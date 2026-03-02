import re

with open('src/ui-details.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r"import { createIcons, icons } from 'lucide';", "import { createIcons, icons } from 'https://unpkg.com/lucide@latest/dist/esm/lucide.js';", content)

with open('src/ui-details.js', 'w', encoding='utf-8') as f:
    f.write(content)
