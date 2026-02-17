// src/utils.js

export function cleanUrl(urlStr) {
    if (!urlStr || !urlStr.startsWith('http')) return urlStr;
    try {
        const urlObj = new URL(urlStr);
        const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'igshid', 'ref'];
        let changed = false;
        paramsToRemove.forEach(param => {
            if (urlObj.searchParams.has(param)) {
                urlObj.searchParams.delete(param);
                changed = true;
            }
        });
        return changed ? urlObj.toString() : urlStr;
    } catch (e) {
        return urlStr;
    }
}

export function parseGps(gpsString) {
    if (!gpsString) return null;
    // Accepte "lat, lon" ou "lat lon" ou "lat; lon"
    // On remplace tout ce qui n'est pas chiffre, point ou moins par un espace, puis on split
    const cleanStr = gpsString.replace(/[,;]/g, ' ').trim(); 
    const parts = cleanStr.split(/\s+/);
    
    if (parts.length < 2) return null;

    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    
    if (isNaN(lat) || isNaN(lon)) return null;
    return { lat, lon };
}

export function decodeText(text) {
    try { return decodeURIComponent(text); } catch (e) { return text; }
}

/**
 * Génère un ID aléatoire format HW-XXXXXXXXXXXXXXXXXXXXXXXXXX
 */
export function generateHWID() {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = 'HW-';
    for (let i = 0; i < 26; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Algorithme "Ray Casting" pour voir si un point est dans un polygone
 * point: [lon, lat]
 * vs: tableau de coordonnées du polygone [[lon, lat], [lon, lat]...]
 */
export function isPointInPolygon(point, vs) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0], yi = vs[i][1];
        const xj = vs[j][0], yj = vs[j][1];
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}