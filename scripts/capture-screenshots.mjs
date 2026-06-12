// scripts/capture-screenshots.mjs
// ============================================================
// Capture les screenshots du manifest PWA (fiche d'installation riche).
// À relancer quand l'UI change visiblement, puis vérifier le rendu
// avant de committer. Les fichiers vont dans public/screenshots/
// (exclus du precache SW — fiche d'installation uniquement).
//
// Usage :
//   1. Lancer le serveur de dev :  npm run dev
//   2. node scripts/capture-screenshots.mjs [url]
//      (défaut : http://localhost:5173)
//
// ⚠ Les `sizes` du manifest.json doivent correspondre aux pixels réels :
//   desktop 1280x800 (dpr 1), mobile 390x844 @2x = 780x1688.
// ============================================================

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = process.argv[2] || 'http://localhost:5173';
const OUT_DIR = resolve(import.meta.dirname, '../public/screenshots');
mkdirSync(OUT_DIR, { recursive: true });

// Neutralise les surcouches de premier lancement (modale de bienvenue,
// bandeau d'installation) qui pollueraient la capture.
const INIT_SCRIPT = `
  localStorage.setItem('hw_welcome_seen', '1');
  localStorage.setItem('hw_install_banner_dismissed_until', '9999999999999');
`;

async function waitForMap(page) {
    // Tuiles Leaflet chargées + petit délai de stabilisation (clusters, fonts).
    // `attached` (pas `visible`) : sur mobile la carte peut être sous un autre slot.
    await page.waitForSelector('.leaflet-tile-loaded', { state: 'attached', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
}

const browser = await chromium.launch();

// --- Desktop (form_factor "wide") -------------------------------------
{
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(INIT_SCRIPT);
    const page = await ctx.newPage();
    await page.goto(BASE_URL);
    await waitForMap(page);
    await page.screenshot({ path: `${OUT_DIR}/desktop-carte.png` });
    console.log('✓ desktop-carte.png (1280x800)');
    await ctx.close();
}

// --- Mobile (form_factor "narrow") ------------------------------------
// Boot mobile = liste « Mes Circuits » (pas la carte). La carte mobile se
// capture via le suivi de circuit : fiche → « Suivre ce circuit », avec une
// géoloc factice posée sur le départ du 1er circuit officiel (Sidi Zayed)
// pour que le point bleu apparaisse sur le tracé.
{
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        geolocation: { latitude: 33.87825, longitude: 10.88 },
        permissions: ['geolocation'],
    });
    await ctx.addInitScript(INIT_SCRIPT);
    const page = await ctx.newPage();
    await page.goto(BASE_URL);

    // Liste des circuits (écran d'accueil mobile)
    await page.waitForSelector('.mc-card', { timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT_DIR}/mobile-circuits.png` });
    console.log('✓ mobile-circuits.png (780x1688)');

    // Suivi de circuit : carte + tracé + point bleu GPS
    await page.locator('.mc-card').first().tap();
    await page.waitForTimeout(2500);
    await page.getByText('Suivre ce circuit').tap();
    await waitForMap(page);
    await page.screenshot({ path: `${OUT_DIR}/mobile-suivi.png` });
    console.log('✓ mobile-suivi.png (780x1688)');
    await ctx.close();
}

await browser.close();
console.log(`Screenshots écrits dans ${OUT_DIR}`);
