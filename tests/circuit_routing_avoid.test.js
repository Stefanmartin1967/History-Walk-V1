// @vitest-environment jsdom
// « Éviter de repasser » (src/circuit-routing.js) : réglage, lignes à éviter
// envoyées à BRouter, passages tracés à la suite, nouvel essai quand brouter.de
// limite le débit. Chantier comparateur de tracé, PR 3 (12/11/2026).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeRouting, avoidPolylinesQuery, routeCircuit, routePoints, LOCAL_BROUTER_URL } from '../src/circuit-routing.js';

describe('normalizeRouting — éviter de repasser', () => {
    it('absent ou faux : aucune clé ajoutée', () => {
        expect(normalizeRouting({ variant: 'direct' })).toEqual({ variant: 'direct' });
        expect(normalizeRouting({ variant: 'chemins', force: 1, avoid: false, weight: 1000 })).toEqual({ variant: 'chemins', force: 1 });
    });
    it('activé : poids 100 par défaut, 5 / 100 / 1000 seulement', () => {
        expect(normalizeRouting({ variant: 'direct', avoid: true })).toEqual({ variant: 'direct', avoid: true, weight: 100 });
        expect(normalizeRouting({ variant: 'chemins', force: 2, avoid: true, weight: 1000 })).toEqual({ variant: 'chemins', force: 2, avoid: true, weight: 1000 });
        expect(normalizeRouting({ variant: 'direct', avoid: true, weight: 7 }).weight).toBe(100);
    });
});

// Tracé vers le nord, un point tous les ~11 m (0,0001° de latitude).
const north = (n, lat0 = 33.8, lon = 10.9) => Array.from({ length: n + 1 }, (_, i) => [lat0 + i * 0.0001, lon]);

describe('avoidPolylinesQuery', () => {
    it('rien à éviter : chaîne vide', () => {
        expect(avoidPolylinesQuery([], [[10.9, 33.8], [10.9, 33.81]], 100, 600)).toBe('');
    });

    it('retire 150 m autour des deux bouts, un point tous les 15 m, poids en fin de ligne', () => {
        const track = north(100); // ~1,1 km
        // Passage qui part du bout du tracé (son dernier point) vers ailleurs.
        const [lat, lon] = track[track.length - 1];
        const q = avoidPolylinesQuery(track, [[lon, lat], [10.95, 33.85]], 100, 600);
        expect(q.startsWith('&polylines=')).toBe(true);
        const nums = q.slice('&polylines='.length).split(',').map(Number);
        expect(nums[nums.length - 1]).toBe(100);
        const pts = [];
        for (let i = 0; i + 1 < nums.length - 1; i += 2) pts.push([nums[i + 1], nums[i]]);
        // Aucun point à moins de 150 m du départ du passage.
        const dist = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
        expect(pts.every(p => dist(p, [lat, lon]) >= 150)).toBe(true);
        // Espacement d'au moins 15 m entre deux points gardés.
        for (let i = 1; i < pts.length; i++) expect(dist(pts[i], pts[i - 1])).toBeGreaterThanOrEqual(14.9);
    });

    it('au-delà du plafond de points : réduit', () => {
        const q = avoidPolylinesQuery(north(3000), [[11.5, 34.5], [11.6, 34.6]], 5, 100);
        const count = (q.slice('&polylines='.length).split(',').length - 1) / 2;
        expect(count).toBeLessThanOrEqual(101);
    });
});

describe('routeCircuit — éviter de repasser', () => {
    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
    const poi = (lat) => ({ geometry: { coordinates: [10.9, lat] }, properties: {} });

    function mockBRouter() {
        const urls = [];
        globalThis.fetch = vi.fn().mockImplementation((url) => {
            urls.push(url);
            const ll = decodeURIComponent(new URL(url).searchParams.get('lonlats')).split('|').map(s => s.split(',').map(Number));
            // Ligne droite fine entre les vias (un point tous les ~11 m).
            const [a, b] = [ll[0], ll[ll.length - 1]];
            const n = 60;
            const coords = Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
            return Promise.resolve({ ok: true, json: async () => ({ features: [{ properties: { 'track-length': '700' }, geometry: { coordinates: coords } }] }) });
        });
        return urls;
    }

    it('passages tracés à la suite, chacun évite les précédents (BRouter de ce PC)', async () => {
        const urls = mockBRouter();
        // Aller puis retour : A → B → A.
        const r = await routeCircuit([poi(33.8), poi(33.806), poi(33.8)], {}, {
            routing: { variant: 'direct', avoid: true, weight: 1000 }, base: LOCAL_BROUTER_URL,
        });
        expect(urls).toHaveLength(2);
        expect(urls[0]).not.toContain('polylines=');
        expect(urls[1]).toContain('&polylines=');
        expect(urls[1]).toMatch(/,1000(&|\||$)/);
        expect(r.segments).toHaveLength(2);
    });

    it('sans « éviter » : passages en parallèle, aucune ligne à éviter', async () => {
        const urls = mockBRouter();
        await routeCircuit([poi(33.8), poi(33.806), poi(33.8)], {}, { routing: { variant: 'direct' } });
        expect(urls).toHaveLength(2);
        expect(urls.every(u => !u.includes('polylines='))).toBe(true);
    });
});

describe('routePoints — brouter.de limite le débit', () => {
    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

    it('nouvel essai après « retry later », puis réussit', async () => {
        vi.useFakeTimers();
        const ok = { ok: true, json: async () => ({ features: [{ properties: { 'track-length': '500' }, geometry: { coordinates: [[10, 33.8], [10.01, 33.8]] } }] }) };
        const busy = { ok: false, status: 503, text: async () => 'Please, retry later!' };
        globalThis.fetch = vi.fn().mockResolvedValueOnce(busy).mockResolvedValueOnce(ok);
        const p = routePoints([[10, 33.8], [10.01, 33.8]]);
        await vi.advanceTimersByTimeAsync(3000);
        const r = await p;
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        expect(r.distanceKm).toBe(0.5);
    });

    it('toujours limité après 3 nouveaux essais : message dédié', async () => {
        vi.useFakeTimers();
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'Please, retry later!' });
        const p = routePoints([[10, 33.8], [10.01, 33.8]]);
        const check = expect(p).rejects.toThrow('brouter.de limite les demandes.');
        await vi.advanceTimersByTimeAsync(3000 + 6000 + 9000);
        await check;
        expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    });
});
