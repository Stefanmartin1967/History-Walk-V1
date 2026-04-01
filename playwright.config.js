import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.visual.js',
  snapshotDir: './tests/visual/snapshots',

  use: {
    baseURL: 'http://localhost:5173/History-Walk-V1/',
    screenshot: 'only-on-failure',
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
