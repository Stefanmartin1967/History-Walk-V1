from playwright.sync_api import sync_playwright

def verify_stats_card():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # PC viewport to see the modal clearly
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        page.goto("http://localhost:3000/History-Walk-V1/")
        page.wait_for_timeout(2000)

        # 1. Open Tools Menu
        page.click("#btn-tools-menu")
        page.wait_for_timeout(500)

        # 2. Click "Mon Carnet de Voyage" (#btn-statistics)
        page.click("#btn-statistics")
        page.wait_for_timeout(1000)

        # 3. Take screenshot of the modal content
        try:
            # Focus on the card area
            card = page.locator("#explorer-card-print")
            card.screenshot(path="verification_stats_card.png")
            print("Screenshot taken: verification_stats_card.png")

            # Full page context
            page.screenshot(path="verification_stats_modal_full.png")
        except Exception as e:
            print(f"Error capturing card: {e}")
            page.screenshot(path="verification_error_stats.png")

        browser.close()

if __name__ == "__main__":
    verify_stats_card()
