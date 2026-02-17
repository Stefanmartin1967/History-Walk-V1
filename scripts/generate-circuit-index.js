const fs = require('fs');
const path = require('path');

const CIRCUITS_DIR = path.join(__dirname, '../public/circuits');
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

function calculateTrackDistance(gpxContent) {
    // Robust parsing: Find all trkpt tags, then extract attributes regardless of order
    const trkptMatches = gpxContent.match(/<trkpt[\s\S]*?>/g);
    if (!trkptMatches) return 0;

    const coords = [];

    trkptMatches.forEach(tag => {
        const latMatch = tag.match(/lat="([^"]+)"/);
        const lonMatch = tag.match(/lon="([^"]+)"/);

        if (latMatch && lonMatch) {
             coords.push([parseFloat(latMatch[1]), parseFloat(lonMatch[1])]);
        }
    });

    if (coords.length < 2) return 0;

    let totalDist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        totalDist += getDistance(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]);
    }

    return totalDist; // in meters
}

function processDirectory(mapId) {
    const dirPath = path.join(CIRCUITS_DIR, mapId);
    const indexFilePath = path.join(CIRCUITS_DIR, `${mapId}.json`);

    console.log(`Processing map: ${mapId}`);

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

        // 3. Calculate Distance
        const distanceMeters = calculateTrackDistance(content);
        const distanceStr = (distanceMeters / 1000).toFixed(1) + ' km';

        // 4. Build New Entry
        // Merge with existing data to preserve manual fields (poiIds, transport)
        const entry = {
            id: id,
            name: name,
            file: `${mapId}/${filename}`, // Relative path for the app
            description: description,
            distance: distanceStr, // Updated with calculated distance
            isOfficial: true,
            hasRealTrack: true,
            poiIds: existingEntry ? existingEntry.poiIds : [],
            transport: existingEntry && existingEntry.transport ? existingEntry.transport : undefined
        };

        // Clean up undefined
        if (!entry.transport) delete entry.transport;

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

    const entries = fs.readdirSync(CIRCUITS_DIR, { withFileTypes: true });

    entries.forEach(entry => {
        if (entry.isDirectory()) {
            processDirectory(entry.name);
        }
    });
}

main();
