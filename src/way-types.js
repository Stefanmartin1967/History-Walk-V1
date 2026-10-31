// way-types.js — Types de voie d'un tracé de circuit (logique pure, sans DOM).
//
// Demande de Stefan (30/10/2026) : voir, PENDANT qu'il trace, si le circuit
// passe par une route, une rue, une piste ou un sentier. Pour l'auteur seul,
// rien n'est publié. Source : les voies OSM autour du tracé (Overpass), pour que
// les couleurs s'affichent aussi sur un circuit déjà tracé qu'on rouvre — les
// messages BRouter, eux, n'existent qu'au moment du calcul.
//
// Principe : un tracé BRouter suit les nœuds OSM, chaque tronçon (deux points
// consécutifs) longe donc une voie. On prend la voie la plus proche du milieu du
// tronçon ; au-delà de MATCH_M, le tronçon est « Non classé » (retouche GPX
// Studio hors voie, voie absente d'OSM…).
//
// Couverture : on n'interroge Overpass que dans un couloir autour du tracé
// (CORRIDOR_M). Un tronçon hors des couloirs déjà interrogés est « en attente »
// (dessiné en bleu) jusqu'à la requête suivante. Un passage recalculé dans la
// même zone se recolore donc sans requête.

export const WAY_CATEGORIES = [
    { key: 'route', label: 'Route' },
    { key: 'rue', label: 'Rue' },
    { key: 'piste', label: 'Piste' },
    { key: 'sentier', label: 'Sentier' },
    { key: 'non-classe', label: 'Non classé' },
];

// Valeur OSM `highway` → catégorie. Le reste (road, construction, bus_guideway…)
// tombe en « Non classé ». `unclassified` = petite route publique ouverte aux
// voitures (souvent la liaison entre houmas) → Route (décision 31/10/2026).
const HIGHWAY_CATEGORY = {
    motorway: 'route', motorway_link: 'route',
    trunk: 'route', trunk_link: 'route',
    primary: 'route', primary_link: 'route',
    secondary: 'route', secondary_link: 'route',
    tertiary: 'route', tertiary_link: 'route',
    unclassified: 'route',
    residential: 'rue', living_street: 'rue', service: 'rue', pedestrian: 'rue',
    track: 'piste',
    path: 'sentier', footway: 'sentier', steps: 'sentier', bridleway: 'sentier', cycleway: 'sentier',
};

export function categoryOfHighway(highway) {
    return HIGHWAY_CATEGORY[highway] || 'non-classe';
}

export const MATCH_M = 10;     // tronçon ↔ voie : au-delà, « Non classé »
export const CORRIDOR_M = 40;  // rayon du couloir interrogé autour du tracé
const COVER_MARGIN_M = 10;     // un point est couvert à moins de CORRIDOR_M − marge
const SIMPLIFY_M = 5;          // tolérance de simplification du couloir
const CELL_M = 50;             // maille de l'index spatial
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320;  // × cos(latitude)

// ---------- Index spatial de segments ----------
// Projection équirectangulaire autour de la latitude du premier point indexé :
// exacte à quelques pour mille sur l'emprise d'un circuit.

export function createSegmentIndex() {
    return { cos: null, cells: new Map(), ids: new Set() };
}

function project(index, lat, lon) {
    if (index.cos === null) index.cos = Math.cos(lat * Math.PI / 180);
    return [lon * M_PER_DEG_LON * index.cos, lat * M_PER_DEG_LAT];
}

function cellKey(cx, cy) { return cx + ':' + cy; }

// Ajoute une polyligne [[lat, lon], …] ; `payload` est rendu par nearestPayload.
export function addPolyline(index, latlngs, payload) {
    for (let i = 0; i + 1 < latlngs.length; i++) {
        const [ax, ay] = project(index, latlngs[i][0], latlngs[i][1]);
        const [bx, by] = project(index, latlngs[i + 1][0], latlngs[i + 1][1]);
        const seg = { ax, ay, bx, by, payload };
        const x0 = Math.floor(Math.min(ax, bx) / CELL_M), x1 = Math.floor(Math.max(ax, bx) / CELL_M);
        const y0 = Math.floor(Math.min(ay, by) / CELL_M), y1 = Math.floor(Math.max(ay, by) / CELL_M);
        for (let cx = x0; cx <= x1; cx++) {
            for (let cy = y0; cy <= y1; cy++) {
                const k = cellKey(cx, cy);
                if (!index.cells.has(k)) index.cells.set(k, []);
                index.cells.get(k).push(seg);
            }
        }
    }
}

function distToSeg(px, py, s) {
    const dx = s.bx - s.ax, dy = s.by - s.ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - s.ax) * dx + (py - s.ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (s.ax + t * dx), py - (s.ay + t * dy));
}

// Payload du segment le plus proche de (lat, lon) à moins de maxM, sinon null.
export function nearestPayload(index, lat, lon, maxM) {
    if (index.cos === null) return null;
    const [px, py] = project(index, lat, lon);
    const x0 = Math.floor((px - maxM) / CELL_M), x1 = Math.floor((px + maxM) / CELL_M);
    const y0 = Math.floor((py - maxM) / CELL_M), y1 = Math.floor((py + maxM) / CELL_M);
    let best = null, bestD = maxM;
    for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
            for (const s of index.cells.get(cellKey(cx, cy)) || []) {
                const d = distToSeg(px, py, s);
                if (d <= bestD) { bestD = d; best = s.payload; }
            }
        }
    }
    return best;
}

/**
 * Ajoute à l'index les voies d'une réponse Overpass (`out geom`). Une voie déjà
 * indexée (même id) est ignorée : les couloirs successifs se recouvrent.
 */
export function addOverpassWays(index, json) {
    for (const el of (json && json.elements) || []) {
        if (el.type !== 'way' || !Array.isArray(el.geometry) || !el.tags?.highway) continue;
        if (el.id != null) {
            if (index.ids.has(el.id)) continue;
            index.ids.add(el.id);
        }
        const ll = el.geometry
            .filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
            .map(p => [p.lat, p.lon]);
        if (ll.length >= 2) addPolyline(index, ll, categoryOfHighway(el.tags.highway));
    }
}

// ---------- Classement d'un tracé ----------

function edgeMeters(a, b) {
    const cos = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
    return Math.hypot((b[1] - a[1]) * M_PER_DEG_LON * cos, (b[0] - a[0]) * M_PER_DEG_LAT);
}

/**
 * Classe les tronçons d'un tracé découpé en passages.
 *
 * @param {Array<{coords: number[][], ok?: boolean}>} parts - passages [[lat, lon], …]
 *        (`ok === false` : passage resté en ligne droite → « droite »)
 * @param {object} wayIndex  - index des voies (addOverpassWays)
 * @param {object} coverIndex - index des couloirs déjà interrogés
 * @returns {{runs: Array<{t: string, ll: number[][]}>, meters: Object<string, number>}}
 *          runs : suites de tronçons de même type, `t` ∈ catégories + 'droite' +
 *          'pending' (hors couloir interrogé) ; meters : longueur par type.
 */
export function classifyParts(parts, wayIndex, coverIndex) {
    const runs = [];
    const meters = {};
    const coverMax = CORRIDOR_M - COVER_MARGIN_M;
    for (const part of parts || []) {
        const c = part && part.coords;
        if (!Array.isArray(c) || c.length < 2) continue;
        let run = null;
        for (let i = 0; i + 1 < c.length; i++) {
            const a = c[i], b = c[i + 1];
            let t;
            if (part.ok === false) t = 'droite';
            else {
                const mLat = (a[0] + b[0]) / 2, mLon = (a[1] + b[1]) / 2;
                if (nearestPayload(coverIndex, mLat, mLon, coverMax) === null) t = 'pending';
                else t = nearestPayload(wayIndex, mLat, mLon, MATCH_M) || 'non-classe';
            }
            meters[t] = (meters[t] || 0) + edgeMeters(a, b);
            if (run && run.t === t) run.ll.push(b);
            else { run = { t, ll: [a, b] }; runs.push(run); }
        }
    }
    return { runs, meters };
}

// ---------- Requête Overpass du couloir ----------

// Douglas-Peucker en mètres (projection locale) : allège la requête sans
// déplacer le couloir de plus de SIMPLIFY_M.
export function simplifyLatLngs(ll, tolM = SIMPLIFY_M) {
    if (!Array.isArray(ll) || ll.length < 3) return ll ? ll.slice() : [];
    const idx = createSegmentIndex();
    const pts = ll.map(p => project(idx, p[0], p[1]));
    const keep = new Uint8Array(ll.length);
    keep[0] = keep[ll.length - 1] = 1;
    const stack = [[0, ll.length - 1]];
    while (stack.length) {
        const [s, e] = stack.pop();
        const seg = { ax: pts[s][0], ay: pts[s][1], bx: pts[e][0], by: pts[e][1] };
        let maxD = -1, maxI = -1;
        for (let i = s + 1; i < e; i++) {
            const d = distToSeg(pts[i][0], pts[i][1], seg);
            if (d > maxD) { maxD = d; maxI = i; }
        }
        if (maxD > tolM) { keep[maxI] = 1; stack.push([s, maxI], [maxI, e]); }
    }
    return ll.filter((_, i) => keep[i]);
}

/**
 * Polylignes du couloir à interroger : les suites « pending », simplifiées.
 * @returns {number[][][]} liste de polylignes [[lat, lon], …]
 */
export function pendingCorridors(runs) {
    return (runs || []).filter(r => r.t === 'pending').map(r => simplifyLatLngs(r.ll));
}

/** Requête Overpass des voies `highway` à CORRIDOR_M des polylignes données. */
export function corridorQuery(corridors) {
    const parts = corridors
        .filter(ll => ll.length >= 2)
        .map(ll => `way["highway"](around:${CORRIDOR_M},${ll.map(p => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(',')});`);
    return `[out:json][timeout:25];(${parts.join('')});out geom;`;
}

/** Longueur affichée « 4,1 km » (une décimale, virgule). */
export function formatKm(m) {
    return (m / 1000).toFixed(1).replace('.', ',') + ' km';
}
