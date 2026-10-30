// @vitest-environment jsdom
// Re-tracé PARTIEL (src/circuit-routing.js → routeChangedSegments) et découpe
// d'un tracé enregistré par ancres (splitTrackByAnchors). Demande de Stefan
// (30/10/2026) : re-tracer après avoir ajouté/retiré un lieu effaçait tous les
// points de passage — seuls les passages dont la paire de lieux a changé doivent
// être recalculés. fetch BRouter mocké (brouter.de injoignable).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { routeChangedSegments, splitTrackByAnchors, buildRealTrack } from '../src/circuit-routing.js';

// Lieux alignés sur une même latitude, ~900 m entre deux voisins.
const poi = (lon, lat = 33.8) => ({ geometry: { coordinates: [lon, lat] }, properties: {} });
const A = poi(10.00), B = poi(10.01), C = poi(10.02), D = poi(10.03);

// Segment « ajusté » : passe par un détour au nord, que BRouter ne referait pas.
function adjusted(from, to) {
    const [lon1, lat1] = from.geometry.coordinates;
    const [lon2, lat2] = to.geometry.coordinates;
    return { coords: [[lat1, lon1], [lat1 + 0.003, (lon1 + lon2) / 2], [lat2, lon2]], ok: true, distanceKm: 1.2, ascend: 3 };
}

// BRouter mocké : ligne droite entre les vias, et on compte les appels.
function mockBRouter() {
    const calls = [];
    globalThis.fetch = vi.fn().mockImplementation((url) => {
        calls.push(url);
        const lonlats = decodeURIComponent(new URL(url).searchParams.get('lonlats'))
            .split('|').map(s => s.split(',').map(Number));
        return Promise.resolve({
            ok: true,
            json: async () => ({
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: { 'track-length': '900', 'total-time': '600', 'filtered ascend': '1' },
                    geometry: { type: 'LineString', coordinates: lonlats },
                }],
            }),
        });
    });
    return calls;
}

describe('routeChangedSegments — re-tracé partiel', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('ajout d’un lieu au milieu : seuls les deux nouveaux passages sont recalculés', async () => {
        const calls = mockBRouter();
        const segAB = adjusted(A, B), segBC = adjusted(B, C);
        const prev = { ids: ['a', 'b', 'c'], features: [A, B, C], segments: [segAB, segBC],
            realTrack: buildRealTrack([segAB, segBC]) };

        const r = await routeChangedSegments([A, B, D, C], ['a', 'b', 'd', 'c'], prev);

        expect(calls).toHaveLength(2); // B→D et D→C
        expect(r.keptCount).toBe(1);
        expect(r.reroutedCount).toBe(2);
        expect(r.segments[0].coords).toEqual(segAB.coords); // A→B intact, détour compris
        expect(r.segments).toHaveLength(3);
    });

    it('retrait d’un lieu : le passage qui le contourne est recalculé, les autres gardés', async () => {
        const calls = mockBRouter();
        const segs = [adjusted(A, B), adjusted(B, C), adjusted(C, D)];
        const prev = { ids: ['a', 'b', 'c', 'd'], features: [A, B, C, D], segments: segs, realTrack: buildRealTrack(segs) };

        const r = await routeChangedSegments([A, C, D], ['a', 'c', 'd'], prev);

        expect(calls).toHaveLength(1); // A→C
        expect(r.segments[1].coords).toEqual(segs[2].coords); // C→D intact
    });

    it('sans segments de session : re-découpe le tracé enregistré et garde la géométrie', async () => {
        const calls = mockBRouter();
        const segAB = adjusted(A, B), segBC = adjusted(B, C);
        const prev = { ids: ['a', 'b', 'c'], features: [A, B, C], segments: null, realTrack: buildRealTrack([segAB, segBC]) };

        const r = await routeChangedSegments([A, B, C, D], ['a', 'b', 'c', 'd'], prev);

        expect(calls).toHaveLength(1); // C→D seulement
        expect(buildRealTrack(r.segments.slice(0, 2))).toEqual(prev.realTrack);
        // Passages re-découpés = sans altitude → D+ laissé à l'appelant.
        expect(r.ascend).toBeNull();
    });

    it('segments de session qui ne correspondent pas au tracé enregistré : ignorés', async () => {
        mockBRouter();
        const segAB = adjusted(A, B), segBC = adjusted(B, C);
        const stale = [{ coords: [[0, 0], [1, 1]], ok: true }, { coords: [[1, 1], [2, 2]], ok: true }];
        const prev = { ids: ['a', 'b', 'c'], features: [A, B, C], segments: stale, realTrack: buildRealTrack([segAB, segBC]) };

        const r = await routeChangedSegments([A, B, C, D], ['a', 'b', 'c', 'd'], prev);

        expect(r.segments[0].coords).toEqual(segAB.coords);
    });

    it('un passage en échec (ligne droite) est retenté', async () => {
        const calls = mockBRouter();
        const segAB = { ...adjusted(A, B), ok: false };
        const segBC = adjusted(B, C);
        const prev = { ids: ['a', 'b', 'c'], features: [A, B, C], segments: [segAB, segBC], realTrack: buildRealTrack([segAB, segBC]) };

        const r = await routeChangedSegments([A, B, C, D], ['a', 'b', 'c', 'd'], prev);

        expect(calls).toHaveLength(2); // A→B (échec) + C→D (nouveau)
        expect(r.keptCount).toBe(1);
    });

    it('drapeau déplacé depuis le tracé (> 50 m) : le passage est recalculé', async () => {
        const calls = mockBRouter();
        const segAB = adjusted(A, B), segBC = adjusted(B, C);
        const prev = { ids: ['a', 'b', 'c'], features: [A, B, C], segments: [segAB, segBC], realTrack: buildRealTrack([segAB, segBC]) };
        // B porte maintenant un drapeau à ~110 m au nord de l'ancien point.
        const Bmoved = { ...B, properties: { accessPoint: [10.01, 33.801] } };

        const r = await routeChangedSegments([A, Bmoved, C, D], ['a', 'b', 'c', 'd'], prev);

        expect(calls).toHaveLength(3); // A→B et B→C (drapeau) + C→D (nouveau)
        expect(r.keptCount).toBe(0);
    });

    it('sans tracé précédent : tout est recalculé', async () => {
        const calls = mockBRouter();
        const r = await routeChangedSegments([A, B, C], ['a', 'b', 'c'], null);
        expect(calls).toHaveLength(2);
        expect(r.keptCount).toBe(0);
        expect(r.reroutedCount).toBe(2);
        expect(r.ascend).toBe(2); // tout vient de BRouter → D+ connu
    });
});

describe('splitTrackByAnchors — découpe d’un tracé qui repasse près d’un lieu', () => {
    it('aller-retour : coupe au bon passage, pas au retour', () => {
        // A (ouest) → B (milieu) → C (est) → D (milieu, au nord de B), retour
        // par la même route : le tracé repasse au ras de B après C.
        const Am = poi(10.00), Bm = poi(10.01), Cm = poi(10.02), Dm = poi(10.01, 33.805);
        const track = [
            [33.8, 10.000], [33.8, 10.005], [33.8, 10.0099], // vers B (passe à ~9 m)
            [33.8, 10.015], [33.8, 10.020],                   // C
            [33.8, 10.015], [33.8, 10.0100],                  // retour, PILE sur B
            [33.8025, 10.01], [33.805, 10.01],                // D
        ];
        const segs = splitTrackByAnchors(track, [Am, Bm, Cm, Dm]);
        // Un glouton couperait B au retour (index 6) et C deviendrait introuvable.
        expect(segs[0].coords).toHaveLength(3);         // A → B (1er passage, index 2)
        expect(segs[1].coords[segs[1].coords.length - 1]).toEqual([33.8, 10.020]); // B → C
        expect(buildRealTrack(segs)).toEqual(track);    // rien de perdu ni dupliqué
    });
});
