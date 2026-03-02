const fs = require('fs');
const path = require('path');

const fileContent = fs.readFileSync(path.resolve('src/ui.js'), 'utf-8');

// A very simple regex to capture the function blocks.
// Warning: this works well only for functions formatted correctly and might have limitations if nested braces exist at top level inside.
