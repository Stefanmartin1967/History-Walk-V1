// src/zones-lighten.mjs
// ============================================================================
// Contours de quartiers allégés, et format du fichier {dest}-zones.geojson
// (02/11/2026). Deux consommateurs :
//   • l'app            → osm-zones.js (allègement, à l'arrivée depuis OSM) et
//                        publish-destination.js (écriture du fichier) ;
//   • les scripts Node → scripts/fetch-zones-from-osm.mjs, cleanup-zones.mjs.
// En .mjs pour la même raison que osm-ref.mjs : les scripts tournent sous Node
// (package `type: "commonjs"`). Aucune dépendance.
// ============================================================================
//
// Les contours arrivent d'OSM avec tous leurs points, à 7 décimales : Charleroi
// pesait 5 Mo, à recharger à chaque ouverture de la destination. Or ils ne
// servent qu'à dire dans quel quartier tombe un lieu (point-dans-polygone),
// jamais à les dessiner. Chaque contour est donc allégé à 5 m (Douglas-Peucker)
// puis arrondi à 6 décimales (11 cm) : environ dix fois plus léger, aucun des
// 844 lieux de Djerba, Hammamet et Charleroi n'a changé de quartier (mesuré le
// 02/11/2026).
// UNE SEULE FOIS, à l'arrivée depuis OSM : relancé sur un contour déjà allégé,
// Douglas-Peucker retire encore quelques points (0,2 % mesuré) et le contour
// glisse un peu plus. Or chaque « Compléter les quartiers » réécrit tout le
// fichier : alléger à l'écriture ferait dériver les anciens quartiers.
// Limite : deux quartiers voisins sont allégés chacun de son côté, leur limite
// commune peut s'écarter de quelques mètres. D'où 5 m et pas plus : en Belgique,
// beaucoup de limites suivent une rue.
const ZONE_TOLERANCE_M = 5;
const ZONE_DECIMALS = 6;

// Distance (m) du point p au segment [a, b], en projection locale (mx, my : mètres
// par degré de longitude et de latitude).
function segmentDistance(p, a, b, mx, my) {
    const ax = a[0] * mx, ay = a[1] * my;
    const dx = b[0] * mx - ax, dy = b[1] * my - ay;
    const px = p[0] * mx - ax, py = p[1] * my - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
    return Math.hypot(t * dx - px, t * dy - py);
}

// Douglas-Peucker sur un anneau fermé (premier point = dernier point, tous deux
// gardés). Un anneau qui tomberait sous 4 points est gardé tel quel.
function lightenRing(ring, toleranceM) {
    if (!Array.isArray(ring) || ring.length < 5) return ring;
    const my = 110540;
    const mx = 111320 * Math.cos(ring[0][1] * Math.PI / 180);
    const keep = new Uint8Array(ring.length);
    keep[0] = keep[ring.length - 1] = 1;
    const stack = [[0, ring.length - 1]];
    while (stack.length) {
        const [i, j] = stack.pop();
        let maxD = 0, maxK = -1;
        for (let k = i + 1; k < j; k++) {
            const d = segmentDistance(ring[k], ring[i], ring[j], mx, my);
            if (d > maxD) { maxD = d; maxK = k; }
        }
        if (maxD > toleranceM) {
            keep[maxK] = 1;
            stack.push([i, maxK], [maxK, j]);
        }
    }
    const out = ring.filter((_, k) => keep[k]);
    return out.length >= 4 ? out : ring;
}

const roundCoord = (v) => Math.round(v * 10 ** ZONE_DECIMALS) / 10 ** ZONE_DECIMALS;

/**
 * Allège les contours d'une collection de quartiers venus d'OSM. Ne modifie pas
 * l'objet reçu. À n'appliquer qu'à des contours bruts (voir plus haut).
 * @param {{features?: Array}} zones
 * @param {number} [toleranceM]
 * @returns {{type: 'FeatureCollection', features: Array}}
 */
export function lightenZones(zones, toleranceM = ZONE_TOLERANCE_M) {
    const polygon = (rings) => rings.map((ring) =>
        lightenRing(ring, toleranceM).map(([lng, lat]) => [roundCoord(lng), roundCoord(lat)]));
    const features = (zones?.features || []).map((f) => {
        const g = f.geometry;
        if (g?.type === 'Polygon') return { ...f, geometry: { ...g, coordinates: polygon(g.coordinates) } };
        if (g?.type === 'MultiPolygon') return { ...f, geometry: { ...g, coordinates: g.coordinates.map(polygon) } };
        return f;
    });
    return { type: 'FeatureCollection', features };
}

/**
 * Contenu du fichier {dest}-zones.geojson : sans indentation (le fichier ne se
 * relit pas à la main ; l'indentation doublait son poids).
 * @param {{features?: Array}} zones
 * @returns {string}
 */
export function zonesFileText(zones) {
    return JSON.stringify({ type: 'FeatureCollection', features: zones?.features || [] }) + '\n';
}
