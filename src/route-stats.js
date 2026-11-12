// route-stats.js — Chiffres d'un itinéraire calculé, pour comparer deux
// variantes (panneau « Choisir l'itinéraire », circuit-compare.js). Logique
// pure, sans DOM ni carte.
//
// Les km par type de voie viennent des `messages` de BRouter (une ligne par
// tronçon, avec ses tags OSM) : instantanés, contrairement au classement
// Overpass (circuit-way-types.js) qui colore le tracé enregistré. Même table
// highway → catégorie (way-types.js). Les deux peuvent différer un peu.
// Repris du banc d'essai `.claude/routing-test/comparer-profils.html` (12/11/2026).
import { categoryOfHighway } from './way-types.js';

/** Catégories affichées en colonnes, dans l'ordre. « Non classé » à part. */
export const WAY_KEYS = ['route', 'rue', 'piste', 'sentier'];
const ALL_KEYS = [...WAY_KEYS, 'non-classe'];

/** Compteur vide { route: 0, …, 'non-classe': 0 } (mètres). */
export function emptyWays() {
    return Object.fromEntries(ALL_KEYS.map(k => [k, 0]));
}

/**
 * Mètres par catégorie de voie d'une réponse BRouter (`properties.messages` :
 * en-tête puis une ligne par tronçon, colonnes « Distance » et « WayTags »).
 * @param {Object} props  `features[0].properties` du geojson BRouter.
 * @returns {Object|null}  null si BRouter n'a pas fourni de messages.
 */
export function waysFromMessages(props) {
    const msg = props && Array.isArray(props.messages) ? props.messages : null;
    if (!msg || msg.length < 2) return null;
    const head = msg[0] || [];
    const iD = head.indexOf('Distance');
    const iW = head.indexOf('WayTags');
    if (iD < 0 || iW < 0) return null;
    const out = emptyWays();
    for (const row of msg.slice(1)) {
        const hw = (/(?:^| )highway=([^ ]+)/.exec(row[iW] || '') || [])[1];
        out[categoryOfHighway(hw)] += Number(row[iD]) || 0;
    }
    return out;
}

/** Somme de compteurs de catégories (les absents comptent 0). */
export function addWays(...list) {
    const out = emptyWays();
    for (const w of list) {
        if (!w) continue;
        for (const k of ALL_KEYS) out[k] += Number(w[k]) || 0;
    }
    return out;
}

/**
 * Mètres du tracé qui repassent sur une partie déjà parcourue : milieu d'un
 * tronçon à moins de 6 m d'un tronçon situé au moins 60 m plus tôt sur le tracé
 * (sinon le tronçon voisin compterait). Grille de 30 m pour rester rapide.
 * @param {number[][]} track  [[lat, lon], …]
 * @returns {number} mètres
 */
export function repassedMeters(track) {
    if (!Array.isArray(track) || track.length < 3) return 0;
    const kx = 111320 * Math.cos((track[0][0] || 0) * Math.PI / 180), ky = 110540;
    const P = track.map(q => [q[1] * kx, q[0] * ky]);
    const cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const CELL = 30;
    const grid = new Map();
    const dSeg = (p, a, b) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
        const u = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
        return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
    };
    let total = 0, j = 1; // j : prochain tronçon à indexer
    for (let i = 1; i < P.length; i++) {
        while (j < i && cum[i] - cum[j] >= 60) { // indexe les tronçons assez anciens
            const a = P[j - 1], b = P[j];
            for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++) {
                for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) {
                    const k = x + ',' + y;
                    if (!grid.has(k)) grid.set(k, []);
                    grid.get(k).push(j);
                }
            }
            j++;
        }
        const m = [(P[i][0] + P[i - 1][0]) / 2, (P[i][1] + P[i - 1][1]) / 2];
        const cx = Math.floor(m[0] / CELL), cy = Math.floor(m[1] / CELL);
        let near = false;
        for (let x = cx - 1; x <= cx + 1 && !near; x++) {
            for (let y = cy - 1; y <= cy + 1 && !near; y++) {
                for (const s of grid.get(x + ',' + y) || []) {
                    if (dSeg(m, P[s - 1], P[s]) < 6) { near = true; break; }
                }
            }
        }
        if (near) total += cum[i] - cum[i - 1];
    }
    return total;
}

/**
 * Écart d'une valeur avec celle de Direct, pour le repère « mieux / moins bien ».
 * @param {number} value
 * @param {number} ref        valeur de Direct
 * @param {'less'|'more'} better  sens du « mieux »
 * @param {number} threshold  écart en dessous duquel on affiche « = »
 * @returns {{kind: 'mieux'|'moins'|'egal', diff: number}}
 */
export function compareToDirect(value, ref, better, threshold) {
    const diff = value - ref;
    if (!Number.isFinite(diff) || Math.abs(diff) < threshold) return { kind: 'egal', diff: 0 };
    const lower = diff < 0;
    const good = better === 'less' ? lower : !lower;
    return { kind: good ? 'mieux' : 'moins', diff };
}

/** Sens du « mieux » par catégorie : moins de route et de rue, plus de piste et de sentier. */
export const WAY_BETTER = { route: 'less', rue: 'less', piste: 'more', sentier: 'more' };

/** « 1,3 » / « −1,3 » / « +2,2 » (km, une décimale, signe typographique). */
export function formatKmDelta(m) {
    const v = (Math.abs(m) / 1000).toFixed(1).replace('.', ',');
    return (m < 0 ? '−' : '+') + v;
}
