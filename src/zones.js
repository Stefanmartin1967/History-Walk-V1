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

// Réassigne les zones de la destination active. Données invalides → collection
// vide → getZoneFromCoords renvoie « A définir » (comportement sûr, pas de crash).
export function setZonesData(data) {
    zonesData = (data && Array.isArray(data.features))
        ? data
        : { type: 'FeatureCollection', features: [] };
}
