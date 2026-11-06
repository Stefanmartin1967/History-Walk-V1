// follow-arrows.js
// Flèches de sens sur le tracé, carte du suivi mobile SEULEMENT (demande de
// Stefan, 06/11/2026 : utile quand un circuit repasse au même endroit ou forme
// une boucle). Calcul pur ici (testable) ; la pose des marqueurs vit dans
// mobile-follow.js.

const EARTH_RADIUS_M = 6371000;
const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

function distanceM(a, b) {
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

// Cap de a vers b, en degrés depuis le nord, sens horaire (0 = nord, 90 = est).
function bearingDeg(a, b) {
    const φ1 = toRad(a[0]);
    const φ2 = toRad(b[0]);
    const Δλ = toRad(b[1] - a[1]);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Positions des flèches le long d'un tracé, régulièrement espacées.
 * @param {number[][]} track  points [lat, lng] dans le sens de la marche
 * @param {number} spacingM   écart entre deux flèches, en mètres
 * @returns {{lat: number, lng: number, bearing: number}[]}
 *   La première flèche est à une demi-distance du départ (pas collée au point
 *   de départ) ; `bearing` = cap du segment qui la porte.
 */
export function arrowPositions(track, spacingM) {
    const out = [];
    if (!Array.isArray(track) || track.length < 2 || !(spacingM > 0)) return out;

    let next = spacingM / 2;
    let walked = 0;
    for (let i = 0; i < track.length - 1; i++) {
        const a = track[i];
        const b = track[i + 1];
        const d = distanceM(a, b);
        if (!(d > 0)) continue;
        const bearing = bearingDeg(a, b);
        while (next <= walked + d) {
            const t = (next - walked) / d;
            out.push({ lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t, bearing });
            next += spacingM;
        }
        walked += d;
    }
    return out;
}

/**
 * Mètres couverts par un pixel écran (projection Web Mercator de Leaflet).
 * Sert à garder un écart CONSTANT À L'ÉCRAN entre les flèches, quel que soit
 * le zoom.
 */
export function metersPerPixel(lat, zoom) {
    return 40075016.686 * Math.cos(toRad(lat)) / Math.pow(2, zoom + 8);
}
