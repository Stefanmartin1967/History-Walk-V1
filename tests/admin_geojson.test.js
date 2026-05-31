import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// admin-geojson.js — génération du geojson maître publié sur GitHub.
// On vérifie que les clés personnelles (PERSONAL_KEYS) sont systématiquement
// purgées du geojson final (sécurité données : pas de fuite Gist privé vers
// la source publique).
// ============================================================================

vi.mock('../src/state.js', () => ({
    state: {
        currentMapId: 'djerba',
        loadedFeatures: []
    }
}));

vi.mock('../src/utils.js', () => ({
    getPoiId: (f) => f.properties.HW_ID || f.id
}));

import { state } from '../src/state.js';
import { generateMasterGeoJSONData } from '../src/admin-geojson.js';
import { PERSONAL_KEYS } from '../src/config.js';

function buildFeature(id, properties = {}, userData = null, geom = [10, 33]) {
    const props = { HW_ID: id, ...properties };
    if (userData) props.userData = userData;
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: geom },
        properties: props
    };
}

describe('admin-geojson — generateMasterGeoJSONData', () => {
    beforeEach(() => {
        state.loadedFeatures = [];
    });

    it('retourne null si aucune feature chargée', () => {
        expect(generateMasterGeoJSONData()).toBeNull();
    });

    it('purge TOUTES les PERSONAL_KEYS du geojson final', () => {
        const dirty = {};
        PERSONAL_KEYS.forEach(k => {
            dirty[k] = (k === 'visitedByCircuits') ? ['CIRC1'] : true;
        });
        dirty.notes = 'note privée';

        state.loadedFeatures = [buildFeature('poi_1', { Nom: 'Test' }, dirty)];

        const result = generateMasterGeoJSONData();
        const props = result.features[0].properties;

        const leakedKeys = PERSONAL_KEYS.filter(k => k in props);
        expect(leakedKeys).toEqual([]);
    });

    it('préserve les champs métier (Nom, Catégorie, lat, lng, HW_ID, verified)', () => {
        state.loadedFeatures = [buildFeature('poi_1', {
            Nom: 'Site A',
            'Catégorie': 'monument',
            description: 'Texte',
            verified: true
        }, { vu: true, notes: 'priv' })];

        const props = generateMasterGeoJSONData().features[0].properties;
        expect(props.Nom).toBe('Site A');
        expect(props['Catégorie']).toBe('monument');
        expect(props.description).toBe('Texte');
        expect(props.verified).toBe(true);
        expect(props.HW_ID).toBe('poi_1');
    });

    it('exclut un POI marqué userData._deleted', () => {
        state.loadedFeatures = [
            buildFeature('poi_keep', { Nom: 'Garde' }),
            buildFeature('poi_drop', { Nom: 'Drop' }, { _deleted: true })
        ];
        const ids = generateMasterGeoJSONData().features.map(f => f.properties.HW_ID);
        expect(ids).toContain('poi_keep');
        expect(ids).not.toContain('poi_drop');
    });

    it('exclut les ids passés en excludedIds', () => {
        state.loadedFeatures = [
            buildFeature('a'), buildFeature('b'), buildFeature('c')
        ];
        const ids = generateMasterGeoJSONData(['b']).features.map(f => f.properties.HW_ID);
        expect(ids).toEqual(['a', 'c']);
    });

    it('purge les photos base64 mais garde les URLs', () => {
        state.loadedFeatures = [buildFeature('poi_1', {
            photos: [
                'https://github.com/photo1.jpg',
                'data:image/jpeg;base64,XXXX',
                'https://github.com/photo2.jpg'
            ]
        })];
        const props = generateMasterGeoJSONData().features[0].properties;
        expect(props.photos).toEqual([
            'https://github.com/photo1.jpg',
            'https://github.com/photo2.jpg'
        ]);
    });

    it('le HW_ID original n\'est jamais écrasé par une vieille valeur dans userData', () => {
        state.loadedFeatures = [buildFeature('NEW_ID', { Nom: 'Test' }, { HW_ID: 'OLD_ID' })];
        const props = generateMasterGeoJSONData().features[0].properties;
        expect(props.HW_ID).toBe('NEW_ID');
    });

    it('ne contient plus la propriété userData (flatten effectué)', () => {
        state.loadedFeatures = [buildFeature('poi_1', { Nom: 'Test' }, { description: 'x' })];
        const props = generateMasterGeoJSONData().features[0].properties;
        expect('userData' in props).toBe(false);
        expect(props.description).toBe('x');
    });

    it('régression A1 : un POI marqué incontournable (perso) ne fuit pas dans le geojson', () => {
        // Avant le fix A1, `incontournable` n'était dans aucune des listes
        // ignoredKeys → fuitait dans le geojson public à chaque publish.
        state.loadedFeatures = [buildFeature('poi_1', { Nom: 'Test' }, { incontournable: true })];
        const props = generateMasterGeoJSONData().features[0].properties;
        expect('incontournable' in props).toBe(false);
    });
});
