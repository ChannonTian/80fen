#!/usr/bin/env python3
"""Keep a freshly loaded page from mixing cached scripts with newer styles."""
from hashlib import sha256
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1] / 'dist'
for page in root.glob('*.html'):
    source = page.read_text()
    def version(match):
        asset = root / match[2]
        if not asset.is_file():
            raise SystemExit(f'Missing local asset: {asset}')
        digest = sha256(asset.read_bytes()).hexdigest()[:12]
        return f'{match[1]}{match[2]}?v={digest}{match[3]}'
    source = re.sub(r'((?:src|href)=")([^"?:]+\.(?:js|css))(?:\?v=[a-f0-9]+)?(")', version, source)
    page.write_text(source)
print('Local script and style URLs match their content versions.')
