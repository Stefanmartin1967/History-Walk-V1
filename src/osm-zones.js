// src/osm-zones.js
// Construit les zones administratives (quartiers) d'une bbox depuis OSM Overpass,
// pour usage NAVIGATEUR — Scout, création d'une destination brouillon (réunif
// C2a-2b). Porté de scripts/fetch-zones-from-osm.mjs (assembleRings + requête
// admin) ; même forme de sortie que public/{dest}-zones.geojson (name/osm_id/
// admin_level), donc consommable tel quel par getZoneFromCoords/loadZonesForActive.
import { fetchOverpassJson } from './osm-overpass.js';

// admin_level par défaut selon le pays (code ISO Nominatim). La Tunisie utilise 6
// (délégations/communes) ; la plupart des autres pays = 8. On tente d'abord ce
// niveau, puis un repli si la 1ʳᵉ passe ne ramène rien (granularité variable).
const LEVEL_CHAIN = { tn: [6, 7], dz: [6, 7], ma: [6, 7] };
function levelChainForCountry(cc) {
    return LEVEL_CHAIN[(cc || '').toLowerCase()] || [8, 6];
}

// Assemble N ways "outer" (qui se touchent par leurs extrémités) en anneaux
// fermés. Les boundaries OSM sont rarement un seul way. (Porté du CLI.)
function assembleRings(outerWays) {
    if (outerWays.length === 0) return [];
    const segments = outerWays.map(w => w.geometry.map(n => [n.lon, n.lat]));
    const ptKey = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
    const ptEqual = (a, b) => ptKey(a) === ptKey(b);
    const rings = [];
    const used = new Array(segments.length).fill(false);
    for (let start = 0; start < segments.length; start++) {
        if (used[start]) continue;
        const ring = [...segments[start]];
        used[start] = true;
        let extended = true;
        while (extended) {
            extended = false;
            const tail = ring[ring.length - 1];
            for (let i = 0; i < segments.length; i++) {
                if (used[i]) continue;
                const seg = segments[i];
                if (ptEqual(tail, seg[0])) {
                    ring.push(...seg.slice(1)); used[i] = true; extended = true; break;
                }
                if (ptEqual(tail, seg[seg.length - 1])) {
                    ring.push(...[...seg].reverse().slice(1)); used[i] = true; extended = true; break;
                }
            }
        }
        const first = ring[0], last = ring[ring.length - 1];
        if (!ptEqual(first, last)) ring.push([...first]); // ferme l'anneau
        if (ring.length >= 4) rings.push(ring);
    }
    return rings;
}

// Une requête Overpass admin pour un niveau donné. bbox = [[s,w],[n,e]].
// Échec/timeout → collection vide (on n'empêche jamais la création du brouillon).
async function fetchZonesForBBox(bbox, adminLevel) {
    const [[south, west], [north, east]] = bbox;
    const query = `[out:json][timeout:60];(relation["boundary"="administrative"]["admin_level"="${adminLevel}"](${south},${west},${north},${east}););out geom;`;
    let data;
    try {
        data = await fetchOverpassJson(query, { timeoutMs: 30000, retries: 1 });
    } catch (e) {
        return { type: 'FeatureCollection', features: [] };
    }
    const features = [];
    for (const rel of (data.elements || [])) {
        if (!rel.members) continue;
        const outerWays = rel.members.filter(m => m.type === 'way' && m.role === 'outer' && m.geometry);
        if (!outerWays.length) continue;
        const rings = assembleRings(outerWays);
        if (!rings.length) continue;
        const t = rel.tags || {};
        const name = t['name:fr'] || t['name:en'] || t.name || `(sans nom #${rel.id})`;
        const nameAr = t['name:ar'] || t.name || '';
        // Une relation admin multi-parties (commune morcelée, îles…) produit
        // plusieurs anneaux disjoints. On les CONSERVE TOUS : un seul → Polygon ;
        // plusieurs → MultiPolygon (chaque anneau = anneau extérieur de son
        // sous-polygone), pour que getZoneFromCoords couvre chaque morceau (un POI
        // dans une petite partie ne doit pas tomber « Hors zone »). assembleRings ne
        // consomme que les ways role=outer → pas de trous à modéliser.
        const geometry = rings.length === 1
            ? { type: 'Polygon', coordinates: [rings[0]] }
            : { type: 'MultiPolygon', coordinates: rings.map(r => [r]) };
        features.push({
            type: 'Feature',
            properties: {
                name,
                ...(nameAr && nameAr !== name ? { name_ar: nameAr } : {}),
                osm_id: rel.id,
                admin_level: t.admin_level,
            },
            geometry,
        });
    }
    return { type: 'FeatureCollection', features };
}

// Récupère les zones admin d'une bbox en choisissant le niveau selon le pays
// (code ISO Nominatim), avec repli si la 1ʳᵉ passe est vide. bbox = [[s,w],[n,e]].
export async function fetchZonesAuto(bbox, countryCode) {
    for (const lvl of levelChainForCountry(countryCode)) {
        const fc = await fetchZonesForBBox(bbox, lvl);
        if (fc.features.length) return fc;
    }
    return { type: 'FeatureCollection', features: [] };
}

