// @vitest-environment jsdom
// Tests pour le dénivelé (D+) capté de BRouter — src/circuit-routing.js.
// Couvre : extraction de « filtered ascend » (clé canonique, AVEC un espace) avec
// repli « plain-ascend », et la somme par segment (segmentsAscend). Le fetch
// BRouter est mocké → déterministe, sans réseau (brouter.de inaccessible en CI).
// Réf format : https://brouter.de/brouter/elevation.html
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { routePoints, segmentsAscend } from '../src/circuit-routing.js';

const POINTS = [[10.1, 33.8], [10.2, 33.9]];

function mockBRouter(properties) {
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties,
                geometry: { type: 'LineString', coordinates: [[10.1, 33.8, 5], [10.2, 33.9, 12]] },
            }],
        }),
    });
}

describe('circuit-routing — dénivelé (D+) BRouter', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('extrait « filtered ascend » (clé avec espace) et l’arrondit', async () => {
        mockBRouter({ 'track-length': '12345', 'total-time': '3600', 'filtered ascend': '678.4', 'plain-ascend': '720' });
        const { ascend } = await routePoints(POINTS);
        expect(ascend).toBe(678); // filtered prioritaire sur plain, arrondi
    });

    it('retombe sur « plain-ascend » si « filtered ascend » absent', async () => {
        mockBRouter({ 'track-length': '12345', 'total-time': '3600', 'plain-ascend': '512' });
        const { ascend } = await routePoints(POINTS);
        expect(ascend).toBe(512);
    });

    it('renvoie null si aucune donnée d’altitude dans les properties', async () => {
        mockBRouter({ 'track-length': '12345', 'total-time': '3600' });
        const { ascend } = await routePoints(POINTS);
        expect(ascend).toBeNull();
    });

    it('n’affecte pas distance/durée (toujours présents)', async () => {
        mockBRouter({ 'track-length': '8000', 'total-time': '1800', 'filtered ascend': '0' });
        const { distanceKm, durationMin, ascend } = await routePoints(POINTS);
        expect(distanceKm).toBe(8);
        expect(durationMin).toBe(30);
        expect(ascend).toBe(0); // plat réel = 0 (≠ null = inconnu)
    });
});

describe('circuit-routing — segmentsAscend (somme)', () => {
    it('somme les ascend numériques, ignore les segments en échec (null)', () => {
        expect(segmentsAscend([{ ascend: 100 }, { ascend: 50 }, { ascend: null }])).toBe(150);
    });
    it('renvoie null si AUCUN segment n’a de donnée (≠ 0 = plat)', () => {
        expect(segmentsAscend([{ ascend: null }, { ascend: null }])).toBeNull();
        expect(segmentsAscend([])).toBeNull();
    });
    it('un seul 0 réel → 0 (terrain plat), pas null', () => {
        expect(segmentsAscend([{ ascend: 0 }, { ascend: null }])).toBe(0);
    });
});
