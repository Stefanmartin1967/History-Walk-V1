import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks — on isole admin-diff-engine de ses dépendances lourdes :
//   - state.js : objet global mutable par test
//   - data.js  : helpers purs (getPoiId / getPoiName) — note : le module réel
//                les importe depuis utils.js, mais on mock quand même data.js
//                (dépendance transitive potentielle côté admin-*)
//   - database.js : getAllPendingAdminPhotos déclenche initDB (IndexedDB
//                   indisponible sous jsdom) → stub minimal
//   - fetch global : URLs GitHub raw (geojson, circuits.json, tested_*.json)
// ============================================================================

global.fetch = vi.fn();

vi.mock('../src/state.js', () => ({
    state: {
        currentMapId: 'djerba',
        loadedFeatures: [],
        customFeatures: [],
        userData: {},
        officialCircuits: [],
        myCircuits: [],
        testedCircuits: {}
    }
}));

vi.mock('../src/data.js', () => ({
    getPoiId: (f) => f.properties.HW_ID || f.id,
    getPoiName: (f) => f.properties.Nom || 'Sans nom'
}));

vi.mock('../src/database.js', () => ({
    getAllPendingAdminPhotos: vi.fn(() => Promise.resolve({})),
    savePoiData: vi.fn(() => Promise.resolve()),
    deletePoiData: vi.fn(() => Promise.resolve())
}));

import { state } from '../src/state.js';
import { getAllPendingAdminPhotos, savePoiData, deletePoiData } from '../src/database.js';
import {
    prepareDiffData,
    reconcileLocalChanges,
    purgeOrphanPendingPois,
    purgeOrphanPendingCircuits,
    diffData
} from '../src/admin-diff-engine.js';

// ----------------------------------------------------------------------------
// Helper : mock fetch par défaut (geojson vide, circuits vides, tested vide).
// Les tests spécifiques surchargent via mockImplementation pour injecter
// des données remote particulières.
// ----------------------------------------------------------------------------
function defaultFetchImpl(url) {
    if (url.includes('.geojson')) {
        return Promise.resolve({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) });
    }
    if (url.includes('tested_')) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
    }
    if (url.includes('.json')) {
        return Promise.resolve({ ok: true, json: async () => ([]) });
    }
    return Promise.reject(new Error('URL non gérée: ' + url));
}

describe('Admin Diff Engine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.loadedFeatures = [];
        state.customFeatures = [];
        state.userData = {};
        state.officialCircuits = [];
        state.myCircuits = [];
        state.testedCircuits = {};
        // diffData est un export mutable (module-level) — on le remet à plat
        diffData.pois = [];
        diffData.circuits = [];
        diffData.testedChanges = { additions: [], removals: [], hasChanges: false, snapshot: {} };
        diffData.pendingPhotos = {};
        diffData.stats = { poisModified: 0, photosAdded: 0, circuitsModified: 0, testedChanged: 0, pendingPhotoCount: 0 };
        diffData.originalFeatures = [];

        global.fetch.mockImplementation(defaultFetchImpl);
        getAllPendingAdminPhotos.mockResolvedValue({});
    });

    // ========================================================================
    // 1. reconcileLocalChanges — pistage du brouillon admin
    // ========================================================================
    describe('reconcileLocalChanges', () => {
        it('ajoute les customFeatures manquants au draft comme creation', () => {
            state.customFeatures = [
                { properties: { HW_ID: 'custom_1', Nom: 'Mon lieu' } }
            ];
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const changed = reconcileLocalChanges(draft, null, null);

            expect(changed).toBe(true);
            expect(draft.pendingPois['custom_1']).toMatchObject({ type: 'creation' });
            expect(typeof draft.pendingPois['custom_1'].timestamp).toBe('number');
        });

        it('ignore userData si seulement des clés "personnelles" (vu, notes, planifie)', () => {
            // Ces clés vivent dans Gist sync (privées) — elles NE DOIVENT PAS
            // déclencher une entrée dans le brouillon admin (sinon publication
            // de données perso sur le repo public).
            state.userData = {
                'poi_1': { vu: true, notes: 'Super endroit', planifieCounter: 3, hidden: true }
            };
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const changed = reconcileLocalChanges(draft, null, null);

            expect(changed).toBe(false);
            expect(draft.pendingPois).toEqual({});
        });

        it('régression A1 : `incontournable` (perso) seule ne crée pas d\'entrée draft', () => {
            // Avant le fix A1, `incontournable` n'était dans aucune des listes
            // ignoredKeys (admin-diff-engine + data.js) — le marquer comme
            // favori côté admin créait un draft puis fuit dans le geojson public.
            state.userData = {
                'poi_1': { incontournable: true }
            };
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const changed = reconcileLocalChanges(draft, null, null);

            expect(changed).toBe(false);
            expect(draft.pendingPois).toEqual({});
        });

        it('régression A1 : mix incontournable (perso) + Description (métier) → tracé update', () => {
            // La présence de `incontournable` ne doit pas masquer une vraie
            // modif métier qui, elle, doit être tracée normalement.
            state.userData = {
                'poi_1': { incontournable: true, Description: 'Nouveau texte' }
            };
            const draft = { pendingPois: {}, pendingCircuits: {} };

            reconcileLocalChanges(draft, null, null);

            expect(draft.pendingPois['poi_1']).toMatchObject({ type: 'update' });
        });

        it('tracke une modification structurelle userData comme update', () => {
            state.userData = {
                'poi_1': { description: 'Nouveau texte', vu: true } // vu ignoré, description meaningful
            };
            const draft = { pendingPois: {}, pendingCircuits: {} };

            reconcileLocalChanges(draft, null, null);

            expect(draft.pendingPois['poi_1']).toMatchObject({ type: 'update' });
        });

        it('tracke une soft-suppression (_deleted) comme delete', () => {
            state.userData = {
                'poi_1': { _deleted: true }
            };
            const draft = { pendingPois: {}, pendingCircuits: {} };

            reconcileLocalChanges(draft, null, null);

            expect(draft.pendingPois['poi_1']).toMatchObject({ type: 'delete' });
        });

        it('retire du draft les circuits fantômes (absents / sans realTrack / supprimés)', () => {
            // c1 valide, c2 brouillon, c3 corbeille, c4 inexistant
            state.myCircuits = [
                { id: 'c1', realTrack: [[10, 11]] },
                { id: 'c2', realTrack: [] },
                { id: 'c3', realTrack: [[10, 11]], isDeleted: true }
            ];
            const draft = {
                pendingPois: {},
                pendingCircuits: { c1: true, c2: true, c3: true, c4: true }
            };

            const changed = reconcileLocalChanges(draft, null, null);

            expect(changed).toBe(true);
            expect(draft.pendingCircuits).toEqual({ c1: true });
        });

        it('appelle saveDraftCallback + updateBadgeCallback uniquement si changement', () => {
            state.customFeatures = [{ properties: { HW_ID: 'custom_1' } }];
            const draft = { pendingPois: {}, pendingCircuits: {} };
            const saveDraft = vi.fn();
            const updateBadge = vi.fn();

            reconcileLocalChanges(draft, saveDraft, updateBadge);

            expect(saveDraft).toHaveBeenCalledWith(draft);
            expect(updateBadge).toHaveBeenCalledTimes(1);
        });
    });

    // ========================================================================
    // 2. prepareDiffData — Circuits : sécurité des publications (historique)
    // ========================================================================
    describe('prepareDiffData — circuits : sécurité des publications', () => {
        it('NE DOIT PAS proposer un circuit sans trace réelle (Brouillon)', async () => {
            state.myCircuits = [{
                id: 'circuit_brouillon_123',
                name: 'Mon Beau Circuit en cours',
                poiIds: ['poi1', 'poi2'],
                realTrack: [] // TRACE VIDE = BROUILLON
            }];
            const adminDraft = { pendingPois: {}, pendingCircuits: {} };

            const result = await prepareDiffData(adminDraft);

            expect(result.circuits.length).toBe(0);
        });

        it('DOIT proposer un circuit avec une trace valide', async () => {
            state.myCircuits = [{
                id: 'circuit_valide_456',
                name: 'Circuit Fini',
                poiIds: ['poi1', 'poi2'],
                realTrack: [[10.1, 11.2], [10.2, 11.3]]
            }];
            const adminDraft = { pendingPois: {}, pendingCircuits: {} };

            const result = await prepareDiffData(adminDraft);

            expect(result.circuits.length).toBe(1);
            expect(result.circuits[0].id).toBe('circuit_valide_456');
            expect(result.circuits[0].isCreation).toBe(true);
        });

        it('NE signale PAS un circuit en boucle comme modifié (poiIds dédoublonnés)', async () => {
            // Bug 21/05/2026 : l'index distant (régénéré par l'Action) dédoublonne
            // les POIs → une boucle [A,B,C,A] devient [A,B,C]. Sans dédoublonnage
            // côté diff, le circuit était signalé « modifié » en permanence.
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([
                    { id: 'loop1', name: 'Boucle', poiIds: ['A', 'B', 'C'] }
                ]) });
            });
            state.officialCircuits = [{
                id: 'loop1', name: 'Boucle', poiIds: ['A', 'B', 'C', 'A'], // étape 1 = étape 4 (retour)
                realTrack: [[10.1, 11.2], [10.2, 11.3]]
            }];

            const result = await prepareDiffData({ pendingPois: {}, pendingCircuits: {} });

            expect(result.circuits.length).toBe(0); // [A,B,C,A] dédoublonné = [A,B,C] = remote
        });

        it('signale BIEN un vrai changement d\'étapes (POI ajouté)', async () => {
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([
                    { id: 'c5', name: 'C', poiIds: ['A', 'B', 'C'] }
                ]) });
            });
            state.officialCircuits = [{
                id: 'c5', name: 'C', poiIds: ['A', 'B', 'C', 'D'], // vrai ajout de D
                realTrack: [[10.1, 11.2], [10.2, 11.3]]
            }];

            const result = await prepareDiffData({ pendingPois: {}, pendingCircuits: {} });

            expect(result.circuits.length).toBe(1);
            expect(result.circuits[0].changes.some(ch => ch.key === 'Étapes')).toBe(true);
        });

        it('NE signale PAS un circuit comme modifié sur une simple différence de description', async () => {
            // Bug 21/05/2026 (jumeau du bug poiIds en boucle) : la description ne
            // fait pas l'aller-retour via le pipeline GPX → index. L'index distant
            // porte TOUJOURS la constante hardcodée « Circuit généré par History
            // Walk. » (lue dans le <desc> des metadata GPX), tandis qu'en local
            // circuit-actions.js appose la signature « (Créé par History Walk) ».
            // Les deux ne coïncident jamais → differ la description signalait à tort
            // une « modification » permanente. La description n'est plus diffée.
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([
                    { id: 'desc1', name: 'Circuit Desc', poiIds: ['A', 'B'], description: 'Circuit généré par History Walk.' }
                ]) });
            });
            state.officialCircuits = [{
                id: 'desc1', name: 'Circuit Desc', poiIds: ['A', 'B'], // name + poiIds identiques
                description: 'Une jolie balade le long de la côte.\n\n(Créé par History Walk)', // desc locale différente
                realTrack: [[10.1, 11.2], [10.2, 11.3]]
            }];

            const result = await prepareDiffData({ pendingPois: {}, pendingCircuits: {} });

            expect(result.circuits.length).toBe(0); // description ignorée → aucun diff
        });

        it('DOIT proposer la suppression d\'un circuit effacé localement (Ghost Prevention)', async () => {
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({
                    ok: true,
                    json: async () => ([{ id: 'circuit_serveur_789', name: 'Vieux Circuit' }])
                });
            });
            state.myCircuits = [{
                id: 'circuit_serveur_789',
                name: 'Vieux Circuit',
                isDeleted: true
            }];
            const adminDraft = { pendingPois: {}, pendingCircuits: {} };

            const result = await prepareDiffData(adminDraft);

            expect(result.circuits.length).toBe(1);
            expect(result.circuits[0].isDeletion).toBe(true);
            expect(result.circuits[0].changes[0].new).toBe('SUPPRESSION');
        });

        it('DOIT ignorer les modifications personnelles "invisibles" sur un POI', async () => {
            const remotePoi = {
                type: 'Feature',
                properties: { HW_ID: 'poi_1', Nom: 'Phare' },
                geometry: { type: 'Point', coordinates: [10, 20] }
            };
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [remotePoi] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([]) });
            });
            state.loadedFeatures = [remotePoi];
            state.userData = {
                'poi_1': { visited: true, notes: 'Super endroit, je reviendrai.' }
            };
            const adminDraft = { pendingPois: { 'poi_1': { type: 'update' } }, pendingCircuits: {} };

            const result = await prepareDiffData(adminDraft);

            expect(result.pois.length).toBe(0);
            expect(result.stats.poisModified).toBe(0);
        });
    });

    // ========================================================================
    // 3. prepareDiffData — Changes sur POIs
    // ========================================================================
    describe('prepareDiffData — POIs', () => {
        it('ignore une suppression sans original GitHub (POI jamais publié → pas de « SUPPRESSION / Inconnu »)', async () => {
            const draft = { pendingPois: { 'ghost_1': { type: 'delete', timestamp: 1 } }, pendingCircuits: {} };
            global.fetch.mockImplementation(defaultFetchImpl); // geojson vide → pas d'original

            const r = await prepareDiffData(draft);

            expect(r.pois.find(p => p.id === 'ghost_1')).toBeUndefined();
            expect(r.stats.poisModified).toBe(0);
        });

        it('surface une suppression d\'un POI réellement publié sur GitHub (non-régression)', async () => {
            const draft = { pendingPois: { 'real_1': { type: 'delete', timestamp: 1 } }, pendingCircuits: {} };
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) {
                    return Promise.resolve({ ok: true, json: async () => ({ features: [{ properties: { HW_ID: 'real_1', Nom: 'Publié' } }] }) });
                }
                return defaultFetchImpl(url);
            });

            const r = await prepareDiffData(draft);

            const d = r.pois.find(p => p.id === 'real_1');
            expect(d).toBeDefined();
            expect(d.isDeletion).toBe(true);
            expect(r.stats.poisModified).toBe(1);
        });

        it('détecte un changement de Position (coordonnées différentes)', async () => {
            const remotePoi = {
                type: 'Feature',
                properties: { HW_ID: 'p1', Nom: 'Phare' },
                geometry: { type: 'Point', coordinates: [10.0, 20.0] }
            };
            const localPoi = {
                type: 'Feature',
                properties: { HW_ID: 'p1', Nom: 'Phare', userData: {} },
                geometry: { type: 'Point', coordinates: [10.001, 20.001] }
            };
            state.loadedFeatures = [localPoi];
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [remotePoi] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([]) });
            });
            const draft = { pendingPois: { p1: { type: 'update' } }, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            expect(r.pois.length).toBe(1);
            const posChange = r.pois[0].changes.find(c => c.key === 'Position');
            expect(posChange).toBeDefined();
            // Format "lat, lng" (ordre inversé par rapport à GeoJSON [lng, lat])
            expect(posChange.old).toBe('20.00000, 10.00000');
            expect(posChange.new).toBe('20.00100, 10.00100');
        });

        it('régression A1 : `incontournable` (perso) n\'apparaît jamais dans les changes', async () => {
            // Avant le fix A1, la liste display ignoredKeys ne contenait pas
            // `incontournable, notes, planifie` — un POI déjà tracé pour une
            // autre raison (ex: changement de description) affichait aussi
            // ces clés perso dans le diff CC, suggérant à l'admin de les
            // publier alors qu'elles devaient rester locales (Gist privé).
            const remotePoi = {
                type: 'Feature',
                properties: { HW_ID: 'p1', Nom: 'Phare', description: 'Original' },
                geometry: { type: 'Point', coordinates: [10, 20] }
            };
            state.loadedFeatures = [{
                type: 'Feature',
                properties: {
                    HW_ID: 'p1',
                    Nom: 'Phare',
                    description: 'Modifié',
                    userData: { incontournable: true, notes: 'priv', planifie: true, hidden: true }
                },
                geometry: { type: 'Point', coordinates: [10, 20] }
            }];
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [remotePoi] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([]) });
            });
            const draft = { pendingPois: { p1: { type: 'update' } }, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            const changeKeys = r.pois[0].changes.map(c => c.rawKey || c.key);
            // Aucune clé personnelle ne doit apparaître dans les changes affichés
            ['incontournable', 'notes', 'planifie', 'hidden', 'vu', 'vuManual', 'visitedByCircuits'].forEach(k => {
                expect(changeKeys).not.toContain(k);
            });
            // Mais le vrai changement métier (description) reste détecté
            const descChange = r.pois[0].changes.find(c => c.rawKey === 'description');
            expect(descChange).toBeDefined();
        });

        it('détecte une modification de description', async () => {
            const remotePoi = {
                type: 'Feature',
                properties: { HW_ID: 'p1', Nom: 'Phare', description: 'Texte original' },
                geometry: { type: 'Point', coordinates: [10, 20] }
            };
            state.loadedFeatures = [{
                type: 'Feature',
                properties: { HW_ID: 'p1', Nom: 'Phare', description: 'Texte modifié', userData: {} },
                geometry: { type: 'Point', coordinates: [10, 20] }
            }];
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [remotePoi] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([]) });
            });
            const draft = { pendingPois: { p1: { type: 'update' } }, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            const descChange = r.pois[0].changes.find(c => c.rawKey === 'description');
            expect(descChange).toBeDefined();
            expect(descChange.key).toBe('Description'); // libellé utilisateur
            expect(descChange.old).toBe('Texte original');
            expect(descChange.new).toBe('Texte modifié');
        });

        it('incrémente stats.photosAdded quand le nombre de photos augmente', async () => {
            const remotePoi = {
                type: 'Feature',
                properties: { HW_ID: 'p1', Nom: 'Phare', photos: [{ url: 'a.jpg' }] },
                geometry: { type: 'Point', coordinates: [10, 20] }
            };
            state.loadedFeatures = [{
                type: 'Feature',
                properties: {
                    HW_ID: 'p1',
                    Nom: 'Phare',
                    photos: [{ url: 'a.jpg' }, { url: 'b.jpg' }, { url: 'c.jpg' }],
                    userData: {}
                },
                geometry: { type: 'Point', coordinates: [10, 20] }
            }];
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [remotePoi] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([]) });
            });
            const draft = { pendingPois: { p1: { type: 'update' } }, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            expect(r.stats.photosAdded).toBe(2); // 1 → 3
            const photoChange = r.pois[0].changes.find(c => c.key === 'Photos');
            expect(photoChange.old).toBe('1 photo(s)');
            expect(photoChange.new).toBe('3 photo(s)');
        });

        it('gère la migration d\'ID (type=migration, oldId → newId)', async () => {
            state.loadedFeatures = [{
                type: 'Feature',
                properties: { HW_ID: 'new_id', Nom: 'Après migration', userData: {} },
                geometry: { type: 'Point', coordinates: [10, 20] }
            }];
            const draft = {
                pendingPois: { new_id: { type: 'migration', oldId: 'legacy_id' } },
                pendingCircuits: {}
            };

            const r = await prepareDiffData(draft);

            expect(r.pois.length).toBe(1);
            expect(r.pois[0].isMigration).toBe(true);
            const idChange = r.pois[0].changes[0];
            expect(idChange.key).toBe('IDENTIFIANT');
            expect(idChange.old).toBe('legacy_id');
            expect(idChange.new).toBe('new_id');
        });

        it('réunif PR1 : curation d\'un candidat de base → change « Curation » (pas skippé)', async () => {
            // Brouillon GitHub : le candidat est publié avec candidate:true (remote).
            // La curation pose userData.candidate=false → isCandidate(current)=false donc
            // la garde ne le saute plus, et le diff affiche « Candidat à curer → Validé ».
            const remotePoi = {
                type: 'Feature',
                properties: { HW_ID: 'cand_1', 'Nom du site FR': 'Mosquée X', candidate: true },
                geometry: { type: 'Point', coordinates: [10, 20] }
            };
            state.loadedFeatures = [{
                type: 'Feature',
                properties: { HW_ID: 'cand_1', 'Nom du site FR': 'Mosquée X', candidate: true, userData: { candidate: false } },
                geometry: { type: 'Point', coordinates: [10, 20] }
            }];
            state.userData = { cand_1: { candidate: false } };
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [remotePoi] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([]) });
            });
            const draft = { pendingPois: { cand_1: { type: 'update' } }, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            expect(r.pois.length).toBe(1);
            const cur = r.pois[0].changes.find(c => c.key === 'Curation');
            expect(cur).toBeDefined();
            expect(cur.old).toBe('Candidat à curer');
            expect(cur.new).toBe('Validé');
        });

        it('réunif : un candidat NON curé reste exclu du diff (ceinture+bretelles)', async () => {
            state.loadedFeatures = [{
                type: 'Feature',
                properties: { HW_ID: 'cand_2', 'Nom du site FR': 'Y', candidate: true, userData: {} },
                geometry: { type: 'Point', coordinates: [10, 20] }
            }];
            const draft = { pendingPois: { cand_2: { type: 'update' } }, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            expect(r.pois.find(p => p.id === 'cand_2')).toBeUndefined();
        });
    });

    // ========================================================================
    // 4. prepareDiffData — Modifications sur circuits existants
    // ========================================================================
    describe('prepareDiffData — circuits modifiés', () => {
        it('détecte un changement de nom sur un circuit existant', async () => {
            state.myCircuits = [{
                id: 'c1',
                name: 'Nouveau nom',
                realTrack: [[10, 11], [10, 12]],
                poiIds: ['p1']
            }];
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({
                    ok: true,
                    json: async () => ([{
                        id: 'c1',
                        name: 'Ancien nom',
                        realTrack: [[10, 11], [10, 12]],
                        poiIds: ['p1']
                    }])
                });
            });
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            expect(r.circuits.length).toBe(1);
            expect(r.circuits[0].isCreation).toBeUndefined();
            const nomChange = r.circuits[0].changes.find(c => c.key === 'Nom');
            expect(nomChange.old).toBe('Ancien nom');
            expect(nomChange.new).toBe('Nouveau nom');
        });

        it('détecte un réordonnancement des poiIds', async () => {
            state.myCircuits = [{
                id: 'c1', name: 'Circuit',
                realTrack: [[10, 11]],
                poiIds: ['p1', 'p2', 'p3']
            }];
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({
                    ok: true,
                    json: async () => ([{
                        id: 'c1', name: 'Circuit',
                        realTrack: [[10, 11]],
                        poiIds: ['p3', 'p1', 'p2']
                    }])
                });
            });
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            const etapesChange = r.circuits[0].changes.find(c => c.key === 'Étapes');
            expect(etapesChange).toBeDefined();
        });

        it('détecte une modification de realTrack au-delà du seuil de tolérance (> 5 points)', async () => {
            const makeTrack = (n) => Array.from({ length: n }, (_, i) => [10 + i * 0.01, 11 + i * 0.01]);
            state.myCircuits = [{
                id: 'c1', name: 'Circuit',
                realTrack: makeTrack(20),
                poiIds: ['p1']
            }];
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({
                    ok: true,
                    json: async () => ([{
                        id: 'c1', name: 'Circuit',
                        realTrack: makeTrack(10), // écart 10 pts > seuil 5
                        poiIds: ['p1']
                    }])
                });
            });
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            const traceChange = r.circuits[0].changes.find(c => c.key === 'Trace GPS');
            expect(traceChange).toBeDefined();
            expect(traceChange.old).toBe('10 pts');
            expect(traceChange.new).toBe('20 pts');
        });

        // Bug pré-existant fixé 15/05/2026 : circuits/<map>.json publié sur
        // GitHub ne contient pas realTrack (chargé lazy via GPX séparé côté
        // admin). Avant le fix, le diff comparait local.realTrack (rempli après
        // ouverture de la fiche) à remote.realTrack=undefined (=0 pts) et
        // générait "0 pts → N pts" comme fausse modification.
        it("n'émet pas de diff Trace GPS si remote.realTrack est undefined (cas djerba.json publié)", async () => {
            const makeTrack = (n) => Array.from({ length: n }, (_, i) => [10 + i * 0.01, 11 + i * 0.01]);
            state.myCircuits = [{
                id: 'c1', name: 'Circuit',
                realTrack: makeTrack(343), // chargé localement après ouverture admin
                poiIds: ['p1']
            }];
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({
                    ok: true,
                    json: async () => ([{
                        id: 'c1', name: 'Circuit',
                        // pas de realTrack — comportement du JSON publié réel
                        poiIds: ['p1']
                    }])
                });
            });
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            // Aucun diff Trace GPS, et donc aucun circuit modifié remonté
            // (puisque les autres champs sont identiques : name, poiIds).
            const entry = r.circuits.find(c => c.id === 'c1');
            expect(entry).toBeUndefined();
        });

        it("garde le diff si remote.realTrack est présent (cas suppression admin réelle)", async () => {
            // Scenario : remote.realTrack = [...10 pts] est dans le JSON publié
            // (cas théorique futur ou autre destination). Local a 20 pts.
            // → diff doit être détecté normalement.
            const makeTrack = (n) => Array.from({ length: n }, (_, i) => [10 + i * 0.01, 11 + i * 0.01]);
            state.myCircuits = [{
                id: 'c1', name: 'Circuit',
                realTrack: makeTrack(20),
                poiIds: ['p1']
            }];
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({
                    ok: true,
                    json: async () => ([{
                        id: 'c1', name: 'Circuit',
                        realTrack: makeTrack(10),
                        poiIds: ['p1']
                    }])
                });
            });
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            const traceChange = r.circuits[0].changes.find(c => c.key === 'Trace GPS');
            expect(traceChange).toBeDefined();
            expect(traceChange.old).toBe('10 pts');
            expect(traceChange.new).toBe('20 pts');
        });
    });

    // ========================================================================
    // 5. prepareDiffData — testedChanges (admin coche "fait")
    // ========================================================================
    describe('prepareDiffData — testedChanges', () => {
        it('détecte un circuit nouvellement marqué "fait" (addition)', async () => {
            state.officialCircuits = [{ id: 'c1', name: 'Circuit Alpha' }];
            state.testedCircuits = { c1: true };
            // tested.json remote vide → addition détectée
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            expect(r.testedChanges.additions).toEqual([{ id: 'c1', name: 'Circuit Alpha' }]);
            expect(r.testedChanges.removals).toEqual([]);
            expect(r.testedChanges.hasChanges).toBe(true);
            expect(r.stats.testedChanged).toBe(1);
            expect(r.testedChanges.snapshot).toEqual({ c1: true });
        });

        it('détecte un circuit décoché localement (removal)', async () => {
            state.officialCircuits = [{ id: 'c2', name: 'Circuit Beta' }];
            state.testedCircuits = {}; // rien côté local
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({ c2: true }) });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([]) });
            });
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            expect(r.testedChanges.additions).toEqual([]);
            expect(r.testedChanges.removals).toEqual([{ id: 'c2', name: 'Circuit Beta' }]);
            expect(r.testedChanges.hasChanges).toBe(true);
            expect(r.stats.testedChanged).toBe(1);
        });

        it('hasChanges=false quand local et remote sont identiques', async () => {
            state.testedCircuits = { c1: true };
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({ c1: true }) });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([]) });
            });
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            expect(r.testedChanges.hasChanges).toBe(false);
            expect(r.testedChanges.additions).toEqual([]);
            expect(r.testedChanges.removals).toEqual([]);
            expect(r.stats.testedChanged).toBe(0);
        });
    });

    // ========================================================================
    // 6. prepareDiffData — pendingPhotos (Chantier 2 CC : grille cochable)
    // ========================================================================
    describe('prepareDiffData — pendingPhotos', () => {
        it('attache les photos à un POI déjà présent dans diffData', async () => {
            const remotePoi = {
                type: 'Feature',
                properties: { HW_ID: 'poi_1', Nom: 'Phare', description: 'Old' },
                geometry: { type: 'Point', coordinates: [10, 20] }
            };
            state.loadedFeatures = [{
                type: 'Feature',
                properties: { HW_ID: 'poi_1', Nom: 'Phare', description: 'New', userData: {} },
                geometry: { type: 'Point', coordinates: [10, 20] }
            }];
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [remotePoi] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: true, json: async () => ({}) });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([]) });
            });
            getAllPendingAdminPhotos.mockResolvedValueOnce({
                poi_1: [{ id: 'ph1', blob: 'blob_a', skipPublish: false }]
            });
            const draft = { pendingPois: { poi_1: { type: 'update' } }, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            // Pas de doublon : un seul item POI
            const items = r.pois.filter(p => p.id === 'poi_1');
            expect(items.length).toBe(1);
            expect(items[0].hasPendingPhotos).toBe(true);
            expect(items[0].pendingPhotos).toHaveLength(1);
            expect(items[0].pendingPhotos[0].id).toBe('ph1');
            expect(items[0].pendingPhotos[0].skipPublish).toBe(false);
        });

        it('crée un item POI minimal si photos sur un POI pas encore dans diffData', async () => {
            // Note : admin-diff-engine importe getPoiName de utils.js (pas data.js),
            // et le vrai getPoiName lit 'Nom du site FR' / 'Nom du site AR' / name.
            // On reflète ici le schéma réel du geojson djerba.
            state.loadedFeatures = [{
                type: 'Feature',
                properties: { HW_ID: 'poi_2', 'Nom du site FR': 'Plage' },
                geometry: { type: 'Point', coordinates: [9, 19] }
            }];
            getAllPendingAdminPhotos.mockResolvedValueOnce({
                poi_2: [{ id: 'ph1', blob: 'blob_a', skipPublish: false }]
            });
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            const poi2 = r.pois.find(p => p.id === 'poi_2');
            expect(poi2).toBeDefined();
            expect(poi2.hasPendingPhotos).toBe(true);
            expect(poi2.name).toBe('Plage'); // résolu via getPoiName (utils.js)
            expect(poi2.changes).toEqual([]);
            expect(r.stats.poisModified).toBe(1);
        });

        it('exclut les photos skipPublish=true du compteur pendingPhotoCount', async () => {
            state.loadedFeatures = [{
                type: 'Feature',
                properties: { HW_ID: 'poi_3', Nom: 'Souk' },
                geometry: { type: 'Point', coordinates: [8, 18] }
            }];
            getAllPendingAdminPhotos.mockResolvedValueOnce({
                poi_3: [
                    { id: 'ph1', blob: 'a', skipPublish: false },
                    { id: 'ph2', blob: 'b', skipPublish: true },  // gardée locale
                    { id: 'ph3', blob: 'c', skipPublish: false }
                ]
            });
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            // Toutes les entrées sont exposées à l'UI (grille)...
            expect(r.pendingPhotos['poi_3']).toHaveLength(3);
            // ...mais seules les publishables comptent dans stats.
            expect(r.stats.pendingPhotoCount).toBe(2);
        });
    });

    // ========================================================================
    // 7. prepareDiffData — Gestion d'erreur fetch
    // ========================================================================
    describe('prepareDiffData — gestion d\'erreur', () => {
        it('continue sans crasher si tested.json renvoie 404 (1re publication)', async () => {
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
                if (url.includes('tested_')) return Promise.resolve({ ok: false, status: 404 });
                if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([]) });
            });
            const draft = { pendingPois: {}, pendingCircuits: {} };

            const r = await prepareDiffData(draft);

            // Fallback {} : pas d'additions/removals, pas de crash
            expect(r.testedChanges.hasChanges).toBe(false);
            expect(r.testedChanges.additions).toEqual([]);
            expect(r.testedChanges.removals).toEqual([]);
            expect(r.testedChanges.snapshot).toEqual({});
        });

        it('continue sans crasher si les fetch tombent en network error', async () => {
            global.fetch.mockImplementation(() => Promise.reject(new Error('Network error')));
            const draft = { pendingPois: {}, pendingCircuits: {} };

            // Ne doit pas throw — le catch interne log et poursuit avec arrays vides
            const r = await prepareDiffData(draft);

            expect(r.pois).toEqual([]);
            expect(r.circuits).toEqual([]);
            expect(r.stats.poisModified).toBe(0);
            expect(r.stats.circuitsModified).toBe(0);
        });
    });

    // ========================================================================
    // purgeOrphanPendingPois — auto-heal des entries pendingPois sans diff réel
    // (bug observé 20/05/2026 par Stefan : badge=1 vs dashboard=0 ; DM bloqué).
    // ========================================================================
    describe('purgeOrphanPendingPois', () => {
        beforeEach(() => {
            // Le purge nettoie via savePoiData/deletePoiData — on les surveille.
            savePoiData.mockClear();
            deletePoiData.mockClear();
        });

        it('purge une entry pendingPois sans diff réel + nettoie userData (match patrimoine)', async () => {
            // Patrimoine : POI avec Catégorie=Mosquée
            const original = { properties: { HW_ID: 'poi_1', Nom: 'Test', 'Catégorie': 'Mosquée' }, geometry: { coordinates: [10, 33] } };
            state.loadedFeatures = [{ ...original, properties: { ...original.properties, userData: { 'Catégorie': 'Mosquée' } } }];
            // userData : admin a "ré-écrit" Catégorie=Mosquée (valeur identique au patrimoine)
            state.userData = { 'poi_1': { 'Catégorie': 'Mosquée' } };
            const draft = {
                pendingPois: { 'poi_1': { type: 'update', timestamp: 1 } },
                pendingCircuits: {}
            };

            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) {
                    return Promise.resolve({ ok: true, json: async () => ({ features: [original] }) });
                }
                return defaultFetchImpl(url);
            });

            await prepareDiffData(draft);
            const purged = await purgeOrphanPendingPois(draft);

            expect(purged).toEqual(['poi_1']);
            expect(draft.pendingPois).toEqual({});
            // userData devient {} → deletePoiData appelée
            expect(deletePoiData).toHaveBeenCalledWith('djerba', 'poi_1');
            expect(state.userData['poi_1']).toBeUndefined();
        });

        it('garde une entry pendingPois qui a un vrai diff', async () => {
            const original = { properties: { HW_ID: 'poi_1', Nom: 'Old', 'Catégorie': 'Mosquée' }, geometry: { coordinates: [10, 33] } };
            state.loadedFeatures = [{ properties: { ...original.properties, userData: { 'Catégorie': 'Marabout' } }, geometry: { coordinates: [10, 33] } }];
            state.userData = { 'poi_1': { 'Catégorie': 'Marabout' } };
            const draft = {
                pendingPois: { 'poi_1': { type: 'update', timestamp: 1 } },
                pendingCircuits: {}
            };

            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) {
                    return Promise.resolve({ ok: true, json: async () => ({ features: [original] }) });
                }
                return defaultFetchImpl(url);
            });

            await prepareDiffData(draft);
            const purged = await purgeOrphanPendingPois(draft);

            expect(purged).toEqual([]);
            expect(draft.pendingPois['poi_1']).toBeDefined();
        });

        it('ignore les entries `creation` / `migration` + `delete` LÉGITIME (POI sur GitHub)', async () => {
            state.customFeatures = [{ properties: { HW_ID: 'new_1', Nom: 'New POI' } }];
            state.loadedFeatures = [{ properties: { HW_ID: 'new_1', Nom: 'New POI' } }];
            const draft = {
                pendingPois: {
                    'new_1': { type: 'creation', timestamp: 1 },
                    'del_1': { type: 'delete', timestamp: 2 },
                    'mig_1': { type: 'migration', oldId: 'legacy_x', timestamp: 3 }
                },
                pendingCircuits: {}
            };
            // del_1 existe SUR GITHUB → suppression légitime, préservée par la purge.
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) {
                    return Promise.resolve({ ok: true, json: async () => ({ features: [{ properties: { HW_ID: 'del_1', Nom: 'Old POI' } }] }) });
                }
                return defaultFetchImpl(url);
            });

            await prepareDiffData(draft);
            const purged = await purgeOrphanPendingPois(draft);

            expect(purged).toEqual([]);
            expect(draft.pendingPois['new_1']).toBeDefined();
            expect(draft.pendingPois['del_1']).toBeDefined();
            expect(draft.pendingPois['mig_1']).toBeDefined();
        });

        it('purge une suppression FANTÔME (delete sans original GitHub — candidat supprimé au tri)', async () => {
            const draft = {
                pendingPois: { 'ghost_1': { type: 'delete', timestamp: 1 } },
                pendingCircuits: {}
            };
            global.fetch.mockImplementation(defaultFetchImpl); // geojson vide → ghost_1 absent de GitHub

            await prepareDiffData(draft);
            const purged = await purgeOrphanPendingPois(draft);

            expect(purged).toEqual(['ghost_1']);
            expect(draft.pendingPois['ghost_1']).toBeUndefined();
        });

        it('purge même quand userData contient des champs vides absents du patrimoine (régression 21/05/2026)', async () => {
            // Bug réel observé : richEditor sauvegarde Téléphone='', Horaires=''
            // pour un POI dont le patrimoine n'a pas ces champs. prepareDiffData
            // dit « 0 diff » via le shortcut isDefaultEmpty. L'ancien purge
            // disait « suspect » et refusait → bug persistait.
            const original = { properties: { HW_ID: 'poi_1', 'Catégorie': 'Mosquée' }, geometry: { coordinates: [10, 33] } };
            state.loadedFeatures = [{ ...original, properties: { ...original.properties, userData: { Téléphone: '', Horaires: '', photos: [] } } }];
            state.userData = { 'poi_1': { Téléphone: '', Horaires: '', photos: [] } };
            const draft = {
                pendingPois: { 'poi_1': { type: 'update', timestamp: 1 } },
                pendingCircuits: {}
            };
            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) {
                    return Promise.resolve({ ok: true, json: async () => ({ features: [original] }) });
                }
                return defaultFetchImpl(url);
            });

            await prepareDiffData(draft);
            const purged = await purgeOrphanPendingPois(draft);

            // L'orphelin DOIT être purgé (auparavant ce test cassait → "suspect")
            expect(purged).toEqual(['poi_1']);
            expect(draft.pendingPois).toEqual({});
            expect(state.userData['poi_1']).toBeUndefined();
            expect(deletePoiData).toHaveBeenCalledWith('djerba', 'poi_1');
        });

        it('préserve les clés personnelles de userData après purge', async () => {
            const original = { properties: { HW_ID: 'poi_1', 'Catégorie': 'Mosquée' }, geometry: { coordinates: [10, 33] } };
            state.loadedFeatures = [{ ...original, properties: { ...original.properties, userData: { 'Catégorie': 'Mosquée', vu: true } } }];
            // userData : Catégorie matche patrimoine (à purger) + vu personnel (à garder)
            state.userData = { 'poi_1': { 'Catégorie': 'Mosquée', vu: true } };
            const draft = {
                pendingPois: { 'poi_1': { type: 'update', timestamp: 1 } },
                pendingCircuits: {}
            };

            global.fetch.mockImplementation((url) => {
                if (url.includes('.geojson')) {
                    return Promise.resolve({ ok: true, json: async () => ({ features: [original] }) });
                }
                return defaultFetchImpl(url);
            });

            await prepareDiffData(draft);
            const purged = await purgeOrphanPendingPois(draft);

            expect(purged).toEqual(['poi_1']);
            // userData ne contient plus que la clé personnelle
            expect(state.userData['poi_1']).toEqual({ vu: true });
            expect(savePoiData).toHaveBeenCalledWith('djerba', 'poi_1', { vu: true });
            expect(deletePoiData).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // purgeOrphanPendingCircuits — auto-heal des pendingCircuits sans diff réel
    // (bug observé 03/06/2026 : badge=1 / CC vide après publication d'un circuit).
    // La fonction ne lit que diffData.circuits → testable en isolation.
    // ========================================================================
    describe('purgeOrphanPendingCircuits', () => {
        it('purge un pendingCircuit sans diff réel (circuit déjà publié)', () => {
            diffData.circuits = []; // prepareDiffData n'a vu aucune différence
            const draft = { pendingPois: {}, pendingCircuits: { 'c1': { timestamp: 1 } } };
            const purged = purgeOrphanPendingCircuits(draft);
            expect(purged).toEqual(['c1']);
            expect(draft.pendingCircuits).toEqual({});
        });

        it('garde un pendingCircuit qui a un vrai diff', () => {
            diffData.circuits = [{ id: 'c1', name: 'X', changes: [{ key: 'Nom', old: 'A', new: 'B' }] }];
            const draft = { pendingPois: {}, pendingCircuits: { 'c1': { timestamp: 1 }, 'c2': { timestamp: 2 } } };
            const purged = purgeOrphanPendingCircuits(draft);
            expect(purged).toEqual(['c2']);          // c2 orphelin → purgé
            expect(draft.pendingCircuits['c1']).toBeDefined(); // c1 a un diff → gardé
            expect(draft.pendingCircuits['c2']).toBeUndefined();
        });

        it('normalise les ids string/number (match via String)', () => {
            diffData.circuits = [{ id: 123, name: 'X', changes: [{ key: 'Nom' }] }];
            const draft = { pendingPois: {}, pendingCircuits: { '123': { timestamp: 1 } } };
            const purged = purgeOrphanPendingCircuits(draft);
            expect(purged).toEqual([]);
            expect(draft.pendingCircuits['123']).toBeDefined();
        });

        it('tolère un brouillon vide / sans pendingCircuits', () => {
            diffData.circuits = [];
            expect(purgeOrphanPendingCircuits({ pendingPois: {}, pendingCircuits: {} })).toEqual([]);
            expect(purgeOrphanPendingCircuits({})).toEqual([]);
            expect(purgeOrphanPendingCircuits(null)).toEqual([]);
        });
    });
});
