
from playwright.sync_api import sync_playwright, expect
import time

def verify_fixes():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 1. Open App
        print("Navigating to app...")
        page.goto("http://localhost:5173/")

        # Wait for map or initial load
        page.wait_for_selector("#map", timeout=10000)
        time.sleep(2) # Allow data to load

        # 2. Check "Mon Carnet de Voyage" UI
        print("Checking Statistics Modal...")
        # Open Tools Menu
        page.click("#btn-tools-menu")
        time.sleep(0.5)
        # Open Statistics
        page.click("#btn-statistics")
        time.sleep(1)

        # Take Screenshot of Modal
        page.screenshot(path="verification/stats_modal.png")
        print("Screenshot of stats modal taken.")

        # Close Modal (Click Overlay or specific button if available)
        # The overlay has class custom-modal-overlay active
        # We can click the "Fermer" button inside actions
        page.click(".custom-modal-actions button")
        time.sleep(0.5)

        # 3. Verify "Done" Status Persistence
        print("Verifying Done Persistence...")

        # Open Circuits List
        page.click("#btn-open-my-circuits")
        time.sleep(1)

        # Find first circuit item's toggle button
        # Selector: .explorer-item .btn-toggle-visited
        # We assume there is at least one circuit loaded
        toggle_btns = page.query_selector_all(".btn-toggle-visited")
        if not toggle_btns:
            print("No circuits found to test persistence.")
        else:
            first_btn = toggle_btns[0]
            initial_state = first_btn.get_attribute("data-visited")
            print(f"Initial State: {initial_state}")

            # Click to toggle
            first_btn.click()
            time.sleep(0.5)

            new_state = first_btn.get_attribute("data-visited")
            print(f"New State (Before Reload): {new_state}")

            if initial_state == new_state:
                print("Error: Button state didn't change!")

            # Reload Page
            print("Reloading page...")
            page.reload()
            page.wait_for_selector("#map", timeout=10000)
            time.sleep(3) # Wait for async data load (Important!)

            # Open Circuits List again
            page.click("#btn-open-my-circuits")
            time.sleep(1)

            # Check state again
            toggle_btns_after = page.query_selector_all(".btn-toggle-visited")
            if toggle_btns_after:
                final_btn = toggle_btns_after[0]
                final_state = final_btn.get_attribute("data-visited")
                print(f"Final State (After Reload): {final_state}")

                if final_state == new_state:
                    print("SUCCESS: State persisted.")
                else:
                    print(f"FAILURE: State lost. Expected {new_state}, got {final_state}")
            else:
                print("Error: Circuits list empty after reload.")

        browser.close()

if __name__ == "__main__":
    verify_fixes()
