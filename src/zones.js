// src/zones.js
// Zones administratives (quartiers) de la destination ACTIVE — origine OSM
// admin_level 6. Chargées DYNAMIQUEMENT par destination au boot (réunif) via
// app-startup → loadZonesForActive :
//   - destination publiée : fetch public/{dest}-zones.geojson (djerba-zones.geojson,
//     hammamet-zones.geojson…). Source unique — plus de copie codée en dur ici.
//   - brouillon local : depuis l'IndexedDB (clé draftZones_{id}).
// Régénérer une destination publiée : node scripts/fetch-zones-from-osm.mjs <dest> 6.
// Consommé (lazy) par getZoneFromCoords/detectZone (utils.js, mobile-nav.js) — le
// `let` + setZonesData fait que ces lectures voient toujours les zones courantes
// (live binding ES module).
export let zonesData = { type: 'FeatureCollection', features: [] };

// Cache de la Zone DÉRIVÉE par POI (dégel de Zone, 17/06/2026). getDerivedZone
// (utils.js) calcule le quartier d'un POI à la volée (point-dans-polygone) au lieu
// de lire une valeur figée ; le filtre topbar l'appelle par POI à CHAQUE applyFilters
// → on mémoïse par id pour ne pas refaire le calcul à chaque passe. Clé = HW_ID.
// Le cache vit ICI (à côté du binding live) pour que setZonesData le vide sans
// créer de cycle d'import (zones.js reste une feuille : utils.js importe zones.js,
// jamais l'inverse).
const _zoneCache = new Map();
export function zoneCacheGet(id) { return _zoneCache.get(id); }
export function zoneCacheSet(id, zone) { _zoneCache.set(id, zone); }
export function deleteZoneCacheEntry(id) { _zoneCache.delete(id); }
// Interne : seul setZonesData vide tout le cache (changement de jeu de quartiers).
function clearZoneCache() { _zoneCache.clear(); }

// Réassigne les zones de la destination active. Données invalides → collection
// vide → getZoneFromCoords renvoie « A définir » (comportement sûr, pas de crash).
// Le jeu de zones change → toutes les Zones dérivées sont périmées → on vide le
// cache (invalidation maîtresse : Scout étend les zones, recalcul, boot passent
// tous par setZonesData).
export function setZonesData(data) {
    zonesData = (data && Array.isArray(data.features))
        ? data
        : { type: 'FeatureCollection', features: [] };
    clearZoneCache();
}
