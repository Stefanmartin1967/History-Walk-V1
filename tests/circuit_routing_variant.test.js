// @vitest-environment jsdom
// Variantes de calcul (Direct / Chemins) et choix du moteur BRouter (ce PC ou
// brouter.de) — src/circuit-routing.js. Chantier comparateur de tracé
// (12/11/2026, PR 1). fetch mocké : aucun appel réseau.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
    normalizeRouting, routingQuery, resolveEngine, forgetEngine, routePoints, routeCircuit,
    LOCAL_BROUTER_URL, PUBLIC_BROUTER_URL,
} from '../src/circuit-routing.js';

const POINTS = [[10.1, 33.8], [10.2, 33.9]];

function okResponse() {
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
}

describe('normalizeRouting', () => {
    it('sans réglage, ou variante inconnue : Direct', () => {
        expect(normalizeRouting(undefined)).toEqual({ variant: 'direct' });
        expect(normalizeRouting(null)).toEqual({ variant: 'direct' });
        expect(normalizeRouting({ variant: 'heripia' })).toEqual({ variant: 'direct' });
    });
    it('Direct ne garde pas de force', () => {
        expect(normalizeRouting({ variant: 'direct', force: 2 })).toEqual({ variant: 'direct' });
    });
    it('Chemins : force 1 par défaut, bornée à [0, 3], au dixième', () => {
        expect(normalizeRouting({ variant: 'chemins' })).toEqual({ variant: 'chemins', force: 1 });
        expect(normalizeRouting({ variant: 'chemins', force: 0.64 })).toEqual({ variant: 'chemins', force: 0.6 });
        expect(normalizeRouting({ variant: 'chemins', force: 7 })).toEqual({ variant: 'chemins', force: 3 });
        expect(normalizeRouting({ variant: 'chemins', force: -1 })).toEqual({ variant: 'chemins', force: 0 });
        expect(normalizeRouting({ variant: 'chemins', force: 'x' })).toEqual({ variant: 'chemins', force: 1 });
    });
});

describe('routingQuery', () => {
    it('Direct = hiking-beta, sans paramètre', () => {
        expect(routingQuery({ variant: 'direct' })).toBe('&profile=hiking-beta');
        expect(routingQuery(undefined)).toBe('&profile=hiking-beta');
    });
    it('Chemins = hiking-mountain + Offroad_factor', () => {
        expect(routingQuery({ variant: 'chemins', force: 0.6 })).toBe('&profile=hiking-mountain&profile:Offroad_factor=0.6');
    });
});

describe('routePoints — variante et moteur dans l’URL', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('par défaut : brouter.de, hiking-beta', async () => {
        globalThis.fetch = vi.fn().mockImplementation(okResponse);
        await routePoints(POINTS);
        const url = globalThis.fetch.mock.calls[0][0];
        expect(url.startsWith(PUBLIC_BROUTER_URL + '?')).toBe(true);
        expect(url).toContain('&profile=hiking-beta&');
    });

    it('Chemins sur BRouter de ce PC', async () => {
        globalThis.fetch = vi.fn().mockImplementation(okResponse);
        await routeCircuit(
            POINTS.map(c => ({ geometry: { coordinates: c }, properties: {} })),
            {},
            { routing: { variant: 'chemins', force: 2 }, base: LOCAL_BROUTER_URL },
        );
        const url = globalThis.fetch.mock.calls[0][0];
        expect(url.startsWith(LOCAL_BROUTER_URL + '?')).toBe(true);
        expect(url).toContain('&profile=hiking-mountain&profile:Offroad_factor=2&');
    });

    it('BRouter de ce PC muet : message dédié', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(routePoints(POINTS, { base: LOCAL_BROUTER_URL })).rejects.toThrow('BRouter de ce PC ne répond pas.');
    });
});

describe('resolveEngine', () => {
    beforeEach(() => { forgetEngine(); });
    afterEach(() => { vi.restoreAllMocks(); forgetEngine(); });

    it('le PC répond (même par une erreur HTTP) : moteur local', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
        const e = await resolveEngine();
        expect(e.key).toBe('local');
        expect(e.base).toBe(LOCAL_BROUTER_URL);
        expect(globalThis.fetch.mock.calls[0][0].startsWith(LOCAL_BROUTER_URL)).toBe(true);
    });

    it('le PC ne répond pas : brouter.de', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        const e = await resolveEngine();
        expect(e.key).toBe('brouter.de');
        expect(e.base).toBe(PUBLIC_BROUTER_URL);
    });

    it('résultat gardé : pas de nouvelle sonde dans la minute', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
        await resolveEngine();
        await resolveEngine();
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('un échec du PC en cours de calcul fait ressonder', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
        await resolveEngine();
        globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(routePoints(POINTS, { base: LOCAL_BROUTER_URL })).rejects.toThrow();
        const e = await resolveEngine();
        expect(e.key).toBe('brouter.de');
    });
});
