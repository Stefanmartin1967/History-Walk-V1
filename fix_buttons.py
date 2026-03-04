import os
import re

directory = "src"

# This script finds buttons with a 'title' attribute but NO 'aria-label'
# and adds 'aria-label="value_of_title"'

for root, dirs, files in os.walk(directory):
    for file in files:
        if file.endswith(".js"):
            filepath = os.path.join(root, file)
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()

            # Regex to find <button ... title="something" ... > without aria-label
            # We want to match the whole <button ... > tag

            def repl(match):
                tag = match.group(0)
                if 'aria-label' in tag:
                    return tag # Skip if already has aria-label

                # Extract title
                title_match = re.search(r'title="([^"]+)"', tag)
                if not title_match:
                    title_match = re.search(r"title='([^']+)'", tag)

                if title_match:
                    title_val = title_match.group(1)
                    # Insert aria-label right after title
                    new_tag = tag.replace(title_match.group(0), f'{title_match.group(0)} aria-label="{title_val}"')
                    return new_tag
                return tag

            new_content = re.sub(r'<button[^>]+title=[\'"][^\'"]+[\'"][^>]*>', repl, content)

            if new_content != content:
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(new_content)
                print(f"Updated {filepath}")
