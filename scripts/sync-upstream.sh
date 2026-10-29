#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $# == 1 ]] || { echo 'usage: sync-upstream.sh <tag-or-commit>' >&2; exit 1; }
[[ -z $(git status --porcelain) && -z $(git -C upstream/pdfcraft status --porcelain) ]] || { echo 'clean worktree required' >&2; exit 1; }
old="$(git -C upstream/pdfcraft rev-parse HEAD)"
backup="$(mktemp -d)"
cp native/Cargo.toml native/Cargo.lock UPSTREAM.md "$backup/"
restore() {
  code=$?
  if (( code != 0 )); then
    git -C upstream/pdfcraft checkout --detach "$old"
    cp "$backup/Cargo.toml" "$backup/Cargo.lock" native/
    cp "$backup/UPSTREAM.md" .
    echo 'sync failed; pin and manifests restored; rebuild before using local binaries' >&2
  fi
  rm -rf "$backup"
}
trap restore EXIT
git -C upstream/pdfcraft fetch --depth=1 -- origin "$1"
git -C upstream/pdfcraft checkout --detach "$(git -C upstream/pdfcraft rev-parse --verify 'FETCH_HEAD^{commit}')"
python3 scripts/sync-patches.py
cargo generate-lockfile --manifest-path native/Cargo.toml
bash scripts/build-native.sh --target all
bash scripts/test-native.sh
npm test
bash scripts/package-native.sh
bash scripts/test-package.sh
python3 - "$1" <<'PY'
from pathlib import Path
import subprocess,sys
p=Path('UPSTREAM.md')
s=p.read_text()
revision=subprocess.check_output(['git','-C','upstream/pdfcraft','rev-parse','HEAD'],text=True).strip()
s=s.replace(s.splitlines()[2], 'PDFCraft '+sys.argv[1]+', commit `'+revision+'`.')
s+='\nVerified sync: '+sys.argv[1]+' (`'+subprocess.check_output(['git','-C','upstream/pdfcraft','rev-parse','HEAD'],text=True).strip()+'`). Native build, API compile checks and smoke tests passed.\n'
p.write_text(s)
PY
# Deliberately no commit, tag or publish.
