import { state } from './state.js';
import { getPoiId } from './data.js';
import { getRealDistance, getOrthodromicDistance } from './map.js';
import { isCircuitCompleted } from './circuit.js';
import { getZoneFromCoords } from './utils.js';

/**
 * Returns a processed list of circuits ready for display (Merged, Filtered, Sorted, Enriched).
 * Used by both PC (Sidebar) and Mobile (Full View) to ensure consistency.
 *
 * @param {string} sortMode - 'date_desc', 'date_asc', 'dist_asc', 'dist_desc'
 * @param {boolean} filterTodo - If true, only show uncompleted circuits
 * @param {string|null} filterZone - If provided, only show circuits in this zone
 * @returns {Array} List of enriched circuit objects
 */
export function getProcessedCircuits(sortMode = 'date_desc', filterTodo = false, filterZone = null) {
    // 1. Data Prep : Fusion des circuits officiels et utilisateur (Sans doublons)
    const officialCircuits = state.officialCircuits || [];
    const localCircuits = (state.myCircuits || []).filter(c => {
        if (c.isDeleted) return false;

        // FILTRE DE SÉCURITÉ : On cache les "Fantômes" (Officiels en double ou Vides)
        if (c.isOfficial) return false; // Un local ne devrait jamais être 'official' (doublon DB)

        // Vérification si une version officielle existe déjà
        const existsInOfficial = officialCircuits.some(off =>
            String(off.id) === String(c.id) ||
            (off.name && c.name && off.name.trim() === c.name.trim())
        );
        return !existsInOfficial;
    });

    const allCircuits = [...officialCircuits, ...localCircuits];

    // 2. Enrichment
    let enrichedCircuits = allCircuits.map(c => {
        // Validation des POIs
        const validPois = (c.poiIds || [])
            .map(id => state.loadedFeatures.find(f => String(getPoiId(f)) === String(id)))
            .filter(Boolean);

        // --- DISTANCE CALCULATION (Unified Logic) ---
        let distance = 0;

        // Priority 1: Official Distance String (e.g. "3.8 km")
        if (c.distance && typeof c.distance === 'string') {
            const parsed = parseFloat(c.distance.replace(',', '.').replace(/[^\d.]/g, ''));
            if (!isNaN(parsed) && parsed > 0) distance = parsed * 1000;
        }

        // Priority 2: Real Track Geometry
        if (distance === 0 && c.realTrack && c.realTrack.length > 0) {
            distance = getRealDistance(c);
        }

        // Priority 3: Orthodromic (As the crow flies)
        if (distance === 0) {
            distance = getOrthodromicDistance(validPois);
        }

        // --- METADATA ---
        const hasRestaurant = validPois.some(f => {
            const cat = f.properties['Catégorie'] || f.properties.userData?.Catégorie;
            return cat === 'Restaurant';
        });

        const isCompleted = isCircuitCompleted(c);

        // --- ZONE CALCULATION ---
        let zoneName = c.zone || "Inconnue"; // Default or stored
        if (validPois.length > 0) {
             const firstPoi = validPois[0];
             const [lng, lat] = firstPoi.geometry.coordinates;
             const computedZone = getZoneFromCoords(lat, lng);
             if (computedZone) zoneName = computedZone;
        } else if (c.realTrack && c.realTrack.length > 0) {
             const [lat, lng] = c.realTrack[0];
             const computedZone = getZoneFromCoords(lat, lng);
             if (computedZone) zoneName = computedZone;
        }

        // --- ICON DETERMINATION ---
        let iconName = 'bird';
        if ((c.realTrack && c.realTrack.length > 0) || c.hasRealTrack) {
            iconName = 'footprints';
        }

        return {
            ...c,
            _validPois: validPois,
            _dist: distance,
            _distDisplay: (distance / 1000).toFixed(1) + ' km',
            _hasRestaurant: hasRestaurant,
            _isCompleted: isCompleted,
            _zoneName: zoneName,
            _iconName: iconName,
            _poiCount: validPois.length,
            // Visited Count
            _visitedCount: validPois.filter(f => f.properties.userData?.vu).length
        };
    });

    // 3. Filtering
    if (filterTodo) {
        enrichedCircuits = enrichedCircuits.filter(c => !c._isCompleted);
    }

    if (filterZone) {
        enrichedCircuits = enrichedCircuits.filter(c => c._zoneName === filterZone);
    }

    // 4. Sorting
    if (sortMode === 'date_desc') {
        // Default: Newest first (assuming array order is chronological for locals, officials are usually static)
        // Note: Ideally we'd use a timestamp but array reverse is the legacy behavior
        enrichedCircuits.reverse();
    } else if (sortMode === 'date_asc') {
        // Keep order
    } else if (sortMode === 'dist_asc') {
        enrichedCircuits.sort((a, b) => a._dist - b._dist);
    } else if (sortMode === 'dist_desc') {
        enrichedCircuits.sort((a, b) => b._dist - a._dist);
    }

    return enrichedCircuits;
}

/**
 * Calculates available zones and their circuit counts from the raw circuit list.
 * This logic mirrors how we enriched circuits above, but specifically for building the filter menu.
 *
 * @returns {Object} { zoneCounts: { "ZoneName": count }, sortedZones: ["ZoneName", ...] }
 */
export function getAvailableZonesFromCircuits() {
    // 1. Get Base List (Official + Local Unique)
    const officialCircuits = state.officialCircuits || [];
    const localCircuits = (state.myCircuits || []).filter(c => {
        if (c.isDeleted) return false;
        if (c.isOfficial) return false;
        const existsInOfficial = officialCircuits.some(off =>
            String(off.id) === String(c.id) ||
            (off.name && c.name && off.name.trim() === c.name.trim())
        );
        return !existsInOfficial;
    });

    const allCircuits = [...officialCircuits, ...localCircuits];
    const zonesMap = {};

    allCircuits.forEach(c => {
        // Re-calculate zone (or trust stored property if consistent, but re-calc is safer)
        let zoneName = c.zone || null;

        if (!zoneName) {
            const validPois = (c.poiIds || [])
                .map(id => state.loadedFeatures.find(f => String(getPoiId(f)) === String(id)))
                .filter(Boolean);

            if (validPois.length > 0) {
                const firstPoi = validPois[0];
                const [lng, lat] = firstPoi.geometry.coordinates;
                zoneName = getZoneFromCoords(lat, lng);
            } else if (c.realTrack && c.realTrack.length > 0) {
                const [lat, lng] = c.realTrack[0];
                zoneName = getZoneFromCoords(lat, lng);
            }
        }

        if (zoneName) {
            zonesMap[zoneName] = (zonesMap[zoneName] || 0) + 1;
        }
    });

    return {
        zoneCounts: zonesMap,
        sortedZones: Object.keys(zonesMap).sort()
    };
}
