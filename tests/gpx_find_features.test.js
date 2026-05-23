// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { findFeaturesOnTrack } from '../src/gpx.js';

// findFeaturesOnTrack(trackCoords, features, threshold = 0.0006)
//  - trackCoords : tableau de [lat, lon]
//  - features    : GeoJSON { geometry: { coordinates: [lon, lat] } }
//  - retourne les features dont un point de trace est à < threshold (degrés,
//    distance euclidienne), triées par ordre de passage sur la trace.
//  - boucle : si la trace se referme (départ ≈ arrivée) et que le 1er POI est
//    aussi proche de la fin, ce 1er POI est dupliqué en fin de liste.

const feat = (lon, lat, id) => ({ geometry: { coordinates: [lon, lat] }, properties: { id } });
const ids = (res) => res.map(f => f.properties.id);

describe('findFeaturesOnTrack', () => {
    it('détecte un lieu sur la trace, ignore un lieu éloigné', () => {
        const track = [[10, 20], [10.01, 20.01], [10.02, 20.02]]; // [lat, lon]
        const near = feat(20, 10, 'NEAR'); // [lon, lat] = pile sur track[0]=[lat10,lon20]
        const far = feat(99, 99, 'FAR');
        expect(ids(findFeaturesOnTrack(track, [near, far]))).toEqual(['NEAR']);
    });

    it('respecte le seuil par défaut (~0.0006°) : juste sous = détecté, juste au-dessus = non', () => {
        const track = [[10, 20]];
        const under = feat(20, 10.0005, 'UNDER'); // écart lat 0.0005 < 0.0006
        const over = feat(20, 10.001, 'OVER');    // écart lat 0.001 > 0.0006
        expect(ids(findFeaturesOnTrack(track, [under]))).toEqual(['UNDER']);
        expect(findFeaturesOnTrack(track, [over])).toEqual([]);
    });

    it('respecte un threshold custom', () => {
        const track = [[0, 0]];
        const f = feat(0, 0.005, 'F'); // distance 0.005
        expect(findFeaturesOnTrack(track, [f])).toEqual([]);          // défaut 0.0006 → non
        expect(ids(findFeaturesOnTrack(track, [f], 0.01))).toEqual(['F']); // 0.01 → détecté
    });

    it('trie par ordre de passage sur la trace (pas par ordre d\'entrée)', () => {
        const track = [[0, 0], [0, 0.001], [0, 0.002], [0, 0.003], [0, 0.004]];
        const A = feat(0, 0, 'A');     // proche de track[0]
        const B = feat(0.004, 0, 'B'); // proche de track[4]
        // passés dans l'ordre inverse pour prouver le tri par index de trace
        expect(ids(findFeaturesOnTrack(track, [B, A]))).toEqual(['A', 'B']);
    });

    it('boucle : trace fermée + 1er POI proche de la fin → 1er POI dupliqué en fin', () => {
        const track = [[0, 0], [0.5, 0.5], [1, 1], [0.5, 0.5], [0, 0.0003]]; // départ≈arrivée
        const start = feat(0, 0, 'START'); // proche départ ET arrivée
        const mid = feat(1, 1, 'MID');
        expect(ids(findFeaturesOnTrack(track, [start, mid]))).toEqual(['START', 'MID', 'START']);
    });

    it('trace ouverte (départ ≠ arrivée) → pas de duplication', () => {
        const track = [[0, 0], [0, 0.001], [0, 0.002]]; // arrivée loin du départ
        const A = feat(0, 0, 'A');
        expect(ids(findFeaturesOnTrack(track, [A]))).toEqual(['A']);
    });

    it('aucune feature → tableau vide', () => {
        expect(findFeaturesOnTrack([[0, 0], [0, 0.001]], [])).toEqual([]);
    });

    it('trace vide → tableau vide (rien à détecter)', () => {
        expect(findFeaturesOnTrack([], [feat(0, 0, 'A')])).toEqual([]);
    });
});
