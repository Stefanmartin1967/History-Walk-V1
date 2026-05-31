// Tests pour src/osm-overpass.js — chantier point d'accès v2 PR 2/5.
// On teste l'utility pure (nearestPointFromWays, distanceMeters, buildQuery)
// + le flow nearestHighway() avec un fetch mocké.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nearestHighway, _internals } from '../src/osm-overpass.js';

const { distanceMeters, nearestPointFromWays, buildQuery, SEARCH_RADIUS_M } = _internals;

describe('osm-overpass — internals', () => {
    describe('distanceMeters', () => {
        it('renvoie 0 pour des coords identiques', () => {
            expect(distanceMeters([48.8566, 2.3522], [48.8566, 2.3522])).toBe(0);
        });
        it('renvoie ~111 km pour 1° de latitude', () => {
            const d = distanceMeters([0, 0], [1, 0]);
            expect(d).toBeGreaterThan(110000);
            expect(d).toBeLessThan(112000);
        });
        it('renvoie ~157 m entre 2 points proches (Djerba)', () => {
            // Mosquée El Bessi → voie carrossable la plus proche (test approximatif)
            const d = distanceMeters([33.8076, 10.9457], [33.8090, 10.9460]);
            expect(d).toBeGreaterThan(140);
            expect(d).toBeLessThan(180);
        });
    });

    describe('buildQuery', () => {
        it('inclut le rayon de recherche et les coords', () => {
            const q = buildQuery(33.8076, 10.9457);
            expect(q).toContain(`around:${SEARCH_RADIUS_M}`);
            expect(q).toContain('33.8076');
            expect(q).toContain('10.9457');
            expect(q).toContain('way["highway"]');
        });
    });

    describe('nearestPointFromWays', () => {
        it('retourne null pour une réponse vide', () => {
            expect(nearestPointFromWays({ elements: [] }, 0, 0)).toBeNull();
            expect(nearestPointFromWays({}, 0, 0)).toBeNull();
            expect(nearestPointFromWays(null, 0, 0)).toBeNull();
        });
        it('trouve le noeud le plus proche parmi plusieurs ways', () => {
            const json = {
                elements: [
                    { type: 'way', geometry: [
                        { lat: 33.8000, lon: 10.9400 }, // loin
                        { lat: 33.8100, lon: 10.9500 }, // ~30m du POI ?
                    ]},
                    { type: 'way', geometry: [
                        { lat: 33.8080, lon: 10.9460 }, // très proche
                    ]},
                ],
            };
            const best = nearestPointFromWays(json, 33.8076, 10.9457);
            expect(best).not.toBeNull();
            expect(best.lon).toBe(10.9460);
            expect(best.lat).toBe(33.8080);
            expect(best.distance).toBeGreaterThan(0);
            expect(best.distance).toBeLessThan(100);
        });
        it('ignore les noeuds invalides (lat/lon non finis)', () => {
            const json = {
                elements: [
                    { type: 'way', geometry: [
                        { lat: 'foo', lon: 10 },
                        { lat: 33.8076, lon: 10.9457 }, // valide
                    ]},
                ],
            };
            const best = nearestPointFromWays(json, 33.8076, 10.9457);
            expect(best).not.toBeNull();
            expect(best.distance).toBe(0);
        });
        it('ignore les ways sans geometry', () => {
            const json = { elements: [{ type: 'way' }, { type: 'node' }] };
            expect(nearestPointFromWays(json, 0, 0)).toBeNull();
        });
    });
});

describe('osm-overpass — nearestHighway (fetch mocké)', () => {
    let originalFetch;
    beforeEach(() => {
        originalFetch = global.fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('valide les inputs et throws si lat/lon invalides', async () => {
        await expect(nearestHighway(NaN, 10)).rejects.toThrow('lat/lon invalides');
        await expect(nearestHighway(33, 'foo')).rejects.toThrow('lat/lon invalides');
    });

    it('retourne {coords, distance} en cas de succès', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                elements: [
                    { type: 'way', geometry: [{ lat: 33.8080, lon: 10.9460 }] },
                ],
            }),
        });
        const r = await nearestHighway(33.8076, 10.9457);
        expect(r).not.toBeNull();
        expect(r.coords).toEqual([10.9460, 33.8080]);
        expect(r.distance).toBeGreaterThan(0);
    });

    it('retourne null si Overpass ne renvoie aucun way', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ elements: [] }),
        });
        const r = await nearestHighway(33.8076, 10.9457);
        expect(r).toBeNull();
    });

    it('bascule sur le 2e endpoint si le 1er échoue', async () => {
        const fail = { ok: false, status: 503, json: async () => ({}) };
        const success = {
            ok: true,
            json: async () => ({
                elements: [{ type: 'way', geometry: [{ lat: 1, lon: 2 }] }],
            }),
        };
        global.fetch = vi.fn()
            .mockResolvedValueOnce(fail)
            .mockResolvedValueOnce(success);
        const r = await nearestHighway(0, 0);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(r).not.toBeNull();
    });

    it('throws si TOUS les endpoints échouent (après retries)', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network down'));
        await expect(nearestHighway(0, 0)).rejects.toThrow();
        // 4 tentatives (1 initiale + 3 retries) × 3 endpoints = 12 appels.
        expect(global.fetch).toHaveBeenCalledTimes(12);
    }, 20000); // Timeout 20s : couvre les 3 backoffs cumulés (1+3+8=12s).
});
