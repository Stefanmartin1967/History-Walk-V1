// src/osm-zones.js
// Construit les zones administratives (quartiers) d'une bbox depuis OSM Overpass,
// pour usage NAVIGATEUR — Scout, création d'une destination brouillon (réunif
// C2a-2b). Porté de scripts/fetch-zones-from-osm.mjs (assembleRings + requête
// admin) ; même forme de sortie que public/{dest}-zones.geojson (name/osm_id/
// admin_level), donc consommable tel quel par getZoneFromCoords/loadZonesForActive.
import { fetchOverpassJson } from './osm-overpass.js';
import { isPointInPolygon } from './utils.js';

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
        data = await fetchOverpassJson(query, { timeoutMs: 40000, retries: 1 });
    } catch (e) {
        return { type: 'FeatureCollection', features: [] };
    }
    return { type: 'FeatureCollection', features: relationsToFeatures(data) };
}

// Relations admin OSM (`out geom`) → features zones (même forme que {dest}-zones.geojson).
function relationsToFeatures(data) {
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
    return features;
}

// Anneaux extérieurs d'une géométrie zone (Polygon ou MultiPolygon).
function outerRings(geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return [];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(p => p && p[0]).filter(Boolean);
    return geometry.coordinates[0] ? [geometry.coordinates[0]] : [];
}

// Une sous-zone est retenue si son centre (moyenne des sommets) tombe dans la zone
// parente. Overpass `(area.p)` ramène aussi les voisines qui ne font que toucher la
// limite : leur centre est dehors. Les sommets eux-mêmes ne conviennent pas : ceux
// d'une limite partagée sont sur le bord, ni dedans ni dehors de façon fiable.
function isMostlyInside(feature, parent) {
    const parentRings = outerRings(parent.geometry);
    const points = outerRings(feature.geometry).flatMap(r => r.slice(0, -1)); // sans le point de fermeture
    if (!points.length || !parentRings.length) return false;
    const center = [
        points.reduce((s, p) => s + p[0], 0) / points.length,
        points.reduce((s, p) => s + p[1], 0) / points.length,
    ];
    return parentRings.some(r => isPointInPolygon(center, r));
}

/**
 * Subdivisions administratives d'une zone (ex. les 15 anciennes communes de
 * Charleroi : admin_level 9 sous la commune de niveau 8). Tente le niveau juste
 * en dessous, puis le suivant (certains pays sautent un niveau). Chaque sous-zone
 * porte `parent_osm_id` : « Compléter les quartiers » et le Scout savent ainsi que
 * la zone d'origine est déjà couverte et ne la rajoutent pas par-dessus.
 * Contrairement à la récupération par bbox, une erreur réseau REMONTE : l'admin a
 * demandé cette action, il doit savoir qu'elle a échoué.
 *
 * @param {object} parent - feature de {dest}-zones.geojson (properties.osm_id, admin_level)
 * @returns {Promise<Array>} les sous-zones (vide si OSM n'en connaît pas au moins deux)
 */
export async function fetchSubZones(parent) {
    const id = parent?.properties?.osm_id;
    const level = Number(parent?.properties?.admin_level);
    if (!id || !Number.isFinite(level)) throw new Error('Zone sans identifiant OSM ou sans niveau administratif.');
    for (const subLevel of [level + 1, level + 2]) {
        const query = `[out:json][timeout:60];rel(${id});map_to_area->.p;relation["boundary"="administrative"]["admin_level"="${subLevel}"](area.p);out geom;`;
        const data = await fetchOverpassJson(query, { timeoutMs: 40000, retries: 1 });
        const subs = relationsToFeatures(data)
            .filter(f => f.properties.osm_id !== id && isMostlyInside(f, parent))
            .map(f => ({ ...f, properties: { ...f.properties, parent_osm_id: id } }));
        if (subs.length >= 2) return subs;
    }
    return [];
}

/**
 * Remplace, À SA PLACE dans la liste, la zone `parentOsmId` par ses sous-zones.
 * Les sous-zones déjà présentes (même osm_id) ne sont pas dupliquées.
 */
export function replaceZoneWithSubZones(fc, parentOsmId, subZones) {
    const features = (fc && fc.features) || [];
    const idx = features.findIndex(f => f.properties?.osm_id === parentOsmId);
    if (idx < 0) return { type: 'FeatureCollection', features: [...features] };
    const rest = features.filter((_, i) => i !== idx);
    const present = new Set(rest.map(f => f.properties?.osm_id).filter(v => v != null));
    const fresh = subZones.filter(f => !present.has(f.properties?.osm_id));
    return { type: 'FeatureCollection', features: [...rest.slice(0, idx), ...fresh, ...rest.slice(idx)] };
}

/**
 * Identifiants OSM déjà couverts par un jeu de zones : ses zones ET les zones
 * d'origine qu'elles subdivisent (`parent_osm_id`). Sert à la déduplication quand
 * on complète le jeu : une commune subdivisée ne doit pas revenir par-dessus.
 */
export function coveredZoneIds(fc) {
    const ids = new Set();
    for (const f of (fc && fc.features) || []) {
        if (f.properties?.osm_id != null) ids.add(f.properties.osm_id);
        if (f.properties?.parent_osm_id != null) ids.add(f.properties.parent_osm_id);
    }
    return ids;
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

