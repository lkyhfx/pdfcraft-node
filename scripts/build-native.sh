#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
target="${2:-$(rustc -vV | awk '/^host:/ {print $2}')}"
[[ $# == 0 || ( $# == 2 && $1 == --target ) ]] || { echo 'usage: build-native.sh [--target <triple|all>]' >&2; exit 1; }
if [[ $target == all ]]; then
  bash "$0" --target x86_64-unknown-linux-gnu
  exec bash "$0" --target aarch64-unknown-linux-gnu
fi
case "$target" in
  x86_64-unknown-linux-gnu) suffix=linux-x64-gnu ;;
  aarch64-unknown-linux-gnu) suffix=linux-arm64-gnu
    if [[ $(rustc -vV | awk '/^host:/ {print $2}') != "$target" && -z ${AARCH64_LINKER:-} ]]; then
      AARCH64_LINKER="$(command -v aarch64-linux-gnu-gcc || command -v aarch64-unknown-linux-gnu-gcc || true)"
      [[ -n $AARCH64_LINKER ]] || { echo 'cross build requires AARCH64_LINKER or a GNU aarch64 linker on PATH' >&2; exit 1; }
    fi
    if [[ -n ${AARCH64_LINKER:-} ]]; then
      export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER="$AARCH64_LINKER"
      export CC_aarch64_unknown_linux_gnu="$AARCH64_LINKER"
    fi ;;
  *) echo 'unsupported target' >&2; exit 1 ;;
esac
# Keep optional external font bundles out of reproducible published binaries.
unset CRAFT_FONTS_DIR CRAFT_FONTS_REQUIRED
cargo build --manifest-path native/Cargo.toml --release --locked --target "$target"
cp "native/target/$target/release/libpdfcraft_node.so" "npm/pdfcraft-node.$suffix.node"
