// circuit-routing.js — Routage in-app via BRouter (profil piéton).
//
// Produit un `realTrack` ([[lat, lon], …], format Heripia) à partir d'une
// séquence ordonnée de POIs. L'ancre de routage de chaque POI = son point
// d'accès au tracé (`accessPoint`, posé par l'admin sur la voie la plus proche)
// s'il existe, sinon ses coordonnées réelles — exactement la logique de
// `trackAnchorOf` (gpx.js) qui alimente le « vol d'oiseau ».
//
// BRouter (serveur public brouter.de) est interrogeable directement depuis le
// navigateur (CORS ouvert), sans clé ni backend — adapté au paradigme PWA
// statique d'Heripia. Online-only : la création de circuit se fait sur PC, le
// vol d'oiseau reste le repli hors-ligne / si BRouter est indisponible.
import { getAccessPoint } from './utils.js';

const BROUTER_URL = 'https://brouter.de/brouter';
export const DEFAULT_PROFILE = 'hiking-beta'; // profil rando piéton validé sur Djerba

// Ancre de routage d'un POI : point d'accès au tracé si défini/valide, sinon
// coordonnées réelles du POI. Renvoie [lon, lat].
export function anchorOf(feature) {
    return getAccessPoint(feature) || feature.geometry.coordinates;
}

function isValidLonLat(a) {
    return Array.isArray(a) && a.length >= 2 && Number.isFinite(a[0]) && Number.isFinite(a[1]);
}

// Dénivelé positif (D+, mètres) renvoyé par BRouter dans les `properties` du
// geojson. Clé canonique « filtered ascend » (AVEC un espace) = ascension lissée,
// débruitée des artefacts SRTM (valeur recommandée par BRouter) ; repli
// « plain-ascend » (brut, avec tiret). Valeurs = chaînes → Number(). BRouter ne
// fournit pas de « descend » dans le geojson → on n'expose que le D+.
// Réf : https://brouter.de/brouter/elevation.html
function pickAscend(props) {
    if (!props) return null;
    for (const key of ['filtered ascend', 'plain-ascend']) {
        const raw = props[key];
        if (raw != null && raw !== '') {
            const n = Number(raw);
            if (Number.isFinite(n)) return Math.round(n);
        }
    }
    return null;
}

// Distance haversine (km) le long d'une polyligne [[lat, lon], …]. Sert au
// repli « ligne droite » d'un segment non routable (échec partiel).
function polylineKm(latLngs) {
    const R = 6371;
    const toRad = (d) => d * Math.PI / 180;
    let km = 0;
    for (let i = 1; i < latLngs.length; i++) {
        const [la1, lo1] = latLngs[i - 1];
        const [la2, lo2] = latLngs[i];
        const dLat = toRad(la2 - la1);
        const dLon = toRad(lo2 - lo1);
        const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
        km += 2 * R * Math.asin(Math.sqrt(h));
    }
    return km;
}

// Sérialise une liste de points [lon, lat] au format `lonlats` de BRouter.
function toLonLats(points) {
    return points.map(([lon, lat]) => `${lon.toFixed(8)},${lat.toFixed(8)}`).join('|');
}

/**
 * Route une séquence de points [lon, lat] via BRouter.
 * @param {number[][]} points  Liste ordonnée de [lon, lat] (≥ 2).
 * @param {string} [profile]   Profil BRouter (défaut : hiking-beta).
 * @returns {Promise<{realTrack: number[][], distanceKm: number, durationMin: number}>}
 *   `realTrack` au format [[lat, lon], …], prêt à être posé sur `circuit.realTrack`.
 * @throws {Error} message lisible si réseau KO ou tracé absent.
 */
export async function routePoints(points, profile = DEFAULT_PROFILE) {
    if (!Array.isArray(points) || points.length < 2) {
        throw new Error('Au moins 2 lieux sont nécessaires pour tracer un itinéraire.');
    }
    const url = `${BROUTER_URL}?lonlats=${toLonLats(points)}&profile=${encodeURIComponent(profile)}&format=geojson&alternativeidx=0`;

    let resp;
    try {
        resp = await fetch(url);
    } catch (e) {
        throw new Error('BRouter est injoignable — vérifiez la connexion internet.');
    }
    if (!resp.ok) {
        throw new Error(`BRouter n'a pas pu calculer l'itinéraire (erreur ${resp.status}).`);
    }

    let gj;
    try {
        gj = await resp.json();
    } catch (e) {
        throw new Error('Réponse BRouter illisible.');
    }

    const feat = gj && Array.isArray(gj.features) ? gj.features[0] : null;
    const coords = feat && feat.geometry ? feat.geometry.coordinates : null;
    if (!Array.isArray(coords) || coords.length === 0) {
        throw new Error("BRouter n'a renvoyé aucun tracé.");
    }

    // BRouter renvoie [lon, lat, ele] → Heripia attend [lat, lon].
    const realTrack = coords.map(c => [c[1], c[0]]);

    const props = feat.properties || {};
    const distanceKm = props['track-length'] ? (+props['track-length']) / 1000 : 0;
    const durationMin = props['total-time'] ? Math.round((+props['total-time']) / 60) : 0;
    const ascend = pickAscend(props);

    return { realTrack, distanceKm, durationMin, ascend };
}

/**
 * Route UN segment (couple de POIs consécutifs + points de passage éventuels)
 * via BRouter. Sur échec (réseau, tronçon non cartographié…), retombe en
 * **ligne droite** entre les vias — l'« échec partiel » du niveau 2 : le
 * circuit reste traçable, le segment est juste signalé.
 * @param {number[][]} vias  Liste ordonnée [lon, lat] (ancre départ, …waypoints, ancre arrivée).
 * @param {string} [profile]
 * @returns {Promise<{ok: boolean, coords: number[][], distanceKm: number, durationMin: number}>}
 *   `coords` au format [[lat, lon], …].
 */
async function routeSegment(vias, profile = DEFAULT_PROFILE) {
    try {
        const { realTrack, distanceKm, durationMin, ascend } = await routePoints(vias, profile);
        return { ok: true, coords: realTrack, distanceKm, durationMin, ascend };
    } catch (e) {
        // Repli ligne droite : on garde la séquence des vias telle quelle.
        const coords = vias.map(([lon, lat]) => [lat, lon]);
        return { ok: false, coords, distanceKm: polylineKm(coords), durationMin: 0, ascend: null };
    }
}

// Construit la liste des vias [lon, lat] d'un segment i : ancre du POI i, puis
// les points de passage de ce segment (dans l'ordre), puis ancre du POI i+1.
function segmentVias(anchors, waypointsBySeg, i) {
    const wps = (waypointsBySeg[i] || [])
        .map(w => [w.lng, w.lat])
        .filter(isValidLonLat);
    return [anchors[i], ...wps, anchors[i + 1]];
}

// Concatène les coords des segments en un realTrack continu [[lat, lon], …].
// On retire le 1ᵉʳ point de chaque segment après le 1ᵉʳ (= jonction dupliquée
// avec la fin du segment précédent).
export function buildRealTrack(segments) {
    const out = [];
    segments.forEach((seg, i) => {
        const c = seg.coords || [];
        out.push(...(i === 0 ? c : c.slice(1)));
    });
    return out;
}

export function segmentsDistanceKm(segments) {
    return segments.reduce((sum, s) => sum + (s.distanceKm || 0), 0);
}

// Dénivelé positif (D+) total = somme des `ascend` des segments routés. Renvoie
// null si AUCUN segment n'a de donnée d'altitude (BRouter muet) — à distinguer
// d'un vrai 0 (terrain plat). Les segments en échec (ligne droite, ascend null)
// sont exclus de la somme.
export function segmentsAscend(segments) {
    const vals = (segments || []).map(s => s.ascend).filter(a => Number.isFinite(a));
    if (vals.length === 0) return null;
    return vals.reduce((sum, a) => sum + a, 0);
}

/**
 * Route un circuit segment par segment (1 appel BRouter par couple de POIs
 * consécutifs). Permet d'isoler un segment en échec et de ne re-router que le
 * segment touché en édition (niveau 2).
 * @param {Object[]} features  Features POI dans l'ordre du circuit.
 * @param {Object} [waypointsBySeg]  { [indexSegment]: [{lat, lng}] } — points de passage.
 * @param {string} [profile]
 * @returns {Promise<{realTrack: number[][], distanceKm: number, durationMin: number,
 *   segments: {coords:number[][], ok:boolean, distanceKm:number}[], failedSegments: number[]}>}
 */
export async function routeCircuit(features, waypointsBySeg = {}, profile = DEFAULT_PROFILE) {
    const anchors = (features || []).map(anchorOf).filter(isValidLonLat);
    if (anchors.length < 2) {
        throw new Error('Au moins 2 lieux sont nécessaires pour tracer un itinéraire.');
    }
    const tasks = [];
    for (let i = 0; i < anchors.length - 1; i++) {
        tasks.push(routeSegment(segmentVias(anchors, waypointsBySeg, i), profile));
    }
    const segments = await Promise.all(tasks);
    const failedSegments = segments.map((s, i) => (s.ok ? -1 : i)).filter(i => i >= 0);
    return {
        realTrack: buildRealTrack(segments),
        distanceKm: segmentsDistanceKm(segments),
        durationMin: segments.reduce((sum, s) => sum + (s.durationMin || 0), 0),
        ascend: segmentsAscend(segments),
        segments,
        failedSegments,
    };
}

/**
 * Re-route UN seul segment (édition niveau 2 : ajout / déplacement / suppression
 * d'un point de passage). Renvoie l'entrée `segment` prête à remplacer
 * `state.routeSegments[i]`.
 * @param {Object[]} features  Séquence complète des POIs du circuit.
 * @param {number} i  Index du segment (POI i → POI i+1).
 * @param {Object} waypointsBySeg  { [indexSegment]: [{lat, lng}] }.
 * @param {string} [profile]
 */
export async function routeOneSegment(features, i, waypointsBySeg = {}, profile = DEFAULT_PROFILE) {
    const anchors = (features || []).map(anchorOf).filter(isValidLonLat);
    return routeSegment(segmentVias(anchors, waypointsBySeg, i), profile);
}

// Trouve l'index du point de `track` ([[lat, lon], …]) le plus proche de
// l'ancre [lon, lat]. Sert à re-découper un realTrack sauvegardé en segments.
function nearestIndex(track, anchorLonLat, from = 0) {
    const [alon, alat] = anchorLonLat;
    let best = from, bestD = Infinity;
    for (let k = from; k < track.length; k++) {
        const [lat, lon] = track[k];
        const d = (lat - alat) ** 2 + (lon - alon) ** 2;
        if (d < bestD) { bestD = d; best = k; }
    }
    return best;
}

/**
 * Re-découpe un realTrack DÉJÀ sauvegardé ([[lat, lon], …]) en segments POI→POI,
 * sans re-router — préserve la géométrie sauvegardée (y compris d'éventuels
 * ajustements GPX Studio ou points de passage d'une session précédente).
 * Utilisé à l'entrée du focus mode sur un circuit chargé.
 * @returns {{coords:number[][], ok:boolean, distanceKm:number}[]} (length = nPOIs - 1)
 */
export function splitTrackByAnchors(realTrack, features) {
    const anchors = (features || []).map(anchorOf).filter(isValidLonLat);
    const n = anchors.length;
    if (n < 2 || !Array.isArray(realTrack) || realTrack.length < 2) return [];

    // Index sur le tracé le plus proche de chaque ancre, monotone croissant.
    const cut = [0];
    for (let i = 1; i < n - 1; i++) {
        cut.push(nearestIndex(realTrack, anchors[i], cut[i - 1]));
    }
    cut.push(realTrack.length - 1);

    const segments = [];
    for (let i = 0; i < n - 1; i++) {
        const coords = realTrack.slice(cut[i], cut[i + 1] + 1);
        segments.push({ coords, ok: true, distanceKm: polylineKm(coords) });
    }
    return segments;
}
