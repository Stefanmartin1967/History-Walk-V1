import re

with open('src/circuit-actions.js', 'r') as f:
    actions_content = f.read()

# Read the extracted code
with open('move_gpx_functions.py', 'r') as f:
    move_code = f.read()

# Let's just directly add the extracted functions to the end of circuit-actions.js

with open('src/gpx.js', 'r') as f:
    # Original code to extract exactly from Git history if possible, but we already have the strings.
    pass

import subprocess

cmd = """
cat src/gpx.js | node --input-type=module -c
"""

subprocess.run(cmd, shell=True)
