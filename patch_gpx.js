const fs = require('fs');

const gpxFile = fs.readFileSync('src/gpx.js', 'utf8');

// 1. Extract computeCircuitCounters
const computeRegex = /(\/\*\*\s*\*\s*Calcule les compteurs.*?)(?=\s*export async function saveAndExportCircuit)/s;
const matchCompute = gpxFile.match(computeRegex);
const computeCode = matchCompute ? matchCompute[1] : '';

// 2. Extract saveAndExportCircuit
const saveRegex = /(export async function saveAndExportCircuit\(\) \{.*?\n\})(?=\s*export async function processImportedGpx)/s;
const matchSave = gpxFile.match(saveRegex);
const saveCode = matchSave ? matchSave[1] : '';

// 3. Remove them from gpx.js
let newGpxFile = gpxFile.replace(computeCode, '');
newGpxFile = newGpxFile.replace(saveCode, '');

// 4. Update gpx.js imports
const gpxImports = `// gpx.js
import { state, APP_VERSION, addMyCircuit } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { loadCircuitById } from './circuit.js';
import { getAppState, saveCircuit } from './database.js';
import { showToast } from './toast.js';
import { downloadFile, escapeXml, generateHWID } from './utils.js';
import { updatePolylines } from './map.js';`;

const headerRegex = /\/\/ gpx\.js.*?\/\/ --- HELPER/s;
newGpxFile = newGpxFile.replace(headerRegex, gpxImports + '\n\n// --- HELPER');

// Make generateAndDownloadGPX exportable
newGpxFile = newGpxFile.replace('function generateAndDownloadGPX(', 'export function generateAndDownloadGPX(');

fs.writeFileSync('src/gpx.js', newGpxFile);


// 5. Append to circuit-actions.js
let actionsFile = fs.readFileSync('src/circuit-actions.js', 'utf8');

// We need to add necessary imports at the top of circuit-actions.js
const extraImports = `
import { DOM } from './ui.js';
import { getAllPoiDataForMap, getAllCircuitsForMap, batchSavePoiData, getAppState } from './database.js';
import { showToast } from './toast.js';
import { generateCircuitName } from './circuit.js';
import { getPoiId, applyFilters } from './data.js';
import { generateAndDownloadGPX } from './gpx.js';
import { updateMyCircuit, setUserData, setActiveCircuitId, setHasUnexportedChanges } from './state.js';
import { generateHWID } from './utils.js';
`;

// Inject imports below the existing imports
actionsFile = actionsFile.replace(/import { state, [^\n]+\n/, `$&${extraImports}`);

actionsFile += '\n\n' + computeCode + '\n\n' + saveCode + '\n';

fs.writeFileSync('src/circuit-actions.js', actionsFile);
