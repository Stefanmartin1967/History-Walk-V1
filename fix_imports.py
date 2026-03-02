import os
import re

replacements = {
    'src/ui-photo-viewer.js': [
        (r"import { openDetailsPanel } from './ui.js';", r"import { openDetailsPanel } from './ui-details.js';")
    ],
    'src/photo-upload.js': [
        (r"import { openDetailsPanel } from './ui.js';", r"import { openDetailsPanel } from './ui-details.js';")
    ],
    'src/searchManager.js': [
        (r"import { DOM, openDetailsPanel } from './ui.js';", r"import { DOM } from './ui.js';\nimport { openDetailsPanel } from './ui-details.js';")
    ],
    'src/mobile.js': [
        (r"import { DOM, openDetailsPanel } from './ui.js';", r"import { DOM } from './ui.js';\nimport { openDetailsPanel } from './ui-details.js';")
    ],
    'src/main.js': [
        (r"openDetailsPanel,\n\s*closeDetailsPanel,", ""), # These might be imported from ui.js
        (r"import {([^}]*)openDetailsPanel,\s*closeDetailsPanel,([^}]*)} from './ui.js';", r"import {\1\2} from './ui.js';\nimport { openDetailsPanel, closeDetailsPanel } from './ui-details.js';")
    ],
    'src/circuit-view.js': [
        (r"import { DOM, openDetailsPanel } from './ui.js';", r"import { DOM } from './ui.js';\nimport { openDetailsPanel } from './ui-details.js';")
    ],
    'src/circuit.js': [
        (r"import { DOM, openDetailsPanel, updateSelectionModeButton } from './ui.js';", r"import { DOM, updateSelectionModeButton } from './ui.js';\nimport { openDetailsPanel } from './ui-details.js';")
    ],
    'src/desktopMode.js': [
        (r"import { DOM, closeDetailsPanel, openDetailsPanel, closeAllDropdowns } from './ui.js';", r"import { DOM, closeAllDropdowns } from './ui.js';\nimport { closeDetailsPanel, openDetailsPanel } from './ui-details.js';")
    ],
    'src/map.js': [
        (r"import { openDetailsPanel } from './ui.js';", r"import { openDetailsPanel } from './ui-details.js';")
    ],
    'src/richEditor.js': [
        (r"import { openDetailsPanel, closeDetailsPanel } from './ui.js';", r"import { openDetailsPanel, closeDetailsPanel } from './ui-details.js';")
    ],
    'src/ui-sidebar.js': [
        (r"import { openDetailsPanel } from './ui.js';", r"import { openDetailsPanel } from './ui-details.js';"),
        (r"import\('./ui\.js'\)\.then\(m => m\.openDetailsPanel", r"import('./ui-details.js').then(m => m.openDetailsPanel")
    ],
    'src/ui-modals.js': [
        (r"import { closeDetailsPanel } from './ui.js';", r"import { closeDetailsPanel } from './ui-details.js';")
    ],
    'src/fileManager.js': [
        (r"import { DOM, closeDetailsPanel, updateExportButtonLabel } from './ui.js';", r"import { DOM, updateExportButtonLabel } from './ui.js';\nimport { closeDetailsPanel } from './ui-details.js';")
    ]
}

for file_path, rules in replacements.items():
    if not os.path.exists(file_path):
        continue
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    for search, replace in rules:
        content = re.sub(search, replace, content)

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
