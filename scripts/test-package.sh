#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
version="$(node -p "require('./npm/package.json').version")"
arch="$(node -p 'process.arch')"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
(cd "$temp" && npm init -y >/dev/null && npm install --ignore-scripts --offline --omit=optional "$root/npm-dist/lkyhfx-pdfcraft-node-$version.tgz" "$root/npm-dist/lkyhfx-pdfcraft-node-linux-$arch-gnu-$version.tgz")
PDFCRAFT_TEST_PACKAGE="$temp/node_modules/@lkyhfx/pdfcraft-node" node --test --test-isolation=none tests/*.test.js
