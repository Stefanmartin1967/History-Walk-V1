import { describe, it, expect } from 'vitest';
import { collectKnownOsmRefs, isDuplicateCandidate, DEDUP_M } from '../src/scout-dedup.js';

// Cas fondateur (10/08/2026) : « Henchir Bourgou », site archéologique d'environ
// 700 m de rayon, était re-proposé en candidat à chaque re-scan — le POI publié
// est pointé au mausolée, le nœud OSM ailleurs sur le site, donc hors des 50 m.
// La règle d'identité OSM ferme ce cas ; la règle des 50 m reste le filet des POI
// qui n'ont pas encore d'osm_ref (89 des 348 POI de Djerba à cette date).

const poi = (lng, lat, props = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { 'Nom du site FR': 'Lieu', ...props },
});

describe('collectKnownOsmRefs', () => {
    it('indexe les osm_ref sous forme canonique « type/id »', () => {
        const set = collectKnownOsmRefs([
            poi(10.97, 33.81, { osm_ref: 'way/386328373' }),
            poi(10.98, 33.82, { osm_ref: 'https://www.openstreetmap.org/node/123#map=18/33/10' }),
        ]);
        expect(set.has('way/386328373')).toBe(true);
        expect(set.has('node/123')).toBe(true);
    });

    it('lit l\'overlay userData en priorité (osm_ref reporté pendant la curation)', () => {
        const f = poi(10.97, 33.81, { osm_ref: '', userData: { osm_ref: 'way/999' } });
        expect(collectKnownOsmRefs([f]).has('way/999')).toBe(true);
    });

    it('ignore les POI sans osm_ref et les valeurs non reconnaissables', () => {
        const set = collectKnownOsmRefs([
            poi(10.97, 33.81),
            poi(10.98, 33.82, { osm_ref: 'Henchir Bourgou' }),
        ]);
        expect(set.size).toBe(0);
    });
});

describe('isDuplicateCandidate', () => {
    // ~700 m au nord du POI existant : bien au-delà des 50 m.
    const FAR = { lat: 33.826, lon: 10.970194, osmRef: 'way/386328373' };
    const existing = poi(10.970194, 33.819806, { osm_ref: 'way/386328373' });

    it('écarte un objet OSM déjà porté par un POI chargé, quelle que soit la distance', () => {
        const dup = isDuplicateCandidate(FAR, {
            knownOsmRefs: collectKnownOsmRefs([existing]),
            features: [existing],
        });
        expect(dup).toBe(true);
    });

    it('retient le candidat si le POI existant n\'a pas encore l\'osm_ref (cas d\'origine du doublon)', () => {
        const sansRef = poi(10.970194, 33.819806);
        const dup = isDuplicateCandidate(FAR, {
            knownOsmRefs: collectKnownOsmRefs([sansRef]),
            features: [sansRef],
        });
        expect(dup).toBe(false);
    });

    it('garde la règle de proximité pour un POI sans osm_ref', () => {
        const sansRef = poi(10.970194, 33.819806);
        const proche = { lat: 33.819826, lon: 10.970194, osmRef: 'node/42' }; // ~2 m
        expect(isDuplicateCandidate(proche, {
            knownOsmRefs: collectKnownOsmRefs([sansRef]),
            features: [sansRef],
        })).toBe(true);
    });

    it('écarte le 2ᵉ candidat d\'un même lieu dédoublé dans OSM (candidats retenus)', () => {
        const retained = [{ lat: 33.8198, lon: 10.9702, dup: false }];
        expect(isDuplicateCandidate({ lat: 33.81981, lon: 10.9702, osmRef: 'node/7' }, {
            knownOsmRefs: new Set(), features: [], retained,
        })).toBe(true);
    });

    it('ne se compare pas à un candidat lui-même marqué doublon', () => {
        const retained = [{ lat: 33.8198, lon: 10.9702, dup: true }];
        expect(isDuplicateCandidate({ lat: 33.81981, lon: 10.9702, osmRef: 'node/7' }, {
            knownOsmRefs: new Set(), features: [], retained,
        })).toBe(false);
    });

    it('tolère un POI chargé sans géométrie exploitable', () => {
        const cassé = { type: 'Feature', properties: {}, geometry: null };
        expect(isDuplicateCandidate({ lat: 33.81, lon: 10.97, osmRef: 'node/7' }, {
            knownOsmRefs: new Set(), features: [cassé],
        })).toBe(false);
    });

    it('refuse un candidat sans coordonnées finies', () => {
        expect(isDuplicateCandidate({ lat: NaN, lon: 10.97 }, { knownOsmRefs: new Set() })).toBe(false);
    });

    it('expose le rayon de la règle #472', () => {
        expect(DEDUP_M).toBe(50);
    });
});
