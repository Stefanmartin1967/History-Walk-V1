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

/**
 * Génère un identifiant unique au format HW-ULID (10 chars timestamp + 16 chars random,
 * alphabet Crockford base32 sans I L O U pour éviter les confusions de lecture).
 *
 * IMPORTANT : algorithme aligné sur HW (src/utils.js generateHWID) — les IDs
 * créés par HW et DM doivent être interchangeables et triables par création
 * (timestamp préfixe). Toute évolution de l'algo doit être répliquée des deux
 * côtés (PR C de l'audit 21/05/2026 a unifié les deux algos qui divergeaient :
 * DM utilisait 36 chars random sans timestamp → IDs non triables).
 */
export function generateHWID() {
    const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    function encodeBase32(number, length) {
        let str = "";
        for (let i = length - 1; i >= 0; i--) {
            str = ENCODING.charAt(number % 32) + str;
            number = Math.floor(number / 32);
        }
        return str;
    }

    function randomChar() {
        return ENCODING.charAt(Math.floor(Math.random() * 32));
    }

    // 1. Timestamp (48 bits -> 10 chars)
    const now = Date.now();
    const timestampPart = encodeBase32(now, 10);

    // 2. Random (80 bits -> 16 chars)
    let randomPart = "";
    for (let i = 0; i < 16; i++) {
        randomPart += randomChar();
    }

    return `HW-${timestampPart}${randomPart}`;
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