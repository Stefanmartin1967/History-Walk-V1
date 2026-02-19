import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path'; // 1. Ajout de l'import pour gérer les chemins

export default defineConfig({
  // Le nom exact de votre dépôt GitHub
  base: '/History-Walk-V1/',

  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      base: '/History-Walk-V1/',
      scope: '/History-Walk-V1/',

      manifest: false, // On utilise public/manifest.json manuellement
      workbox: {
        // Ajout explicite pour être sûr que fusion.html est mis en cache
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,geojson}'],
        // Augmentation de la limite pour djerba.geojson (4.88MB+)
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 // 6 MiB
      }
    })
  ],

  // 2. AJOUT : Configuration multi-pages pour Rollup
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        fusion: resolve(__dirname, 'tools/fusion.html'),
        scout: resolve(__dirname, 'tools/scout.html'),
      },
    },
  },
});
