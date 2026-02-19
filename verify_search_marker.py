from playwright.sync_api import sync_playwright

def verify_search_coordinates_draggable():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})

        print("Opening app...")
        page.goto("http://localhost:5173/")

        # Wait for map
        page.wait_for_selector("#map", timeout=10000)

        # Type coordinates
        print("Typing coordinates...")
        search_input = page.locator("#search-input")
        search_input.fill("33.8, 10.9")
        search_input.press("Enter")

        # Wait for ghost marker
        print("Waiting for marker...")
        # The marker has class 'ghost-marker-icon' in its icon
        try:
            page.wait_for_selector(".ghost-marker-icon", timeout=5000)
            print("Ghost marker found.")
        except:
            print("Ghost marker NOT found.")
            page.screenshot(path="/home/jules/verification/search_marker_fail.png")
            browser.close()
            return

        # Check if draggable
        # Leaflet markers have 'leaflet-marker-draggable' class if draggable
        print("Checking draggability...")
        # We need to find the marker element that has the draggable class.
        # The .ghost-marker-icon is the DIV inside the marker container?
        # No, L.divIcon creates a div.
        # The marker container (the one with leaflet-marker-icon class) should have leaflet-marker-draggable.

        # Let's inspect the HTML structure around the ghost icon
        marker_el = page.locator(".leaflet-marker-icon.ghost-marker-icon")

        # Check class list
        classes = marker_el.get_attribute("class")
        print(f"Marker classes: {classes}")

        if "leaflet-marker-draggable" in classes:
            print("SUCCESS: Marker is draggable.")
        else:
            print("FAILURE: Marker is NOT draggable.")
            page.screenshot(path="/home/jules/verification/search_marker_not_draggable.png")

        browser.close()

if __name__ == "__main__":
    verify_search_coordinates_draggable()
