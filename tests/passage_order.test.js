// Ordre des points de passage le long du parcours (src/passage-order.js).
// Chantier points de passage permanents, PR 1 (13/11/2026).
import { describe, it, expect } from 'vitest';
import { locateOnTrack, nearestPassage, insertionIndex } from '../src/passage-order.js';

// ~11 m par dix-millième de degré de latitude.
const D = 0.0001;

// Boucle dans un parc : on part vers le nord sur la voie ouest, on traverse,
// on redescend par la voie est, à 40 m de l'aller. Un aller et un retour au
// même niveau entre les deux lieux : l'ancien tri par la ligne droite les mélangeait.
const LAT0 = 50.40, LON_W = 4.40, LON_E = 4.40 + 40 / (111320 * Math.cos(50.4 * Math.PI / 180));
const up = Array.from({ length: 21 }, (_, i) => [LAT0 + i * D, LON_W]);           // aller, ~220 m
const across = [[LAT0 + 20 * D, LON_E]];
const down = Array.from({ length: 21 }, (_, i) => [LAT0 + (20 - i) * D, LON_E]);   // retour
const loop = [...up, ...across, ...down.slice(1)];

describe('locateOnTrack', () => {
    it('distance et position le long du tracé', () => {
        const hit = locateOnTrack(up, { lat: LAT0 + 10 * D, lng: LON_W });
        expect(hit.dist).toBeLessThan(0.5);
        expect(hit.along).toBeGreaterThan(105);
        expect(hit.along).toBeLessThan(116);
    });
    it('cherche après un tronçon donné : le retour, pas l’aller', () => {
        const p = { lat: LAT0 + 5 * D, lng: (LON_W + LON_E) / 2 }; // à mi-chemin des deux voies
        const first = locateOnTrack(loop, p);
        const later = locateOnTrack(loop, p, 25);
        expect(later.along).toBeGreaterThan(first.along);
        expect(later.idx).toBeGreaterThanOrEqual(25);
    });
    it('tracé vide : null', () => {
        expect(locateOnTrack([], { lat: 1, lng: 1 })).toBeNull();
    });
});

describe('nearestPassage', () => {
    it('compte la distance au tracé, pas aux seuls sommets', () => {
        // Passage 0 : long tronçon droit à deux sommets ; passage 1 : sommets serrés plus loin.
        const seg0 = { coords: [[LAT0, LON_W], [LAT0 + 100 * D, LON_W]] };
        const seg1 = { coords: Array.from({ length: 5 }, (_, i) => [LAT0 + 50 * D + i * D, LON_W + 0.002]) };
        // Clic à 5 m du milieu du tronçon droit, loin de ses sommets.
        expect(nearestPassage([seg0, seg1], { lat: LAT0 + 52 * D, lng: LON_W + 0.00007 })).toBe(0);
    });
});

describe('insertionIndex — ordre du parcours', () => {
    const wp = (seg, lat, lng, id) => ({ id, seg, lat, lng });

    it('premier point du passage : à la fin de la liste', () => {
        const list = [wp(0, LAT0, LON_W, 'a')];
        expect(insertionIndex(list, 1, loop, { lat: LAT0, lng: LON_W })).toBe(1);
    });

    it('boucle : un point du retour se place après ceux de l’aller', () => {
        // Points déjà posés : aller (bas, haut), puis retour (haut).
        const list = [
            wp(0, LAT0 + 4 * D, LON_W, 'aller-bas'),
            wp(0, LAT0 + 16 * D, LON_W, 'aller-haut'),
            wp(0, LAT0 + 16 * D, LON_E, 'retour-haut'),
        ];
        // Nouveau point sur le retour, en bas : au même niveau que « aller-bas ».
        // L'ancien tri le plaçait en tête ; il va à la fin.
        expect(insertionIndex(list, 0, loop, { lat: LAT0 + 4 * D, lng: LON_E })).toBe(3);
        // Nouveau point sur l'aller, au milieu : entre les deux points de l'aller.
        expect(insertionIndex(list, 0, loop, { lat: LAT0 + 10 * D, lng: LON_W })).toBe(1);
    });

    it('ne touche pas aux points des autres passages', () => {
        const list = [
            wp(0, LAT0 + 4 * D, LON_W, 'p0'),
            wp(1, LAT0 + 4 * D, LON_W, 'q-bas'),
            wp(0, LAT0 + 8 * D, LON_W, 'p0-b'),
            wp(1, LAT0 + 16 * D, LON_W, 'q-haut'),
        ];
        // Passage 1 : nouveau point entre « q-bas » et « q-haut » → avant q-haut (index 3).
        expect(insertionIndex(list, 1, up, { lat: LAT0 + 10 * D, lng: LON_W })).toBe(3);
        // Après le dernier du passage 1 → juste après lui.
        expect(insertionIndex(list, 1, up, { lat: LAT0 + 19 * D, lng: LON_W })).toBe(4);
    });

    it('point posé à l’écart du tracé : rangé selon le point du tracé le plus proche', () => {
        const list = [wp(0, LAT0 + 4 * D, LON_W, 'a'), wp(0, LAT0 + 16 * D, LON_W, 'b')];
        // 60 m à l'ouest de l'aller, à mi-hauteur : entre a et b.
        expect(insertionIndex(list, 0, up, { lat: LAT0 + 10 * D, lng: LON_W - 0.00085 })).toBe(1);
    });
});
