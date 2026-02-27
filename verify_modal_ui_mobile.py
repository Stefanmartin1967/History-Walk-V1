from playwright.sync_api import sync_playwright

def verify_contribution_modal_mobile():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Emulate a mobile device
        context = browser.new_context(viewport={'width': 375, 'height': 667})
        page = context.new_page()

        # Navigate
        page.goto("http://localhost:3000/History-Walk-V1/")

        # Wait for map or initial load
        page.wait_for_timeout(2000)

        # Clear sobriety
        page.evaluate("localStorage.removeItem('hw_last_support_click')")

        # In mobile view, `btn-tools-menu` is hidden.
        # We need to trigger the modal via code or mobile navigation.
        # To simplify, we will inject the call to show the modal directly,
        # verifying the CSS and Structure we just built.

        # We need to import the module. Since it's an ES module app,
        # we can't easily access exports from window unless we expose them or use import().
        # Let's try to expose it or simulate the event.

        # Actually, let's just create the DOM structure manually to verify CSS?
        # No, that defeats the purpose of integration test.

        # Let's try to click the "Menu" button in the bottom dock if visible
        # Mobile dock has `data-view="actions"` button which is the menu.
        # But that opens a panel, not the export modal directly.

        # The export buttons are usually in the "actions" panel or "circuits" panel.

        # Let's try to forcefully call the function.
        page.evaluate("""
            import('./src/fileManager.js').then(m => {
                // Ensure the function is available
                if (m.handleExportWithContribution) {
                    m.handleExportWithContribution('gpx', () => console.log('Proceed'));
                } else {
                    console.error('Function not found');
                }
            });
        """)

        # Wait for modal
        try:
            page.wait_for_selector(".custom-modal-box.modal-contribution", timeout=5000)
            page.wait_for_timeout(1000)
            page.screenshot(path="verification_modal_mobile_direct.png")
            print("Screenshot taken: verification_modal_mobile_direct.png")
        except Exception as e:
            print(f"Error waiting for modal: {e}")
            page.screenshot(path="verification_error.png")

        browser.close()

if __name__ == "__main__":
    verify_contribution_modal_mobile()
