#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p npm-dist
(cd native && cargo about generate ../scripts/third-party-licenses.hbs) > npm-dist/THIRD-PARTY-LICENSES.md
[[ -s npm-dist/THIRD-PARTY-LICENSES.md ]]
for license in upstream/pdfcraft/assets/fonts/OFL-*.txt; do
  printf '\n## Bundled font: %s\n\n' "$(basename "$license")" >> npm-dist/THIRD-PARTY-LICENSES.md
  cat "$license" >> npm-dist/THIRD-PARTY-LICENSES.md
done
for license in upstream/pdfcraft/vendor/hayro-interpret/assets/LICENSE_FOXIT upstream/pdfcraft/vendor/hayro-interpret/assets/CGATS_LICENSE.txt upstream/pdfcraft/vendor/hayro-cmap/assets/LICENSE.txt; do
  printf '\n## Bundled rendering asset: %s\n\n' "$license" >> npm-dist/THIRD-PARTY-LICENSES.md
  cat "$license" >> npm-dist/THIRD-PARTY-LICENSES.md
done
cp LICENSE-MIT LICENSE-APACHE NOTICE README.md npm/
cp npm-dist/THIRD-PARTY-LICENSES.md npm/
node scripts/package-native.js
