// Types de voie d'un tracé (src/way-types.js) : classement OSM, rapprochement
// tronçon ↔ voie, couverture de la zone interrogée, requête Overpass. Demandes de
// Stefan : voir route / rue / piste / sentier pendant qu'il trace (30/10/2026),
// puis toutes les voies de la zone autour du tracé (31/10/2026).
import { describe, it, expect } from 'vitest';
import {
    categoryOfHighway, createSegmentIndex, addOverpassWays, classifyParts,
    pendingZone, zoneQuery, boundsOf, boxesIntersect, formatKm, MATCH_M, ZONE_MARGIN_M,
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
// Index des voies + rectangle interrogé autour de `covered` (marge en mètres).
function indexes(ways, covered, marginM = ZONE_MARGIN_M) {
    const w = createSegmentIndex();
    addOverpassWays(w, { elements: ways });
    return [w, covered ? [boundsOf(covered, marginM)] : []];
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

    it('hors de la zone interrogée : « pending » (reste bleu)', () => {
        // Rectangle de 0 à 200 m élargi de 450 m : couvert jusqu'à 500 m (bord − 150 m).
        const [w, c] = indexes([way(1, 'path', 0, 12)], track(0, 2), 450);
        const { runs, meters } = classifyParts([{ coords: track(0, 12) }], w, c);
        expect(runs.map(r => r.t)).toEqual(['sentier', 'pending']);
        expect(meters.sentier).toBeCloseTo(500, 0);
        expect(meters.pending).toBeCloseTo(700, 0);
    });

    it('un passage resté en ligne droite compte à part (« droite »)', () => {
        const [w, c] = indexes([way(1, 'path', 0, 6)], track(0, 6));
        const { runs } = classifyParts([{ coords: track(0, 3), ok: true }, { coords: track(3, 6), ok: false }], w, c);
        expect(runs.map(r => r.t)).toEqual(['sentier', 'droite']);
    });

    it('ignore une voie déjà indexée (rectangles qui se recouvrent)', () => {
        const w = createSegmentIndex();
        const count = () => [...w.cells.values()].flat().length;
        const first = addOverpassWays(w, { elements: [way(1, 'track', 0, 3)] });
        const once = count();
        const again = addOverpassWays(w, { elements: [way(1, 'track', 0, 3)] });
        expect(w.ids.size).toBe(1);
        expect(count()).toBe(once);
        expect(first).toHaveLength(1);
        expect(again).toHaveLength(0); // pas dessinée deux fois en fond
    });
});

describe('zone Overpass', () => {
    it('rend les voies ajoutées avec leur type et leur rectangle', () => {
        const [added] = addOverpassWays(createSegmentIndex(), { elements: [way(7, 'footway', 0, 3)] });
        expect(added.t).toBe('sentier');
        expect(added.ll).toHaveLength(2);
        expect(added.box.e).toBeGreaterThan(added.box.w);
    });

    it('après la requête, la zone couvre les tronçons qui étaient en attente', () => {
        const [w] = indexes([], null);
        const cover = [];
        const t = [...track(0, 3), [LAT + 300 * DLAT_1M, 10 + 3 * DLON_100M]]; // coude vers le nord
        const first = classifyParts([{ coords: t }], w, cover);
        cover.push(pendingZone(first.runs));
        const again = classifyParts([{ coords: t }], w, cover);
        expect(again.meters.pending).toBeUndefined();
    });

    it('la zone élargit le rectangle des tronçons en attente de 500 m', () => {
        const box = pendingZone([{ t: 'piste', ll: track(20, 30) }, { t: 'pending', ll: track(0, 3) }]);
        const [s0, w0] = track(0, 0)[0];
        expect((s0 - box.s) * 110574).toBeCloseTo(ZONE_MARGIN_M, 0);
        expect((w0 - box.w) / DLON_100M * 100).toBeCloseTo(ZONE_MARGIN_M, 0);
        expect((box.e - track(3, 3)[0][1]) / DLON_100M * 100).toBeCloseTo(ZONE_MARGIN_M, 0); // pas jusqu'à la piste
        expect(pendingZone([{ t: 'piste', ll: track(0, 3) }])).toBeNull();
    });

    it('construit une requête sur le rectangle (sud, ouest, nord, est)', () => {
        expect(zoneQuery({ s: 33.8, w: 10.1, n: 33.81, e: 10.11 }))
            .toBe('[out:json][timeout:25];way["highway"](33.800000,10.100000,33.810000,10.110000);out geom;');
    });

    it('rectangles qui se touchent ou non', () => {
        const a = { s: 0, w: 0, n: 1, e: 1 };
        expect(boxesIntersect(a, { s: 1, w: 1, n: 2, e: 2 })).toBe(true);
        expect(boxesIntersect(a, { s: 1.1, w: 0, n: 2, e: 1 })).toBe(false);
    });
});

describe('formatKm', () => {
    it('une décimale, virgule', () => {
        expect(formatKm(4120)).toBe('4,1 km');
        expect(formatKm(60)).toBe('0,1 km');
    });
});
