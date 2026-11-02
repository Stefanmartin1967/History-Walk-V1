// scout-territory.js — destination à TERRITOIRE (02/11/2026, la Wallonie).
//
// Une destination peut porter `territoryOsmId` (destinations.json) : l'identifiant
// de la relation OSM de son territoire. Ses quartiers sont alors les communes de
// ce territoire (« Compléter les quartiers », fetchTerritoryZones). Le rectangle de
// la destination déborde sur les régions et pays voisins ; le Scout s'appuie donc
// sur les quartiers :
//   - il ne capture que ce qui tombe dans un quartier (inTerritory) ;
//   - son garde-fou regarde l'étendue des quartiers (zonesExtent) au lieu du
//     rectangle ;
//   - il n'ajoute pas de quartier à la capture (scout.js).
// Isolé de scout.js (carte, DOM) pour être testable, comme scout-dedup.js.
import { getZoneFromCoords } from './utils.js';

/** La destination (entrée de destinations.json) a-t-elle un territoire ? */
export function hasTerritory(dest) {
    return !!dest?.territoryOsmId;
}

/**
 * Le point tombe-t-il dans un quartier de la destination active ? Quartiers non
 * chargés (« A définir ») → non : on ne capture pas à l'aveugle.
 */
export function inTerritory(lat, lon) {
    const zone = getZoneFromCoords(lat, lon);
    return zone !== 'Hors zone' && zone !== 'A définir';
}

/**
 * Étendue [[s,w],[n,e]] d'un jeu de quartiers (FeatureCollection Polygon /
 * MultiPolygon), ou null s'il est vide.
 */
export function zonesExtent(zones) {
    let s = 90, w = 180, n = -90, e = -180;
    const visit = (c) => {
        if (typeof c[0] === 'number') {
            if (c[1] < s) s = c[1];
            if (c[1] > n) n = c[1];
            if (c[0] < w) w = c[0];
            if (c[0] > e) e = c[0];
        } else c.forEach(visit);
    };
    for (const f of zones?.features || []) {
        if (Array.isArray(f.geometry?.coordinates)) visit(f.geometry.coordinates);
    }
    return s <= n ? [[s, w], [n, e]] : null;
}
