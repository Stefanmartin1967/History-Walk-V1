import fs from 'fs';
import path from 'path';

const srcDir = './src';

function checkImports() {
    let allValid = true;
    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

    for (const file of files) {
        const filePath = path.join(srcDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Simple regex to find import statements
        const importRegex = /import\s+({[^}]+}|\*\s+as\s+[a-zA-Z0-9_]+|[a-zA-Z0-9_]+)\s+from\s+['"]([^'"]+)['"]/g;
        let match;

        while ((match = importRegex.exec(content)) !== null) {
            const importPath = match[2];
            // Only check local imports
            if (importPath.startsWith('./') || importPath.startsWith('../')) {
                const resolvedPath = path.resolve(path.dirname(filePath), importPath);
                if (!fs.existsSync(resolvedPath)) {
                    console.error(`Invalid import in ${file}: ${importPath} -> ${resolvedPath} not found`);
                    allValid = false;
                }
            }
        }
    }

    if (allValid) {
        console.log('All local imports resolve successfully!');
    }
}

checkImports();
