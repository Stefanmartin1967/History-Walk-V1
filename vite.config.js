import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path'; // 1. Ajout de l'import pour gérer les chemins

export default defineConfig({
  // Le nom exact de votre dépôt GitHub
  base: '/History-Walk-V1/',

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
      base: '/History-Walk-V1/',
      scope: '/History-Walk-V1/',

      manifest: false, // On utilise public/manifest.json manuellement
      workbox: {
        // Les fichiers .geojson sont exclus du precache (CacheFirst trop agressif)
        // et gérés en NetworkFirst via runtimeCaching ci-dessous.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        // Limite élevée pour les grandes images (badges, gamification : jusqu'à ~8 MB)
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
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
        ],
      }
    })
  ],

  // 2. AJOUT : Configuration multi-pages pour Rollup
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        scout: resolve(__dirname, 'tools/scout.html'),
        datamanager: resolve(__dirname, 'history_walk_datamanager/index.html'),
      },
    },
  },
});
