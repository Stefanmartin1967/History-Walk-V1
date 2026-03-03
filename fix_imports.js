const fs = require('fs');

function replaceImport(file, fromModule, oldImport, newImport) {
    let content = fs.readFileSync(file, 'utf8');
    const importRegex = new RegExp(`import\\s+\\{([^}]*)\\}\\s+from\\s+['"]\\.\\/${fromModule}\\.js['"];`);
    content = content.replace(importRegex, (match, p1) => {
        let imports = p1.split(',').map(s => s.trim());
        if (imports.includes(oldImport)) {
            imports = imports.filter(i => i !== oldImport);
            let newMatch = `import { ${imports.join(', ')} } from './${fromModule}.js';`;
            if (imports.length === 0) {
                newMatch = ''; // Remove entirely if empty
            }
            // Add the new import from the new module
            return newMatch;
        }
        return match;
    });

    // Add the new import if needed
    if (newImport && !content.includes(`import { ${oldImport} } from './${newImport}.js';`)) {
        // Just inject at the top
        content = `import { ${oldImport} } from './${newImport}.js';\n` + content;
    }

    fs.writeFileSync(file, content);
}

// ui-circuit-editor.js needs saveAndExportCircuit from circuit-actions.js instead of gpx.js
let uiEditor = fs.readFileSync('src/ui-circuit-editor.js', 'utf8');
uiEditor = uiEditor.replace(/import\s+\{\s*saveAndExportCircuit\s*\}\s*from\s*'\.\/gpx\.js';/, "import { saveAndExportCircuit } from './circuit-actions.js';");
fs.writeFileSync('src/ui-circuit-editor.js', uiEditor);

// Wait, UI circuit editor also imports saveAndExportCircuit! Let's check it.
