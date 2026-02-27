from playwright.sync_api import sync_playwright

def verify_contribution_modal():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Emulate a mobile device to verify the responsive behavior as requested
        context = browser.new_context(viewport={'width': 375, 'height': 667})
        page = context.new_page()

        # Navigate to the app (assuming it's running on port 3000)
        page.goto("http://localhost:3000/History-Walk-V1/")

        # Wait for map or initial load
        page.wait_for_timeout(2000)

        # Clear any previous sobriety timestamp to force the modal to show
        page.evaluate("localStorage.removeItem('hw_last_support_click')")

        # Trigger an export action (e.g. GPX export is disabled by default, let's try Backup Modal)
        # Open Tools Menu
        page.click("#btn-tools-menu")
        page.wait_for_timeout(500)

        # Click "Sauvegarder..." which should trigger the contribution modal first?
        # Actually, the implementation wraps specific export actions.
        # Let's check `fileManager.js`: handleExportWithContribution is called before exports.
        # We need to find a button that calls this.
        # In `main.js` or `ui.js`, export buttons call this.
        # Let's simulate calling the function directly to be sure, or find a UI path.

        # Let's try to invoke the modal directly via console for robust verification of the MODAL UI itself
        # since UI navigation might be complex with disabled buttons.
        page.evaluate("""
            import('./src/fileManager.js').then(m => {
                m.handleExportWithContribution('gpx', () => console.log('Proceed'));
            });
        """)

        # Wait for modal to appear
        page.wait_for_selector(".custom-modal-box.modal-contribution")
        page.wait_for_timeout(1000) # Wait for animation

        # Take screenshot
        page.screenshot(path="verification_modal_mobile.png")

        print("Screenshot taken: verification_modal_mobile.png")
        browser.close()

if __name__ == "__main__":
    verify_contribution_modal()
