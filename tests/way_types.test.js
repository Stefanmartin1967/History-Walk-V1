// Types de voie d'un tracé (src/way-types.js) : classement OSM, rapprochement
// tronçon ↔ voie, couverture du couloir interrogé, requête Overpass. Demande de
// Stefan (30/10/2026) : voir route / rue / piste / sentier pendant qu'il trace.
import { describe, it, expect } from 'vitest';
import {
    categoryOfHighway, createSegmentIndex, addOverpassWays, addPolyline, classifyParts,
    pendingCorridors, corridorQuery, simplifyLatLngs, formatKm, MATCH_M,
} from '../src/way-types.js';

const LAT = 33.8;
const DLON_100M = 100 / (111320 * Math.cos(LAT * Math.PI / 180)); // ≈ 100 m vers l'est
const DLAT_1M = 1 / 110574;

// Voie Overpass (`out geom`) horizontale, de x0 à x1 (en centaines de mètres).
function way(id, highway, x0, x1, dyM = 0) {
    return {
        type: 'way', id, tags: { highway },
        geometry: [{ lat: LAT + dyM * DLAT_1M, lon: 10 + x0 * DLON_100M }, { lat: LAT + dyM * DLAT_1M, lon: 10 + x1 * DLON_100M }],
    };
}
// Tracé horizontal, un point tous les 100 m de x0 à x1.
function track(x0, x1, dyM = 0) {
    const out = [];
    for (let x = x0; x <= x1; x++) out.push([LAT + dyM * DLAT_1M, 10 + x * DLON_100M]);
    return out;
}
function indexes(ways, covered) {
    const w = createSegmentIndex(), c = createSegmentIndex();
    addOverpassWays(w, { elements: ways });
    if (covered) addPolyline(c, covered, true);
    return [w, c];
}

describe('categoryOfHighway', () => {
    it('range les valeurs OSM dans les cinq catégories', () => {
        expect(categoryOfHighway('primary')).toBe('route');
        expect(categoryOfHighway('unclassified')).toBe('route'); // décision du 31/10
        expect(categoryOfHighway('residential')).toBe('rue');
        expect(categoryOfHighway('pedestrian')).toBe('rue');
        expect(categoryOfHighway('track')).toBe('piste');
        expect(categoryOfHighway('footway')).toBe('sentier');
        expect(categoryOfHighway('steps')).toBe('sentier');
        expect(categoryOfHighway('road')).toBe('non-classe');
        expect(categoryOfHighway(undefined)).toBe('non-classe');
    });
});

describe('classifyParts', () => {
    it('donne à chaque tronçon le type de la voie qu\'il longe, en suites continues', () => {
        const [w, c] = indexes([way(1, 'primary', 0, 3), way(2, 'track', 3, 6)], track(0, 6));
        const { runs, meters } = classifyParts([{ coords: track(0, 6), ok: true }], w, c);
        expect(runs.map(r => r.t)).toEqual(['route', 'piste']);
        expect(runs[0].ll).toHaveLength(4);
        expect(runs[1].ll[0]).toEqual(runs[0].ll[3]); // les suites se touchent
        expect(meters.route).toBeCloseTo(300, 0);
        expect(meters.piste).toBeCloseTo(300, 0);
    });

    it('préfère la voie la plus proche (trottoir parallèle à une route)', () => {
        const [w, c] = indexes([way(1, 'secondary', 0, 3), way(2, 'footway', 0, 3, 6)], track(0, 3));
        const { runs } = classifyParts([{ coords: track(0, 3) }], w, c);
        expect(runs.map(r => r.t)).toEqual(['route']);
    });

    it(`au-delà de ${MATCH_M} m de toute voie : « Non classé »`, () => {
        const [w, c] = indexes([way(1, 'residential', 0, 3, 25)], track(0, 3));
        const { runs } = classifyParts([{ coords: track(0, 3) }], w, c);
        expect(runs.map(r => r.t)).toEqual(['non-classe']);
    });

    it('hors du couloir interrogé : « pending » (reste bleu)', () => {
        const [w, c] = indexes([way(1, 'path', 0, 6)], track(0, 3));
        const { runs, meters } = classifyParts([{ coords: track(0, 6) }], w, c);
        expect(runs.map(r => r.t)).toEqual(['sentier', 'pending']);
        expect(meters.pending).toBeCloseTo(300, 0);
    });

    it('un passage resté en ligne droite compte à part (« droite »)', () => {
        const [w, c] = indexes([way(1, 'path', 0, 6)], track(0, 6));
        const { runs } = classifyParts([{ coords: track(0, 3), ok: true }, { coords: track(3, 6), ok: false }], w, c);
        expect(runs.map(r => r.t)).toEqual(['sentier', 'droite']);
    });

    it('ignore une voie déjà indexée (couloirs qui se recouvrent)', () => {
        const w = createSegmentIndex();
        const count = () => [...w.cells.values()].flat().length;
        addOverpassWays(w, { elements: [way(1, 'track', 0, 3)] });
        const once = count();
        addOverpassWays(w, { elements: [way(1, 'track', 0, 3)] });
        expect(w.ids.size).toBe(1);
        expect(count()).toBe(once);
    });
});

describe('couloir Overpass', () => {
    it('simplifie une ligne droite à ses deux bouts', () => {
        expect(simplifyLatLngs(track(0, 10))).toHaveLength(2);
    });

    it('après la requête, le couloir couvre les tronçons qui étaient en attente', () => {
        const [w, c] = indexes([], null);
        const t = [...track(0, 3), [LAT + 300 * DLAT_1M, 10 + 3 * DLON_100M]]; // coude vers le nord
        const first = classifyParts([{ coords: t }], w, c);
        const corridors = pendingCorridors(first.runs);
        corridors.forEach(ll => addPolyline(c, ll, true));
        const again = classifyParts([{ coords: t }], w, c);
        expect(again.meters.pending).toBeUndefined();
    });

    it('construit une requête « around » par suite en attente', () => {
        const q = corridorQuery([[[33.8, 10.1], [33.81, 10.11]]]);
        expect(q).toBe('[out:json][timeout:25];(way["highway"](around:40,33.800000,10.100000,33.810000,10.110000););out geom;');
    });
});

describe('formatKm', () => {
    it('une décimale, virgule', () => {
        expect(formatKm(4120)).toBe('4,1 km');
        expect(formatKm(60)).toBe('0,1 km');
    });
});
