const { chromium } = require('playwright');

async function testAdminFusionRichEditor() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log("Setting up local storage for Admin Fusion ++...");
    await context.addInitScript(() => {
        const dummyGeoJSON = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [10.8, 33.8] },
                    "properties": {
                        "HW_ID": "HW-test-123",
                        "Nom du site FR": "Test POI",
                        "Catégorie": "Hôtel"
                    }
                }
            ]
        };
        const dummyUserData = {
            "HW-test-123": {
                "Nom du site FR": "Test POI Modified",
                "Catégorie": "Restaurant"
            }
        };

        localStorage.setItem('hw_admin_fusion_map', 'djerba');
        // IndexedDB mock injection because standalone fusion uses getAppState which queries IndexedDB
        // For testing, we mock the localDB functions in the window object before they are used
        window.indexedDBMockData = {
            'userData': dummyUserData,
            'customPois_djerba': [],
            'hiddenPois_djerba': []
        };
    });

    // Mock GitHub API for GeoJSON fetch
    await page.route('**/public/djerba.geojson*', async route => {
        console.log("Mocking GeoJSON fetch for:", route.request().url());
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": { "type": "Point", "coordinates": [10.8, 33.8] },
                        "properties": {
                            "HW_ID": "HW-test-123",
                            "Nom du site FR": "Test POI",
                            "Catégorie": "Hôtel"
                        }
                    }
                ]
            })
        });
    });

    console.log("Navigating to admin-fusion.html...");
    await page.goto('http://localhost:5173/History-Walk-V1/admin-fusion.html');

    // Wait for the Dashboard to load and display changes
    await page.waitForSelector('#dashboard', { state: 'visible' });
    console.log("Dashboard loaded.");

    // Check if the Edit button is present
    await page.waitForSelector('.btn-edit-poi[data-id="HW-test-123"]', { state: 'visible' });
    console.log("Edit button found. Clicking it...");

    // Click the edit button
    await page.click('.btn-edit-poi[data-id="HW-test-123"]');

    // Wait for modal to open
    await page.waitForSelector('#rich-poi-modal', { state: 'visible' });
    console.log("Rich Editor Modal opened.");

    // Verify modal content
    const nameVal = await page.$eval('#rich-poi-name-fr', el => el.value);
    const catVal = await page.$eval('#rich-poi-category', el => el.value);

    console.log("Name in editor:", nameVal);
    console.log("Category in editor:", catVal);

    if (nameVal === 'Test POI Modified' && catVal === 'Restaurant') {
        console.log("✅ Data correctly populated in Editor.");
    } else {
        console.error("❌ Data mismatch in Editor.");
    }

    // Modify a field and save
    await page.fill('#rich-poi-name-fr', 'Test POI Super Modified');
    await page.click('#btn-save-rich-poi');

    // Wait for modal to close
    await page.waitForSelector('#rich-poi-modal', { state: 'hidden' });
    console.log("Modal closed and data saved.");

    // Check if list was re-rendered with new name
    await page.waitForTimeout(500); // Give it time to re-render
    const newRenderedName = await page.$eval('#item-HW-test-123 .poi-name span', el => el.textContent);
    console.log("New name in list:", newRenderedName);

    if (newRenderedName === 'Test POI Super Modified') {
         console.log("✅ Fusion List correctly updated with new value!");
    } else {
         console.error("❌ Fusion List failed to update.");
    }

    await browser.close();
}

testAdminFusionRichEditor().catch(err => {
    console.error(err);
    process.exit(1);
});
