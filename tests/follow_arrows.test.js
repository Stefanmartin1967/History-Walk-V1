// Flèches de sens sur le tracé, carte du suivi mobile (06/11/2026).

import { describe, it, expect } from 'vitest';
import { arrowPositions, metersPerPixel } from '../src/follow-arrows.js';

// ~111 m par millième de degré de latitude.
const north = [[50.000, 4.4], [50.001, 4.4], [50.002, 4.4]];       // ~222 m vers le nord
const east = [[50.0, 4.400], [50.0, 4.401], [50.0, 4.402]];         // vers l'est
const loop = [[50.000, 4.4], [50.001, 4.4], [50.001, 4.4015], [50.000, 4.4015], [50.000, 4.4]];

describe('arrowPositions', () => {
    it('espace régulièrement les flèches, la première à mi-écart du départ', () => {
        const arrows = arrowPositions(north, 50);
        expect(arrows.length).toBe(4); // à 25, 75, 125, 175 m sur ~222 m
        expect(arrows[0].lat).toBeCloseTo(50.000225, 5);
        expect(arrows[1].lat - arrows[0].lat).toBeCloseTo(0.00045, 5);
    });

    it('oriente chaque flèche selon le sens de la marche', () => {
        expect(arrowPositions(north, 50)[0].bearing).toBeCloseTo(0, 0);
        expect(arrowPositions(east, 30)[0].bearing).toBeCloseTo(90, 0);
        const back = arrowPositions([...north].reverse(), 50);
        expect(back[0].bearing).toBeCloseTo(180, 0);
    });

    it('sur une boucle, les flèches tournent avec le tracé (nord, est, sud, ouest)', () => {
        const caps = arrowPositions(loop, 40).map(a => Math.round(a.bearing / 90) % 4);
        expect([...new Set(caps)]).toEqual([0, 1, 2, 3]);
    });

    it('rien à poser sans tracé exploitable', () => {
        expect(arrowPositions(null, 50)).toEqual([]);
        expect(arrowPositions([[50, 4.4]], 50)).toEqual([]);
        expect(arrowPositions(north, 0)).toEqual([]);
        expect(arrowPositions([[50, 4.4], [50, 4.4]], 10)).toEqual([]);
    });
});

describe('metersPerPixel', () => {
    it('divise par deux à chaque niveau de zoom', () => {
        expect(metersPerPixel(50, 16) / metersPerPixel(50, 17)).toBeCloseTo(2, 5);
    });
    it("vaut ~1,5 m/px au zoom 16 à la latitude de Charleroi", () => {
        expect(metersPerPixel(50.41, 16)).toBeGreaterThan(1.4);
        expect(metersPerPixel(50.41, 16)).toBeLessThan(1.6);
    });
});
