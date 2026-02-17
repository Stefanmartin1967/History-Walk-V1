import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path'; // 1. Ajout de l'import pour gérer les chemins

export default defineConfig({
  // Le nom exact de votre dépôt GitHub
  base: '/history-walk/', 

  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      base: '/history-walk/', 
      scope: '/history-walk/',

      manifest: false, // On utilise public/manifest.json manuellement
      workbox: {
        // Ajout explicite pour être sûr que fusion.html est mis en cache
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,geojson}']
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
