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
        loadedFeatures: [],
        hiddenPoiIds: []
    }
}));

vi.mock('../src/utils.js', () => ({
    getPoiId: (f) => f.properties.HW_ID || f.id,
    // Réplique de l'overlay userData : userData.candidate prime sur properties.candidate.
    isCandidate: (f) => {
        const ud = f?.properties?.userData;
        const v = (ud && ud.candidate !== undefined) ? ud.candidate : f?.properties?.candidate;
        return !!v;
    },
    // Dégel de Zone : generateMasterGeoJSONData cuit une Zone fraîche au publish via
    // deriveZoneSafe. En test (zones non chargées) on renvoie la valeur stockée → la
    // cuisson est un no-op, les assertions existantes restent valides.
    deriveZoneSafe: (_lat, _lng, stored) => stored,
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
        state.hiddenPoiIds = [];
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

    it('fix 07/08 : exclut un POI dont l\'id est dans state.hiddenPoiIds (soft-delete)', () => {
        // hiddenPoiIds est écrit en tout premier par deletePoi, avant toute activité
        // réseau — garde la plus fiable pour qu'un lieu supprimé ne soit jamais
        // republié tel quel, même si le brouillon de suppression a été perdu.
        state.loadedFeatures = [
            buildFeature('poi_keep', { Nom: 'Garde' }),
            buildFeature('poi_hidden', { Nom: 'Caché' })
        ];
        state.hiddenPoiIds = ['poi_hidden'];
        const ids = generateMasterGeoJSONData().features.map(f => f.properties.HW_ID);
        expect(ids).toContain('poi_keep');
        expect(ids).not.toContain('poi_hidden');
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

    it('réunif : exclut par défaut un candidat Scout non curé (pas de fuite publique)', () => {
        state.loadedFeatures = [
            buildFeature('poi_reel', { Nom: 'Réel' }),
            buildFeature('poi_cand', { Nom: 'Candidat', candidate: true })
        ];
        const ids = generateMasterGeoJSONData().features.map(f => f.properties.HW_ID);
        expect(ids).toContain('poi_reel');
        expect(ids).not.toContain('poi_cand');
    });

    it('réunif : keepCandidates:true (brouillon GitHub) conserve les candidats', () => {
        state.loadedFeatures = [
            buildFeature('poi_reel', { Nom: 'Réel' }),
            buildFeature('poi_cand', { Nom: 'Candidat', candidate: true })
        ];
        const ids = generateMasterGeoJSONData([], { keepCandidates: true })
            .features.map(f => f.properties.HW_ID);
        expect(ids).toContain('poi_reel');
        expect(ids).toContain('poi_cand');
    });

    it('réunif PR1 : un candidat de base CURÉ (userData.candidate=false) est publié SANS la clé candidate', () => {
        // Brouillon GitHub : le candidat est un feature de base (candidate:true) ;
        // la curation pose userData.candidate=false. isCandidate=false → il est gardé
        // (pas exclu), et la clé candidate:false résiduelle est retirée après le merge.
        state.loadedFeatures = [
            buildFeature('poi_cure', { Nom: 'Curé', candidate: true }, { candidate: false })
        ];
        const result = generateMasterGeoJSONData(); // keepCandidates:false (défaut)
        const ids = result.features.map(f => f.properties.HW_ID);
        expect(ids).toContain('poi_cure');
        expect('candidate' in result.features[0].properties).toBe(false);
    });

    it('réunif : excludedIds et exclusion candidat se combinent', () => {
        state.loadedFeatures = [
            buildFeature('a', { Nom: 'A' }),
            buildFeature('b', { Nom: 'B' }),
            buildFeature('c', { Nom: 'C', candidate: true })
        ];
        const ids = generateMasterGeoJSONData(['a']).features.map(f => f.properties.HW_ID);
        expect(ids).toEqual(['b']); // 'a' exclu explicitement, 'c' candidat exclu par défaut
    });
});
