import re

with open('src/gpx.js', 'r') as f:
    gpx_content = f.read()

counters_regex = r'/\*\*\n \* Calcule les compteurs "Planifié".*?export async function recalculatePlannedCountersForMap\(mapId\) \{.*?\n\}'
gpx_content_new = re.sub(counters_regex, '', gpx_content, flags=re.DOTALL)

save_regex = r'export async function saveAndExportCircuit\(\) \{.*?\n\}'
gpx_content_new = re.sub(save_regex, '', gpx_content_new, flags=re.DOTALL)

# Clean up imports in gpx.js
# We keep what's needed for generateGPXString and processImportedGpx
# Needed: state, APP_VERSION, getPoiName, escapeXml, getPoiId, addMyCircuit (db?), saveCircuit, getAppState
# actually processImportedGpx needs: state, addMyCircuit (from state), getPoiId, getAppState
# modal: showConfirm, showAlert
# toast: showToast
# map: updatePolylines
# circuit: loadCircuitById
# utils: generateHWID

gpx_imports = """// gpx.js
import { state, APP_VERSION, addMyCircuit } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { loadCircuitById } from './circuit.js';
import { getAppState, saveCircuit } from './database.js';
import { showToast } from './toast.js';
import { downloadFile, escapeXml, generateHWID } from './utils.js';
import { updatePolylines } from './map.js';
"""

# Replace imports block
gpx_content_new = re.sub(r'// gpx\.js\n.*?\n// --- HELPER', gpx_imports + '\n// --- HELPER', gpx_content_new, flags=re.DOTALL)

# IMPORTANT: generateAndDownloadGPX needs to be exported so saveAndExportCircuit can use it!
gpx_content_new = gpx_content_new.replace('function generateAndDownloadGPX(', 'export function generateAndDownloadGPX(')

with open('src/gpx.js', 'w') as f:
    f.write(gpx_content_new)
