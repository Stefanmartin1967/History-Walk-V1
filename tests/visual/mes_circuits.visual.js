/**
 * mes_circuits.visual.js
 * Tests E2E desktop de l'onglet "Mes Circuits" V2 Lot 2 (refonte filtres + cartes Variante A).
 */

import { test, expect } from '@playwright/test';

const LOAD_TIMEOUT = 20000;

test.describe('Desktop — Mes Circuits V2 Lot 2', () => {

    test.beforeEach(async ({ page, isMobile }) => {
        test.skip(isMobile, 'Tests desktop uniquement');

        await page.addInitScript(() => {
            localStorage.setItem('hw_welcome_seen', '1');
        });

        await page.goto('/');
        await page.waitForSelector('.leaflet-marker-icon', { timeout: LOAD_TIMEOUT });
        await page.waitForTimeout(1200);

        // Bascule sur l'onglet "Mes Circuits"
        await page.locator('.tab-button[data-tab="explorer"]').click();
        await page.waitForSelector('#mc-toolbar', { timeout: 5000 });
    });

    test('1 — toolbar 4 boutons (recherche + filtres + nouveau + fermer)', async ({ page }) => {
        await expect(page.locator('#mc-search-input')).toBeVisible();
        await expect(page.locator('#mc-btn-filters')).toBeVisible();
        await expect(page.locator('#mc-btn-new')).toBeVisible();
        await expect(page.locator('#mc-btn-close')).toBeVisible();
        // Pas de menu ⋮
        await expect(page.locator('#mc-btn-menu')).toHaveCount(0);
    });

    test('2 — bouton Filtres ouvre le panneau dropdown (filter-pop)', async ({ page }) => {
        await expect(page.locator('#panel-explorer')).toHaveAttribute('data-filter-open', 'false');

        await page.locator('#mc-btn-filters').click();
        await page.waitForTimeout(200);

        await expect(page.locator('#panel-explorer')).toHaveAttribute('data-filter-open', 'true');
        await expect(page.locator('.filter-pop')).toBeVisible();
        // 4 sections : Type, Distance, Tri, Mon parcours
        await expect(page.locator('.filter-section')).toHaveCount(4);
    });

    test('3 — cocher "Vérifiés" auto-coche "Officiels"', async ({ page }) => {
        await page.locator('#mc-btn-filters').click();
        await page.waitForTimeout(200);

        const officiels = page.locator('.fchk[data-fchk="official"]');
        const verifies = page.locator('.fchk[data-fchk="verified"]');

        await expect(officiels).not.toHaveClass(/is-on/);
        await expect(verifies).not.toHaveClass(/is-on/);

        await verifies.click();
        await page.waitForTimeout(200);

        // Les deux doivent être cochés
        await expect(officiels).toHaveClass(/is-on/);
        await expect(verifies).toHaveClass(/is-on/);
    });

    test('4 — décocher "Officiels" décoche aussi "Vérifiés"', async ({ page }) => {
        await page.locator('#mc-btn-filters').click();
        await page.waitForTimeout(200);

        // Coche Vérifiés (auto-coche Officiels) — le panneau est re-rendu donc
        // on relit le locator après l'action.
        await page.locator('.fchk[data-fchk="verified"]').click();
        await page.waitForTimeout(300);
        await expect(page.locator('.fchk[data-fchk="official"]')).toHaveClass(/is-on/);

        // Décoche Officiels
        await page.locator('.fchk[data-fchk="official"]').click();
        await page.waitForTimeout(300);

        await expect(page.locator('.fchk[data-fchk="official"]')).not.toHaveClass(/is-on/);
        await expect(page.locator('.fchk[data-fchk="verified"]')).not.toHaveClass(/is-on/);
    });

    test('5 — segmented tri (Proximité / Distance / Vérifiés)', async ({ page }) => {
        await page.locator('#mc-btn-filters').click();
        await page.waitForTimeout(200);

        await expect(page.locator('.fseg button[data-sort="proximity_asc"]')).toHaveClass(/is-on/);

        await page.locator('.fseg button[data-sort="dist_asc"]').click();
        await page.waitForTimeout(200);
        await expect(page.locator('.fseg button[data-sort="dist_asc"]')).toHaveClass(/is-on/);
        await expect(page.locator('.fseg button[data-sort="proximity_asc"]')).not.toHaveClass(/is-on/);
    });

    test('5b — segmented Mon parcours (Tout / À faire / Fait)', async ({ page }) => {
        await page.locator('#mc-btn-filters').click();
        await page.waitForTimeout(200);

        const seg = page.locator('#mc-fseg-completion');
        await expect(seg.locator('button[data-completion="all"]')).toHaveClass(/is-on/);

        await seg.locator('button[data-completion="todo"]').click();
        await page.waitForTimeout(300);
        await expect(seg.locator('button[data-completion="todo"]')).toHaveClass(/is-on/);
        await expect(seg.locator('button[data-completion="all"]')).not.toHaveClass(/is-on/);
    });

    test('6 — badge n sur le bouton Filtres après cochage', async ({ page }) => {
        // Au départ, pas de badge
        await expect(page.locator('#mc-btn-filters .badge-n')).toHaveCount(0);

        await page.locator('#mc-btn-filters').click();
        await page.waitForTimeout(200);
        await page.locator('.fchk[data-fchk="resto"]').click();
        await page.waitForTimeout(200);

        // Badge n apparaît avec valeur 1
        await expect(page.locator('#mc-btn-filters .badge-n')).toContainText('1');
    });

    test('7 — bouton Tout réinitialiser remet tout à zéro', async ({ page }) => {
        await page.locator('#mc-btn-filters').click();
        await page.waitForTimeout(200);
        await page.locator('.fchk[data-fchk="official"]').click();
        await page.waitForTimeout(300);
        await page.locator('.fchk[data-fchk="resto"]').click();
        await page.waitForTimeout(300);

        await page.locator('#mc-fp-reset').click();
        await page.waitForTimeout(400);

        // Réouvrir le panneau (le reset peut le fermer / re-render)
        if (await page.locator('#panel-explorer').getAttribute('data-filter-open') !== 'true') {
            await page.locator('#mc-btn-filters').click();
            await page.waitForTimeout(200);
        }

        await expect(page.locator('.fchk[data-fchk="official"]')).not.toHaveClass(/is-on/);
        await expect(page.locator('.fchk[data-fchk="resto"]')).not.toHaveClass(/is-on/);
        await expect(page.locator('#mc-btn-filters .badge-n')).toHaveCount(0);
    });

    test('8 — clic extérieur ferme le panneau filtres', async ({ page }) => {
        await page.locator('#mc-btn-filters').click();
        await page.waitForTimeout(200);
        await expect(page.locator('#panel-explorer')).toHaveAttribute('data-filter-open', 'true');

        // Clic sur la carte (largement en dehors de la sidebar et du filter-pop)
        await page.locator('.leaflet-container').click({ position: { x: 200, y: 400 }, force: true });
        await page.waitForTimeout(300);

        await expect(page.locator('#panel-explorer')).toHaveAttribute('data-filter-open', 'false');
    });

    test('9 — Escape ferme le panneau filtres', async ({ page }) => {
        await page.locator('#mc-btn-filters').click();
        await page.waitForTimeout(200);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await expect(page.locator('#panel-explorer')).toHaveAttribute('data-filter-open', 'false');
    });

    test('10 — carte Variante A : ruban gauche + flag textuel + check toggle', async ({ page }) => {
        const cards = page.locator('.va-card');
        const count = await cards.count();
        expect(count).toBeGreaterThan(0);

        // Au moins une carte avec data-flag="official" ou "verified" (les officiels Djerba)
        const flaggedCards = page.locator('.va-card[data-flag="official"], .va-card[data-flag="verified"]');
        expect(await flaggedCards.count()).toBeGreaterThan(0);

        // Chaque carte a un titre + toggle done + meta avec pastilles POI/km/zone
        const first = cards.first();
        await expect(first.locator('.va-title')).toBeVisible();
        await expect(first.locator('.va-done')).toBeVisible();
        await expect(first.locator('.va-stat').first()).toBeVisible();
        // Au moins 2 va-stat (POI + km)
        expect(await first.locator('.va-stat').count()).toBeGreaterThanOrEqual(2);
    });

    test('10b — slider double-handle : 2 poignées présentes (min + max)', async ({ page }) => {
        await page.locator('#mc-btn-filters').click();
        await page.waitForTimeout(200);
        await expect(page.locator('#mc-fslider-handle-min')).toBeVisible();
        await expect(page.locator('#mc-fslider-handle-max')).toBeVisible();
        // Initial : min=0, max=20 → fill couvre 100%
        const fill = page.locator('#mc-fslider-fill');
        const fillStyle = await fill.getAttribute('style');
        expect(fillStyle).toContain('left:0%');
        expect(fillStyle).toContain('width:100%');
    });

    test('11 — clic sur une carte bascule sur l\'onglet "Circuit"', async ({ page }) => {
        await page.locator('.va-card').first().click();
        await page.waitForTimeout(400);
        await expect(page.locator('.tab-button[data-tab="circuit"]')).toHaveClass(/active/);
    });

    test('12 — recherche temps réel filtre les cartes (par nom)', async ({ page }) => {
        const initialCount = await page.locator('.va-card').count();
        expect(initialCount).toBeGreaterThan(0);

        await page.locator('#mc-search-input').fill('zzzimprobable');
        await page.waitForTimeout(200);

        await expect(page.locator('.va-empty')).toBeVisible();
        await expect(page.locator('.va-card')).toHaveCount(0);
    });

    test('13 — X clear vide la recherche', async ({ page }) => {
        await page.locator('#mc-search-input').fill('mosquée');
        await page.waitForTimeout(200);
        await expect(page.locator('#mc-search-clear')).toBeVisible();

        await page.locator('#mc-search-clear').click();
        await page.waitForTimeout(200);
        await expect(page.locator('#mc-search-input')).toHaveValue('');
        await expect(page.locator('#mc-search-clear')).toHaveClass(/is-hidden/);
    });

});
