import { test, expect } from '@playwright/test';

const LOAD_TIMEOUT = 15000;

// ─── Tests Desktop (viewport 1280x800) ───────────────────────────────────────
// La carte Leaflet est uniquement en mode PC

test.describe('Desktop', () => {

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'Tests desktop uniquement sur le projet desktop');
    await page.goto('/');
    await page.waitForSelector('.leaflet-container', { timeout: LOAD_TIMEOUT });
    await page.waitForTimeout(1500);
  });

  test('carte principale', async ({ page }) => {
    await expect(page).toHaveScreenshot('desktop-carte.png');
  });

  test('panneau liste circuits', async ({ page }) => {
    await page.click('#btn-open-my-circuits');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('desktop-circuits.png');
  });

  test('panneau détails POI', async ({ page }) => {
    const marker = page.locator('.leaflet-marker-icon').first();
    await marker.click();
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('desktop-poi-details.png');
  });

});

// ─── Tests Mobile (Pixel 5 — viewport 393x851) ───────────────────────────────
// Mode encyclopédique : pas de carte, circuits sur Wikiloc

test.describe('Mobile', () => {

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Tests mobile uniquement sur le projet mobile');
    await page.goto('/');
    await page.waitForSelector('.mobile-nav', { timeout: LOAD_TIMEOUT });
    await page.waitForTimeout(1000);
  });

  test('vue liste circuits (défaut)', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Tests mobile uniquement sur le projet mobile');
    await expect(page).toHaveScreenshot('mobile-circuits.png');
  });

  test('vue menu', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Tests mobile uniquement sur le projet mobile');
    await page.click('[data-view="actions"]');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('mobile-menu.png');
  });

  test('vue recherche', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Tests mobile uniquement sur le projet mobile');
    await page.click('[data-view="search"]');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('mobile-recherche.png');
  });

});
