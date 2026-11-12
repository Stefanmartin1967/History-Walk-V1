// Chiffres d'un itinéraire pour le comparateur « Choisir l'itinéraire »
// (src/route-stats.js) + ce que routeCircuit en remonte (src/circuit-routing.js).
// Chantier comparateur de tracé, PR 2 (12/11/2026).
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    waysFromMessages, addWays, repassedMeters, compareToDirect, formatKmDelta, emptyWays,
} from '../src/route-stats.js';
import { routeCircuit } from '../src/circuit-routing.js';

// En-tête réel des messages BRouter (colonnes utiles : Distance, WayTags).
const HEAD = ['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'ElevCost', 'TurnCost', 'NodeCost', 'InitialCost', 'WayTags', 'NodeTags', 'Time', 'Energy'];
const row = (dist, tags) => ['0', '0', '0', String(dist), '0', '0', '0', '0', '0', tags, '', '0', '0'];

describe('waysFromMessages', () => {
    it('range chaque tronçon dans sa catégorie (même table que way-types.js)', () => {
        const w = waysFromMessages({ messages: [HEAD,
            row(300, 'highway=residential surface=asphalt'),
            row(200, 'highway=track tracktype=grade2'),
            row(150, 'highway=footway'),
            row(100, 'highway=tertiary'),
            row(40, 'highway=construction'),
        ] });
        expect(w).toEqual({ route: 100, rue: 300, piste: 200, sentier: 150, 'non-classe': 40 });
    });
    it('sans messages : null', () => {
        expect(waysFromMessages({})).toBeNull();
        expect(waysFromMessages({ messages: [HEAD] })).toBeNull();
    });
});

describe('addWays', () => {
    it('additionne, les absents comptent 0', () => {
        expect(addWays({ route: 100 }, null, { route: 50, sentier: 20 })).toEqual({ ...emptyWays(), route: 150, sentier: 20 });
    });
});

describe('repassedMeters', () => {
    // ~111 m par millième de degré de latitude.
    const north = (n) => Array.from({ length: n + 1 }, (_, i) => [33.8 + i * 0.0001, 10.9]);

    it('aller simple : rien de repassé', () => {
        expect(repassedMeters(north(20))).toBe(0);
    });
    it('aller-retour sur la même voie : le retour est repassé', () => {
        const go = north(20); // ~222 m
        const track = go.concat(go.slice(0, -1).reverse());
        const r = repassedMeters(track);
        // Les 60 premiers mètres du retour ne comptent pas (tronçons voisins) ;
        // le reste, oui.
        expect(r).toBeGreaterThan(130);
        expect(r).toBeLessThan(230);
    });
    it('tracé trop court : 0', () => {
        expect(repassedMeters([[33.8, 10.9], [33.81, 10.9]])).toBe(0);
    });
});

describe('compareToDirect', () => {
    it('moins de route = mieux, plus = moins bien, sous le seuil = égal', () => {
        expect(compareToDirect(800, 2100, 'less', 50).kind).toBe('mieux');
        expect(compareToDirect(2100, 800, 'less', 50).kind).toBe('moins');
        expect(compareToDirect(830, 800, 'less', 50).kind).toBe('egal');
    });
    it('plus de sentier = mieux', () => {
        expect(compareToDirect(2300, 600, 'more', 50)).toEqual({ kind: 'mieux', diff: 1700 });
    });
});

describe('formatKmDelta', () => {
    it('signe typographique et virgule', () => {
        expect(formatKmDelta(-1300)).toBe('−1,3');
        expect(formatKmDelta(2200)).toBe('+2,2');
    });
});

describe('routeCircuit — types de voie, motif d’échec, progression', () => {
    afterEach(() => { vi.restoreAllMocks(); });
    const poi = (lon) => ({ geometry: { coordinates: [lon, 33.8] }, properties: {} });

    it('somme les types de voie des passages et compte la progression', async () => {
        globalThis.fetch = vi.fn().mockImplementation(() => Promise.resolve({
            ok: true,
            json: async () => ({ features: [{
                properties: { 'track-length': '500', messages: [HEAD, row(300, 'highway=track'), row(200, 'highway=residential')] },
                geometry: { coordinates: [[10, 33.8], [10.01, 33.8]] },
            }] }),
        }));
        const progress = [];
        const r = await routeCircuit([poi(10), poi(10.01), poi(10.02)], {}, { onProgress: (d, t) => progress.push(`${d}/${t}`) });
        expect(r.ways).toEqual({ ...emptyWays(), piste: 600, rue: 400 });
        expect(progress).toEqual(['1/2', '2/2']);
    });

    it('un passage en échec garde son motif et compte en « Non classé »', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        const r = await routeCircuit([poi(10), poi(10.01)], {}, { base: 'http://localhost:17777/brouter' });
        expect(r.segments[0].ok).toBe(false);
        expect(r.segments[0].error).toBe('BRouter de ce PC ne répond pas.');
        expect(r.ways['non-classe']).toBeGreaterThan(900);
    });
    // brouter.de qui limite le débit : nouveaux essais et message dédié,
    // cf. tests/circuit_routing_avoid.test.js (minuteries simulées).
});
