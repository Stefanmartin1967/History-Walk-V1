// passage-measure.js — Mesures d'un passage dans le panneau Itinéraire.
//
// Deux signaux, demandés par Stefan le 17/11/2026 après Saint-Benoît, où il a
// « trop forcé sur les petits sentiers » : le passage Clairière → Saint-Nicolas
// faisait 4,8 km pour 2,25 km à vol d'oiseau, porté par 12 points, et une trace
// Wikiloc récente montrait qu'on pouvait relier ses points 8 et 11 sans passer
// par le sentier interdit ni par les ronces.
//  - le RAPPORT au vol d'oiseau : longueur du passage ÷ distance directe entre
//    ses deux bouts (« ×2,1 ») — un passage très au-dessus de 1 est forcé ;
//  - le SUIVI D'UN CALQUE : part du passage à moins de 30 m d'un calque de
//    référence affiché (une marche, une trace Wikiloc), et les morceaux qui s'en
//    écartent — un calque marché prouve qu'un chemin existe.
//
// Module pur : coordonnées [lat, lon], aucune dépendance (tests compris).

/** Rapport au-delà duquel un passage est signalé comme forcé… */
export const FORCED_RATIO = 1.8;
/** …s'il fait aussi au moins ce détour (m). Sur un passage court, un lacet de
 *  montée gonfle le rapport sans rien forcer : Grotte des Sarrasins → Clairière,
 *  0,7 km pour 260 m (×2,9), marché sans difficulté le 13/11/2026. */
export const FORCED_EXTRA_M = 800;
/** Distance (m) sous laquelle un passage « suit » un calque. */
export const FOLLOW_TOLERANCE_M = 30;
// En dessous, le vol d'oiseau ne veut rien dire (boucle sur un même lieu).
const MIN_STRAIGHT_M = 150;

const M_PER_DEG_LAT = 110540;
const mPerDegLon = (lat) => 111320 * Math.cos(lat * Math.PI / 180);

function dist(a, b) {
    return Math.hypot((a[1] - b[1]) * mPerDegLon((a[0] + b[0]) / 2), (a[0] - b[0]) * M_PER_DEG_LAT);
}

/** Longueur (m) d'une ligne [[lat, lon], …]. */
export function lineLength(coords) {
    let m = 0;
    for (let i = 1; i < (coords || []).length; i++) m += dist(coords[i - 1], coords[i]);
    return m;
}

/**
 * Longueur d'un passage et rapport à son vol d'oiseau (bouts du passage) ;
 * forcé = rapport ≥ FORCED_RATIO et détour ≥ FORCED_EXTRA_M.
 * @returns {{lengthM: number, straightM: number, ratio: number|null, forced: boolean}}
 */
export function straightRatio(coords) {
    const pts = coords || [];
    const lengthM = lineLength(pts);
    const straightM = pts.length >= 2 ? dist(pts[0], pts[pts.length - 1]) : 0;
    const ratio = straightM >= MIN_STRAIGHT_M ? lengthM / straightM : null;
    const forced = ratio != null && ratio >= FORCED_RATIO && lengthM - straightM >= FORCED_EXTRA_M;
    return { lengthM, straightM, ratio, forced };
}

// Distance (m) d'un point au segment [a, b], dans une projection locale plane.
function pointSegmentDist(p, a, b) {
    const kx = mPerDegLon(p[0]);
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * M_PER_DEG_LAT;
    const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * M_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Index des segments de plusieurs lignes (les calques affichés), par cases
 * d'environ 60 m : « ce point est-il à moins de `tolM` d'un calque ? » ne
 * regarde que les segments voisins (une trace Wikiloc a des milliers de points).
 * @param {number[][][]} lines
 * @param {number} [tolM]
 * @returns {{isNear: (pt: number[]) => boolean, empty: boolean}}
 */
export function buildLineIndex(lines, tolM = FOLLOW_TOLERANCE_M) {
    const cell = 0.00055; // ~60 m en latitude ; en longitude, à peine moins
    const key = (i, j) => `${i}:${j}`;
    const cells = new Map();
    let count = 0;
    (lines || []).forEach(line => {
        for (let k = 1; k < (line || []).length; k++) {
            const a = line[k - 1], b = line[k];
            const padLat = tolM / M_PER_DEG_LAT, padLon = tolM / mPerDegLon(a[0]);
            const i0 = Math.floor((Math.min(a[0], b[0]) - padLat) / cell), i1 = Math.floor((Math.max(a[0], b[0]) + padLat) / cell);
            const j0 = Math.floor((Math.min(a[1], b[1]) - padLon) / cell), j1 = Math.floor((Math.max(a[1], b[1]) + padLon) / cell);
            for (let i = i0; i <= i1; i++) {
                for (let j = j0; j <= j1; j++) {
                    const kk = key(i, j);
                    if (!cells.has(kk)) cells.set(kk, []);
                    cells.get(kk).push([a, b]);
                }
            }
            count++;
        }
    });
    return {
        empty: count === 0,
        isNear(pt) {
            const segs = cells.get(key(Math.floor(pt[0] / cell), Math.floor(pt[1] / cell)));
            return !!segs && segs.some(([a, b]) => pointSegmentDist(pt, a, b) <= tolM);
        },
    };
}

// Points tous les `stepM` mètres au plus le long d'une ligne.
function densify(coords, stepM) {
    const out = [];
    for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1], b = coords[i];
        const n = Math.max(1, Math.ceil(dist(a, b) / stepM));
        for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    if (coords.length) out.push(coords[coords.length - 1]);
    return out;
}

/**
 * Part d'un passage qui suit les calques, et les morceaux qui s'en écartent
 * (assez longs pour compter : au moins `minOffM`).
 * @param {number[][]} coords passage [[lat, lon], …]
 * @param {{isNear: Function, empty: boolean}} index buildLineIndex
 * @returns {{share: number, off: number[][][]}|null} null sans calque ni passage
 */
export function followShare(coords, index, { stepM = 10, minOffM = 60 } = {}) {
    if (!index || index.empty || !Array.isArray(coords) || coords.length < 2) return null;
    const pts = densify(coords, stepM);
    const near = pts.map(p => index.isNear(p));
    let onM = 0, totalM = 0;
    const off = [];
    let run = null;
    for (let i = 1; i < pts.length; i++) {
        const d = dist(pts[i - 1], pts[i]);
        totalM += d;
        const segOn = near[i - 1] && near[i];
        if (segOn) onM += d;
        if (!segOn) {
            if (!run) run = { pts: [pts[i - 1]], m: 0 };
            run.pts.push(pts[i]);
            run.m += d;
        } else if (run) {
            if (run.m >= minOffM) off.push(run.pts);
            run = null;
        }
    }
    if (run && run.m >= minOffM) off.push(run.pts);
    return { share: totalM > 0 ? onM / totalM : 0, off };
}
