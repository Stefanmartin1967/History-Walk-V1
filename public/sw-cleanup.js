// sw-cleanup.js — chargé par le service worker (workbox.importScripts, vite.config.js).
//
// Supprime, à l'activation d'un nouveau service worker, les caches que plus
// aucune route Workbox n'utilise. Workbox ne le fait que pour son précache
// (`cleanupOutdatedCaches`), pas pour un cache d'exécution renommé.
//
// - `map-tiles` (jusqu'à v3.7.439) : tuiles chargées sans CORS, réponses
//   opaques que Chrome compte ~7,8 Mo chacune. Remplacé par `map-tiles-cors`.
//   À garder dans la liste : un appareil resté longtemps sans mise à jour peut
//   encore l'avoir.
//
// L'activation a lieu une fois l'ancien service worker parti : plus rien ne
// remplira ces caches ensuite. Les métadonnées d'expiration de Workbox
// (IndexedDB `workbox-expiration`, quelques Ko) restent, exprès : les retirer
// obligerait à dépendre du format interne de Workbox.
const OBSOLETE_CACHES = ['map-tiles'];

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all(OBSOLETE_CACHES.map((name) => caches.delete(name)))
            // Nettoyage au mieux : un échec ne doit jamais gêner l'activation.
            .catch(() => {})
    );
});
