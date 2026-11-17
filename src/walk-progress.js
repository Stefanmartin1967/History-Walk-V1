// walk-progress.js — Tableau de marche du suivi mobile (17/11/2026).
//
// Pendant le suivi d'un circuit, la carte du titre dit où l'on en est : la
// distance faite et celle qui reste, le prochain lieu et la distance pour y
// arriver — ou, si l'on s'est écarté, « Hors du tracé · à 120 m, vers l'est ».
// Idée de Stefan après Saint-Benoît, inspirée (pas copiée) de l'écran
// d'enregistrement Wikiloc ; maquette « Tableau de marche », variante A validée.
//
// Heripia n'enregistre pas la marche (une PWA ne suit pas la position écran
// éteint) : tout se calcule depuis la POSITION PROJETÉE SUR LE TRACÉ. D'où :
//  - pas de vitesse, de temps en mouvement ni de D+ réel ;
//  - une progression qui n'avance que dans le sens de la marche : une boucle
//    repasse par son départ, un aller-retour par les mêmes chemins — la
//    position la plus proche du tracé pourrait sauter à la fin, on retient
//    celle qui prolonge la précédente.
//
// Module pur : coordonnées [lat, lon], aucune dépendance (tests compris).

/** Au-delà, on est « hors du tracé » ; on y revient sous OFF_TRACK_BACK_M. */
export const OFF_TRACK_M = 50;
export const OFF_TRACK_BACK_M = 35;
// Une position peut reculer d'autant sur le tracé (GPS qui flotte, demi-tour
// court) sans qu'on la croie revenue en arrière.
const BACKTRACK_M = 60;
// Écart toléré entre la projection la plus proche et une projection qui
// prolonge la marche (chemins parallèles d'un aller-retour).
const AMBIGUITY_M = 25;
// Un lieu est « passé » quand on l'a dépassé d'autant le long du tracé.
const PASSED_M = 15;

const M_PER_DEG_LAT = 110540;
const mPerDegLon = (lat) => 111320 * Math.cos(lat * Math.PI / 180);

function dist(a, b) {
    return Math.hypot((a[1] - b[1]) * mPerDegLon((a[0] + b[0]) / 2), (a[0] - b[0]) * M_PER_DEG_LAT);
}

/**
 * Prépare un tracé : distances cumulées le long du tracé.
 * @param {number[][]} track [[lat, lon], …]
 * @returns {{pts: number[][], cum: number[], total: number}|null}
 */
export function prepareTrack(track) {
    if (!Array.isArray(track) || track.length < 2) return null;
    const pts = track.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 2) return null;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    return { pts, cum, total: cum[cum.length - 1] };
}

// Projection d'un point sur le segment i : { along, distM, point }.
function projectOn(prep, i, p) {
    const a = prep.pts[i], b = prep.pts[i + 1];
    const kx = mPerDegLon(p[0]);
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * M_PER_DEG_LAT;
    const dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * M_PER_DEG_LAT;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return { along: prep.cum[i] + (prep.cum[i + 1] - prep.cum[i]) * t, distM: Math.hypot(ax + t * dx, ay + t * dy), point };
}

/**
 * Où en est-on sur le tracé ?
 * @param {number[]} p position [lat, lon]
 * @param {object} prep prepareTrack
 * @param {number|null} [prevAlong] progression précédente (null au 1er fix)
 * @returns {{along: number, distM: number, point: number[]}}
 */
export function locateOnTrack(p, prep, prevAlong = null) {
    const cands = [];
    for (let i = 0; i < prep.pts.length - 1; i++) cands.push(projectOn(prep, i, p));
    const nearest = cands.reduce((m, c) => (c.distM < m.distM ? c : m));
    const close = cands.filter(c => c.distM <= nearest.distM + AMBIGUITY_M);
    if (prevAlong == null) {
        // 1er fix : au plus tôt du parcours (le départ d'une boucle, pas sa fin).
        return close.reduce((m, c) => (c.along < m.along ? c : m));
    }
    // Ensuite : la projection qui prolonge la marche, sans grand retour arrière.
    const ahead = close.filter(c => c.along >= prevAlong - BACKTRACK_M);
    if (ahead.length === 0) return nearest;
    return ahead.reduce((m, c) => (Math.abs(c.along - prevAlong) < Math.abs(m.along - prevAlong) ? c : m));
}

/**
 * Position de chaque lieu le long du tracé, dans l'ordre du circuit (un lieu
 * qui revient — le départ d'une boucle — est cherché après le précédent).
 * @param {number[][]} places [[lat, lon], …] (point d'accès au tracé, sinon le lieu)
 * @returns {number[]} distance le long du tracé, par lieu
 */
export function placesAlong(places, prep) {
    let from = 0;
    return (places || []).map(pl => {
        const cands = [];
        for (let i = 0; i < prep.pts.length - 1; i++) {
            const c = projectOn(prep, i, pl);
            if (c.along + 1e-6 >= from) cands.push(c);
        }
        if (cands.length === 0) return from;
        // Le plus tôt parmi les passages les plus proches : le départ d'une
        // boucle est au début ET à la fin du tracé — au début ici, à la fin
        // quand il revient comme dernière étape (cherché après les autres).
        const minD = Math.min(...cands.map(c => c.distM));
        const along = cands.filter(c => c.distM <= minD + AMBIGUITY_M)
            .reduce((m, c) => (c.along < m.along ? c : m)).along;
        from = along;
        return along;
    });
}

/** Le prochain lieu après `along`, ou null quand tous sont passés. */
export function nextPlace(alongs, along) {
    const i = (alongs || []).findIndex(a => a > along + PASSED_M);
    return i < 0 ? null : { index: i, inM: alongs[i] - along };
}

const DIRECTIONS = ['le nord', 'le nord-est', "l'est", 'le sud-est', 'le sud', 'le sud-ouest', "l'ouest", 'le nord-ouest'];

/** Direction de `from` vers `to`, en mots (« l'est », « le nord-ouest »). */
export function directionWord(from, to) {
    const dx = (to[1] - from[1]) * mPerDegLon(from[0]);
    const dy = (to[0] - from[0]) * M_PER_DEG_LAT;
    const deg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360; // 0 = nord, 90 = est
    return DIRECTIONS[Math.round(deg / 45) % 8];
}

/** Distance lisible : « 650 m » (à 10 m près), « 11,6 km », « 125 km ». */
export function formatDistance(m) {
    if (!Number.isFinite(m) || m < 0) m = 0;
    if (m < 1000) return `${Math.round(m / 10) * 10} m`;
    const km = m / 1000;
    return `${(km < 100 ? km.toFixed(1) : String(Math.round(km))).replace('.', ',')} km`;
}

/**
 * Suivi d'une marche sur un tracé : état gardé d'une position à l'autre.
 * @param {number[][]} track
 * @param {number[][]} places points des lieux, dans l'ordre du circuit
 */
export function createWalkTracker(track, places) {
    const prep = prepareTrack(track);
    if (!prep) return null;
    const alongs = placesAlong(places, prep);
    let along = null;   // progression retenue (gelée hors du tracé)
    let off = false;
    let passed = 0;     // lieux déjà dépassés : on ne les « dé-passe » pas en tournant autour
    return {
        total: prep.total,
        /**
         * @returns {{done: number, left: number, share: number, off: boolean,
         *   offM: number, nearest: number[], direction: string,
         *   next: {index: number, inM: number}|null}}
         */
        update(p) {
            const hit = locateOnTrack(p, prep, along);
            off = off ? hit.distM > OFF_TRACK_BACK_M : hit.distM > OFF_TRACK_M;
            if (!off) along = hit.along;
            const done = along ?? 0;
            let next = along == null ? null : nextPlace(alongs, along);
            if (next && next.index < passed) next = { index: passed, inM: Math.max(0, alongs[passed] - along) };
            if (next) passed = next.index;
            else if (along != null) passed = alongs.length;
            return {
                done,
                left: Math.max(0, prep.total - done),
                share: prep.total > 0 ? done / prep.total : 0,
                off,
                offM: hit.distM,
                nearest: hit.point,
                direction: directionWord(p, hit.point),
                next: passed >= alongs.length ? null : next,
            };
        },
    };
}
