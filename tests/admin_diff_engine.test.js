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
    getAllPendingAdminPhotos: vi.fn(() => Promise.resolve({}))
}));

import { state } from '../src/state.js';
import { getAllPendingAdminPhotos } from '../src/database.js';
import {
    prepareDiffData,
    reconcileLocalChanges,
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
});
