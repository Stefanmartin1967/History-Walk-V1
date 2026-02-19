from playwright.sync_api import sync_playwright

def verify_right_click():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})

        # Open the app
        print("Opening app...")
        page.goto("http://localhost:5173/")

        # Wait for map to load
        print("Waiting for map...")
        page.wait_for_selector(".leaflet-container", timeout=10000)

        # Trigger right click on the map
        print("Triggering right click...")
        map_container = page.locator("#map")

        # Center of the map
        box = map_container.bounding_box()
        x = box['x'] + box['width'] / 2
        y = box['y'] + box['height'] / 2

        page.mouse.move(x, y)
        page.mouse.down(button="right")
        page.mouse.up(button="right")

        # Wait for the marker popup
        print("Waiting for popup...")
        try:
            page.wait_for_selector("text=Nouveau Lieu ?", timeout=5000)
            print("Popup found!")
        except Exception as e:
            print("Popup not found:", e)
            page.screenshot(path="/home/jules/verification/right_click_fail.png")
            browser.close()
            return

        # Check for coordinates
        print("Checking for coordinates element...")
        coords = page.locator("#desktop-draft-coords")
        if coords.count() > 0:
            print(f"Success! Found coordinates: {coords.inner_text()}")
        else:
            print("Failure! Coordinates element not found.")
            page.screenshot(path="/home/jules/verification/right_click_no_coords.png")

        # Check if the marker is draggable
        print("Checking for draggable class...")
        draggable_marker = page.locator(".leaflet-marker-draggable")
        count = draggable_marker.count()

        if count > 0:
            print(f"Success! Found {count} draggable marker(s).")
            page.screenshot(path="/home/jules/verification/right_click_success_final.png")
        else:
            print("Failure! No draggable marker found.")
            page.screenshot(path="/home/jules/verification/right_click_fail_class.png")

        browser.close()

if __name__ == "__main__":
    verify_right_click()
