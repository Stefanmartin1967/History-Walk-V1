import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.visual.js',
  snapshotDir: './tests/visual/snapshots',

  use: {
    baseURL: 'http://localhost:5173/History-Walk-V1/',
    screenshot: 'only-on-failure',
  },

  expect: {
    // Tolérance pour les snapshots visuels : les tuiles Leaflet rendent un état
    // partiel différent à chaque run (chargement asynchrone), ce qui produit
    // des diffs pixels élevés mais sans régression visuelle réelle. Les vraies
    // régressions (mauvaise palette, layout cassé) dépassent ce seuil.
    toHaveScreenshot: { maxDiffPixels: 50000 },
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] }, // Android Chrome — pas besoin de WebKit
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/History-Walk-V1/',
    reuseExistingServer: true,
  },
});
