import time
from playwright.sync_api import sync_playwright

def verify_map_resize():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a consistent viewport size
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()

        print("Navigating to application...")
        # Assuming the dev server runs on port 5173 (default for Vite)
        try:
            page.goto("http://localhost:5173/History-Walk-V1/", timeout=60000)
        except Exception as e:
            print(f"Error navigating: {e}")
            browser.close()
            return

        print("Waiting for map to load...")
        page.wait_for_selector("#map", timeout=30000)

        # Initial screenshot
        time.sleep(2) # Give map tiles time to load
        page.screenshot(path="verification_step1_initial.png")
        print("Initial state captured.")

        # Simulate opening/closing sidebar tabs which triggers resize
        print("Switching to 'Explorer' tab...")
        # Click on the tab button for 'explorer'
        explorer_btn = page.locator("button[data-tab='explorer']")
        if explorer_btn.is_visible():
            explorer_btn.click()
            time.sleep(1) # Allow for transition
            page.screenshot(path="verification_step2_explorer.png")
            print("Explorer tab state captured.")
        else:
            print("Explorer button not found.")

        print("Switching to 'Circuit' tab (simulated)...")
        # Click the 'Circuit' tab
        circuit_btn = page.locator("button[data-tab='circuit']")
        if circuit_btn.is_visible():
            circuit_btn.click()
            time.sleep(1) # Allow for transition
            page.screenshot(path="verification_step3_circuit.png")
            print("Circuit tab state captured.")

        # Verify map size/bounds (programmatically checking if map container size changed)
        # We can inject JS to check Leaflet map size
        map_size = page.evaluate("""() => {
            // map is exported from src/map.js but it is not attached to window by default.
            // However, looking at the code, it seems map variable is local to module scope.
            // But we can check the #map div size.
            const mapDiv = document.getElementById('map');
            return { width: mapDiv.offsetWidth, height: mapDiv.offsetHeight };
        }""")
        print(f"Map div size: {map_size}")

        browser.close()

if __name__ == "__main__":
    verify_map_resize()
