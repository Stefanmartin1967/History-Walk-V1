import json
import re
import math

def clean_json_content(content):
    # Keep HEAD content
    pattern = re.compile(r'<<<<<<< HEAD\n(.*?)\n=======\n.*?\n>>>>>>> .*?\n', re.DOTALL)
    cleaned_content = re.sub(pattern, r'\1', content)
    return cleaned_content

def main():
    filepath = 'public/djerba.geojson'

    print(f"Reading {filepath}...")
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    if '<<<<<<< HEAD' in content:
        print("Resolving merge conflicts (Keeping HEAD)...")
        content = clean_json_content(content)

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        return

    features = data.get('features', [])
    original_count = len(features)
    print(f"Loaded {original_count} features.")

    # Correction: Remove "Mosquée El Chehoud" (near 33.784959, 10.893311), NOT "El Chouhoud".
    # Correction: Remove "Mosquée Ibrahim El-Kalil Dhhira" (Exact Name).

    target_ibrahim_name = "Mosquée Ibrahim El-Kalil Dhhira"

    updated_features = []

    removed_count = 0

    for f in features:
        props = f.get('properties', {})
        name = props.get('Nom du site FR', '')

        # 1. Check for Removal: Mosquée El Chehoud
        if name == "Mosquée El Chehoud":
            print(f"Removing: {name}")
            removed_count += 1
            continue

        # 2. Check for Removal: Ibrahim El-Kalil Dhhira
        if name == target_ibrahim_name:
            print(f"Removing: {name}")
            removed_count += 1
            continue

        # 3. Check for Updates
        # Mosquée El Ghoula : 33.777147513068996, 10.794860611273545
        if name == "Mosquée El Ghoula":
            print(f"Updating {name} coordinates.")
            f['geometry']['coordinates'] = [10.794860611273545, 33.777147513068996]
            f['properties']['Latitude'] = 33.777147513068996
            f['properties']['Longitude'] = 10.794860611273545
            f['properties']['Coordonnées GPS'] = "33.777147513068996, 10.794860611273545"

        # Mosquée Khnensa : 33.75818454061917, 10.791050841108836
        if name == "Mosquée Khnensa":
            print(f"Updating {name} coordinates.")
            f['geometry']['coordinates'] = [10.791050841108836, 33.75818454061917]
            f['properties']['Latitude'] = 33.75818454061917
            f['properties']['Longitude'] = 10.791050841108836
            f['properties']['Coordonnées GPS'] = "33.75818454061917, 10.791050841108836"

        # Explicit check to ensure we are keeping El Chouhoud
        if name == "Mosquée El Chouhoud":
            print(f"Keeping: {name} (as requested)")

        updated_features.append(f)

    data['features'] = updated_features
    print(f"Final feature count: {len(updated_features)} (Removed {removed_count})")

    print(f"Saving to {filepath}...")
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print("Done.")

if __name__ == "__main__":
    main()
