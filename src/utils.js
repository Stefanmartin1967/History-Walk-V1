
// utils.js
import { zonesData } from './zones.js';

export function getPoiId(feature) {
    if (!feature || !feature.properties) return null;
    return feature.properties.HW_ID || feature.id;
}

export function getPoiName(feature) {
    if (!feature || !feature.properties) return "Lieu sans nom";
    const props = feature.properties;
    const userData = props.userData || {};
    return userData.custom_title || userData['Nom du site FR'] || props['Nom du site FR'] || userData['Nom du site arabe'] || props['Nom du site AR'] || props.name || "Lieu inconnu";
}

export function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename.replace(/[\\/:"*?<>|]/g, '-');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

// Calcule la distance en mètres entre deux points (Formule de Haversine)
export function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Rayon de la terre en mètres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance en mètres
}

// --- MINIMAL EXIF PARSER (Custom Implementation) ---
// Remplace exif-js qui cause des erreurs 'n is not defined' en strict mode

export function getExifLocation(file) {
    return new Promise((resolve, reject) => {
        // Timeout de sécurité (10s)
        const timer = setTimeout(() => {
            reject(new Error("Timeout lors de l'extraction GPS"));
        }, 10000);

        const reader = new FileReader();

        reader.onload = (event) => {
            clearTimeout(timer);
            try {
                const dataView = new DataView(event.target.result);
                const coords = parseExifGps(dataView);
                if (coords) {
                    resolve(coords);
                } else {
                    reject(new Error("Pas de données GPS trouvées"));
                }
            } catch (e) {
                reject(e);
            }
        };

        reader.onerror = () => {
            clearTimeout(timer);
            reject(new Error("Erreur de lecture du fichier"));
        };

        // On lit les premiers 128 Ko, suffisant pour l'en-tête EXIF
        reader.readAsArrayBuffer(file.slice(0, 128 * 1024));
    });
}

function parseExifGps(dataView) {
    if (dataView.getUint16(0) !== 0xFFD8) return null; // Not JPEG

    let offset = 2;
    const length = dataView.byteLength;

    while (offset < length) {
        if (dataView.getUint8(offset) !== 0xFF) return null; // Invalid marker

        const marker = dataView.getUint8(offset + 1);
        if (marker === 0xE1) { // APP1 (Exif)
            return readExifData(dataView, offset + 4);
        }

        offset += 2 + dataView.getUint16(offset + 2);
    }
    return null;
}

function readExifData(dataView, start) {
    const tiffStart = start + 6; // Skip "Exif\0\0"
    if (dataView.getUint32(start) !== 0x45786966) return null; // check "Exif"

    // Endianness
    const bigEndian = dataView.getUint16(tiffStart) === 0x4D4D;

    // First IFD offset
    const firstIFDOffset = dataView.getUint32(tiffStart + 4, bigEndian);
    if (firstIFDOffset < 8) return null;

    const ifdStart = tiffStart + firstIFDOffset;
    const entries = dataView.getUint16(ifdStart, bigEndian);

    let gpsOffset = null;

    // Scan First IFD for GPSInfo (Tag 0x8825)
    for (let i = 0; i < entries; i++) {
        const entryOffset = ifdStart + 2 + i * 12;
        const tag = dataView.getUint16(entryOffset, bigEndian);
        if (tag === 0x8825) {
            gpsOffset = dataView.getUint32(entryOffset + 8, bigEndian);
            break;
        }
    }

    if (gpsOffset) {
        return readGpsIFD(dataView, tiffStart + gpsOffset, tiffStart, bigEndian);
    }
    return null;
}

function readGpsIFD(dataView, start, tiffStart, bigEndian) {
    const entries = dataView.getUint16(start, bigEndian);

    let lat = null, latRef = null, lng = null, lngRef = null;

    for (let i = 0; i < entries; i++) {
        const entryOffset = start + 2 + i * 12;
        const tag = dataView.getUint16(entryOffset, bigEndian);

        // GPSLatitudeRef (1)
        if (tag === 0x0001) {
             latRef = String.fromCharCode(dataView.getUint8(entryOffset + 8));
        }
        // GPSLatitude (2)
        else if (tag === 0x0002) {
             lat = readRationals(dataView, entryOffset, tiffStart, bigEndian, 3);
        }
        // GPSLongitudeRef (3)
        else if (tag === 0x0003) {
             lngRef = String.fromCharCode(dataView.getUint8(entryOffset + 8));
        }
        // GPSLongitude (4)
        else if (tag === 0x0004) {
             lng = readRationals(dataView, entryOffset, tiffStart, bigEndian, 3);
        }
    }

    if (lat && latRef && lng && lngRef) {
        return {
            lat: convertDMSToDD(lat[0], lat[1], lat[2], latRef),
            lng: convertDMSToDD(lng[0], lng[1], lng[2], lngRef)
        };
    }
    return null;
}

function readRationals(dataView, entryOffset, tiffStart, bigEndian, count) {
    const offset = dataView.getUint32(entryOffset + 8, bigEndian);
    const result = [];
    for (let i = 0; i < count; i++) {
        const num = dataView.getUint32(tiffStart + offset + i * 8, bigEndian);
        const den = dataView.getUint32(tiffStart + offset + i * 8 + 4, bigEndian);
        result.push(num / den);
    }
    return result;
}

function convertDMSToDD(degrees, minutes, seconds, direction) {
    let dd = degrees + minutes / 60 + seconds / (60 * 60);
    if (direction === "S" || direction === "W") {
        dd = dd * -1;
    }
    return dd;
}

export function resizeImage(file, maxWidth = 1280, quality = 0.9) {
    return new Promise((resolve, reject) => {
        // Timeout de sécurité (15s) pour éviter le blocage infini sur les grosses images
        const timer = setTimeout(() => {
            reject(new Error("Timeout lors du redimensionnement de l'image."));
        }, 15000);

        const reader = new FileReader();
        reader.readAsDataURL(file);

        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;

            img.onload = () => {
                clearTimeout(timer);
                try {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Calcul du ratio pour ne pas déformer l'image
                    if (width > maxWidth) {
                        height = Math.round(height * (maxWidth / width));
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Renvoie l'image en Base64 compressée
                    resolve(canvas.toDataURL('image/jpeg', quality));
                } catch (e) {
                    reject(e);
                }
            };

            img.onerror = (err) => {
                clearTimeout(timer);
                reject(new Error("Impossible de charger l'image (format non supporté ?)"));
            };
        };

        reader.onerror = (err) => {
            clearTimeout(timer);
            reject(new Error("Erreur de lecture du fichier."));
        };
    });
}

// Vérifie si un point (GPS) se trouve à l'intérieur d'une zone (Polygone)
export function isPointInPolygon(point, vs) {
    // point = [longitude, latitude]
    // vs = tableau de points du polygone
    var x = point[0], y = point[1];
    var inside = false;
    for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        var xi = vs[i][0], yi = vs[i][1];
        var xj = vs[j][0], yj = vs[j][1];
        
        var intersect = ((yi > y) != (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// --- DÉTECTEUR DE ZONE AUTOMATIQUE ---
export function getZoneFromCoords(lat, lng) {
    if (!zonesData || !zonesData.features) return "A définir";

    const point = [lng, lat]; 
    
    // On boucle sur tous les quartiers (Houmt Souk, Erriadh...)
    for (const feature of zonesData.features) {
        const polygon = feature.geometry.coordinates[0]; 
        
        // On utilise la fonction isPointInPolygon qui existe déjà dans votre fichier !
        if (isPointInPolygon(point, polygon)) { 
            return feature.properties.name; 
        }
    }
    return "Hors zone"; 
}

export function escapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function escapeXml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    // String(unsafe) garantit que .replace existe toujours
    return String(unsafe).replace(/[<>&'"]/g, c => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;'
    }[c]));
}

// --- CLUSTERING PHOTOS GPS ---

export function calculateBarycenter(coordsList) {
    if (!coordsList || coordsList.length === 0) return null;
    const avgLat = coordsList.reduce((sum, c) => sum + c.lat, 0) / coordsList.length;
    const avgLng = coordsList.reduce((sum, c) => sum + c.lng, 0) / coordsList.length;
    return { lat: avgLat, lng: avgLng };
}

export function clusterByLocation(items, distanceThreshold = 50) {
    // items doit être un tableau d'objets contenant { coords: { lat, lng }, ... }
    const validItems = items.filter(i => i.coords && i.coords.lat && i.coords.lng);
    const clusters = [];
    const visited = new Set(); // Stocke les index des items traités

    for (let i = 0; i < validItems.length; i++) {
        if (visited.has(i)) continue;

        const cluster = [];
        const queue = [i];
        visited.add(i);

        while (queue.length > 0) {
            const currentIndex = queue.shift();
            const currentItem = validItems[currentIndex];
            cluster.push(currentItem);

            // On cherche tous les voisins proches de cet élément (Transitive clustering)
            for (let j = 0; j < validItems.length; j++) {
                if (visited.has(j)) continue;

                const otherItem = validItems[j];
                const dist = calculateDistance(
                    currentItem.coords.lat, currentItem.coords.lng,
                    otherItem.coords.lat, otherItem.coords.lng
                );

                if (dist <= distanceThreshold) {
                    visited.add(j);
                    queue.push(j);
                }
            }
        }
        clusters.push(cluster);
    }
    return clusters;
}

export function filterOutliers(items) {
    // Need at least 3 items to calculate meaningful stats for outliers
    if (!items || items.length < 3) return { main: items, outliers: [] };

    const coords = items.map(i => i.coords);
    const center = calculateBarycenter(coords);

    // Calculate distances to center
    const distances = items.map(i => {
        const dist = calculateDistance(center.lat, center.lng, i.coords.lat, i.coords.lng);
        return { item: i, dist };
    });

    const sumDist = distances.reduce((acc, curr) => acc + curr.dist, 0);
    const meanDist = sumDist / items.length;

    const variance = distances.reduce((acc, curr) => acc + Math.pow(curr.dist - meanDist, 2), 0) / items.length;
    const stdDev = Math.sqrt(variance);

    // Threshold: Mean + 2 * StdDev
    // Min threshold 50m (same as clustering radius) to avoid splitting tight groups
    const threshold = Math.max(meanDist + 2 * stdDev, 50);

    const main = [];
    const outliers = [];

    distances.forEach(d => {
        if (d.dist > threshold) {
            outliers.push(d.item);
        } else {
            main.push(d.item);
        }
    });

    return { main, outliers };
}

/**
 * Calcule le nouveau temps pour un POI (Heures/Minutes)
 */
export function calculateAdjustedTime(currentH, currentM, minutesToAdd) {
    let totalMinutes = (parseInt(currentH) || 0) * 60 + (parseInt(currentM) || 0) + minutesToAdd;
    if (totalMinutes < 0) totalMinutes = 0;

    return {
        h: Math.floor(totalMinutes / 60),
        m: totalMinutes % 60
    };
}
