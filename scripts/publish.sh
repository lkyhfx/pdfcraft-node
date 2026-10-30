#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/package-native.sh
bash scripts/test-package.sh
version="$(node -p "require('./npm/package.json').version")"
for suffix in -linux-x64-gnu -linux-arm64-gnu ''; do
  npm publish "./npm-dist/lkyhfx-pdfcraft-node$suffix-$version.tgz" --access public
done
