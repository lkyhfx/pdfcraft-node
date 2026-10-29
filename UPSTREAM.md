# Upstream

PDFCraft v0.15.0, commit `75360d1d7db06fed974f48c914d4c04132757187`.
Source: https://github.com/storytold/pdfcraft, submodule `upstream/pdfcraft`.
MIT OR Apache-2.0; no upstream source modifications.

Native dependencies: cos, optimize and organize. Their transitive content/model,
annotation, fonts and codec dependencies are retained. No engine, CLI or GUI.
The standalone native workspace mirrors upstream vendor path patches and locks
all dependencies in Cargo.lock. A registry-only build fails because content
requires the patched hayro-syntax TypedIter API.

Stage 2 additionally links pdfcraft-render and patched hayro-syntax for geometry,
and resvg/usvg for SVG. All eight upstream vendor path patches are mirrored: hayro,
hayro-interpret, hayro-syntax, hayro-cmap, hayro-postscript, hayro-jbig2, lopdf and
vello_common. Desktop egui/winit git patches are not needed and are excluded.
No OCR, editor, engine, GUI, MCP or CLI crate is linked.

Font/CMap/ICC assets: PDFCraft Inter/Dancing Script (SIL OFL), Hayro's Foxit standard
fonts (PDFium/Foxit BSD notice), Adobe CMaps (BSD notice) and CGATS ICC profile (CC0).
Asset notices are appended explicitly to cargo-about's crate-license report.
Optional external craft-fonts must not be enabled without extending those notices.
The build uses no external craft-fonts checkout.

To update: start with a clean superproject and submodule, run
`scripts/sync-upstream.sh <tag-or-commit>` with both GNU toolchains, cargo-about and
Node available. The script syncs vendor path patches, refreshes Cargo.lock, builds
both architectures (compilation checks every consumed Rust API), runs native and JS
smoke tests, packages, performs installed-tarball tests and appends the verified pin.
Failure restores the old pin/manifests; rebuild binaries after a failed attempt.
No automatic commit, tag or publishing. New upstream APIs may require wrapper
adaptations; a failed build is a compatibility failure, never a reason to patch upstream.

Verified sync: v0.15.0 (`75360d1d7db06fed974f48c914d4c04132757187`). Native build, API compile checks and smoke tests passed.
