// osm-overpass.js
//
// Utility Overpass pour le chantier « point d'accès au tracé » v2 :
// trouver la voie OSM la plus proche d'un POI pour pré-poser un drapeau
// (cf. project_offroad_poi_track_snapping). « Voie la plus proche » =
// any way[highway=*] dans un rayon de 150 m, candidate la plus proche
// retenue (distance Haversine, pas projection sur segment — approximation
// acceptable au rayon visé, plus simple, suffisant pour le pré-pose).
// Mutualisé avec le Scout (moisson bbox) et la création de destination (zones).
//
// Serveurs, dans l'ordre (28/10/2026) :
//   1. api.overpass.ch, si une clé est enregistrée sur l'appareil (réglage admin,
//      cf. overpass-key.js). Offre gratuite : 10 000 requêtes/mois, 30/min.
//   2. overpass-api.de, serveur public sans clé, souvent saturé.
// Les anciens miroirs kumi.systems et private.coffee sont retirés : c'est un
// seul et même serveur (kumi = ancien nom), muet depuis septembre — chaque
// échec y coûtait un timeout entier.

const PUBLIC_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const KEYED_ENDPOINT_BASE = 'https://api.overpass.ch/v1';
const TIMEOUT_MS = 8000;
const SEARCH_RADIUS_M = 150;
// Retry avec backoff sur erreur réseau / 429 (rate limit). Délais en ms.
// Calibré sur l'incident Stefan 31/05 PR #710 : 275/297 échecs en batch
// massif sans retry — ces délais ramènent le taux d'échec à ~0%.
const RETRY_DELAYS = [1000, 3000, 8000];
// Politique d'overpass-api.de (wiki OSM) : après un 429 ou un 406, attendre 30 s
// avant toute nouvelle requête. Même pause sur 502/503/504 (« at capacity, request
// queue is full ») : le serveur saturé n'est plus sollicité, on passe au suivant.
const COOLDOWN_MS = 30000;
const COOLDOWN_STATUSES = new Set([406, 429, 502, 503, 504]);
// overpass.ch : 30 requêtes/min sur l'offre gratuite → au plus une toutes les 2,1 s
// (la pré-pose des drapeaux en batch enchaîne sinon ~1 requête/s).
const KEYED_MIN_INTERVAL_MS = 2100;
// Une réponse dont la base OSM a plus de 7 jours est écartée : un serveur en
// retard ressort des objets supprimés et rate les ajouts récents (puits proposé
// par le Scout le 16/09/2026, miroir en retard de 7 semaines).
const MAX_DATA_AGE_MS = 7 * 24 * 3600 * 1000;

let _key = null;
const _coolUntil = new Map();   // id serveur → fin de la pause (ms epoch)
let _lastKeyedStart = 0;

/** Enregistre (ou retire, si vide) la clé overpass.ch utilisée par les requêtes. */
export function setOverpassKey(key) {
    _key = (typeof key === 'string' && key.trim()) ? key.trim() : null;
}

/** @returns {boolean} true si une clé overpass.ch est active. */
export function hasOverpassKey() {
    return !!_key;
}

function keyedUrl(key) {
    return `${KEYED_ENDPOINT_BASE}/${encodeURIComponent(key)}/interpreter`;
}

function serverList() {
    const list = [];
    if (_key) list.push({ id: 'overpass.ch', url: keyedUrl(_key), keyed: true });
    list.push({ id: 'overpass-api.de', url: PUBLIC_ENDPOINT, keyed: false });
    return list;
}

// Distance Haversine en mètres entre [lat, lon] (idem access-point-editor).
function distanceMeters(a, b) {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function buildQuery(lat, lon) {
    // out:json compact, geometry des ways pour avoir les noeuds en local.
    return `[out:json][timeout:10];way["highway"](around:${SEARCH_RADIUS_M},${lat},${lon});out geom;`;
}

// Âge (ms) de la base OSM d'une réponse, null si le serveur ne le donne pas.
function dataAgeMs(json, now = Date.now()) {
    const t = Date.parse(json?.osm3s?.timestamp_osm_base || '');
    return Number.isFinite(t) ? now - t : null;
}

async function fetchOnce(url, query, timeoutMs) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query),
            signal: controller.signal,
        });
        if (!res.ok) {
            const err = new Error(`HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        const json = await res.json();
        const age = dataAgeMs(json);
        if (age !== null && age > MAX_DATA_AGE_MS) {
            throw new Error(`Base OSM périmée (${Math.round(age / 86400000)} j)`);
        }
        return json;
    } finally {
        clearTimeout(tid);
    }
}

async function queryServer(server, query, timeoutMs) {
    if (server.keyed) {
        const wait = _lastKeyedStart + KEYED_MIN_INTERVAL_MS - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        _lastKeyedStart = Date.now();
    }
    try {
        return await fetchOnce(server.url, query, timeoutMs);
    } catch (e) {
        if (COOLDOWN_STATUSES.has(e.status)) _coolUntil.set(server.id, Date.now() + COOLDOWN_MS);
        throw e;
    }
}

/**
 * Exécute une requête Overpass arbitraire et renvoie le JSON parsé. Essaie les
 * serveurs dans l'ordre (overpass.ch si clé, puis overpass-api.de) en sautant
 * ceux qui sont en pause après un refus, + retry/backoff (leçon #711 anti-504).
 * Réutilisé par le Scout in-app (réunif B2) et la création de destination.
 *
 * @param {string} query - corps Overpass QL (ex. `[out:json];(...);out center;`)
 * @param {{timeoutMs?: number, retries?: number}} [opts] - timeout par serveur
 *        (défaut TIMEOUT_MS) et nombre de passes supplémentaires. Le Scout passe
 *        un timeout généreux : une bbox large est lente.
 * @returns {Promise<object>} le JSON Overpass (`{elements: [...]}`)
 * @throws {Error} si tous les serveurs échouent sur toutes les tentatives, ou
 *         d'emblée si tous sont en pause (`err.cooling = true`).
 */
export async function fetchOverpassJson(query, { timeoutMs = TIMEOUT_MS, retries = RETRY_DELAYS.length } = {}) {
    let lastError = null;
    // nearestHighway (batch silencieux) garde le retry agressif par défaut ; le
    // Scout (interactif) passe retries:0 → un seul passage, échec rapide →
    // l'admin re-scanne lui-même plutôt que d'attendre des minutes.
    for (let attempt = 0; attempt <= retries; attempt++) {
        const now = Date.now();
        const available = serverList().filter(s => (_coolUntil.get(s.id) || 0) <= now);
        if (!available.length) {
            // Tous en pause : inutile d'attendre les backoffs, on le dit tout de suite.
            const err = new Error('Serveurs Overpass saturés — réessaie dans 30 s');
            err.cooling = true;
            throw err;
        }
        for (const server of available) {
            try {
                return await queryServer(server, query, timeoutMs);
            } catch (e) {
                lastError = e;
            }
        }
        if (attempt < retries) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        }
    }
    throw lastError || new Error('Tous les serveurs Overpass ont échoué');
}

/**
 * Vérifie une clé overpass.ch par une requête minuscule (bbox vide).
 * @param {string} key
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function testOverpassKey(key) {
    const clean = (key || '').trim();
    if (!clean) return { ok: false, error: 'clé vide' };
    try {
        await fetchOnce(keyedUrl(clean), '[out:json][timeout:5];node(0,0,0,0);out;', 15000);
        return { ok: true };
    } catch (e) {
        if (e.status === 401 || e.status === 403) return { ok: false, error: `refusée par overpass.ch (${e.status})` };
        if (e.name === 'AbortError') return { ok: false, error: 'overpass.ch ne répond pas' };
        return { ok: false, error: e.message || String(e) };
    }
}

// Parcourt les `way.geometry` (liste de {lat, lon}), retourne le noeud le
// plus proche du POI parmi tous les ways. Fallback si geometry absent.
function nearestPointFromWays(json, poiLat, poiLon) {
    const ways = (json && json.elements) || [];
    let best = null; // { lon, lat, distance }
    for (const w of ways) {
        if (!Array.isArray(w.geometry)) continue;
        for (const p of w.geometry) {
            if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
            const d = distanceMeters([poiLat, poiLon], [p.lat, p.lon]);
            if (best === null || d < best.distance) {
                best = { lon: p.lon, lat: p.lat, distance: d };
            }
        }
    }
    return best;
}

/**
 * Trouve la voie OSM la plus proche d'un POI.
 *
 * @param {number} lat - latitude du POI
 * @param {number} lon - longitude du POI
 * @returns {Promise<{coords: [number,number], distance: number} | null>}
 *          coords = [lon, lat] du point de voie le plus proche, distance en m.
 *          null si aucune voie trouvée dans le rayon ou si tous les endpoints échouent.
 * @throws {Error} si la requête échoue sur tous les endpoints — le caller
 *                 décide si c'est un « failed » (à reprendre) ou silencieux.
 */
export async function nearestHighway(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error('lat/lon invalides');
    }
    // Round-robin + retry/backoff mutualisés (cf. retour Stefan 31/05 PR #711 :
    // les 504 sur overpass-api.de bloquaient tout le batch).
    const json = await fetchOverpassJson(buildQuery(lat, lon));
    const best = nearestPointFromWays(json, lat, lon);
    return best ? { coords: [best.lon, best.lat], distance: best.distance } : null;
}

// Exporté pour tests.
export const _internals = {
    distanceMeters, nearestPointFromWays, buildQuery, dataAgeMs, TIMEOUT_MS, SEARCH_RADIUS_M,
    PUBLIC_ENDPOINT, KEYED_ENDPOINT_BASE, COOLDOWN_MS, MAX_DATA_AGE_MS,
    reset() { _key = null; _coolUntil.clear(); _lastKeyedStart = 0; },
};
