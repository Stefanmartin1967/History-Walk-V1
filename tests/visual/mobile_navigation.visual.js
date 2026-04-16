/**
 * mobile_navigation.visual.js
 * Tests de navigation mobile — filet de sécurité avant refactorisation de mobile.js
 *
 * Flux testés :
 *  1. Affichage initial — liste circuits visible au démarrage
 *  2. Clic circuit → vue POI list (avec bouton Retour)
 *  3. Bouton Retour → retour à la liste circuits
 *  4. Nav "Recherche" → vue recherche active
 *  5. Nav "Menu" → vue menu active
 *  6. Retour à circuits depuis recherche via nav button
 */

import { test, expect } from '@playwright/test';

const LOAD_TIMEOUT = 20000;

// ─── Setup commun Mobile ──────────────────────────────────────────────────────

test.describe('Mobile — Navigation', () => {

    test.beforeEach(async ({ page, isMobile }) => {
        test.skip(!isMobile, 'Tests navigation uniquement sur projet mobile');

        // Éviter l'écran de bienvenue (premier lancement)
        await page.addInitScript(() => {
            localStorage.setItem('hw_welcome_seen', '1');
        });

        await page.goto('/');

        // Attendre que l'app mobile soit initialisée (dock + circuits chargés)
        await page.waitForSelector('#mobile-main-container', { timeout: LOAD_TIMEOUT });
        await page.waitForSelector('.mobile-circuit-card-wrapper', { timeout: LOAD_TIMEOUT });
        await page.waitForTimeout(500); // stabilisation animations
    });

    // ─── Test 1 : État initial ────────────────────────────────────────────────

    test('1 — liste circuits visible au démarrage', async ({ page }) => {
        // Le container principal doit exister
        await expect(page.locator('#mobile-main-container')).toBeVisible();

        // Au moins un circuit doit être affiché
        const circuits = page.locator('.mobile-circuit-card-wrapper');
        await expect(circuits.first()).toBeVisible();

        // Le dock de navigation doit être visible
        await expect(page.locator('#mobile-dock')).toBeVisible();

        // Le bouton circuits doit être actif
        const circuitsNavBtn = page.locator('.mobile-nav-btn[data-view="circuits"]');
        await expect(circuitsNavBtn).toHaveClass(/active/);
    });

    // ─── Test 2 : Clic circuit → liste POIs ──────────────────────────────────

    test('2 — clic sur un circuit affiche la liste de ses POIs', async ({ page }) => {
        // Cliquer sur le premier circuit
        const firstCircuit = page.locator('.mobile-circuit-card-wrapper').first();
        await firstCircuit.click();

        // L'en-tête POI list doit apparaître
        await page.waitForSelector('.mobile-poi-header', { timeout: 5000 });
        await expect(page.locator('.mobile-poi-header')).toBeVisible();

        // Le bouton Retour doit être présent
        await expect(page.locator('#mobile-back-btn')).toBeVisible();

        // La liste des circuits ne doit plus être visible
        await expect(page.locator('.mobile-circuits-header')).not.toBeVisible();
    });

    // ─── Test 3 : Bouton Retour → retour circuits ─────────────────────────────

    test('3 — bouton Retour restaure la liste circuits', async ({ page }) => {
        // Aller dans un circuit
        await page.locator('.mobile-circuit-card-wrapper').first().click();
        await page.waitForSelector('#mobile-back-btn', { timeout: 5000 });

        // Cliquer Retour
        await page.locator('#mobile-back-btn').click();
        await page.waitForTimeout(400); // animation

        // La liste circuits doit revenir
        await expect(page.locator('.mobile-circuit-card-wrapper').first()).toBeVisible();

        // L'en-tête POI list ne doit plus être visible
        await expect(page.locator('.mobile-poi-header')).not.toBeVisible();
    });

    // ─── Test 4 : Navigation → Recherche ─────────────────────────────────────

    test('4 — bouton Recherche affiche la vue recherche', async ({ page }) => {
        await page.locator('[data-view="search"]').click();
        await page.waitForTimeout(300);

        // Le champ de recherche mobile doit apparaître
        await expect(page.locator('#mobile-search-input')).toBeVisible();

        // Le bouton search doit être actif dans le dock
        await expect(page.locator('.mobile-nav-btn[data-view="search"]')).toHaveClass(/active/);
    });

    // ─── Test 5 : Navigation → Menu ──────────────────────────────────────────

    test('5 — bouton Menu affiche la vue menu', async ({ page }) => {
        await page.locator('[data-view="actions"]').click();
        await page.waitForTimeout(300);

        // Le container menu doit avoir du contenu
        const container = page.locator('#mobile-main-container');
        await expect(container).not.toBeEmpty();

        // Le bouton actions doit être actif
        await expect(page.locator('.mobile-nav-btn[data-view="actions"]')).toHaveClass(/active/);
    });

    // ─── Test 6 : Retour circuits depuis recherche ────────────────────────────

    test('6 — retour à circuits depuis recherche via nav button', async ({ page }) => {
        // Aller en recherche
        await page.locator('[data-view="search"]').click();
        await page.waitForTimeout(300);

        // Revenir aux circuits
        await page.locator('[data-view="circuits"]').click();
        await page.waitForTimeout(400);

        // La liste circuits doit être de nouveau visible
        await expect(page.locator('.mobile-circuit-card-wrapper').first()).toBeVisible();
        await expect(page.locator('.mobile-nav-btn[data-view="circuits"]')).toHaveClass(/active/);
    });

});
