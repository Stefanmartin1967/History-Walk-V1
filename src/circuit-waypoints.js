// Points de passage ENREGISTRÉS avec le circuit (champ `waypoints`).
//
// Jusqu'au 13/11/2026, les points posés en « Éditer l'itinéraire » ne vivaient
// que le temps de l'édition : seul le tracé obtenu était gardé. Tracer, le
// comparateur et le re-tracé repartaient de zéro, et rouvrir l'édition ne les
// remontrait pas. Ils sont désormais enregistrés avec le tracé.
//
// Rangement : par PAIRE DE LIEUX, pas par numéro de passage, pour survivre à un
// lieu ajouté ou déplacé ailleurs dans la liste. Enregistré sur le circuit :
//   waypoints: { ids: [séquence des lieux quand ils ont été posés],
//                passages: { "idA>idB#0": [[lat, lng], …], … } }
// `ids` est la séquence du tracé enregistré avec eux : elle permet de les
// reporter si la liste des lieux change, même après un rechargement.
// `#n` = rang de cette paire si elle revient plusieurs fois dans le circuit.
// Les points d'une paire sont dans l'ordre du parcours (cf. passage-order.js).
//
// Quand la liste des lieux change (décisions de Stefan, 13/11/2026) :
//  - lieu RETIRÉ : les points de ses deux passages passent au nouveau passage
//    qui relie les lieux restants ;
//  - lieu AJOUTÉ au milieu d'un passage : ses points se répartissent avant /
//    après le nouveau lieu, selon leur position sur l'ancien tracé ;
//  - les points priment sur « éviter de repasser » (BRouter passe forcément par
//    eux) et la variante s'applique entre eux.

import { locateOnTrack } from './passage-order.js';
import { anchorOf, splitTrackByAnchors } from './circuit-routing.js';
import { getPoiId } from './data.js';
import { state } from './state.js';

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** Clé de chaque passage d'une séquence de lieux (longueur ids.length - 1). */
export function passageKeys(ids) {
    const seen = new Map();
    const keys = [];
    for (let i = 0; i + 1 < (ids || []).length; i++) {
        const pair = `${ids[i]}>${ids[i + 1]}`;
        const n = seen.get(pair) || 0;
        seen.set(pair, n + 1);
        keys.push(`${pair}#${n}`);
    }
    return keys;
}

function cleanPoints(pts) {
    return (Array.isArray(pts) ? pts : [])
        .filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map(p => [round6(p[0]), round6(p[1])]);
}

/** Objet enregistrable, sans passage vide ; null s'il ne reste rien. */
export function compactWaypoints(saved) {
    const out = {};
    Object.entries(saved || {}).forEach(([k, pts]) => {
        const c = cleanPoints(pts);
        if (c.length) out[k] = c;
    });
    return Object.keys(out).length ? out : null;
}

/**
 * Points enregistrés → forme attendue par routeCircuit / l'édition :
 * { [indexPassage]: [{lat, lng}] }.
 */
export function savedToBySeg(saved, ids) {
    const bySeg = {};
    passageKeys(ids).forEach((k, i) => {
        const pts = cleanPoints(saved && saved[k]);
        if (pts.length) bySeg[i] = pts.map(([lat, lng]) => ({ lat, lng }));
    });
    return bySeg;
}

/** Points de la session d'édition ([{seg, lat, lng}], dans l'ordre) → objet enregistrable. */
export function draftToSaved(draft, ids) {
    const keys = passageKeys(ids);
    const out = {};
    (draft || []).forEach(w => {
        const k = keys[w.seg];
        if (!k || !Number.isFinite(w.lat) || !Number.isFinite(w.lng)) return;
        (out[k] = out[k] || []).push([w.lat, w.lng]);
    });
    return compactWaypoints(out);
}

/**
 * Reporte les points enregistrés d'une séquence de lieux sur une nouvelle.
 *
 * @param {Object|null} saved  Points enregistrés (rangés sur `prev.ids`).
 * @param {{ids:string[], segments?:{coords:number[][]}[]}} prev
 *   Séquence pour laquelle les points ont été posés ; `segments` : son tracé
 *   découpé par passage (sert à répartir les points autour d'un lieu ajouté).
 * @param {{ids:string[], anchors?:number[][]}} next
 *   Nouvelle séquence ; `anchors` : position [lon, lat] de chaque lieu.
 * @returns {Object|null}
 */
export function remapWaypoints(saved, prev, next) {
    if (!saved) return null;
    const prevIds = prev?.ids || [];
    const nextIds = next?.ids || [];
    const prevKeys = passageKeys(prevIds);
    const nextKeys = passageKeys(nextIds);
    // Séquence d'origine inconnue : seules les paires identiques passent.
    if (!prevIds.length) {
        const out = {};
        nextKeys.forEach(k => { if (saved[k]) out[k] = saved[k]; });
        return compactWaypoints(out);
    }

    const ptsOf = (j) => cleanPoints(saved[prevKeys[j]]);
    const inPrev = new Set(prevIds);
    const inNext = new Set(nextIds);
    const used = new Array(prevKeys.length).fill(false);
    const out = {};
    const add = (k, pts) => { if (pts.length) (out[k] = out[k] || []).push(...pts); };
    const kept = new Set(); // passages de la nouvelle séquence restés identiques

    // 1. Même paire (même rang) : les points restent.
    nextKeys.forEach((k) => {
        const j = prevKeys.indexOf(k);
        if (j >= 0 && !used[j]) { used[j] = true; kept.add(k); add(k, ptsOf(j)); }
    });

    // 2. Lieu(x) retiré(s) : le nouveau passage X→Y reprend, dans l'ordre, les
    // points des anciens passages de X à Y, si tous les lieux entre eux ont
    // disparu de la liste.
    nextKeys.forEach((k, i) => {
        if (kept.has(k)) return;
        const X = nextIds[i], Y = nextIds[i + 1];
        for (let p = 0; p < prevIds.length; p++) {
            if (prevIds[p] !== X) continue;
            let q = p + 1;
            while (q < prevIds.length && prevIds[q] !== Y && !inNext.has(prevIds[q])) q++;
            if (q >= prevIds.length || prevIds[q] !== Y || q === p + 1) continue;
            const span = [];
            for (let j = p; j < q; j++) span.push(j);
            if (span.some(j => used[j])) continue;
            span.forEach(j => { used[j] = true; add(k, ptsOf(j)); });
            break;
        }
    });

    // 3. Lieu(x) ajouté(s) au milieu d'un ancien passage A→C : ses points se
    // répartissent entre A→B…→C selon leur position le long de l'ancien tracé
    // du passage (à défaut, le long des lignes droites entre les lieux).
    prevKeys.forEach((pk, j) => {
        if (used[j]) return;
        const pts = ptsOf(j);
        if (!pts.length) return;
        const A = prevIds[j], C = prevIds[j + 1];
        for (let a = 0; a < nextIds.length; a++) {
            if (nextIds[a] !== A) continue;
            let c = a + 1;
            while (c < nextIds.length && nextIds[c] !== C && !inPrev.has(nextIds[c])) c++;
            if (c >= nextIds.length || nextIds[c] !== C || c === a + 1) continue;
            used[j] = true;
            splitAcross(pts, prev?.segments?.[j]?.coords, next?.anchors, a, c)
                .forEach((bucket, b) => add(nextKeys[a + b], bucket));
            break;
        }
    });

    return compactWaypoints(out);
}

/** Forme enregistrée sur le circuit ; null s'il n'y a aucun point. */
export function storedWaypoints(passages, ids) {
    const p = compactWaypoints(passages);
    return p ? { ids: [...ids], passages: p } : null;
}

/**
 * Points enregistrés d'un circuit, reportés sur la séquence de lieux `features`
 * (celle de l'écran). null si le circuit n'en a pas.
 * @param {Object|null} circuit
 * @param {Object[]} features
 * @returns {Object|null} passages rangés sur la séquence de `features`
 */
export function circuitWaypointsFor(circuit, features) {
    const stored = circuit && circuit.waypoints;
    if (!stored || !stored.passages) return null;
    const basisIds = Array.isArray(stored.ids) ? stored.ids : [];
    // Tracé enregistré découpé sur la séquence d'origine : sert à répartir les
    // points autour d'un lieu ajouté depuis.
    const basis = basisIds.map(id => (state.loadedFeatures || []).find(f => getPoiId(f) === id));
    const segments = basis.length >= 2 && basis.every(Boolean)
        ? splitTrackByAnchors(circuit.realTrack || [], basis) : undefined;
    return remapWaypoints(stored.passages, { ids: basisIds, segments }, {
        ids: (features || []).map(getPoiId),
        anchors: (features || []).map(anchorOf),
    });
}

// Répartit des points [lat, lng] entre les passages a→a+1, …, c-1→c de la
// nouvelle séquence : un point va au passage dont il est entre les deux bornes
// (lieux ajoutés repérés sur le même tracé).
function splitAcross(pts, oldCoords, anchors, a, c) {
    const buckets = Array.from({ length: c - a }, () => []);
    const ll = (i) => anchors && anchors[i] ? { lat: anchors[i][1], lng: anchors[i][0] } : null;
    let track = Array.isArray(oldCoords) && oldCoords.length >= 2 ? oldCoords : null;
    if (!track && anchors) {
        // Repli : les lignes droites entre les lieux de la nouvelle séquence.
        track = [];
        for (let i = a; i <= c; i++) if (anchors[i]) track.push([anchors[i][1], anchors[i][0]]);
        if (track.length < 2) track = null;
    }
    if (!track) { buckets[0].push(...pts); return buckets; }
    // Bornes : position des lieux ajoutés le long du tracé, dans l'ordre.
    const bounds = [];
    let from = 0;
    for (let i = a + 1; i < c; i++) {
        const p = ll(i);
        const hit = p ? locateOnTrack(track, p, from) : null;
        bounds.push(hit ? hit.along : Infinity);
        if (hit) from = hit.idx;
    }
    from = 0;
    pts.forEach(([lat, lng]) => {
        const hit = locateOnTrack(track, { lat, lng }, from);
        const along = hit ? hit.along : 0;
        if (hit) from = hit.idx;
        let b = 0;
        while (b < bounds.length && along > bounds[b]) b++;
        buckets[b].push([lat, lng]);
    });
    return buckets;
}
