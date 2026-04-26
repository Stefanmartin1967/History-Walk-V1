/**
 * filter_panel.visual.js
 * Tests E2E du nouveau panneau de filtres unifié (PR 1 — foundation).
 * Couvre uniquement la section Localisation (les autres sont des stubs en PR 1).
 */

import { test, expect } from '@playwright/test';

const LOAD_TIMEOUT = 20000;

test.describe('Desktop — Nouveau panneau de filtres', () => {

    test.beforeEach(async ({ page, isMobile }) => {
        test.skip(isMobile, 'Tests desktop uniquement');

        await page.addInitScript(() => {
            localStorage.setItem('hw_welcome_seen', '1');
        });

        await page.goto('/');
        await page.waitForSelector('.leaflet-marker-icon', { timeout: LOAD_TIMEOUT });
        await page.waitForTimeout(800);
    });

    async function openPanelViaToolsMenu(page) {
        await page.locator('#btn-tools-menu').click();
        await page.waitForSelector('#btn-new-filters', { state: 'visible', timeout: 3000 });
        await page.locator('#btn-new-filters').click();
        await page.waitForSelector('#hw-filter-panel.is-open', { timeout: 3000 });
    }

    test('1 — bouton "Nouveaux filtres" du menu Outils ouvre le panneau', async ({ page }) => {
        await openPanelViaToolsMenu(page);
        await expect(page.locator('#hw-filter-panel')).toHaveClass(/is-open/);
        await expect(page.locator('.hw-fp-title')).toHaveText('Filtres');
        await expect(page.locator('#hw-fp-subtitle')).toHaveText('Aucun filtre actif');
    });

    test('2 — clic sur la croix ferme le panneau', async ({ page }) => {
        await openPanelViaToolsMenu(page);
        await page.locator('#hw-fp-close').click();
        await page.waitForTimeout(300);
        await expect(page.locator('#hw-filter-panel')).not.toHaveClass(/is-open/);
    });

    test('3 — clic sur le select Localisation ouvre la liste des zones', async ({ page }) => {
        await openPanelViaToolsMenu(page);
        await page.locator('#hw-fp-zone-select').click();
        await page.waitForSelector('#hw-fp-zones-list.is-open', { timeout: 2000 });
        // "Toutes les zones" doit toujours figurer
        await expect(page.locator('.hw-fp-zone-btn').first()).toContainText('Toutes les zones');
    });

    test('4 — sélection d\'une zone applique le filtre + met à jour le sous-titre', async ({ page }) => {
        await openPanelViaToolsMenu(page);
        await page.locator('#hw-fp-zone-select').click();
        await page.waitForSelector('#hw-fp-zones-list.is-open', { timeout: 2000 });

        // Cliquer sur la 2e zone (la 1ère étant "Toutes les zones")
        const zoneButtons = page.locator('.hw-fp-zone-btn');
        const count = await zoneButtons.count();
        expect(count).toBeGreaterThan(1);
        const targetBtn = zoneButtons.nth(1);
        const targetLabel = (await targetBtn.locator('span').first().textContent())?.trim();

        await targetBtn.click();
        await page.waitForTimeout(300);

        // Sous-titre passe à "1 section active"
        await expect(page.locator('#hw-fp-subtitle')).toHaveText('1 section active');
        // Section Localisation badge "Actif"
        await expect(page.locator('[data-section="localisation"] .hw-fp-section-badge-active')).toBeVisible();
        // Reset bouton activé
        await expect(page.locator('#hw-fp-reset')).toBeEnabled();
        // Le label du select reflète la zone choisie
        await expect(page.locator('#hw-fp-zone-value')).toHaveText(targetLabel || '');
    });

    test('5 — bouton "Tout réinitialiser" remet la zone à null', async ({ page }) => {
        await openPanelViaToolsMenu(page);

        // Sélection d'une zone
        await page.locator('#hw-fp-zone-select').click();
        await page.locator('.hw-fp-zone-btn').nth(1).click();
        await page.waitForTimeout(300);

        // Reset
        await page.locator('#hw-fp-reset').click();
        await page.waitForTimeout(300);

        await expect(page.locator('#hw-fp-subtitle')).toHaveText('Aucun filtre actif');
        await expect(page.locator('#hw-fp-zone-value')).toHaveText('Toutes les zones');
        await expect(page.locator('#hw-fp-reset')).toBeDisabled();
    });

    test('6 — clic sur header de section toggle son pli', async ({ page }) => {
        await openPanelViaToolsMenu(page);
        const section = page.locator('[data-section="categories"]');

        // Initialement déplié (pas de class is-collapsed)
        await expect(section).not.toHaveClass(/is-collapsed/);

        // Clic header → replié
        await page.locator('[data-section-toggle="categories"]').click();
        await page.waitForTimeout(200);
        await expect(section).toHaveClass(/is-collapsed/);

        // Clic header → déplié à nouveau
        await page.locator('[data-section-toggle="categories"]').click();
        await page.waitForTimeout(200);
        await expect(section).not.toHaveClass(/is-collapsed/);
    });

});
