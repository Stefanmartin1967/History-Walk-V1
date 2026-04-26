/**
 * topbar_v2.visual.js
 * Tests E2E desktop du nouveau topbar (refonte Claude Design — PR 3).
 *
 * Couvre :
 *  - Sélecteur de destination visible (Djerba)
 *  - Bouton Filtres présent avec label "Filtres" par défaut
 *  - Compteur "Filtres (n)" dynamique : sélection d'une zone → "Filtres (1)"
 *  - Bouton Filtres ouvre/ferme le panneau
 *  - Anciens boutons retirés (#btn-filter-zones, #btn-categories, #btn-filter-vus, etc.)
 */

import { test, expect } from '@playwright/test';

const LOAD_TIMEOUT = 20000;

test.describe('Desktop — Topbar v2 (refonte)', () => {

    test.beforeEach(async ({ page, isMobile }) => {
        test.skip(isMobile, 'Tests desktop uniquement');

        await page.addInitScript(() => {
            localStorage.setItem('hw_welcome_seen', '1');
        });

        await page.goto('/');
        await page.waitForSelector('.leaflet-marker-icon', { timeout: LOAD_TIMEOUT });
        await page.waitForTimeout(800);
    });

    // ─── Test 1 : Sélecteur de destination ────────────────────────────────────

    test('1 — sélecteur de destination affiche "Djerba"', async ({ page }) => {
        const selector = page.locator('#hw-dest-selector');
        await expect(selector).toBeVisible();
        await expect(page.locator('#hw-dest-selector-name')).toHaveText('Djerba');
        // Overline "HISTORY WALK"
        await expect(page.locator('.hw-dest-selector-overline')).toHaveText('HISTORY WALK');
    });

    // ─── Test 2 : Bouton Filtres par défaut ───────────────────────────────────

    test('2 — bouton Filtres affiche "Filtres" sans compteur quand aucun filtre actif', async ({ page }) => {
        const label = page.locator('#hw-topbar-filters-label');
        await expect(label).toHaveText('Filtres');
        await expect(page.locator('#hw-topbar-filters-btn')).not.toHaveClass(/is-active/);
    });

    // ─── Test 3 : Compteur dynamique ──────────────────────────────────────────

    test('3 — compteur passe à "Filtres (1)" après sélection d\'une zone', async ({ page }) => {
        // Ouvrir le panneau
        await page.locator('#hw-topbar-filters-btn').click();
        await page.waitForSelector('#hw-filter-panel.is-open', { timeout: 3000 });

        // Sélection d'une zone
        await page.locator('#hw-fp-zone-select').click();
        await page.locator('.hw-fp-zone-btn').nth(1).click();
        await page.waitForTimeout(300);

        await expect(page.locator('#hw-topbar-filters-label')).toHaveText('Filtres (1)');
        await expect(page.locator('#hw-topbar-filters-btn')).toHaveClass(/is-active/);

        // Reset → revient à "Filtres" sans compteur
        await page.locator('#hw-fp-reset').click();
        await page.waitForTimeout(300);
        await expect(page.locator('#hw-topbar-filters-label')).toHaveText('Filtres');
        await expect(page.locator('#hw-topbar-filters-btn')).not.toHaveClass(/is-active/);
    });

    // ─── Test 4 : Toggle ouvre/ferme le panneau ───────────────────────────────

    test('4 — clic sur Filtres ouvre puis re-clic ferme le panneau', async ({ page }) => {
        const btn = page.locator('#hw-topbar-filters-btn');
        const panel = page.locator('#hw-filter-panel');

        await btn.click();
        await expect(panel).toHaveClass(/is-open/);

        await btn.click();
        await page.waitForTimeout(300);
        await expect(panel).not.toHaveClass(/is-open/);
    });

    // ─── Test 5 : Anciens boutons retirés ─────────────────────────────────────

    test('5 — anciens boutons filtres absents du DOM', async ({ page }) => {
        await expect(page.locator('#btn-filter-zones')).toHaveCount(0);
        await expect(page.locator('#btn-categories')).toHaveCount(0);
        await expect(page.locator('#btn-filter-vus')).toHaveCount(0);
        await expect(page.locator('#btn-filter-planifies')).toHaveCount(0);
        await expect(page.locator('#btn-filter-nonverifies')).toHaveCount(0);
        await expect(page.locator('#zonesMenu')).toHaveCount(0);
        await expect(page.locator('#categoriesMenu')).toHaveCount(0);
        // L'entrée temporaire du menu Outils a aussi été retirée
        await expect(page.locator('#btn-new-filters')).toHaveCount(0);
        // L'ancien titre #app-title remplacé par le sélecteur de destination
        await expect(page.locator('#app-title')).toHaveCount(0);
    });

    // ─── PR 4 : dropdown destinations ─────────────────────────────────────────

    test('6 — dropdown destinations fermé par défaut', async ({ page }) => {
        await expect(page.locator('#hw-dest-menu')).toBeHidden();
        await expect(page.locator('#hw-dest-selector')).toHaveAttribute('aria-expanded', 'false');
    });

    test('7 — clic sur le sélecteur ouvre le dropdown + chevron rotate', async ({ page }) => {
        const selector = page.locator('#hw-dest-selector');
        const menu = page.locator('#hw-dest-menu');

        await selector.click();
        await expect(menu).toBeVisible();
        await expect(selector).toHaveAttribute('aria-expanded', 'true');
        await expect(selector).toHaveClass(/is-open/);
    });

    test('8 — dropdown contient Djerba active + Hammamet/Agadir désactivés', async ({ page }) => {
        await page.locator('#hw-dest-selector').click();
        await page.waitForSelector('#hw-dest-menu:visible', { timeout: 2000 });

        // Djerba : active
        const djerba = page.locator('.hw-dest-item[data-dest="djerba"]');
        await expect(djerba).toHaveClass(/is-active/);
        await expect(djerba.locator('.hw-dest-item-name')).toHaveText('Djerba');
        await expect(djerba.locator('.hw-dest-item-check')).toBeVisible();

        // Hammamet : désactivé, badge "Bientôt"
        const hammamet = page.locator('.hw-dest-item[data-dest="hammamet"]');
        await expect(hammamet).toHaveClass(/is-disabled/);
        await expect(hammamet).toHaveAttribute('aria-disabled', 'true');
        await expect(hammamet.locator('.hw-dest-item-name')).toHaveText('Hammamet');
        await expect(hammamet.locator('.hw-dest-item-badge')).toHaveText('Bientôt');

        // Agadir : désactivé
        const agadir = page.locator('.hw-dest-item[data-dest="agadir"]');
        await expect(agadir).toHaveClass(/is-disabled/);
        await expect(agadir.locator('.hw-dest-item-name')).toHaveText('Agadir');
        await expect(agadir.locator('.hw-dest-item-sub')).toHaveText('Maroc');

        // Footer
        await expect(page.locator('.hw-dest-menu-footer')).toContainText("D'autres destinations à venir");
    });

    test('9 — clic sur Djerba (active) ferme le dropdown', async ({ page }) => {
        await page.locator('#hw-dest-selector').click();
        await page.waitForSelector('#hw-dest-menu:visible', { timeout: 2000 });

        await page.locator('.hw-dest-item[data-dest="djerba"]').click();
        await page.waitForTimeout(200);

        await expect(page.locator('#hw-dest-menu')).toBeHidden();
        await expect(page.locator('#hw-dest-selector')).toHaveAttribute('aria-expanded', 'false');
    });

    test('10 — clic en dehors ferme le dropdown', async ({ page }) => {
        await page.locator('#hw-dest-selector').click();
        await page.waitForSelector('#hw-dest-menu:visible', { timeout: 2000 });

        // Clic sur la carte (largement en dehors du sélecteur et du menu)
        await page.locator('.leaflet-container').click({ position: { x: 600, y: 400 }, force: true });
        await page.waitForTimeout(200);

        await expect(page.locator('#hw-dest-menu')).toBeHidden();
    });

    test('11 — Escape ferme le dropdown', async ({ page }) => {
        await page.locator('#hw-dest-selector').click();
        await page.waitForSelector('#hw-dest-menu:visible', { timeout: 2000 });

        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);

        await expect(page.locator('#hw-dest-menu')).toBeHidden();
    });

});
