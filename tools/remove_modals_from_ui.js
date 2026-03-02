const fs = require('fs');

let uiContent = fs.readFileSync('src/ui.js', 'utf8');

// Find the index of export function showLegendModal()
const idx = uiContent.indexOf('export function showLegendModal() {');
if (idx !== -1) {
    uiContent = uiContent.substring(0, idx);
    fs.writeFileSync('src/ui.js', uiContent);
    console.log("Modals removed from src/ui.js");
} else {
    console.log("Could not find showLegendModal in src/ui.js");
}
