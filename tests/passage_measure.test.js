import { describe, it, expect } from 'vitest';
import { straightRatio, buildLineIndex, followShare, lineLength, FORCED_RATIO } from '../src/passage-measure.js';

// Mesures d'un passage (17/11/2026, après Saint-Benoît : 4,8 km pour 2,25 km à
// vol d'oiseau, et une trace Wikiloc qui évitait le sentier interdit).

// Vers l'est, à la latitude de Nalinnes : 0,001° de longitude ≈ 71 m.
const LAT = 50.35;
const east = (n, step = 0.001, lat = LAT) => Array.from({ length: n }, (_, i) => [lat, 4.44 + i * step]);

describe('straightRatio', () => {
    it('ligne droite : rapport 1, pas forcé', () => {
        const r = straightRatio(east(11));
        expect(r.ratio).toBeCloseTo(1, 5);
        expect(r.forced).toBe(false);
        expect(r.lengthM).toBeCloseTo(lineLength(east(11)), 6);
    });

    it('détour : rapport au-delà du seuil, passage forcé', () => {
        // aller vers le nord puis revenir : ~ 2,6 fois la distance directe, ~1,1 km de détour
        const coords = [[LAT, 4.44], [LAT + 0.005, 4.44], [LAT + 0.005, 4.45], [LAT, 4.45]];
        const r = straightRatio(coords);
        expect(r.ratio).toBeGreaterThan(FORCED_RATIO);
        expect(r.forced).toBe(true);
    });

    it('passage court : rapport élevé mais détour modeste, pas forcé (lacet de montée)', () => {
        // ~260 m à vol d'oiseau, ~730 m de long (Grotte des Sarrasins → Clairière)
        const coords = [[LAT, 4.44], [LAT + 0.003, 4.4405], [LAT + 0.003, 4.4430], [LAT, 4.4436]];
        const r = straightRatio(coords);
        expect(r.ratio).toBeGreaterThan(FORCED_RATIO);
        expect(r.forced).toBe(false);
    });

    it('bouts trop proches (boucle sur un lieu) : pas de rapport', () => {
        const loop = [[LAT, 4.44], [LAT + 0.003, 4.44], [LAT + 0.003, 4.443], [LAT, 4.4401]];
        expect(straightRatio(loop).ratio).toBeNull();
        expect(straightRatio(loop).forced).toBe(false);
    });
});

describe('followShare', () => {
    it('passage posé sur le calque : suivi à 100 %, rien de surligné', () => {
        const idx = buildLineIndex([east(11)]);
        const f = followShare(east(11), idx);
        expect(f.share).toBeCloseTo(1, 2);
        expect(f.off).toEqual([]);
    });

    it('calque à 20 m : suivi ; à 100 m : pas suivi', () => {
        const near = buildLineIndex([east(11, 0.001, LAT + 0.00018)]); // ~20 m au nord
        const far = buildLineIndex([east(11, 0.001, LAT + 0.0009)]);   // ~100 m au nord
        expect(followShare(east(11), near).share).toBeCloseTo(1, 2);
        expect(followShare(east(11), far).share).toBe(0);
    });

    it('le calque ne couvre que la moitié : ~50 %, l’autre moitié surlignée', () => {
        const idx = buildLineIndex([east(6)]); // 0 → 0,005° ; le passage va jusqu'à 0,010°
        const f = followShare(east(11), idx);
        expect(f.share).toBeGreaterThan(0.4);
        expect(f.share).toBeLessThan(0.6);
        expect(f.off).toHaveLength(1);
        expect(lineLength(f.off[0])).toBeGreaterThan(300);
    });

    it('calque à points espacés : mesuré au segment, pas aux seuls points', () => {
        const sparse = buildLineIndex([[[LAT, 4.44], [LAT, 4.45]]]); // 2 points, ~710 m
        expect(followShare(east(11), sparse).share).toBeCloseTo(1, 2);
    });

    it('un écart trop court n’est pas surligné', () => {
        // le passage s'écarte de ~45 m sur ~40 m de long, au milieu
        const coords = [[LAT, 4.44], [LAT, 4.4447], [LAT + 0.0004, 4.445], [LAT, 4.4453], [LAT, 4.45]];
        const f = followShare(coords, buildLineIndex([east(11)]));
        expect(f.off).toEqual([]);
        expect(f.share).toBeLessThan(1);
    });

    it('sans calque : pas de mesure', () => {
        expect(followShare(east(11), buildLineIndex([]))).toBeNull();
        expect(followShare(east(11), null)).toBeNull();
    });
});
