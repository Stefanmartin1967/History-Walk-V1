import { describe, it, expect } from 'vitest';
import {
    prepareTrack, locateOnTrack, placesAlong, nextPlace, directionWord, formatDistance,
    createWalkTracker, OFF_TRACK_M,
} from '../src/walk-progress.js';

// Tableau de marche du suivi mobile (17/11/2026). Coordonnées autour de
// Nalinnes : 0,001° de longitude ≈ 71 m, 0,001° de latitude ≈ 111 m.
const LAT = 50.35, LON = 4.44;

// Ligne droite vers l'est, ~710 m.
const LINE = Array.from({ length: 11 }, (_, i) => [LAT, LON + i * 0.001]);
// Boucle carrée qui revient à son départ : est, nord, ouest, sud (~1,8 km).
const LOOP = [
    [LAT, LON], [LAT, LON + 0.004], [LAT + 0.004, LON + 0.004], [LAT + 0.004, LON], [LAT, LON],
];

describe('prepareTrack', () => {
    it('cumule les distances ; refuse un tracé trop court', () => {
        const p = prepareTrack(LINE);
        expect(p.cum[0]).toBe(0);
        expect(p.total).toBeGreaterThan(700);
        expect(p.total).toBeLessThan(720);
        expect(prepareTrack([[LAT, LON]])).toBeNull();
    });
});

describe('locateOnTrack', () => {
    it('projette une position proche sur le tracé', () => {
        const prep = prepareTrack(LINE);
        const hit = locateOnTrack([LAT + 0.0002, LON + 0.005], prep); // ~22 m au nord, au milieu
        expect(hit.distM).toBeGreaterThan(18);
        expect(hit.distM).toBeLessThan(26);
        expect(hit.along).toBeGreaterThan(340);
        expect(hit.along).toBeLessThan(370);
    });

    it('boucle : au départ, 0 au 1er fix ; à l’arrivée, la fin si la marche a avancé', () => {
        const prep = prepareTrack(LOOP);
        expect(locateOnTrack([LAT, LON], prep, null).along).toBeCloseTo(0, 0);
        // même endroit, mais on vient de faire presque tout le tour
        expect(locateOnTrack([LAT + 0.0001, LON], prep, prep.total - 50).along).toBeGreaterThan(prep.total - 30);
    });
});

describe('placesAlong / nextPlace', () => {
    it('lieux dans l’ordre du circuit, départ répété en fin de boucle', () => {
        const prep = prepareTrack(LOOP);
        const alongs = placesAlong([[LAT, LON], [LAT + 0.004, LON + 0.004], [LAT, LON]], prep);
        expect(alongs[0]).toBeCloseTo(0, 0);
        expect(alongs[1]).toBeGreaterThan(prep.total / 2 - 20);
        expect(alongs[2]).toBeCloseTo(prep.total, 0);
    });

    it('départ d’une boucle au début, même si la fin du tracé est aussi proche', () => {
        const prep = prepareTrack(LOOP);
        const alongs = placesAlong([[LAT + 0.00001, LON], [LAT + 0.004, LON + 0.004], [LAT, LON]], prep);
        expect(alongs[0]).toBeLessThan(5);
        expect(alongs[2]).toBeGreaterThan(prep.total - 5);
    });

    it('le prochain lieu est le premier pas encore dépassé', () => {
        const alongs = [0, 500, 1200];
        expect(nextPlace(alongs, 10)).toEqual({ index: 1, inM: 490 });
        expect(nextPlace(alongs, 520)).toEqual({ index: 2, inM: 680 });
        expect(nextPlace(alongs, 1200)).toBeNull();
    });
});

describe('directionWord / formatDistance', () => {
    it('donne la direction en mots', () => {
        expect(directionWord([LAT, LON], [LAT, LON + 0.01])).toBe("l'est");
        expect(directionWord([LAT, LON], [LAT + 0.01, LON])).toBe('le nord');
        expect(directionWord([LAT, LON], [LAT - 0.01, LON - 0.014])).toBe('le sud-ouest');
    });

    it('arrondit les distances', () => {
        expect(formatDistance(647)).toBe('650 m');
        expect(formatDistance(2140)).toBe('2,1 km');
        expect(formatDistance(11600)).toBe('11,6 km');
        expect(formatDistance(125400)).toBe('125 km');
        expect(formatDistance(-5)).toBe('0 m');
    });
});

describe('createWalkTracker', () => {
    const places = [[LAT, LON], [LAT + 0.004, LON + 0.004], [LAT, LON]];

    it('fait / reste / prochain lieu le long d’une boucle', () => {
        const t = createWalkTracker(LOOP, places);
        const s = t.update([LAT, LON + 0.002]); // mi-chemin du 1er côté
        expect(s.off).toBe(false);
        expect(s.done).toBeGreaterThan(130);
        expect(s.done).toBeLessThan(150);
        expect(s.left).toBeCloseTo(t.total - s.done, 3);
        expect(s.next.index).toBe(1);
    });

    it('hors du tracé : progression gelée, distance et direction du tracé', () => {
        const t = createWalkTracker(LOOP, places);
        const before = t.update([LAT, LON + 0.002]);
        const s = t.update([LAT - 0.0011, LON + 0.002]); // ~120 m au sud du 1er côté
        expect(s.off).toBe(true);
        expect(s.offM).toBeGreaterThan(OFF_TRACK_M);
        expect(s.direction).toBe('le nord');
        expect(s.done).toBeCloseTo(before.done, 6);
    });

    it('revient sur le tracé sous 35 m, pas avant (pas de clignotement)', () => {
        const t = createWalkTracker(LOOP, places);
        t.update([LAT, LON + 0.002]);
        expect(t.update([LAT - 0.0006, LON + 0.002]).off).toBe(true);  // ~66 m
        expect(t.update([LAT - 0.0004, LON + 0.002]).off).toBe(true);  // ~44 m : encore hors
        expect(t.update([LAT - 0.0002, LON + 0.0025]).off).toBe(false); // ~22 m : revenu
    });

    it('fin de boucle : avance jusqu’au bout sans repartir à zéro', () => {
        const t = createWalkTracker(LOOP, places);
        [[LAT, LON + 0.002], [LAT + 0.002, LON + 0.004], [LAT + 0.004, LON + 0.002], [LAT + 0.002, LON], [LAT + 0.0003, LON]]
            .forEach(p => t.update(p));
        const s = t.update([LAT, LON]);
        expect(s.left).toBeLessThan(10);
        expect(s.next).toBeNull();
    });

    it('un lieu dépassé le reste, même en tournant autour', () => {
        const t = createWalkTracker(LOOP, places);
        t.update([LAT, LON + 0.002]);
        t.update([LAT + 0.002, LON + 0.004]);
        expect(t.update([LAT + 0.0042, LON + 0.0038]).next.index).toBe(2); // juste après le lieu 2
        expect(t.update([LAT + 0.0039, LON + 0.004]).next.index).toBe(2);  // petit recul : reste 2
    });

    it('tracé inutilisable : pas de tableau', () => {
        expect(createWalkTracker([[LAT, LON]], [])).toBeNull();
    });
});
