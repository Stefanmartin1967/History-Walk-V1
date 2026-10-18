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
        //
        // destinations.json + circuits/*.json + poi-categories.json : EXCLUS du
        // précache. Étant des .json, ils étaient happés par globPatterns →
        // précachés (CacheFirst figé à la build), et le précache GAGNE sur le
        // NetworkFirst ci-dessous → la config restait PÉRIMÉE jusqu'à activation
        // d'un nouveau SW (bug observé : nouvelle vue d'ouverture/devise non vues
        // après déploiement — poi-categories.json avait le même piège, sans même
        // ce filet, cf. renommage Marabout→Mausolée du 15/08/2026). En les
        // ignorant, ils tombent sur le NetworkFirst 'app-data' (même traitement
        // que .geojson) → frais à chaque boot online, fallback cache hors-ligne.
        globIgnores: ['**/og-image.png', '**/screenshots/**', '**/destinations.json', '**/circuits/*.json', '**/poi-categories.json'],
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
        // Script chargé par le service worker avant Workbox : supprime, à
        // l'activation, les caches que plus aucune route n'utilise (ex. l'ancien
        // `map-tiles`, cf. tuiles plus bas). Fichier de public/ → copié à la
        // racine de dist/, à côté de sw.js. ⚠ S'il manquait au déploiement, le
        // nouveau SW échouerait à s'installer et plus aucune mise à jour
        // n'arriverait : tests/sw_cleanup.test.js le garde.
        importScripts: ['sw-cleanup.js'],
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
            // Circuits officiels, config destinations et taxonomie POI : NetworkFirst
            // Remplace le double-fetch manuel avec ?t=Date.now() dans app-startup.js
            urlPattern: /\/(circuits\/[^?]+\.json|destinations\.json|poi-categories\.json)(\?.*)?$/,
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
            // Tuiles de carte (CARTO « Voyager » par défaut, OSM « Plan », OSM
            // France « Plan (FR) », Google « Satellite ») : CacheFirst — une tuile
            // vue une fois reste dispo hors ligne. C'est ce qui permet le « pack
            // terrain » PASSIF : on prépare un circuit chez soi (les tuiles de la
            // zone se chargent) → sur le terrain elles sont déjà là, carte lisible
            // même sans réseau. Cf. map.js.
            //
            // Tuiles chargées en CORS (`crossOrigin: true` dans map.js) depuis le
            // 18/10/2026 → réponses 200 lisibles, comptées par Chrome à leur poids
            // réel (quelques Ko par tuile, mesuré). Avant, Leaflet les chargeait SANS
            // crossorigin → réponses OPAQUES (status 0, d'où l'ancien
            // `statuses: [0, 200]`), que Chrome compte ~7,8 Mo chacune dans le
            // quota : 2,2 Go affichés pour heripia.com. `statuses: [200]` : une
            // tuile en erreur (404, panne) n'est plus gardée 30 jours, son vrai
            // code étant maintenant visible (une réponse opaque le masquait).
            //
            // Nom changé (`map-tiles` → `map-tiles-cors`) : une tuile opaque déjà
            // en cache, resservie à une <img crossorigin>, ne s'affiche PAS (mesuré
            // sur les 4 serveurs). L'ancien cache est supprimé à l'activation du SW
            // par public/sw-cleanup.js (cf. importScripts plus haut).
            //
            // maxEntries 256 : n'est plus imposé par le gonflement du quota ; le
            // relever est une décision à part. purgeOnQuotaError : ce cache, le plus
            // facile à reconstituer, part en premier si le quota sature.
            urlPattern: /^https:\/\/(?:[a-c]\.tile\.openstreetmap\.org|[a-c]\.tile\.openstreetmap\.fr|[a-d]\.basemaps\.cartocdn\.com|mt[0-3]\.google\.com)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles-cors',
              cacheableResponse: { statuses: [200] },
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
