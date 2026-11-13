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
//
// Moteur (12/11/2026, chantier comparateur de tracé) : BRouter peut aussi
// tourner SUR LE PC de l'auteur (C:\BRouter, port 17777 : mêmes réponses que
// brouter.de, sans limite de débit). `resolveEngine()` le sonde et retombe sur
// brouter.de s'il ne répond pas. Les fonctions de routage ne sondent rien
// elles-mêmes : l'appelant (UI) résout le moteur et passe son `base`.
import { getAccessPoint } from './utils.js';
import { fetchWithTimeout } from './net.js';
import { waysFromMessages, addWays } from './route-stats.js';

export const PUBLIC_BROUTER_URL = 'https://brouter.de/brouter';
export const LOCAL_BROUTER_URL = 'http://localhost:17777/brouter';
export const DEFAULT_PROFILE = 'hiking-beta'; // profil rando piéton validé sur Djerba

// Variantes de calcul. « Direct » = le calcul historique (hiking-beta).
// « Chemins » = hiking-mountain, dont l'Offroad_factor rend routes et rues plus
// chères et les chemins de terre moins chers ; sa « force » (0 sans effet,
// 1 par défaut, 3 très fort) est cet Offroad_factor.
export const ROUTING_VARIANTS = {
    direct: { label: 'Direct', profile: DEFAULT_PROFILE },
    chemins: { label: 'Chemins', profile: 'hiking-mountain', forceParam: 'Offroad_factor' },
};
export const DEFAULT_FORCE = 1;
export const FORCE_MAX = 3;
// « Éviter de repasser » : poids de la pénalité posée sur les voies déjà
// parcourues (5 léger, 100 net, 1000 fort : gros détours). S'il n'y a pas
// d'autre voie, BRouter repasse quand même.
export const AVOID_WEIGHTS = [5, 100, 1000];
export const DEFAULT_AVOID_WEIGHT = 100;

/**
 * Réglages de calcul d'un circuit, nettoyés : variante connue (sinon Direct),
 * force bornée à [0, 3] et arrondie au dixième (Chemins seulement), et
 * « éviter de repasser » avec son poids (seulement s'il est activé).
 * @param {Object} [routing]  `circuit.routing` tel qu'enregistré (ou absent).
 * @returns {{variant: 'direct'|'chemins', force?: number, avoid?: true, weight?: number}}
 */
export function normalizeRouting(routing) {
    const variant = routing && ROUTING_VARIANTS[routing.variant] ? routing.variant : 'direct';
    const out = { variant };
    if (variant === 'chemins') {
        const raw = Number(routing.force);
        out.force = Number.isFinite(raw)
            ? Math.round(Math.min(FORCE_MAX, Math.max(0, raw)) * 10) / 10
            : DEFAULT_FORCE;
    }
    if (routing && routing.avoid === true) {
        out.avoid = true;
        out.weight = AVOID_WEIGHTS.includes(Number(routing.weight)) ? Number(routing.weight) : DEFAULT_AVOID_WEIGHT;
    }
    return out;
}

/**
 * Variante publiable dans l'index des circuits (publiée depuis le 13/11/2026) :
 * le réglage seul, sans le moteur qui a calculé (propre à un PC). undefined si
 * le circuit n'en a pas.
 */
export function publishedRouting(routing) {
    return routing && routing.variant ? normalizeRouting(routing) : undefined;
}

/** « Chemins · force 1 · éviter de repasser (poids 100) » — libellé texte d'une variante. */
export function routingLabel(routing) {
    const r = normalizeRouting(routing);
    const parts = [ROUTING_VARIANTS[r.variant].label];
    if (r.variant === 'chemins') parts.push(`force ${String(r.force).replace('.', ',')}`);
    if (r.avoid) parts.push(`éviter de repasser (poids ${r.weight})`);
    return parts.join(' · ');
}

// Paramètres d'URL BRouter d'une variante : `&profile=…` (+ `&profile:<param>=<force>`).
export function routingQuery(routing) {
    const r = normalizeRouting(routing);
    const v = ROUTING_VARIANTS[r.variant];
    let q = `&profile=${encodeURIComponent(v.profile)}`;
    if (v.forceParam) q += `&profile:${v.forceParam}=${r.force}`;
    return q;
}

// Distance approchée (m) entre deux points [lat, lon].
function metersBetween(a, b) {
    const dx = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180) * 111320;
    const dy = (b[0] - a[0]) * 110540;
    return Math.sqrt(dx * dx + dy * dy);
}

// Autour des deux bouts d'un passage, la ligne à éviter est retirée : BRouter
// IGNORE une ligne à éviter qui passe par le départ ou l'arrivée du passage
// (constaté le 12/11/2026 sur le banc d'essai). Le départ est toujours au bout
// du tracé précédent.
const AVOID_END_CLEARANCE_M = 150;
const AVOID_STEP_M = 15;        // un point tous les 15 m suffit
// Les demandes partent en GET : brouter.de en accepte 600 points au plus ;
// BRouter de ce PC n'a pas cette limite, on garde tout de même une borne.
const AVOID_MAX_POINTS = { public: 600, local: 3000 };

/**
 * Paramètre `&polylines=` qui fait éviter à BRouter le tracé déjà parcouru.
 * @param {number[][]} track  Tracé déjà parcouru, [[lat, lon], …].
 * @param {number[][]} vias   Points du passage à tracer, [lon, lat] (départ … arrivée).
 * @param {number} weight     Poids de la pénalité.
 * @param {number} maxPoints  Nombre total de points envoyés, au plus.
 * @returns {string}  '' si rien à éviter.
 */
export function avoidPolylinesQuery(track, vias, weight, maxPoints) {
    if (!Array.isArray(track) || track.length < 2 || !Array.isArray(vias) || vias.length < 2) return '';
    const ends = [vias[0], vias[vias.length - 1]].map(([lon, lat]) => [lat, lon]);
    const pieces = [];
    let cur = [];
    for (const q of track) {
        if (ends.some(e => metersBetween(e, q) < AVOID_END_CLEARANCE_M)) {
            // Trou autour d'un bout : un morceau = une ligne, sans relier les trous.
            if (cur.length > 1) pieces.push(cur);
            cur = [];
            continue;
        }
        if (!cur.length || metersBetween(cur[cur.length - 1], q) >= AVOID_STEP_M) cur.push(q);
    }
    if (cur.length > 1) pieces.push(cur);
    const total = pieces.reduce((s, m) => s + m.length, 0);
    if (!total) return '';
    const keep = total > maxPoints ? maxPoints / total : 1;
    const lines = pieces
        .map(m => (keep < 1
            ? m.filter((_, i) => i === m.length - 1 || Math.floor(i * keep) !== Math.floor((i - 1) * keep))
            : m))
        .filter(m => m.length > 1)
        .map(m => m.map(q => `${q[1].toFixed(6)},${q[0].toFixed(6)}`).join(',') + ',' + weight);
    return lines.length ? '&polylines=' + lines.join('|') : '';
}

// --- Moteur : BRouter de ce PC ou brouter.de ---------------------------------
const ENGINES = {
    local: { key: 'local', base: LOCAL_BROUTER_URL, label: 'BRouter de ce PC' },
    public: { key: 'brouter.de', base: PUBLIC_BROUTER_URL, label: 'brouter.de' },
};
export function engineLabel(key) {
    return key === 'local' ? ENGINES.local.label : ENGINES.public.label;
}

// Résultat de la dernière sonde, gardé une minute : l'édition d'un passage
// route souvent, inutile de sonder à chaque fois.
const ENGINE_TTL_MS = 60000;
const PROBE_TIMEOUT_MS = 1500;
let engineCache = null; // { engine, at }

/** Oublie le moteur retenu : la prochaine résolution sonde à nouveau. */
export function forgetEngine() { engineCache = null; }

/**
 * BRouter de ce PC s'il répond, sinon brouter.de. Toute réponse HTTP compte
 * (le point sondé est hors carte, BRouter répond par une erreur) : seul un
 * serveur muet, absent ou bloqué (CSP, navigateur) fait retomber sur brouter.de.
 * @returns {Promise<{key: 'local'|'brouter.de', base: string, label: string}>}
 */
export async function resolveEngine() {
    if (engineCache && Date.now() - engineCache.at < ENGINE_TTL_MS) return engineCache.engine;
    let engine = ENGINES.public;
    try {
        await fetchWithTimeout(`${LOCAL_BROUTER_URL}?lonlats=0,0|0.001,0&profile=${DEFAULT_PROFILE}&format=geojson`, {}, PROBE_TIMEOUT_MS);
        engine = ENGINES.local;
    } catch (e) {
        // Serveur local éteint ou injoignable : brouter.de.
    }
    engineCache = { engine, at: Date.now() };
    return engine;
}

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
 * Options de routage communes aux fonctions ci-dessous.
 * @typedef {Object} RouteOptions
 * @property {Object} [routing]  Variante ({ variant, force }) — défaut : Direct.
 * @property {string} [base]     URL du moteur (résolue par resolveEngine) — défaut : brouter.de.
 * @property {(done: number, total: number) => void} [onProgress]  routeCircuit : appelé à
 *   l'arrivée de chaque passage (compteur « passage 3 sur 5 » du comparateur).
 * @property {number[][]} [avoidTrack]  routePoints : tracé déjà parcouru à éviter
 *   ([[lat, lon], …]), pris en compte si la variante a « éviter de repasser ».
 * @property {Object} [waypointsBySeg]  routeChangedSegments : points de passage
 *   ({ [passage]: [{lat, lng}] }) des passages recalculés (circuit-waypoints.js).
 */

// brouter.de limite le débit (« Please, retry later! ») : jusqu'à 3 nouvelles
// tentatives, espacées de 3, 6 puis 9 s. Rien de tel avec BRouter de ce PC.
const RETRY_DELAYS_MS = [3000, 6000, 9000];
// Passages tracés à la suite (« éviter de repasser ») vers brouter.de : un appel
// toutes les 1,2 s au plus, comme sur le banc d'essai.
const PUBLIC_SPACING_MS = 1200;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Route une séquence de points [lon, lat] via BRouter.
 * @param {number[][]} points  Liste ordonnée de [lon, lat] (≥ 2).
 * @param {RouteOptions} [opts]
 * @returns {Promise<{realTrack: number[][], distanceKm: number, durationMin: number}>}
 *   `realTrack` au format [[lat, lon], …], prêt à être posé sur `circuit.realTrack`.
 * @throws {Error} message lisible si réseau KO ou tracé absent.
 */
export async function routePoints(points, { routing, base = PUBLIC_BROUTER_URL, avoidTrack = null } = {}) {
    if (!Array.isArray(points) || points.length < 2) {
        throw new Error('Au moins 2 lieux sont nécessaires pour tracer un itinéraire.');
    }
    const r = normalizeRouting(routing);
    const local = base === LOCAL_BROUTER_URL;
    const avoid = r.avoid && avoidTrack
        ? avoidPolylinesQuery(avoidTrack, points, r.weight, local ? AVOID_MAX_POINTS.local : AVOID_MAX_POINTS.public)
        : '';
    const url = `${base}?lonlats=${toLonLats(points)}${routingQuery(r)}${avoid}&format=geojson&alternativeidx=0`;

    let resp;
    for (let attempt = 0; ; attempt++) {
        try {
            // 20 s : un routage long (nombreux points) peut être plus lent qu'une API
            // classique, mais ne doit pas pendre indéfiniment sur un serveur muet.
            resp = await fetchWithTimeout(url, {}, 20000);
        } catch (e) {
            if (local) {
                forgetEngine(); // éteint en cours de route : le prochain calcul ressonde
                throw new Error('BRouter de ce PC ne répond pas.');
            }
            throw new Error('BRouter est injoignable — vérifiez la connexion internet.');
        }
        if (resp.ok) break;
        // brouter.de limite le débit : il répond « Please, retry later! ».
        let body = '';
        try { body = typeof resp.text === 'function' ? await resp.text() : ''; } catch (e) { /* corps illisible */ }
        if (!/retry later/i.test(body)) {
            throw new Error(`BRouter n'a pas pu calculer l'itinéraire (erreur ${resp.status}).`);
        }
        if (attempt >= RETRY_DELAYS_MS.length) throw new Error('brouter.de limite les demandes.');
        await wait(RETRY_DELAYS_MS[attempt]);
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
    // Mètres par type de voie (messages BRouter), pour le comparateur ; null si absents.
    const ways = waysFromMessages(props);

    return { realTrack, distanceKm, durationMin, ascend, ways };
}

/**
 * Route UN segment (couple de POIs consécutifs + points de passage éventuels)
 * via BRouter. Sur échec (réseau, tronçon non cartographié…), retombe en
 * **ligne droite** entre les vias — l'« échec partiel » du niveau 2 : le
 * circuit reste traçable, le segment est juste signalé.
 * @param {number[][]} vias  Liste ordonnée [lon, lat] (ancre départ, …waypoints, ancre arrivée).
 * @param {RouteOptions} [opts]
 * @returns {Promise<{ok: boolean, coords: number[][], distanceKm: number, durationMin: number}>}
 *   `coords` au format [[lat, lon], …].
 */
async function routeSegment(vias, opts = {}) {
    try {
        const { realTrack, distanceKm, durationMin, ascend, ways } = await routePoints(vias, opts);
        return { ok: true, coords: realTrack, distanceKm, durationMin, ascend, ways };
    } catch (e) {
        // Repli ligne droite : on garde la séquence des vias telle quelle.
        // `error` : le motif, pour le comparateur (« BRouter de ce PC ne répond pas. »).
        const coords = vias.map(([lon, lat]) => [lat, lon]);
        return { ok: false, coords, distanceKm: polylineKm(coords), durationMin: 0, ascend: null, error: e && e.message };
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
 * @param {RouteOptions} [opts]
 * @returns {Promise<{realTrack: number[][], distanceKm: number, durationMin: number,
 *   segments: {coords:number[][], ok:boolean, distanceKm:number}[], failedSegments: number[]}>}
 */
export async function routeCircuit(features, waypointsBySeg = {}, opts = {}) {
    const anchors = (features || []).map(anchorOf).filter(isValidLonLat);
    if (anchors.length < 2) {
        throw new Error('Au moins 2 lieux sont nécessaires pour tracer un itinéraire.');
    }
    const total = anchors.length - 1;
    let done = 0;
    const progress = (seg) => {
        done++;
        if (typeof opts.onProgress === 'function') opts.onProgress(done, total);
        return seg;
    };
    let segments;
    if (normalizeRouting(opts.routing).avoid) {
        // « Éviter de repasser » : chaque passage est tracé à son tour, en évitant
        // les voies des passages précédents. Vers brouter.de, les appels sont
        // espacés (débit limité) ; BRouter de ce PC n'a pas de limite.
        segments = [];
        let walked = [];
        for (let i = 0; i < total; i++) {
            if (i > 0 && opts.base !== LOCAL_BROUTER_URL) await wait(PUBLIC_SPACING_MS);
            const seg = progress(await routeSegment(segmentVias(anchors, waypointsBySeg, i), { ...opts, avoidTrack: walked }));
            segments.push(seg);
            walked = buildRealTrack(segments);
        }
    } else {
        segments = await Promise.all(Array.from({ length: total }, (_, i) =>
            routeSegment(segmentVias(anchors, waypointsBySeg, i), opts).then(progress)));
    }
    const failedSegments = segments.map((s, i) => (s.ok ? -1 : i)).filter(i => i >= 0);
    return {
        realTrack: buildRealTrack(segments),
        distanceKm: segmentsDistanceKm(segments),
        durationMin: segments.reduce((sum, s) => sum + (s.durationMin || 0), 0),
        ascend: segmentsAscend(segments),
        // Mètres par type de voie : un passage en ligne droite compte en « Non classé ».
        ways: addWays(...segments.map(s => s.ok && s.ways ? s.ways : { 'non-classe': (s.distanceKm || 0) * 1000 })),
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
 * @param {RouteOptions} [opts]
 * @param {Object} [anchorOverrides]  { [indexPOI]: [lon, lat] } — ancres déplacées
 *   EN SESSION (drapeaux d'accès glissés en focus, non encore persistés) qui
 *   priment sur l'accessPoint enregistré, pour re-router sur la position live.
 */
export async function routeOneSegment(features, i, waypointsBySeg = {}, opts = {}, anchorOverrides = {}) {
    const anchors = (features || []).map((f, idx) => anchorOverrides[idx] || anchorOf(f)).filter(isValidLonLat);
    return routeSegment(segmentVias(anchors, waypointsBySeg, i), opts);
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
 * @param {RouteOptions} [opts]
 * @returns {Promise<Object>} Même forme que routeCircuit, plus `keptCount` et
 *   `reroutedCount`. `ascend` est null si un passage conservé n'a pas d'altitude.
 */
export async function routeChangedSegments(features, ids, prev, opts = {}) {
    const anchors = (features || []).map(anchorOf);
    if (anchors.length < 2 || !anchors.every(isValidLonLat) || !Array.isArray(ids) || ids.length !== anchors.length) {
        const full = await routeCircuit(features, opts.waypointsBySeg || {}, opts);
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
            tasks.push(routeSegment(segmentVias(anchors, opts.waypointsBySeg || {}, i), opts));
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
