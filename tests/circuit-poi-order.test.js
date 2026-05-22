import { describe, it, expect } from 'vitest';
const { findPOIsOnTrack } = require('../scripts/generate-circuit-index.js');

// Non-régression de l'ordre des poiIds produit par generate-circuit-index.js.
// findPOIsOnTrack DOIT préserver l'ordre des waypoints (= priorityIds, dérivé du
// GPX = ordre de sélection de l'admin), et NON ré-ordonner par position sur le
// tracé GPS. Ce tri-par-tracé était un vestige de l'ancienne découverte par
// proximité ; il cassait les circuits en BOUCLE (le POI de départ, présent au
// début ET à la fin du tracé, se retrouvait trié en dernier) → faux positif
// « modifié » permanent dans le CC + boucle affichée au mauvais départ côté user.
//
// Convention coords : poiFeatures.geometry.coordinates = [lon, lat] (GeoJSON) ;
// trackPoints = [lat, lon] (comme extractTrackPoints). Lat 33° → 0.001° ≈ 100 m.
const poi = (id, lon, lat) => ({ properties: { HW_ID: id }, geometry: { coordinates: [lon, lat] } });

describe('findPOIsOnTrack — ordre canonique (waypoints), pas tri-par-tracé', () => {
    it('BOUCLE : le POI de départ (proche de la FIN du tracé) reste en 1re position', () => {
        // A = départ, présent au début ET à la fin du tracé. Son point le plus
        // proche tombe à la FIN (index 3) → l'ancien tri l'aurait mis en dernier.
        const pois = [poi('A', 11.0000, 33.0000), poi('B', 11.0030, 33.0000), poi('C', 11.0030, 33.0030)];
        const track = [
            [33.0000, 11.0005], // proche de A (~47 m), début
            [33.0000, 11.0030], // B
            [33.0030, 11.0030], // C
            [33.0000, 11.0000], // EXACTEMENT A → point le plus proche de A, à la fin
        ];
        const priorityIds = ['A', 'B', 'C']; // ordre des waypoints (sélection)

        expect(findPOIsOnTrack(track, pois, priorityIds)).toEqual(['A', 'B', 'C']);
    });

    it('circuit linéaire : ordre déjà aligné → inchangé (pas de régression)', () => {
        const pois = [poi('A', 11.0000, 33.0000), poi('B', 11.0030, 33.0000), poi('C', 11.0030, 33.0030)];
        const track = [
            [33.0000, 11.0000], // A
            [33.0000, 11.0030], // B
            [33.0030, 11.0030], // C
        ];
        expect(findPOIsOnTrack(track, pois, ['A', 'B', 'C'])).toEqual(['A', 'B', 'C']);
    });

    it('suit l\'ordre des waypoints, PAS l\'ordre du fichier GeoJSON', () => {
        // poiFeatures dans un ordre différent (C, A, B) → la sortie doit suivre
        // priorityIds (A, B, C), pas l'ordre d'itération du GeoJSON.
        const pois = [poi('C', 11.0030, 33.0030), poi('A', 11.0000, 33.0000), poi('B', 11.0030, 33.0000)];
        const track = [
            [33.0000, 11.0000], // A
            [33.0000, 11.0030], // B
            [33.0030, 11.0030], // C
        ];
        expect(findPOIsOnTrack(track, pois, ['A', 'B', 'C'])).toEqual(['A', 'B', 'C']);
    });

    it('écarte un POI prioritaire trop loin du tracé (> 2 km), garde l\'ordre des autres', () => {
        const pois = [poi('A', 11.0000, 33.0000), poi('B', 11.0030, 33.0000), poi('FAR', 12.0000, 34.0000)];
        const track = [
            [33.0000, 11.0000], // A
            [33.0000, 11.0030], // B
        ];
        // FAR est à ~150 km → exclu. A et B conservés dans l'ordre des waypoints.
        expect(findPOIsOnTrack(track, pois, ['A', 'B', 'FAR'])).toEqual(['A', 'B']);
    });
});
