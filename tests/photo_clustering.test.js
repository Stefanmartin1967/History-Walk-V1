import { describe, it, expect } from 'vitest';
import { clusterPhotos } from '../src/photo-clustering.js';

// POI feature factory : geometry.coordinates = [lng, lat] (convention GeoJSON).
function poi(id, lat, lng, name = id) {
    return {
        properties: { HW_ID: id, 'Nom du site FR': name },
        geometry: { type: 'Point', coordinates: [lng, lat] },
    };
}
function photo(lat, lng, date = 0) {
    return { coords: { lat, lng }, date };
}

// Houmt Souk-ish : deux POIs proches (~55 m). 0.0006° lng ≈ 55 m à 33.88°.
const CAFE = poi('cafe', 33.8800, 10.8570, 'Café');
const EGLISE = poi('eglise', 33.8800, 10.8576, 'Église');

describe('clusterPhotos — groupement par lieu (1 groupe = POI le plus proche)', () => {
    it('sépare deux lieux proches que la proximité fusionnerait', () => {
        const photos = [
            photo(33.8800, 10.8570, 1), photo(33.88001, 10.85702, 2), // café
            photo(33.8800, 10.8576, 3), photo(33.88002, 10.85761, 4), // église
        ];
        const clusters = clusterPhotos(photos, [CAFE, EGLISE]);
        expect(clusters).toHaveLength(2);
        const ids = clusters.map(c => c.nearbyPois[0].feature.properties.HW_ID).sort();
        expect(ids).toEqual(['cafe', 'eglise']);
    });

    it('le POI d’ancrage est toujours en tête de nearbyPois (= nom + cible save)', () => {
        // Photo près de l'église, mais le café est dans le rayon nearby → l'ancre
        // (église) doit primer même si un voisin est proche.
        const photos = [photo(33.8800, 10.8576, 1)];
        const clusters = clusterPhotos(photos, [CAFE, EGLISE]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].nearbyPois[0].feature.properties.HW_ID).toBe('eglise');
    });

    it('une photo sans POI dans le rayon (120 m) part en groupe « trajet »', () => {
        const photos = [
            photo(33.8800, 10.8570, 1),       // café
            photo(33.8700, 10.8400, 2),       // loin de tout (>1 km)
        ];
        const clusters = clusterPhotos(photos, [CAFE, EGLISE]);
        expect(clusters).toHaveLength(2);
        const trajet = clusters.find(c => c.nearbyPois.length === 0);
        expect(trajet).toBeTruthy();
        expect(trajet.absoluteNearest).toBeTruthy(); // le POI le plus proche reste connu
    });

    it('regroupe toutes les photos d’un même lieu, peu importe l’ordre', () => {
        const photos = [
            photo(33.8800, 10.8570, 1),  // café
            photo(33.8800, 10.8576, 2),  // église
            photo(33.88001, 10.85701, 3),// café (revient dessus, désordre)
        ];
        const clusters = clusterPhotos(photos, [CAFE, EGLISE]);
        const cafe = clusters.find(c => c.nearbyPois[0].feature.properties.HW_ID === 'cafe');
        expect(cafe.photos).toHaveLength(2);
    });

    it('respecte hiddenPoiIds (POI masqué = ignoré comme ancre)', () => {
        const photos = [photo(33.8800, 10.8570, 1)];
        const clusters = clusterPhotos(photos, [CAFE, EGLISE], ['cafe']);
        // Café masqué → l'église devient le plus proche dans le rayon, sinon trajet.
        expect(clusters).toHaveLength(1);
        const anchor = clusters[0].nearbyPois[0]?.feature?.properties?.HW_ID;
        expect(anchor === 'eglise' || clusters[0].nearbyPois.length === 0).toBe(true);
    });
});

describe('clusterPhotos — tri & garde-fous', () => {
    it('trie les clusters et leurs photos par date croissante', () => {
        const photos = [
            photo(33.8800, 10.8576, 30), // église, tardive
            photo(33.8800, 10.8570, 10), // café, tôt
            photo(33.88001, 10.85701, 5),// café, plus tôt
        ];
        const clusters = clusterPhotos(photos, [CAFE, EGLISE]);
        expect(clusters[0].nearbyPois[0].feature.properties.HW_ID).toBe('cafe'); // 1er groupe = date min
        expect(clusters[0].photos[0].date).toBe(5); // photos triées dans le groupe
    });

    it('ignore les photos sans coords valides', () => {
        const photos = [photo(33.8800, 10.8570, 1), { coords: null, date: 2 }, {}];
        const clusters = clusterPhotos(photos, [CAFE]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].photos).toHaveLength(1);
    });

    it('retourne [] pour une entrée vide', () => {
        expect(clusterPhotos([], [CAFE])).toEqual([]);
        expect(clusterPhotos(null, [CAFE])).toEqual([]);
    });
});
