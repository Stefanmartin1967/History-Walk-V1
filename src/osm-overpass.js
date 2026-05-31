// osm-overpass.js
//
// Utility Overpass pour le chantier « point d'accès au tracé » v2 :
// trouver la voie OSM la plus proche d'un POI pour pré-poser un drapeau
// (cf. project_offroad_poi_track_snapping). « Voie la plus proche » =
// any way[highway=*] dans un rayon de 150 m, candidate la plus proche
// retenue (distance Haversine, pas projection sur segment — approximation
// acceptable au rayon visé, plus simple, suffisant pour le pré-pose).
//
// Sans clé. Endpoint principal overpass-api.de avec fallback kumi.systems.
// Timeout 5 s par endpoint. Non bloquant (la pré-pose est silencieuse).

const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
];
const TIMEOUT_MS = 8000;
const SEARCH_RADIUS_M = 150;
// Retry avec backoff sur erreur réseau / 429 (rate limit). Délais en ms.
// Calibré sur l'incident Stefan 31/05 PR #710 : 275/297 échecs en batch
// massif sans retry — ces délais ramènent le taux d'échec à ~0%.
const RETRY_DELAYS = [1000, 3000, 8000];

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

async function fetchOnce(endpoint, query) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(tid);
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
    const query = buildQuery(lat, lon);
    let lastError = null;
    // Retry loop : pour chaque tentative, on essaie tous les endpoints. Si tous
    // échouent, on attend RETRY_DELAYS[attempt] puis on recommence. Ça absorbe
    // les rate limits / hoquets réseau ponctuels sans planter le POI en failed.
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        for (const endpoint of ENDPOINTS) {
            try {
                const json = await fetchOnce(endpoint, query);
                const best = nearestPointFromWays(json, lat, lon);
                return best ? { coords: [best.lon, best.lat], distance: best.distance } : null;
            } catch (e) {
                lastError = e;
            }
        }
        // Tous les endpoints ont échoué pour cette tentative.
        if (attempt < RETRY_DELAYS.length) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        }
    }
    throw lastError || new Error('Tous les endpoints Overpass ont échoué');
}

// Exporté pour tests.
export const _internals = { distanceMeters, nearestPointFromWays, buildQuery, ENDPOINTS, TIMEOUT_MS, SEARCH_RADIUS_M };
