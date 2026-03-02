const fs = require('fs');

let uiContent = fs.readFileSync('src/ui.js', 'utf8');

// Find the start of populateZonesMenu
const idxStart = uiContent.indexOf('export function populateZonesMenu() {');
// Find the end by looking for updateSelectionModeButton
const idxEnd = uiContent.indexOf('export function updateSelectionModeButton(isActive) {');

if (idxStart !== -1 && idxEnd !== -1) {
    const filtersCode = uiContent.substring(idxStart, idxEnd);
    fs.writeFileSync('src/ui-filters.js', `import { state, POI_CATEGORIES } from './state.js';
import { applyFilters } from './data.js';
import { getZonesData } from './circuit-actions.js';
import { escapeXml } from './utils.js';
import { loadCircuitById } from './circuit.js';
import { switchSidebarTab } from './ui-sidebar.js';

` + filtersCode);

    uiContent = uiContent.substring(0, idxStart) + uiContent.substring(idxEnd);
    fs.writeFileSync('src/ui.js', uiContent);
    console.log("Filters extracted to src/ui-filters.js");
} else {
    console.log("Could not find boundaries in src/ui.js", idxStart, idxEnd);
}
