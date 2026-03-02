import re

with open('src/ui.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove setupGlobalEditButton
content = re.sub(r'function setupGlobalEditButton\(poiId\).*?}\n', '', content, flags=re.DOTALL)

# Remove setupDetailsEventListeners
content = re.sub(r'// --- SETUP LISTENERS DU PANNEAU DE DÉTAILS ---.*?// --- OUVERTURE/FERMETURE ---', '// --- OUVERTURE/FERMETURE ---', content, flags=re.DOTALL)

# Remove openDetailsPanel
content = re.sub(r'export function openDetailsPanel\(.*?}\n', '', content, flags=re.DOTALL)

# Remove closeDetailsPanel
content = re.sub(r'export function closeDetailsPanel\(.*?}\n', '', content, flags=re.DOTALL)

# Remove adjustTime
content = re.sub(r'export function adjustTime\(.*?}\n', '', content, flags=re.DOTALL)

# Remove adjustPrice
content = re.sub(r'export function adjustPrice\(.*?}\n', '', content, flags=re.DOTALL)

with open('src/ui.js', 'w', encoding='utf-8') as f:
    f.write(content)
