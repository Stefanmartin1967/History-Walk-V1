/**
 * legal_notice.visual.js
 * Tests E2E desktop pour la modale Mentions légales.
 */

import { test, expect } from '@playwright/test';

const LOAD_TIMEOUT = 20000;

test.describe('Desktop — Mentions légales', () => {

    test.beforeEach(async ({ page, isMobile }) => {
        test.skip(isMobile, 'Tests desktop uniquement');

        await page.addInitScript(() => {
            localStorage.setItem('hw_welcome_seen', '1');
        });

        await page.goto('/');
        await page.waitForSelector('.leaflet-marker-icon', { timeout: LOAD_TIMEOUT });
        await page.waitForTimeout(800);
    });

    test('1 — entrée "Mentions légales" présente dans le menu Outils', async ({ page }) => {
        await page.locator('#btn-tools-menu').click();
        await page.waitForSelector('#btn-legal-notice', { state: 'visible', timeout: 3000 });
        await expect(page.locator('#btn-legal-notice')).toContainText('Mentions légales');
    });

    test('2 — clic ouvre la modale avec le bon contenu', async ({ page }) => {
        await page.locator('#btn-tools-menu').click();
        await page.waitForSelector('#btn-legal-notice', { state: 'visible', timeout: 3000 });
        await page.locator('#btn-legal-notice').click();

        // La modale doit apparaître (système V2 hw-modal)
        const modal = page.locator('.hw-modal-overlay.is-active');
        await expect(modal).toBeVisible({ timeout: 3000 });

        // Titre
        await expect(modal.locator('.hw-modal-title')).toHaveText('Mentions légales');

        // Copyright
        await expect(modal).toContainText('© 2026 Stefan Martin');
        await expect(modal).toContainText('Tous droits réservés');

        // Sections clés
        await expect(modal).toContainText('Propriété intellectuelle');
        await expect(modal).toContainText('Données cartographiques');
        await expect(modal).toContainText('Contact');

        // ODbL
        await expect(modal).toContainText('ODbL');
        await expect(modal).toContainText('OpenStreetMap');

        // Email
        await expect(modal.locator('a[href="mailto:history.walk.007@gmail.com"]')).toBeVisible();
    });

    test('3 — croix du header referme la modale', async ({ page }) => {
        await page.locator('#btn-tools-menu').click();
        await page.locator('#btn-legal-notice').click();
        await expect(page.locator('.hw-modal-overlay.is-active')).toBeVisible({ timeout: 3000 });

        // legal-modal.js ouvre avec footer:false → fermeture via la croix du header
        await page.locator('.hw-modal-close').click();
        await page.waitForTimeout(400);

        await expect(page.locator('.hw-modal-overlay.is-active')).not.toBeVisible();
    });

    test('4 — attribution OSM visible (bottom-left, non masquée)', async ({ page }) => {
        const attribution = page.locator('.leaflet-control-attribution');
        await expect(attribution).toBeVisible();
        await expect(attribution).toContainText('OpenStreetMap');
        // Lien cliquable vers la page copyright OSM (ODbL info)
        await expect(attribution.locator('a[href*="openstreetmap.org/copyright"]')).toBeVisible();
    });

});
