# Verification — 2026-10-30

Node 24.20.0, Rust 1.97.0; PDFCraft v0.15.0 at
75360d1d7db06fed974f48c914d4c04132757187. Scope is this independent npm package.

Stage 1 was independently built and installed from tarballs, then committed as
`aaf6223` before page/rendering work began. Both GNU architectures compiled;
six compression integration cases passed on x64.

Final checks: **14 installed-tarball integration tests and 6 Rust tests passed**;
`cargo clippy -- -D warnings`, shell syntax and whitespace checks passed. The same
14 integration tests passed using registry-downloaded modules in
`node:24-bookworm-slim` with network disabled during testing and no cargo, gs or
mutool installed. Image: pdfcraft-node-test:0.1.0.
Main package contains JS/types/docs/notices; the two platform packages contain native
binaries/notices. ESM named exports were smoke-checked.

Stage 2 covers native compression, info, ordered merge/selection (including duplicates),
remove, replacement of arbitrary/all pages, split, file operations, batch bisection,
rotation/UserUnit, PNG rendering, SVG security and Chinese embedded fonts.
Native preservation tests cover bookmarks, form/catalog references, attachments,
metadata, tags/layers, unchanged decoded image samples, duplicate resources with
custom trailer references, real AES encryption refusal,
inline signatures, catalog version references and original-output fallback.

## Real-document controls

Seven existing local PDFs from the reference wordcraft-doc fixture corpus were read
without redistributing them. A generated Chinese embedded-font PDF is included in
our fixtures. All three compression modes and first-page renders completed on all
eight files; every PDFCraft compression output had exactly the original pdftotext
result. Two actual signed PDFs from upstream sign tests were refused. Ordinary
structural compression reduced the real corpus by roughly 9–14%; these small PDFs
have no large scan images, so the three modes produce the same sizes.

Balanced-mode comparison (bytes, milliseconds, sampled PDFCraft process-tree RSS):

| File | Input | PDFCraft | ms | RSS MiB | GS control | ms |
|---|---:|---:|---:|---:|---:|---:|
| 47304.pdf | 8315 | 7548 | 70 | 103.3 | 7424 | 48 |
| SampleDoc.pdf | 21911 | 19549 | 80 | 103.5 | 19260 | 58 |
| empty.pdf | 2172 | 1969 | 87 | 103.2 | 2261 | 54 |
| rich-structures.pdf | 56108 | 48037 | 86 | 103.6 | 44675 | 75 |
| simple-table.pdf | 14804 | 13066 | 80 | 103.4 | 12992 | 47 |
| test.pdf | 36796 | 31436 | 80 | 103.6 | 30394 | 53 |
| testWORD.pdf | 59624 | 51347 | 80 | 103.6 | 50891 | 69 |

Raw measurements: tests/results/reference-benchmark.json and chinese-benchmark.json.
GS uses /prepress, /ebook, /screen reference presets; these are controls, not matched
implementations of the package's modes. Timing includes Node/worker startup and file
I/O. RSS samples sum parent and descendants every 5 ms, not allocator-exact peaks.
MuPDF first-page PNGs were also generated at 72 DPI for the same files. A text-heavy
page and the Chinese PDF were visually spot-checked; no visible missing text or
layout shift was found. Pixel equivalence and whole-corpus visual acceptance are
not claimed. Reference tools are development controls only.

## Large-file and cancellation checks

A deterministic 105655212-byte, 264-page source was extracted into 128/128/8-page
files by one native task in 457 ms; sampled process-tree peak RSS 374513664 bytes
(357.2 MiB). No source Buffer was loaded in JS. Native serialization still holds
one candidate and its verification copy at a time; parsing is memory-based.
A second run read a **320168444-byte, 800-page** source and extracted pages 1–264:
3100 ms, sampled process-tree peak RSS 588206080 bytes (561.0 MiB). That run overlapped
other build/test activity, so its timing is not directly comparable to the smaller run.
Full 800-page extraction was not attempted because raw aggregate outputs would exceed
the configured 256 MiB ceiling. See tests/results/batch-memory-320mb.json.
See tests/results/batch-memory.json. The measured input is synthetic, not a scan.

Aborting and timing out this 105 MB task after 100 ms both rejected after about
120 ms with CANCELLED/TIMEOUT, after worker exit. No staged/partial files remained.
Ordinary integration tests also exercise pre-abort, live cancellation, timeout,
concurrent calls, immediate input ownership, output caps, failed atomic writes,
same-path replacement and cleanup after batch failures.

## Platform and packaging

Linux x64 runs the entire integration suite. Linux arm64 GNU cross compilation and
QEMU/Node 24.10.0 smoke calls cover compression, info, repeated selection, PDF PNG and
SVG PNG. QEMU validation is not physical ARM hardware performance validation.
The x64 addon links only libc, libm and libgcc_s; current x64 glibc minimum is 2.35.

Packaging includes a cargo-about dependency license report plus explicit font,
CMap and ICC notices. Main and both platform tarballs are generated in npm-dist.
Installed-tarball tests use offline npm with install scripts disabled.

## Known limits / not accepted as tested

- No full real scan/seal/JBIG2/CCITT/CMYK/complex-transparency corpus acceptance.
- No comprehensive malformed-PDF fuzzer campaign or exact allocation accounting.
- No physical ARM64 host test. RSS watchdog sampling can overshoot; RLIMIT_DATA
  bounds data allocations, not the process's entire virtual address space.
- Rendering checks cannot prove fidelity for every PDF feature. Nonstandard missing
  fonts and upstream truncation/colour fallback fail explicitly.
- Tagged/article-thread page edits, XFA rewrites, signed rewrites, encrypted PDFs,
  repaired files and version downgrades are refused. Compression retains tags.
- Page import does not merge every source's document-level metadata/bookmarks or
  attachments; see README. It does not add synthetic top-level bookmarks.
- ZIP creation, storage/upload manifests, application recovery and integration code
  are outside this generic package. Registry delivery is verified separately after publication.

## Registry release 0.1.0

Published all three public npm packages, platform packages before the main package:

- @lkyhfx/pdfcraft-node
- @lkyhfx/pdfcraft-node-linux-x64-gnu
- @lkyhfx/pdfcraft-node-linux-arm64-gnu

Fresh-cache installation from https://registry.npmjs.org automatically selected the
x64 optional dependency; all 14 integration tests passed. A second fresh-cache
installation with npm's Linux/arm64/glibc target override fetched the ARM64 optional
dependency, whose native compression/info/duplicate-page/PDF-render/SVG-render calls
passed under QEMU and ARM64 Node 24.10.0. The actual downloaded x64 modules were then
mounted into a clean, network-disabled Node 24 container; all 14 tests passed again.
Installation used --ignore-scripts and required no Rust or PDF tooling.

Registry download URLs and SHA-512 integrities are recorded in
`tests/results/registry-0.1.0.json` and match local release tarballs. Initial npm
publication was accepted before download propagation completed; verification above
was performed only after the registry served the packages successfully.

The publish script uses explicit `./npm-dist/` paths: without `./`, npm interpreted
the tarball path as GitHub shorthand. The corrected path passed dry-run and actual
publication. Both upstream-sync success and dirty-worktree refusal were exercised.
