const fs = require('fs');

let testContent = fs.readFileSync('tests/gpx_performance.test.js', 'utf8');

// The file needs jsdom environment because circuit-actions.js imports things that depend on UI and window.
if (!testContent.includes('@vitest-environment jsdom')) {
    testContent = "/**\n * @vitest-environment jsdom\n */\n" + testContent;
    fs.writeFileSync('tests/gpx_performance.test.js', testContent);
}
