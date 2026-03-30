import { test, expect } from '@playwright/test';

test('Mobile menu updates correctly after admin login', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('http://localhost:5173/History-Walk-V1/');

    // Set legacy token which is currently used
    await page.evaluate(() => {
        window.localStorage.setItem('admin_session', 'active');
    });

    await page.reload();

    await page.waitForSelector('.mobile-nav-btn[data-view="actions"]');

    // Attendre que l'app soit initialisée (dock visible)
    await page.waitForSelector('.mobile-nav', { timeout: 8000 });

    await page.click('.mobile-nav-btn[data-view="actions"]');

    // Since we are logged in, it should render with admin tools
    // Let's use the actual ID used in the code: 'mob-action-admin-control-center'
    await page.waitForSelector('#mob-action-admin-control-center', { timeout: 5000 });

    const ccVisible = await page.isVisible('#mob-action-admin-control-center');
    expect(ccVisible).toBeTruthy();
});
