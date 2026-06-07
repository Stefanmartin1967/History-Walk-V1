// @vitest-environment jsdom
// Override d'ancre de routeOneSegment (src/circuit-routing.js). En focus « Éditer
// l'itinéraire », un drapeau d'accès GLISSÉ fournit une ancre de SESSION (non
// encore persistée) qui prime sur l'accessPoint enregistré, pour re-router le
// segment sur la position LIVE du drapeau (cf. circuit-focus.js → anchorOverrides
// → routeOneSegment). On vérifie que la coordonnée override atterrit bien dans la
// requête BRouter (param `lonlats`). fetch BRouter mocké (brouter.de injoignable).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { routeOneSegment } from '../src/circuit-routing.js';

const FEATURES = [
    { geometry: { coordinates: [10.1, 33.8] }, properties: {} },
    { geometry: { coordinates: [10.2, 33.9] }, properties: {} },
];

// Capture les URL passées à fetch ; renvoie un geojson minimal routable (ok:true).
function mockBRouterCapture() {
    const calls = [];
    globalThis.fetch = vi.fn().mockImplementation((url) => {
        calls.push(url);
        return Promise.resolve({
            ok: true,
            json: async () => ({
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: { 'track-length': '1000', 'total-time': '600' },
                    geometry: { type: 'LineString', coordinates: [[10.1, 33.8], [10.2, 33.9]] },
                }],
            }),
        });
    });
    return calls;
}

describe('circuit-routing — override d’ancre (drapeau glissé en focus)', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('sans override : route avec l’ancre du POI (geometry.coordinates)', async () => {
        const calls = mockBRouterCapture();
        await routeOneSegment(FEATURES, 0, {});
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('10.10000000,33.80000000');
        expect(calls[0]).toContain('10.20000000,33.90000000');
    });

    it('override sur l’index 0 : la position glissée prime sur l’ancre du POI', async () => {
        const calls = mockBRouterCapture();
        await routeOneSegment(FEATURES, 0, {}, undefined, { 0: [10.15, 33.85] });
        // L'ancre 0 est remplacée par la position LIVE du drapeau…
        expect(calls[0]).toContain('10.15000000,33.85000000');
        expect(calls[0]).not.toContain('10.10000000,33.80000000');
        // …l'ancre 1 (non déplacée) reste l'ancre du POI.
        expect(calls[0]).toContain('10.20000000,33.90000000');
    });

    it('un override sans entrée pour cet index n’altère pas les ancres', async () => {
        const calls = mockBRouterCapture();
        // Override pour un AUTRE index (99) → sans effet sur le segment 0.
        await routeOneSegment(FEATURES, 0, {}, undefined, { 99: [0, 0] });
        expect(calls[0]).toContain('10.10000000,33.80000000');
        expect(calls[0]).toContain('10.20000000,33.90000000');
    });
});
