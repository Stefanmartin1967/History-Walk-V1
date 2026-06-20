import { describe, it, expect, vi, beforeEach } from 'vitest';

// PR-3 (modèle C) : le helper feuille persistPoiEdit, partagé par les 2 éditeurs
// de POI (richEditor.executeEdit + ui-photo-batch.saveTaxonomyBatch). On vérifie
// le ROUTAGE custom-vs-base — coeur du fix « revert de curation » : un POI custom
// (capture Scout) doit s'écrire dans properties + customPois (PAS l'overlay).

vi.mock('../src/state.js', () => ({
    state: { loadedFeatures: [], customFeatures: [], userData: {}, currentMapId: 'djerba' }
}));
vi.mock('../src/database.js', () => ({
    saveAppState: vi.fn(() => Promise.resolve()),
    savePoiData: vi.fn(() => Promise.resolve()),
    deletePoiData: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/utils.js', () => ({
    getPoiId: (f) => f?.properties?.HW_ID || f?.id,
}));

import { state } from '../src/state.js';
import { saveAppState, savePoiData, deletePoiData } from '../src/database.js';
import { persistPoiEdit } from '../src/poi-persistence.js';

function poi(id, props = {}) {
    return { type: 'Feature', properties: { HW_ID: id, ...props }, geometry: { type: 'Point', coordinates: [10, 33] } };
}

beforeEach(() => {
    vi.clearAllMocks();
    state.loadedFeatures = [];
    state.customFeatures = [];
    state.userData = {};
    state.currentMapId = 'djerba';
});

describe('persistPoiEdit — POI de BASE (overlay userData)', () => {
    it('écrit dans userData + savePoiData, ne touche pas customPois', async () => {
        const f = poi('base_1');
        state.loadedFeatures = [f];
        state.customFeatures = []; // pas custom

        await persistPoiEdit('base_1', { 'Catégorie': 'Mosquée', 'Sous-type': 'À minaret' });

        expect(state.userData['base_1']).toEqual({ 'Catégorie': 'Mosquée', 'Sous-type': 'À minaret' });
        expect(f.properties.userData).toBe(state.userData['base_1']); // rebind
        expect(savePoiData).toHaveBeenCalledWith('djerba', 'base_1', state.userData['base_1']);
        // Aucune écriture customPois en branche base.
        expect(saveAppState).not.toHaveBeenCalledWith('customPois_djerba', expect.anything());
        // La catégorie NE doit PAS être écrite dans properties (réservé au custom).
        expect(f.properties['Catégorie']).toBeUndefined();
    });

    it('P7 — fold `candidate:false` (base) : écrit dans l\'overlay userData', async () => {
        const f = poi('base_cand', { candidate: true });
        state.loadedFeatures = [f];
        state.customFeatures = [];

        await persistPoiEdit('base_cand', { 'Catégorie': 'Mosquée', candidate: false });

        expect(state.userData['base_cand'].candidate).toBe(false);
        expect(savePoiData).toHaveBeenCalledWith('djerba', 'base_cand', state.userData['base_cand']);
    });
});

describe('persistPoiEdit — POI CUSTOM (properties + customPois, overlay purgé)', () => {
    it('écrit dans properties + customPois, purge l\'overlay userData, ne fait pas savePoiData', async () => {
        const f = poi('HW-CUST-1', { 'Catégorie': 'A définir' });
        state.loadedFeatures = [f];
        state.customFeatures = [f];                       // custom
        state.userData['HW-CUST-1'] = { 'Catégorie': 'Vieux' }; // overlay résiduel à purger

        await persistPoiEdit('HW-CUST-1', { 'Catégorie': 'Musée', 'Sous-type': 'Régional' });

        // Écrit dans le POI lui-même.
        expect(f.properties['Catégorie']).toBe('Musée');
        expect(f.properties['Sous-type']).toBe('Régional');
        // Overlay purgé (sinon getPoiProp masquerait la version curée).
        expect(state.userData['HW-CUST-1']).toBeUndefined();
        expect(f.properties.userData).toBeUndefined();
        expect(deletePoiData).toHaveBeenCalledWith('djerba', 'HW-CUST-1');
        // Persistance custom : customPois + lastGeoJSON + userData purgé.
        expect(saveAppState).toHaveBeenCalledWith('customPois_djerba', state.customFeatures);
        expect(saveAppState).toHaveBeenCalledWith('lastGeoJSON', expect.objectContaining({ type: 'FeatureCollection' }));
        expect(saveAppState).toHaveBeenCalledWith('userData', state.userData);
        // PAS de savePoiData en branche custom (ce serait re-créer l'overlay).
        expect(savePoiData).not.toHaveBeenCalled();
    });

    it('retire les champs vides ("") mais conserve false / 0', async () => {
        const f = poi('HW-CUST-2', { 'Sous-type': 'AncienSousType' });
        state.loadedFeatures = [f];
        state.customFeatures = [f];

        await persistPoiEdit('HW-CUST-2', { 'Sous-type': '', 'verified': false, 'Prix_TND': 0 });

        expect(f.properties['Sous-type']).toBeUndefined(); // vidé → clé retirée
        expect(f.properties['verified']).toBe(false);      // conservé
        expect(f.properties['Prix_TND']).toBe(0);          // conservé
    });

    it('PRÉSERVE l\'enrichissement overlay (photos / accessPoint / vu) — pas de perte de données', async () => {
        // Régression rattrapée en revue PR-3 : catégoriser une capture enrichie ne
        // doit PAS effacer son overlay (photos/accessPoint/vu vivent UNIQUEMENT là
        // pour un POI custom). On ne retire que les clés taxonomie réécrites.
        const f = poi('HW-CUST-3');
        state.loadedFeatures = [f];
        state.customFeatures = [f];
        state.userData['HW-CUST-3'] = { photos: ['p1.jpg'], accessPoint: [[10, 33]], vuManual: true };

        await persistPoiEdit('HW-CUST-3', { 'Catégorie': 'Musée', 'Sous-type': '' });

        // Catégorie écrite dans properties.
        expect(f.properties['Catégorie']).toBe('Musée');
        // Enrichissement INTACT dans l'overlay.
        expect(state.userData['HW-CUST-3']).toEqual({ photos: ['p1.jpg'], accessPoint: [[10, 33]], vuManual: true });
        // L'overlay reste référencé par le feature (lisible en session) + persisté
        // intégralement (les photos/accessPoint/vu survivent).
        expect(f.properties.userData).toBe(state.userData['HW-CUST-3']);
        expect(savePoiData).toHaveBeenCalledWith('djerba', 'HW-CUST-3', state.userData['HW-CUST-3']);
    });

    it('P7 — fold `candidate:false` (custom) : conservé dans properties (≠ vide), POI plus candidat', async () => {
        // « Valider & enregistrer » route candidate:false via le dict data. Pour un
        // custom, false n'est PAS retiré (≠ "" / null) → properties.candidate=false →
        // isCandidate false ; admin-geojson retire la clé `=== false` à la publication.
        const f = poi('HW-CUST-5', { candidate: true, 'Catégorie': 'A définir' });
        state.loadedFeatures = [f];
        state.customFeatures = [f];

        await persistPoiEdit('HW-CUST-5', { 'Catégorie': 'Musée', candidate: false });

        expect(f.properties.candidate).toBe(false); // conservé (≠ delete)
        expect(f.properties['Catégorie']).toBe('Musée');
        expect(saveAppState).toHaveBeenCalledWith('customPois_djerba', state.customFeatures);
    });

    it('overlay MIXTE : retire la clé taxonomie du store (REPLACE, pas merge) → pas de revert au reload', async () => {
        const f = poi('HW-CUST-4');
        state.loadedFeatures = [f];
        state.customFeatures = [f];
        state.userData['HW-CUST-4'] = { 'Catégorie': 'ObsolèteOverlay', photos: ['a.jpg'] };

        await persistPoiEdit('HW-CUST-4', { 'Catégorie': 'Fortification' });

        // Catégorie va dans properties ; la version overlay obsolète est retirée en
        // mémoire ; les photos restent.
        expect(f.properties['Catégorie']).toBe('Fortification');
        expect(state.userData['HW-CUST-4']).toEqual({ photos: ['a.jpg'] });
        // CLÉ DU FIX reload-revert : savePoiData MERGE (ne supprime pas une clé du
        // store) → on doit REMPLACER l'entrée (delete puis save) pour que la clé
        // taxonomie obsolète ne ressorte pas au boot via getAllPoiDataForMap.
        expect(deletePoiData).toHaveBeenCalledWith('djerba', 'HW-CUST-4');
        expect(savePoiData).toHaveBeenCalledWith('djerba', 'HW-CUST-4', { photos: ['a.jpg'] });
        // L'ordre garantit le replace : delete AVANT save.
        expect(deletePoiData.mock.invocationCallOrder[0]).toBeLessThan(savePoiData.mock.invocationCallOrder[0]);
    });
});
