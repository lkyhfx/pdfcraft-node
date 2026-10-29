#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Rust tests run outside Node; load N-API symbols dynamically in this test build only.
cargo test --manifest-path native/Cargo.toml --locked --lib --features napi/dyn-symbols
