# Upstream

PDFCraft v0.15.0, commit `75360d1d7db06fed974f48c914d4c04132757187`.
Source: https://github.com/storytold/pdfcraft, submodule `upstream/pdfcraft`.
MIT OR Apache-2.0; no upstream source modifications.

Native dependencies: cos, optimize and organize. Their transitive content/model,
annotation, fonts and codec dependencies are retained. No engine, CLI or GUI.
The standalone native workspace mirrors upstream vendor path patches and locks
all dependencies in Cargo.lock. A registry-only build fails because content
requires the patched hayro-syntax TypedIter API.
