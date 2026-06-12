import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path'; // 1. Ajout de l'import pour gérer les chemins

export default defineConfig({
  // Le nom exact de votre dépôt GitHub
  base: '/',

  plugins: [
    // En dev seulement : Vite HMR injecte des styles inline qui frappent la CSP stricte.
    // On autorise 'unsafe-inline' uniquement pour `vite serve`. En build, la CSP reste strict.
    {
      name: 'csp-dev-relax',
      transformIndexHtml(html, ctx) {
        if (ctx.server) {
          return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");
        }
        return html;
      }
    },
    VitePWA({
      registerType: 'prompt',
      base: '/',
      scope: '/',

      manifest: false, // On utilise public/manifest.json manuellement
      workbox: {
        // Les fichiers .geojson sont exclus du precache (CacheFirst trop agressif)
        // et gérés en NetworkFirst via runtimeCaching ci-dessous.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,webp}'],
        // og-image.png (720 KB) : utilisée par les scrapers sociaux, inutile hors-ligne.
        // screenshots/ : fiche d'installation PWA uniquement, inutile hors-ligne.
        globIgnores: ['**/og-image.png', '**/screenshots/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Les .gpx (partage/téléchargement de circuit) ne doivent PAS être happés
        // par le navigateFallback → sinon scanner le QR d'un circuit (qui pointe
        // vers …/circuits/x.gpx) sert l'app (index.html) au lieu du fichier, et HW
        // s'ouvre sur « Mes Circuits » vide. On les laisse passer au réseau.
        // Idem pour /lieux/ : pages SEO statiques générées post-build (hook
        // npm postbuild → scripts/generate-poi-pages.mjs), servies par le
        // réseau — sinon un utilisateur avec l'app installée qui clique un
        // lien Google recevrait index.html au lieu de la page du lieu.
        navigateFallbackDenylist: [/\.gpx(\?.*)?$/i, /^\/lieux\//],
        runtimeCaching: [
          {
            // GeoJSON : NetworkFirst — données éditoriales qui évoluent
            urlPattern: /\.geojson(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'geojson-data',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 jours
              },
            },
          },
          {
            // Circuits officiels et config destinations : NetworkFirst
            // Remplace le double-fetch manuel avec ?t=Date.now() dans app-startup.js
            urlPattern: /\/(circuits\/[^?]+\.json|destinations\.json)(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-data',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 jours
              },
            },
          },
          {
            // Tuiles de carte (OSM « Plan », CARTO « Voyager » par défaut, Google
            // « Satellite ») : CacheFirst — une tuile vue une fois reste dispo hors
            // ligne. C'est ce qui permet le « pack terrain » PASSIF : on prépare un
            // circuit chez soi (les tuiles de la zone se chargent) → sur le terrain
            // elles sont déjà là, carte lisible même sans réseau. Cf. map.js.
            //
            // ⚠ Les tuiles sont chargées par Leaflet via <img> SANS crossorigin →
            // requêtes no-cors → réponses OPAQUES (status 0). Workbox ne met en
            // cache que les 200 par défaut : sans `statuses: [0, 200]` le cache
            // resterait VIDE en silence. Revers : une réponse opaque est « paddée »
            // à ~7 Mo dans la comptabilité du quota (taille réelle stockée = petite)
            // → maxEntries volontairement modéré + purgeOnQuotaError pour que ce
            // cache s'auto-purge sous pression plutôt que d'évincer les autres.
            urlPattern: /^https:\/\/(?:[a-c]\.tile\.openstreetmap\.org|[a-d]\.basemaps\.cartocdn\.com|mt[0-3]\.google\.com)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 256,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 jours
                purgeOnQuotaError: true,
              },
            },
          },
          {
            // Photos de POI (same-origin /photos/*.jpg, servies par GitHub Pages) :
            // CacheFirst. Réponses 200 classiques (pas opaques) → pas de padding
            // quota. Une fois une fiche consultée, ses photos restent hors ligne.
            urlPattern: /\/photos\/[^?]+\.jpg(\?.*)?$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'poi-photos',
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 jours
                purgeOnQuotaError: true,
              },
            },
          },
        ],
      }
    })
  ],

  // Réunification (12/06/2026) : le Scout et le Data Manager autonomes ont été
  // supprimés (remplacés par le Scout in-app et le Mode Données). Plus qu'une
  // seule entrée — l'app principale.
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
