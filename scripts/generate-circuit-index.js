const fs = require('fs');
const path = require('path');

const CIRCUITS_DIR = path.join(__dirname, '../public/circuits');
const MAP_GEOJSON_PATH = path.join(__dirname, '../public/map.geojson');
const DESTINATIONS_PATH = path.join(__dirname, '../public/destinations.json');
const PUBLIC_DIR = path.join(__dirname, '../public');
const HISTORY_WALK_URL = 'https://stefanmartin1967.github.io/history-walk/';

function getTimestampId() {
    return `HW-${Date.now()}`;
}

function escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.replace(/[<>&'"]/g, c => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;'
    }[c]));
}

function unescapeXml(safe) {
    if (!safe) return '';
    return safe.replace(/&(lt|gt|amp|apos|quot);/g, (match, entity) => ({
        'lt': '<',
        'gt': '>',
        'amp': '&',
        'apos': "'",
        'quot': '"'
    }[entity]));
}

// Haversine formula to calculate distance between two points
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function extractTrackPoints(gpxContent) {
    // Robust parsing: Find all trkpt tags, then extract attributes regardless of order
    const trkptMatches = gpxContent.match(/<trkpt[\s\S]*?>/g);
    if (!trkptMatches) return [];

    const coords = [];

    trkptMatches.forEach(tag => {
        const latMatch = tag.match(/lat="([^"]+)"/);
        const lonMatch = tag.match(/lon="([^"]+)"/);

        if (latMatch && lonMatch) {
             coords.push([parseFloat(latMatch[1]), parseFloat(lonMatch[1])]);
        }
    });
    return coords;
}

function calculateTrackDistance(coords) {
    if (coords.length < 2) return 0;

    let totalDist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        totalDist += getDistance(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]);
    }

    return totalDist; // in meters
}

// Ray-casting algorithm for point in polygon
function isPointInPolygon(point, vs) {
    // point = [lon, lat] (GeoJSON convention) or [lat, lon]?
    // GeoJSON polygons are usually [lon, lat].
    // Our point input here is [lat, lon] from GPX.

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

function loadZones() {
    if (!fs.existsSync(MAP_GEOJSON_PATH)) {
        console.warn("Map GeoJSON not found at " + MAP_GEOJSON_PATH);
        return [];
    }
    try {
        const data = JSON.parse(fs.readFileSync(MAP_GEOJSON_PATH, 'utf8'));
        if (data.type === 'FeatureCollection') {
            return data.features.filter(f => f.geometry && f.geometry.type === 'Polygon');
        }
    } catch (e) {
        console.error("Error loading zones:", e);
    }
    return [];
}

function getZoneForPoint(lat, lon, zones) {
    // Point needs to be [lon, lat] for comparison with GeoJSON
    const point = [lon, lat];

    for (const zone of zones) {
        // GeoJSON Polygon coordinates are nested: [ [ [x,y], ... ] ]
        // Usually the first ring is the exterior ring.
        if (zone.geometry.coordinates && zone.geometry.coordinates.length > 0) {
            const polygon = zone.geometry.coordinates[0];
            if (isPointInPolygon(point, polygon)) {
                return zone.properties.name;
            }
        }
    }
    return null;
}

function loadDestinations() {
    if (!fs.existsSync(DESTINATIONS_PATH)) {
        console.warn("Destinations file not found at " + DESTINATIONS_PATH);
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(DESTINATIONS_PATH, 'utf8'));
    } catch (e) {
        console.error("Error loading destinations:", e);
        return {};
    }
}

function loadPOIs(poiFilename) {
    if (!poiFilename) return [];
    const poiPath = path.join(PUBLIC_DIR, poiFilename);
    if (!fs.existsSync(poiPath)) {
        console.warn("POI file not found at " + poiPath);
        return [];
    }
    try {
        const data = JSON.parse(fs.readFileSync(poiPath, 'utf8'));
        if (data.type === 'FeatureCollection') {
            return data.features.filter(f => f.geometry && f.geometry.type === 'Point' && f.properties && f.properties.HW_ID);
        }
    } catch (e) {
        console.error("Error loading POIs from " + poiFilename + ":", e);
    }
    return [];
}

function findPOIsOnTrack(trackPoints, poiFeatures) {
    const matchedIds = new Set();
    const DISTANCE_THRESHOLD = 50; // meters

    // Optimization: Calculate bounding box of track to quickly exclude distant POIs
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    trackPoints.forEach(pt => {
        if (pt[0] < minLat) minLat = pt[0];
        if (pt[0] > maxLat) maxLat = pt[0];
        if (pt[1] < minLon) minLon = pt[1];
        if (pt[1] > maxLon) maxLon = pt[1];
    });

    // Add buffer to bbox (approx 0.001 degrees is ~100m)
    const buffer = 0.002;
    minLat -= buffer; maxLat += buffer;
    minLon -= buffer; maxLon += buffer;

    const nearbyPOIs = poiFeatures.filter(poi => {
        const [lon, lat] = poi.geometry.coordinates;
        return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
    });

    nearbyPOIs.forEach(poi => {
        const [poiLon, poiLat] = poi.geometry.coordinates;
        for (const [trackLat, trackLon] of trackPoints) {
            if (getDistance(trackLat, trackLon, poiLat, poiLon) <= DISTANCE_THRESHOLD) {
                matchedIds.add(poi.properties.HW_ID);
                break; // Found it on the track, move to next POI
            }
        }
    });

    return Array.from(matchedIds);
}

function processDirectory(mapId, zones, destinations) {
    const dirPath = path.join(CIRCUITS_DIR, mapId);
    const indexFilePath = path.join(CIRCUITS_DIR, `${mapId}.json`);

    console.log(`Processing map: ${mapId}`);

    // Determine POI file from destinations
    let poiFeatures = [];
    if (destinations && destinations.maps && destinations.maps[mapId] && destinations.maps[mapId].file) {
        poiFeatures = loadPOIs(destinations.maps[mapId].file);
        console.log(`  Loaded ${poiFeatures.length} POIs from ${destinations.maps[mapId].file}`);
    } else {
        console.log(`  No destination config found for mapId '${mapId}', skipping POI detection.`);
    }

    let oldIndex = [];
    if (fs.existsSync(indexFilePath)) {
        try {
            oldIndex = JSON.parse(fs.readFileSync(indexFilePath, 'utf8'));
        } catch (e) {
            console.warn(`Could not parse existing index for ${mapId}:`, e.message);
        }
    }

    const files = fs.readdirSync(dirPath).filter(f => f.toLowerCase().endsWith('.gpx'));
    const newIndex = [];

    files.forEach(filename => {
        const filePath = path.join(dirPath, filename);
        let content = fs.readFileSync(filePath, 'utf8');
        let fileChanged = false;

        // 1. Extract Metadata
        let id = null;
        let name = filename.replace('.gpx', '').replace(/_/g, ' '); // Fallback name
        let description = '';

        // Extract ID
        const idMatch = content.match(/\[HW-ID:(HW-\d+)\]/);
        if (idMatch) {
            id = idMatch[1];
        }

        // Extract Name
        const nameMatch = content.match(/<name>(.*?)<\/name>/);
        if (nameMatch) {
            let extractedName = nameMatch[1];
            if (extractedName.includes('<![CDATA[')) {
                extractedName = extractedName.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1'); // Handle CDATA
            } else {
                extractedName = unescapeXml(extractedName);
            }
            name = extractedName;

            // CLEANUP: Remove Wikiloc branding
            name = name.replace(/^Wikiloc\s*-\s*/i, '').replace(/Wikiloc/gi, '').trim();
        }

        // Extract Description
        const descMatch = content.match(/<desc>(.*?)<\/desc>/); // Simple regex, might miss multiline CDATA but robust enough for basic
        if (descMatch) {
            let extractedDesc = descMatch[1];
            if (extractedDesc.includes('<![CDATA[')) {
                extractedDesc = extractedDesc.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
            } else {
                extractedDesc = unescapeXml(extractedDesc);
            }
            description = extractedDesc;
        }

        // 2. ID Resolution & Preservation
        let existingEntry = null;

        // Try finding by ID first
        if (id) {
            existingEntry = oldIndex.find(c => c.id === id);
        }

        // Fallback: Find by filename (handle migration)
        if (!existingEntry) {
            // Check for exact match or path match (e.g. "djerba/file.gpx" matches "file.gpx")
            existingEntry = oldIndex.find(c => {
                const oldBase = path.basename(c.file);
                return oldBase === filename;
            });
        }

        if (!id) {
            if (existingEntry && existingEntry.id) {
                id = existingEntry.id;
                console.log(`  Matched existing ID for ${filename}: ${id}`);
            } else {
                id = getTimestampId();
                console.log(`  Generated new ID for ${filename}: ${id}`);
            }

            // INJECT ID into file
            const linkTag = `
    <link href="${HISTORY_WALK_URL}">
      <text>History Walk [HW-ID:${id}]</text>
    </link>`;

            if (content.includes('<metadata>')) {
                content = content.replace('</metadata>', `${linkTag}\n  </metadata>`);
            } else {
                // Insert metadata after <gpx ...>
                const metadataBlock = `
  <metadata>
    <name>${escapeXml(name)}</name>
    ${linkTag}
  </metadata>`;
                content = content.replace(/<gpx[^>]*>/, match => `${match}\n${metadataBlock}`);
            }
            fileChanged = true;
        }

        // 3. Calculate Distance, Zone, and POIs
        const trackPoints = extractTrackPoints(content);
        const distanceMeters = calculateTrackDistance(trackPoints);
        const distanceStr = (distanceMeters / 1000).toFixed(1) + ' km';

        let zone = null;

        // Find POIs on track
        const poiIds = findPOIsOnTrack(trackPoints, poiFeatures);

        // Determine Zone
        // Priority 1: Zone of the first POI
        if (poiIds.length > 0) {
            const firstPoi = poiFeatures.find(p => p.properties.HW_ID === poiIds[0]);
            if (firstPoi && firstPoi.properties.Zone) {
                zone = firstPoi.properties.Zone;
            }
        }

        // Priority 2: Zone of the start point
        if (!zone && trackPoints.length > 0) {
            const startPoint = trackPoints[0];
            zone = getZoneForPoint(startPoint[0], startPoint[1], zones);
        }

        // 4. Build New Entry
        const entry = {
            id: id,
            name: name,
            file: `${mapId}/${filename}`, // Relative path for the app
            description: description,
            distance: distanceStr,
            isOfficial: true,
            hasRealTrack: true,
            zone: zone,
            poiIds: poiIds, // Updated POIs
            transport: existingEntry && existingEntry.transport ? existingEntry.transport : undefined
        };

        // Clean up undefined
        if (!entry.transport) delete entry.transport;
        if (!entry.zone) delete entry.zone;

        newIndex.push(entry);

        if (fileChanged) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`  Updated GPX file with ID: ${filename}`);
        }
    });

    // Write new index
    fs.writeFileSync(indexFilePath, JSON.stringify(newIndex, null, 2), 'utf8');
    console.log(`Saved index for ${mapId} with ${newIndex.length} circuits.`);
}

function main() {
    if (!fs.existsSync(CIRCUITS_DIR)) {
        console.error("Circuits directory not found.");
        process.exit(1);
    }

    const zones = loadZones();
    console.log(`Loaded ${zones.length} zones.`);

    const destinations = loadDestinations();

    const entries = fs.readdirSync(CIRCUITS_DIR, { withFileTypes: true });

    entries.forEach(entry => {
        if (entry.isDirectory()) {
            processDirectory(entry.name, zones, destinations);
        }
    });
}

main();
