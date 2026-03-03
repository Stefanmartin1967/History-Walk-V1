import re

with open('src/gpx.js', 'r') as f:
    gpx_content = f.read()

with open('src/circuit-actions.js', 'r') as f:
    actions_content = f.read()

# 1. Extract computeCircuitCounters and recalculatePlannedCountersForMap from gpx.js
counters_regex = r'(/\*\*\s*\*\s*Calcule les compteurs.*?export async function recalculatePlannedCountersForMap\(mapId\) \{.*?\n\})'
match_counters = re.search(counters_regex, gpx_content, re.DOTALL)
counters_code = match_counters.group(1) if match_counters else ''

# Extract saveAndExportCircuit
save_regex = r'(export async function saveAndExportCircuit\(\) \{.*?\n\})'
match_save = re.search(save_regex, gpx_content, re.DOTALL)
save_code = match_save.group(1) if match_save else ''

# Clean up gpx.js by removing extracted functions
gpx_content_new = re.sub(counters_regex, '', gpx_content, flags=re.DOTALL)
gpx_content_new = re.sub(save_regex, '', gpx_content_new, flags=re.DOTALL)

# Modify gpx.js imports
# Remove unused imports from gpx.js: addMyCircuit, updateMyCircuit, setUserData, setActiveCircuitId, setHasUnexportedChanges,
# getPoiName, applyFilters, generateCircuitName, loadCircuitById, DOM, getAllPoiDataForMap, getAllCircuitsForMap, saveCircuit, batchSavePoiData, getAppState
# And add them to circuit-actions.js

gpx_imports = """import { state, APP_VERSION } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { showToast } from './toast.js';
import { escapeXml, generateHWID } from './utils.js';
import { updatePolylines } from './map.js';
import { addMyCircuit, saveCircuit } from './database.js';
"""
# Note: we need to fix imports properly.

print("Extracted counters_code:", len(counters_code))
print("Extracted save_code:", len(save_code))
