const { chromium } = require('playwright');
const assert = require('assert');

async function testCategoryUpdate() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Injecter un hash valide pour bypasser l'authentification admin
  const validHash = '351186f6a16eb579ba3d83f573f518148fb84ab2a1536d87277534b06f4ac16d_123456';
  await context.addInitScript((hash) => {
    localStorage.setItem('hw_adm_ts', hash);
  }, validHash);

  await page.goto('http://localhost:5173/');

  // Attendre que la carte et les POIs soient chargés
  await page.waitForSelector('.leaflet-marker-icon');

  console.log("Map loaded.");

  // Trouver un marqueur
  const markers = await page.$$('.leaflet-marker-icon');
  if (markers.length === 0) {
      console.log("No markers found.");
      await browser.close();
      return;
  }

  // Obtenir la classe de l'icône du premier marqueur
  const initialHtml = await page.$eval('.leaflet-marker-icon[title="Rym Beach"]', el => el.innerHTML).catch(() => page.$eval('.leaflet-marker-icon', el => el.innerHTML));
  console.log("Initial icon HTML:", initialHtml);

  // Cliquer sur le marqueur pour ouvrir le panneau de détails en forçant le clic
  await page.click('.leaflet-marker-icon[title="Rym Beach"]', { force: true }).catch(() => page.click('.leaflet-marker-icon', { force: true }));

  // Attendre que le panneau de détails s'ouvre
  await page.waitForSelector('#details-panel', { state: 'visible' });

  // Cliquer sur le bouton "Éditer" (God Mode)
  await page.click('#btn-global-edit');

  // Attendre que l'éditeur riche s'ouvre
  await page.waitForSelector('#rich-poi-modal', { state: 'visible' });

  // Attendre que l'option soit disponible
  await page.waitForTimeout(500);

  // Changer la catégorie en Restaurant (utensils-crossed)
  await page.selectOption('#rich-poi-category', { label: 'Restaurant' });

  // Wait for category to be interactable
  await page.waitForSelector('#rich-poi-category', { state: 'visible' });

  // Wait for the form to load
  await page.waitForSelector('#rich-poi-name-fr', { state: 'visible' });

  // Enter title
  await page.fill('#rich-poi-name-fr', 'Maison Test');

  // Set Category by Value
  await page.selectOption('#rich-poi-category', { label: 'Site historique' });

  // Wait for the button to be enabled (no longer disabled attribute)
  await page.waitForFunction(() => {
    const btn = document.getElementById('btn-save-rich-poi');
    return btn && !btn.disabled;
  });

  // Intercept the native confirm dialog just in case it's used as a fallback
  page.on('dialog', async dialog => {
    console.log(`Native dialog appeared: ${dialog.message()}`);
    await dialog.dismiss();
  });

  // Enregistrer
  await page.click('#btn-save-rich-poi');

  // The showConfirm modal in modal.js uses .custom-modal
  try {
      await page.waitForSelector('.custom-modal.active', { state: 'visible', timeout: 3000 });
      console.log("Confirmation modal appeared.");

      // Secondary button is usually "Annuler" / "Non, enregistrer seul"
      const buttons = await page.$$('.custom-modal-btn');
      if (buttons.length >= 2) {
          await buttons[1].click();
      } else if (buttons.length === 1) {
          await buttons[0].click();
      }
  } catch (e) {
      console.log("No confirmation modal appeared, or timeout.");
  }

  // Wait for modal to hide
  await page.waitForSelector('#rich-poi-modal', { state: 'hidden' });

  // Vérifier que l'icône a changé sur la carte
  // (La map se met à jour asynchrone, un court délai peut être nécessaire)
  await page.waitForTimeout(1000);

  // click a specific marker
  const markerSelector = '.leaflet-marker-icon[title="Maison Test"]';
  const updatedHtml = await page.$eval(markerSelector, el => el.innerHTML).catch(() => page.$eval('.leaflet-marker-icon', el => el.innerHTML));
  console.log("Updated icon HTML:", updatedHtml);

  if (initialHtml !== updatedHtml) {
      console.log("✅ Category update test passed! Icon updated.");
  } else {
      console.log("❌ Category update test failed! Icon did not update.");
  }

  await browser.close();
}

testCategoryUpdate().catch(err => {
  console.error(err);
  process.exit(1);
});
