/**
 * poi_details.visual.js
 * Tests E2E desktop du panneau POI details (ui-details.js + templates.js).
 *
 * Flow couverts :
 *  1. Clic marker → panneau details devient actif + titre visible
 *  2. Toggle Visité ON → classe is-on appliquée
 *  3. Toggle Visité OFF → classe is-on retirée (round-trip)
 *  4. Toggle Incontournable → classe is-on appliquée
 *  5. Notes : saisie + reload page → IndexedDB persistance vérifiée
 *  6. Bouton fermer → panneau plus actif
 *
 * Note Leaflet : on utilise `click({ force: true })` sur les markers car ils
 * peuvent se chevaucher au zoom initial — Playwright refuse sinon avec
 * "intercepts pointer events". Leaflet bind via DOM listener sur l'élément,
 * donc le clic forcé déclenche bien le handler.
 */

import { test, expect } from '@playwright/test';

const LOAD_TIMEOUT = 20000;

test.describe('Desktop — POI details panel', () => {

    test.beforeEach(async ({ page, isMobile }) => {
        test.skip(isMobile, 'Tests desktop uniquement');

        // Skip welcome screen
        await page.addInitScript(() => {
            localStorage.setItem('hw_welcome_seen', '1');
        });

        await page.goto('/');
        await page.waitForSelector('.leaflet-container', { timeout: LOAD_TIMEOUT });
        await page.waitForSelector('.leaflet-marker-icon', { timeout: LOAD_TIMEOUT });
        await page.waitForTimeout(800); // stabilisation rendering markers
    });

    // ─── Test 1 : Ouverture du panneau via clic marker ─────────────────────────

    test('1 — clic sur un marker ouvre le panneau details (active + titre)', async ({ page }) => {
        await page.locator('.leaflet-marker-icon').first().click({ force: true });
        await page.waitForSelector('#details-panel.active', { timeout: 5000 });

        await expect(page.locator('#details-panel')).toHaveClass(/active/);
        await expect(page.locator('#panel-title-fr')).toBeVisible();
        const title = await page.locator('#panel-title-fr').textContent();
        expect(title?.trim().length).toBeGreaterThan(0);
    });

    // ─── Test 2 : Toggle Visité ON ─────────────────────────────────────────────

    test('2 — toggle Visité ON applique la classe is-on', async ({ page }) => {
        await page.locator('.leaflet-marker-icon').first().click({ force: true });
        await page.waitForSelector('#poi-toggle-vu', { timeout: 5000 });

        const toggle = page.locator('#poi-toggle-vu');
        const wasOn = await toggle.evaluate(el => el.classList.contains('is-on'));

        await toggle.click();
        await page.waitForTimeout(300); // attendre savePoiData async

        const isOnAfter = await toggle.evaluate(el => el.classList.contains('is-on'));
        expect(isOnAfter).toBe(!wasOn);
    });

    // ─── Test 3 : Toggle Visité round-trip (ON puis OFF) ───────────────────────

    test('3 — toggle Visité OFF retire la classe is-on (round-trip)', async ({ page }) => {
        await page.locator('.leaflet-marker-icon').first().click({ force: true });
        await page.waitForSelector('#poi-toggle-vu', { timeout: 5000 });

        const toggle = page.locator('#poi-toggle-vu');

        // Garantir l'état initial OFF (clic seulement si is-on présent)
        const initiallyOn = await toggle.evaluate(el => el.classList.contains('is-on'));
        if (initiallyOn) {
            await toggle.click();
            await page.waitForTimeout(300);
        }

        // ON
        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).toHaveClass(/is-on/);

        // OFF
        await toggle.click();
        await page.waitForTimeout(300);
        await expect(toggle).not.toHaveClass(/is-on/);
    });

    // ─── Test 4 : Toggle Incontournable ────────────────────────────────────────

    test('4 — toggle Incontournable applique la classe is-on', async ({ page }) => {
        await page.locator('.leaflet-marker-icon').first().click({ force: true });
        await page.waitForSelector('#poi-toggle-incontournable', { timeout: 5000 });

        const toggle = page.locator('#poi-toggle-incontournable');
        const wasOn = await toggle.evaluate(el => el.classList.contains('is-on'));

        await toggle.click();
        await page.waitForTimeout(300);

        const isOnAfter = await toggle.evaluate(el => el.classList.contains('is-on'));
        expect(isOnAfter).toBe(!wasOn);

        // Cleanup : remettre l'état initial pour ne pas polluer les autres tests
        await toggle.click();
        await page.waitForTimeout(300);
    });

    // ─── Test 5 : Persistance IndexedDB après reload complet ───────────────────

    test('5 — notes saisies persistent après reload complet de la page', async ({ page }) => {
        await page.locator('.leaflet-marker-icon').first().click({ force: true });
        await page.waitForSelector('#poi-notes-area', { timeout: 5000 });

        // Capturer l'identité du POI ouvert pour le retrouver après reload
        const poiTitle = (await page.locator('#panel-title-fr').textContent())?.trim();
        expect(poiTitle && poiTitle.length).toBeGreaterThan(0);

        const noteText = `Test note ${Date.now()}`;
        const notesArea = page.locator('#poi-notes-area');
        const initialValue = await notesArea.inputValue();

        await notesArea.fill(noteText);
        await notesArea.blur(); // updatePoiData immédiat (pas le path debounce)
        await page.waitForTimeout(1200); // savePoiData → IndexedDB (durable avant reload, marge sous charge parallèle)

        // Reload complet — teste réellement la persistance IndexedDB
        await page.reload();
        await page.waitForSelector('.leaflet-marker-icon', { timeout: LOAD_TIMEOUT });
        await page.waitForTimeout(800);

        // Rouvrir le même POI via le title du marker
        await page.locator(`.leaflet-marker-icon[title="${poiTitle}"]`).first().click({ force: true });
        await page.waitForSelector('#poi-notes-area', { timeout: 5000 });

        const persistedValue = await page.locator('#poi-notes-area').inputValue();
        expect(persistedValue).toBe(noteText);

        // Cleanup : restaurer l'état initial
        await page.locator('#poi-notes-area').fill(initialValue);
        await page.locator('#poi-notes-area').blur();
        await page.waitForTimeout(400);
    });

    // ─── Test 6 : Fermeture via bouton X ───────────────────────────────────────

    test('6 — bouton fermer désactive le panneau details', async ({ page }) => {
        await page.locator('.leaflet-marker-icon').first().click({ force: true });
        await page.waitForSelector('#details-panel.active', { timeout: 5000 });

        await page.locator('#close-details-button').click();
        await page.waitForTimeout(400);

        await expect(page.locator('#details-panel')).not.toHaveClass(/active/);
    });

});
