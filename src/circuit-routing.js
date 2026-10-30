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
import { fetchWithTimeout } from './net.js';

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
        // 20 s : un routage long (nombreux points) peut être plus lent qu'une API
        // classique, mais ne doit pas pendre indéfiniment sur un serveur muet.
        resp = await fetchWithTimeout(url, {}, 20000);
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
 * @param {Object} [anchorOverrides]  { [indexPOI]: [lon, lat] } — ancres déplacées
 *   EN SESSION (drapeaux d'accès glissés en focus, non encore persistés) qui
 *   priment sur l'accessPoint enregistré, pour re-router sur la position live.
 */
export async function routeOneSegment(features, i, waypointsBySeg = {}, profile = DEFAULT_PROFILE, anchorOverrides = {}) {
    const anchors = (features || []).map((f, idx) => anchorOverrides[idx] || anchorOf(f)).filter(isValidLonLat);
    return routeSegment(segmentVias(anchors, waypointsBySeg, i), profile);
}

// Distance approchée (m) entre un point de tracé [lat, lon] et une ancre
// [lon, lat]. Projection équirectangulaire : largement assez précise à l'échelle
// d'un circuit, et bien plus légère que haversine sur des milliers de points.
function metersTo(pt, anchorLonLat) {
    const [lat, lon] = pt;
    const [alon, alat] = anchorLonLat;
    const dx = (lon - alon) * Math.cos(((lat + alat) / 2) * Math.PI / 180) * 111320;
    const dy = (lat - alat) * 110540;
    return Math.sqrt(dx * dx + dy * dy);
}

// Index de coupe du tracé pour chaque ancre : 0 pour la 1ʳᵉ, la fin pour la
// dernière, et pour les ancres intermédiaires la suite CROISSANTE d'index qui
// minimise la somme des distances ancre ↔ point (programmation dynamique).
// Un choix glouton (« le point le plus proche après la coupe précédente ») se
// trompe dès que le tracé repasse près d'un lieu (aller-retour, boucle) : il
// prend le second passage et fausse toutes les coupes suivantes.
function cutIndices(track, anchors) {
    const n = anchors.length, m = track.length;
    const cut = new Array(n);
    cut[0] = 0;
    cut[n - 1] = m - 1;
    if (n <= 2) return cut;

    // prevMin[k] = coût minimal des ancres déjà placées, la dernière coupée en ≤ k.
    // argMin[i][k] = index (≤ k) où couper l'ancre i pour atteindre ce minimum.
    let prevMin = new Float64Array(m); // ancre 0 coupée en 0 : coût nul pour tout k
    const argMin = [];
    for (let i = 1; i < n - 1; i++) {
        const curMin = new Float64Array(m);
        const arg = new Int32Array(m);
        let best = Infinity, bestK = 0;
        for (let k = 0; k < m; k++) {
            const c = metersTo(track[k], anchors[i]) + prevMin[k];
            if (c < best) { best = c; bestK = k; }
            curMin[k] = best;
            arg[k] = bestK;
        }
        argMin[i] = arg;
        prevMin = curMin;
    }
    // Remontée : la dernière ancre intermédiaire au mieux avant la fin, puis
    // chaque ancre au mieux avant la coupe de la suivante.
    cut[n - 2] = argMin[n - 2][m - 1];
    for (let i = n - 3; i >= 1; i--) cut[i] = argMin[i][cut[i + 1]];
    return cut;
}

/**
 * Re-découpe un realTrack DÉJÀ sauvegardé ([[lat, lon], …]) en segments POI→POI,
 * sans re-router — préserve la géométrie sauvegardée (y compris d'éventuels
 * ajustements GPX Studio ou points de passage d'une session précédente).
 * Utilisé à l'entrée du focus mode sur un circuit chargé, et par le re-tracé
 * partiel (routeChangedSegments).
 * @returns {{coords:number[][], ok:boolean, distanceKm:number}[]} (length = nPOIs - 1)
 */
export function splitTrackByAnchors(realTrack, features) {
    const anchors = (features || []).map(anchorOf).filter(isValidLonLat);
    const n = anchors.length;
    if (n < 2 || !Array.isArray(realTrack) || realTrack.length < 2) return [];

    const cut = cutIndices(realTrack, anchors);

    const segments = [];
    for (let i = 0; i < n - 1; i++) {
        const coords = realTrack.slice(cut[i], cut[i + 1] + 1);
        segments.push({ coords, ok: true, distanceKm: polylineKm(coords) });
    }
    return segments;
}

// Au-delà de cette distance entre un lieu (son ancre) et le bout d'un passage
// conservé, on ne s'y fie plus : drapeau déplacé depuis le tracé, ou découpe
// douteuse. Le passage est alors recalculé — au pire, on re-route un passage
// qui n'en avait pas besoin.
export const KEEP_MAX_M = 50;

// Les segments de la session (Tracer / Éditer l'itinéraire) correspondent-ils
// EXACTEMENT au tracé enregistré ? Seulement alors on les préfère à un
// re-découpage : bornes exactes et état d'échec connu.
function segmentsMatchTrack(segments, realTrack, nAnchors) {
    if (!Array.isArray(segments) || segments.length !== nAnchors - 1) return false;
    const rebuilt = buildRealTrack(segments);
    if (rebuilt.length !== realTrack.length) return false;
    return rebuilt.every((p, k) => p[0] === realTrack[k][0] && p[1] === realTrack[k][1]);
}

/**
 * Re-tracé PARTIEL : ne recalcule que les passages dont la paire de lieux a
 * changé depuis le tracé précédent. Un passage dont les deux lieux se suivent
 * toujours garde sa géométrie telle quelle — points de passage posés en
 * « Éditer l'itinéraire » et retouches GPX Studio compris. Ajouter B entre A et
 * C recalcule A→B et B→C ; retirer B recalcule A→C.
 * Un passage en échec (ligne droite) ou dont un bout s'est éloigné de son lieu
 * de plus de KEEP_MAX_M est recalculé lui aussi.
 * @param {Object[]} features  Nouvelle séquence des POIs.
 * @param {string[]} ids       Leurs poiIds, dans le même ordre.
 * @param {{ids:string[], features:Object[], realTrack:number[][], segments?:Object[]}} prev
 *   Tracé précédent : séquence routée, son realTrack enregistré et, si la session
 *   les connaît, ses segments.
 * @param {string} [profile]
 * @returns {Promise<Object>} Même forme que routeCircuit, plus `keptCount` et
 *   `reroutedCount`. `ascend` est null si un passage conservé n'a pas d'altitude.
 */
export async function routeChangedSegments(features, ids, prev, profile = DEFAULT_PROFILE) {
    const anchors = (features || []).map(anchorOf);
    if (anchors.length < 2 || !anchors.every(isValidLonLat) || !Array.isArray(ids) || ids.length !== anchors.length) {
        const full = await routeCircuit(features, {}, profile);
        return { ...full, keptCount: 0, reroutedCount: full.segments.length };
    }

    // Passages du tracé précédent, rangés par paire de lieux « idA|idB ».
    const pool = new Map();
    const prevFeatures = prev?.features || [];
    const prevUsable = Array.isArray(prev?.realTrack) && prev.realTrack.length >= 2
        && prevFeatures.length >= 2 && prevFeatures.map(anchorOf).every(isValidLonLat)
        && Array.isArray(prev.ids) && prev.ids.length === prevFeatures.length;
    if (prevUsable) {
        const prevSegs = segmentsMatchTrack(prev.segments, prev.realTrack, prevFeatures.length)
            ? prev.segments : splitTrackByAnchors(prev.realTrack, prevFeatures);
        prevSegs.forEach((seg, j) => {
            const key = `${prev.ids[j]}|${prev.ids[j + 1]}`;
            if (!pool.has(key)) pool.set(key, []);
            pool.get(key).push(seg);
        });
    }

    const reusable = (seg, i) => !!seg && seg.ok !== false
        && Array.isArray(seg.coords) && seg.coords.length >= 2
        && metersTo(seg.coords[0], anchors[i]) <= KEEP_MAX_M
        && metersTo(seg.coords[seg.coords.length - 1], anchors[i + 1]) <= KEEP_MAX_M;

    const tasks = [];
    let keptCount = 0;
    for (let i = 0; i < anchors.length - 1; i++) {
        const seg = (pool.get(`${ids[i]}|${ids[i + 1]}`) || []).shift();
        if (reusable(seg, i)) {
            keptCount++;
            tasks.push(Promise.resolve({ ...seg }));
        } else {
            tasks.push(routeSegment(segmentVias(anchors, {}, i), profile));
        }
    }
    const segments = await Promise.all(tasks);
    const failedSegments = segments.map((s, i) => (s.ok ? -1 : i)).filter(i => i >= 0);
    return {
        realTrack: buildRealTrack(segments),
        distanceKm: segmentsDistanceKm(segments),
        durationMin: segments.reduce((sum, s) => sum + (s.durationMin || 0), 0),
        // Un passage re-découpé n'a pas d'altitude : une somme partielle serait
        // fausse → null, l'appelant garde le D+ existant (même règle que finish()).
        ascend: segments.every(s => Number.isFinite(s.ascend)) ? segmentsAscend(segments) : null,
        segments,
        failedSegments,
        keptCount,
        reroutedCount: segments.length - keptCount,
    };
}
