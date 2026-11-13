// Ordre des points de passage le long du parcours (édition du tracé).
//
// Jusqu'au 13/11/2026, les points d'un passage étaient TRIÉS par leur projection
// sur la ligne droite entre ses deux lieux. Sur une boucle ou un aller-retour
// (tour d'un terril, d'un parc), l'aller et le retour tombent au même niveau de
// cette ligne : les points se mélangeaient et BRouter sautait un morceau.
// Désormais l'ordre est celui du parcours : un point posé s'insère selon sa
// position le long du tracé ACTUEL du passage, et l'ordre est ensuite gardé.
//
// Tracés en [[lat, lon], …] ; points en { lat, lng }.

// Mètres par degré (projection équirectangulaire locale : largement assez
// précise à l'échelle d'un passage).
function frame(lat) {
    return { kx: 111320 * Math.cos(lat * Math.PI / 180), ky: 110540 };
}

/**
 * Point du tracé le plus proche de p, en ne cherchant qu'à partir du tronçon
 * `fromIdx`. Renvoie la distance (m) à ce point et sa position le long du tracé
 * (`along`, en mètres depuis le début), plus le tronçon trouvé (`idx`).
 * @param {number[][]} coords
 * @param {{lat:number, lng:number}} p
 * @param {number} [fromIdx=0]
 * @returns {{dist:number, along:number, idx:number}|null}
 */
export function locateOnTrack(coords, p, fromIdx = 0) {
    if (!Array.isArray(coords) || coords.length < 1 || !p) return null;
    const { kx, ky } = frame(p.lat);
    const P = [p.lng * kx, p.lat * ky];
    if (coords.length === 1) {
        const q = [coords[0][1] * kx, coords[0][0] * ky];
        return { dist: Math.hypot(P[0] - q[0], P[1] - q[1]), along: 0, idx: 0 };
    }
    let cum = 0, best = null;
    for (let i = 1; i < coords.length; i++) {
        const a = [coords[i - 1][1] * kx, coords[i - 1][0] * ky];
        const b = [coords[i][1] * kx, coords[i][0] * ky];
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
        if (i - 1 >= fromIdx) {
            const u = L2 ? Math.max(0, Math.min(1, ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / L2)) : 0;
            const d = Math.hypot(P[0] - a[0] - u * dx, P[1] - a[1] - u * dy);
            if (!best || d < best.dist) best = { dist: d, along: cum + u * L, idx: i - 1 };
        }
        cum += L;
    }
    return best;
}

/**
 * Passage dont le tracé passe au plus près de p (distance au tracé, pas à ses
 * seuls sommets : un long tronçon droit compte sur toute sa longueur).
 * @param {{coords:number[][]}[]} segments
 * @param {{lat:number, lng:number}} p
 * @returns {number} index du passage (0 si aucun)
 */
export function nearestPassage(segments, p) {
    let best = 0, bestD = Infinity;
    (segments || []).forEach((s, i) => {
        const hit = locateOnTrack(s && s.coords, p);
        if (hit && hit.dist < bestD) { bestD = hit.dist; best = i; }
    });
    return best;
}

/**
 * Où insérer, dans la liste de TOUS les points de passage, un nouveau point p
 * du passage `seg` dont le tracé actuel est `coords`.
 *
 * Les points déjà posés sur ce passage sont repérés le long du tracé dans leur
 * ordre (chacun cherché après le précédent : sur une boucle qui repasse près
 * d'un point, on ne le confond pas avec l'autre passage). Le nouveau point
 * prend place avant le premier qui se trouve plus loin que lui sur le parcours.
 *
 * @param {{seg:number, lat:number, lng:number}[]} list  Tous les points, dans l'ordre.
 * @param {number} seg
 * @param {number[][]} coords  Tracé actuel du passage.
 * @param {{lat:number, lng:number}} p
 * @returns {number} index pour list.splice(index, 0, nouveauPoint)
 */
export function insertionIndex(list, seg, coords, p) {
    const own = [];
    (list || []).forEach((w, k) => { if (w.seg === seg) own.push(k); });
    if (!own.length) return (list || []).length;
    const here = locateOnTrack(coords, p);
    if (!here) return own[own.length - 1] + 1;
    let from = 0;
    for (const k of own) {
        const hit = locateOnTrack(coords, list[k], from);
        if (!hit) break;
        if (hit.along > here.along) return k;
        from = hit.idx;
    }
    return own[own.length - 1] + 1;
}
