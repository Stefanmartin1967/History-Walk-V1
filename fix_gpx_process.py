import re

with open('src/gpx.js', 'r') as f:
    content = f.read()

# Make sure computeCircuitCounters is still in circuit-actions and processImportedGpx doesn't need it.
# Oh, processImportedGpx might use generateCircuitName from circuit.js. Let's make sure it imports it.
if 'import { generateCircuitName' not in content:
    content = re.sub(r"import \{ loadCircuitById \} from '\.\/circuit\.js';", "import { loadCircuitById, generateCircuitName } from './circuit.js';", content)

with open('src/gpx.js', 'w') as f:
    f.write(content)
