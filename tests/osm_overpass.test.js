// Tests pour src/osm-overpass.js — chantier point d'accès v2 PR 2/5.
// On teste l'utility pure (nearestPointFromWays, distanceMeters, buildQuery)
// + le flow nearestHighway() avec un fetch mocké.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nearestHighway, fetchOverpassJson, setOverpassKey, hasOverpassKey, testOverpassKey, _internals } from '../src/osm-overpass.js';

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

    it('throws si le serveur échoue à chaque tentative (après retries)', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network down'));
        await expect(nearestHighway(0, 0)).rejects.toThrow();
        // Sans clé, un seul serveur : 4 tentatives (1 initiale + 3 retries) = 4 appels.
        expect(global.fetch).toHaveBeenCalledTimes(4);
    }, 20000); // Timeout 20s : couvre les 3 backoffs cumulés (1+3+8=12s).
});

describe('osm-overpass — chaîne de serveurs (fetch mocké)', () => {
    const { PUBLIC_ENDPOINT, KEYED_ENDPOINT_BASE, MAX_DATA_AGE_MS, dataAgeMs, reset } = _internals;
    const ok = (json) => ({ ok: true, status: 200, json: async () => json });
    const fail = (status) => ({ ok: false, status, json: async () => ({}) });
    let originalFetch;
    beforeEach(() => { originalFetch = global.fetch; reset(); });
    afterEach(() => { global.fetch = originalFetch; reset(); vi.restoreAllMocks(); });

    it('sans clé : seul overpass-api.de est interrogé', async () => {
        global.fetch = vi.fn().mockResolvedValue(ok({ elements: [] }));
        expect(hasOverpassKey()).toBe(false);
        await fetchOverpassJson('q', { retries: 0 });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch.mock.calls[0][0]).toBe(PUBLIC_ENDPOINT);
    });

    it('avec clé : overpass.ch d\'abord, clé dans le chemin', async () => {
        setOverpassKey('  abc123  ');
        global.fetch = vi.fn().mockResolvedValue(ok({ elements: [] }));
        await fetchOverpassJson('q', { retries: 0 });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch.mock.calls[0][0]).toBe(`${KEYED_ENDPOINT_BASE}/abc123/interpreter`);
    });

    it('avec clé : bascule sur overpass-api.de si overpass.ch échoue', async () => {
        setOverpassKey('abc123');
        global.fetch = vi.fn()
            .mockResolvedValueOnce(fail(500))
            .mockResolvedValueOnce(ok({ elements: [{ id: 1 }] }));
        const json = await fetchOverpassJson('q', { retries: 0 });
        expect(json.elements).toHaveLength(1);
        expect(global.fetch.mock.calls[1][0]).toBe(PUBLIC_ENDPOINT);
    });

    it('un serveur saturé (502) est mis en pause : la requête suivante ne le sollicite plus', async () => {
        global.fetch = vi.fn().mockResolvedValue(fail(502));
        await expect(fetchOverpassJson('q', { retries: 3 })).rejects.toThrow();
        // Pause posée dès le 1er refus → les retries s'arrêtent net (pas de backoff à vide).
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const err = await fetchOverpassJson('q', { retries: 0 }).catch(e => e);
        expect(err.cooling).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('une erreur réseau ne met PAS le serveur en pause', async () => {
        global.fetch = vi.fn()
            .mockRejectedValueOnce(new Error('Network down'))
            .mockResolvedValueOnce(ok({ elements: [] }));
        await expect(fetchOverpassJson('q', { retries: 0 })).rejects.toThrow('Network down');
        await expect(fetchOverpassJson('q', { retries: 0 })).resolves.toEqual({ elements: [] });
    });

    it('écarte une réponse dont la base OSM est périmée et passe au serveur suivant', async () => {
        setOverpassKey('abc123');
        const old = new Date(Date.now() - MAX_DATA_AGE_MS - 86400000).toISOString();
        const fresh = new Date().toISOString();
        global.fetch = vi.fn()
            .mockResolvedValueOnce(ok({ osm3s: { timestamp_osm_base: old }, elements: [{ id: 'vieux' }] }))
            .mockResolvedValueOnce(ok({ osm3s: { timestamp_osm_base: fresh }, elements: [{ id: 'frais' }] }));
        const json = await fetchOverpassJson('q', { retries: 0 });
        expect(json.elements[0].id).toBe('frais');
    });

    it('dataAgeMs : null si le serveur ne donne pas de date', () => {
        expect(dataAgeMs({})).toBeNull();
        expect(dataAgeMs({ osm3s: { timestamp_osm_base: '2026-10-28T10:00:00Z' } }, Date.parse('2026-10-28T11:00:00Z'))).toBe(3600000);
    });

    it('setOverpassKey vide retire la clé', () => {
        setOverpassKey('abc');
        expect(hasOverpassKey()).toBe(true);
        setOverpassKey('   ');
        expect(hasOverpassKey()).toBe(false);
    });

    it('testOverpassKey : ok sur 200, refus explicite sur 401', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce(ok({ elements: [] }));
        await expect(testOverpassKey('abc')).resolves.toEqual({ ok: true });
        global.fetch = vi.fn().mockResolvedValueOnce(fail(401));
        const r = await testOverpassKey('abc');
        expect(r.ok).toBe(false);
        expect(r.error).toContain('401');
        await expect(testOverpassKey('  ')).resolves.toEqual({ ok: false, error: 'clé vide' });
    });
});
