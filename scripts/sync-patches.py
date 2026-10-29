"""Mirror required upstream vendor patches without pulling desktop git patches."""
from pathlib import Path
import tomllib
root = Path(__file__).resolve().parent.parent
manifest = root / 'native/Cargo.toml'
upstream = tomllib.loads((root / 'upstream/pdfcraft/Cargo.toml').read_text())
patches = upstream.get('patch', {}).get('crates-io', {})
text = manifest.read_text().split('[patch.crates-io]')[0] + '[patch.crates-io]\n'
for name, patch in patches.items():
    if 'path' in patch:
        text += f'{name} = {{ path = "../upstream/pdfcraft/{patch["path"]}" }}\n'
manifest.write_text(text)
