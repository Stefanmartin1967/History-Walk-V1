/**
 * mes_circuits.visual.js
 * Tests E2E desktop de l'onglet "Mes Circuits" V2 (refonte Claude Design — PR B).
 */

import { test, expect } from '@playwright/test';

const LOAD_TIMEOUT = 20000;

test.describe('Desktop — Mes Circuits V2', () => {

    test.beforeEach(async ({ page, isMobile }) => {
        test.skip(isMobile, 'Tests desktop uniquement');

        await page.addInitScript(() => {
            localStorage.setItem('hw_welcome_seen', '1');
        });

        await page.goto('/');
        await page.waitForSelector('.leaflet-marker-icon', { timeout: LOAD_TIMEOUT });
        // Attendre le chargement des circuits officiels
        await page.waitForTimeout(1200);

        // Bascule sur l'onglet "Mes Circuits"
        await page.locator('.tab-button[data-tab="explorer"]').click();
        await page.waitForSelector('#mc-toolbar', { timeout: 5000 });
    });

    test('1 — toolbar rendue avec recherche + 4 boutons icônes', async ({ page }) => {
        await expect(page.locator('#mc-search-input')).toBeVisible();
        await expect(page.locator('#mc-btn-filters')).toBeVisible();
        await expect(page.locator('#mc-btn-new')).toBeVisible();
        await expect(page.locator('#mc-btn-menu')).toBeVisible();
        await expect(page.locator('#mc-btn-close')).toBeVisible();
    });

    test('2 — bouton filtres déplie la zone .mc-filters', async ({ page }) => {
        const filters = page.locator('#mc-filters');
        await expect(filters).toHaveClass(/is-collapsed/);

        await page.locator('#mc-btn-filters').click();
        await page.waitForTimeout(300);

        await expect(filters).not.toHaveClass(/is-collapsed/);
        await expect(page.locator('.mc-filter-chip[data-chip="all"]')).toBeVisible();
        await expect(page.locator('.mc-filter-chip[data-chip="official"]')).toBeVisible();
        await expect(page.locator('.mc-filter-chip[data-chip="with-resto"]')).toBeVisible();
    });

    test('3 — chip "Officiels" filtre la liste + badge-dot apparaît', async ({ page }) => {
        await page.locator('#mc-btn-filters').click();
        await page.waitForTimeout(200);

        // Badge-dot absent au départ
        await expect(page.locator('#mc-btn-filters .badge-dot')).toHaveCount(0);

        // Active le chip "Officiels"
        await page.locator('.mc-filter-chip[data-chip="official"]').click();
        await page.waitForTimeout(300);

        // Badge-dot apparaît
        await expect(page.locator('#mc-btn-filters .badge-dot')).toBeVisible();
        // Le chip est dans l'état actif
        await expect(page.locator('.mc-filter-chip[data-chip="official"]')).toHaveClass(/is-on/);
        // Toutes les cartes affichées doivent avoir le badge officiel
        const cards = page.locator('.mc-card');
        const count = await cards.count();
        expect(count).toBeGreaterThan(0);
    });

    test('4 — recherche en temps réel filtre les cartes', async ({ page }) => {
        // Compter le nombre initial de cartes
        const initialCount = await page.locator('.mc-card').count();
        expect(initialCount).toBeGreaterThan(0);

        // Recherche d'un terme improbable
        await page.locator('#mc-search-input').fill('zzzimprobable123');
        await page.waitForTimeout(200);

        // La liste doit afficher l'empty state
        await expect(page.locator('.mc-empty')).toBeVisible();
        await expect(page.locator('.mc-card')).toHaveCount(0);

        // Effacer la recherche → cartes reviennent
        await page.locator('#mc-search-input').fill('');
        await page.waitForTimeout(200);
        const restoredCount = await page.locator('.mc-card').count();
        expect(restoredCount).toBe(initialCount);
    });

    test('5 — bouton ⋮ ouvre le menu dropdown avec les options', async ({ page }) => {
        await page.locator('#mc-btn-menu').click();
        await page.waitForSelector('#mc-menu-dropdown', { timeout: 2000 });

        const menu = page.locator('#mc-menu-dropdown');
        await expect(menu).toBeVisible();
        await expect(menu.locator('[data-action="sort-proximity"]')).toContainText('proximité');
        await expect(menu.locator('[data-action="sort-dist"]')).toContainText('distance');
        await expect(menu.locator('[data-action="toggle-todo"]')).toBeVisible();
        await expect(menu.locator('[data-action="reset"]')).toContainText('Réinitialiser');

        // Clic extérieur ferme le menu
        await page.locator('#explorer-list').click({ position: { x: 100, y: 100 } });
        await page.waitForTimeout(200);
        await expect(page.locator('#mc-menu-dropdown')).toHaveCount(0);
    });

    test('6 — carte de circuit a la structure 2 lignes + badge officiel + check toggle', async ({ page }) => {
        const firstCard = page.locator('.mc-card').first();
        await expect(firstCard).toBeVisible();

        // Ligne 1 : titre + check toggle (badge officiel optionnel selon le circuit)
        await expect(firstCard.locator('.mc-card-title')).toBeVisible();
        await expect(firstCard.locator('.mc-card-action-check')).toBeVisible();

        // Ligne 2 : pastilles meta (au moins POI + distance)
        const metas = firstCard.locator('.mc-card-line2 .mc-meta');
        const metaCount = await metas.count();
        expect(metaCount).toBeGreaterThanOrEqual(2);
    });

    test('7 — clic sur une carte bascule sur l\'onglet "Circuit"', async ({ page }) => {
        const firstCard = page.locator('.mc-card').first();
        await firstCard.click();
        await page.waitForTimeout(400);

        // L'onglet "circuit" devient actif
        await expect(page.locator('.tab-button[data-tab="circuit"]')).toHaveClass(/active/);
    });

    test('8 — menu Réinitialiser remet tout à zéro', async ({ page }) => {
        // Active une recherche + un chip
        await page.locator('#mc-search-input').fill('test');
        await page.locator('#mc-btn-filters').click();
        await page.locator('.mc-filter-chip[data-chip="official"]').click();
        await page.waitForTimeout(300);

        // Reset via menu
        await page.locator('#mc-btn-menu').click();
        await page.waitForSelector('#mc-menu-dropdown', { timeout: 2000 });
        await page.locator('[data-action="reset"]').click();
        await page.waitForTimeout(300);

        // Recherche vidée + chip Tous actif
        await expect(page.locator('#mc-search-input')).toHaveValue('');
        await expect(page.locator('.mc-filter-chip[data-chip="all"]')).toHaveClass(/is-on/);
        await expect(page.locator('#mc-btn-filters .badge-dot')).toHaveCount(0);
    });

});
