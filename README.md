# @lkyhfx/pdfcraft-node

PDFCraft Rust bindings for Node.js 24, Linux x64/arm64 glibc. No PDF command-line
tools are required. Prebuilt platform packages install through optionalDependencies.
License: MIT OR Apache-2.0; third-party notices accompany every binary package.

```sh
npm install @lkyhfx/pdfcraft-node
```

```js
const { compressPdf, compressPdfFile } = require('@lkyhfx/pdfcraft-node')
const smaller = await compressPdf(buffer, { mode: 'balanced', timeoutMs: 120000 })
await compressPdfFile('/input.pdf', '/output.pdf', { mode: 'lossless' })
```

All calls return Promises. See index.d.ts for options. Modes: lossless does not
actively lower image quality (it is not byte-level losslessness); balanced uses
150 PPI above 225 PPI with JPEG quality 60; strong uses 96 PPI above 144 PPI with
JPEG quality 60. Duplicate resources are merged and unused objects are cleaned on full rewrite.
Unsupported image encodings stay intact. Output is reparsed and
page counts verified. Compression returns original bytes if output is not smaller.

Compatibility defaults to retain; object streams can raise the version to 1.5.
Explicit 1.4 disables object streams. Version downgrades are refused because
upstream does not convert newer features. Encrypted, signed, XFA and PDFs requiring
parser repairs are refused for rewriting. Hidden-information removal is never used.

Calls run in disposable Node subprocesses loading the addon directly. AbortSignal
and timeout terminate the subprocess and await its exit before rejecting; no detached
native work continues. Two workers and 16 queued requests maximum per loaded package
instance. Queue-retained input buffers have an aggregate 512 MiB ceiling. Each worker
uses one libuv native task, a 1.5 GiB data allocation limit and a 1.5 GiB RSS watchdog.
The watchdog is sampled and is not an exact RSS hard cap. Allocation aborts are isolated.
Do not load the private native execute entry point in a shared application process.

Defaults/hard ceilings: input 512 MiB, output 256 MiB, 10000 pages, timeout 120 seconds
(maximum 300 seconds). Limits can be lowered by options. File operations read in native
threads, use same-directory staging and atomic replacement after successful worker
exit. Failed/cancelled operations preserve existing outputs. Buffer APIs snapshot their
input immediately and spool it to temporary files; file APIs avoid this extra copy.
Parsing is memory-based, not streaming. Temporary files use private directories.

Errors expose stable `ERR_PDFCRAFT_` codes: INVALID_ARGUMENT, INVALID_PDF,
PASSWORD_REQUIRED, UNSUPPORTED, PAGE_RANGE, INPUT_TOO_LARGE, OUTPUT_TOO_LARGE,
RENDER, CANCELLED, TIMEOUT, BUSY, RESOURCE_LIMIT, IO and PANIC.

Build: `git submodule update --init --recursive`, then `bash scripts/build-native.sh`.
Rust 1.97 and Node 24 were used. `--target all` builds both platforms; cross builds
need an aarch64 GNU linker (`AARCH64_LINKER`). `npm test` runs native integration tests.
`bash scripts/package-native.sh` requires cargo-about and produces three npm tarballs.
`bash scripts/test-package.sh` installs and tests tarballs offline without install scripts.
`bash scripts/publish.sh` manually publishes platform packages before the main package.
No GitHub Actions are installed.

```js
const pdf = require('@lkyhfx/pdfcraft-node')
const info = await pdf.getPdfInfoFile('/input.pdf')
const reordered = await pdf.selectPdfPages(buffer, [3, 1, 3])
const replaced = await pdf.replacePdfPages(buffer, replacement, [1, 3])
const parts = await pdf.splitPdf(buffer, [{ start: 1, end: 2 }, { start: 3, end: 3 }])
await pdf.renderPdfPageFile('/input.pdf', 1, '/page.png', { dpi: 144 })
const png = await pdf.renderSvgToPng('<svg width="20" height="10" xmlns="http://www.w3.org/2000/svg"/>')
const manifest = await pdf.extractPdfRangesFile('/large.pdf', '/existing-output-dir',
  [{ start: 1, end: info.pageCount }], { maxRangePages: 128, maxBatchBytes: 20 * 1024 * 1024 })
```

Page numbers and range endpoints are **1-based**, endpoints inclusive. Selection
preserves supplied order and duplicates. Remove treats duplicates as the same
original page and refuses deletion of all pages. Replace deletes selected originals
and inserts the entire replacement at the earliest selected position. Merge appends
pages in input order and renames colliding incoming form-field names; it adds no new
top-level bookmarks. Existing bookmarks of the first document remain; incoming
bookmarks, attachments and document-level metadata are not merged by page import.

`getPdfInfo` / `getPdfInfoFile` return page count, effective version and each visible
page's point dimensions, rotation and orientation. `mergePdfs`, `mergePdfFiles`,
`selectPdfPages`, `removePdfPages`, `replacePdfPages`, `splitPdf`, and
`extractPdfPagesFile` provide page operations. Page editing refuses tagged documents
and article threads because upstream import does not preserve their full structure.
Compression preserves tags. Page extraction carries supported source information,
print standard and bookmarks targeting copied pages; attachments and arbitrary
catalog extensions are not automatically copied. Forms, annotation references and
layers use upstream import semantics; links to omitted pages are removed.

`extractPdfRangesFile` reads/parses once, limits initial ranges to 128 pages, writes
sequentially, recursively bisects oversized results and errors if one page is still
too large. It returns up to 128 files with unique names and page/size metadata. Output
directory must exist. Aggregate output limit still applies. Completed outputs are
published after native success; failure removes this call's newly published files.
A process crash during the publication loop may leave some unique output files;
there is no filesystem-wide atomic multi-file transaction or persistent batch cache.
The caller can persist returned manifests and choose remaining ranges for recovery.

PDF rendering uses PDFCraft-render, default 144 DPI, PNG output, up to 8192 per side
and 32 million pixels. Crop/rotation/UserUnit come from the upstream parser.
Transparency is supported, and premultiplied pixels are converted to straight alpha.
Rendering fails on reported content truncation/colour fallback and nonstandard fonts
without embedded font programs. No whole CJK fallback font is bundled; embed fonts
in production PDFs. Standard-14 fallback fonts are included by upstream. These checks
cannot certify perfect rendering of every possible PDF feature.

SVG rendering uses resvg/usvg locally, preserves transparent backgrounds and accepts
optional width/height (one dimension preserves aspect ratio). SVG input is capped at
8 MiB. DTD/entities, scripts, handlers, animation, foreignObject, external resource
references, CSS imports and escapes are rejected. Only internal fragment references
and embedded PNG/JPEG data-image hrefs are allowed; the string image resolver is
disabled. System fonts can be read for text; SVG-controlled filesystem/network
resources are never loaded. SVG text appearance depends on installed fonts.

`bash scripts/test-native.sh` verifies native preservation and encryption guards.
`node scripts/check-corpus.js <directory>` checks a local PDF corpus.
`python3 scripts/benchmark.py <corpus> <output> --compare` is an optional development
benchmark using installed reference engines and pdftotext. These controls are not
packaged dependencies. See TEST-RESULTS.md for measurements and remaining coverage.
`docker build -f tests/Dockerfile -t pdfcraft-node-test .` validates tarballs in a clean
Node 24 image with no Rust or system PDF tools. Current prebuilt x64 binary requires
glibc >= 2.35; build on an older glibc host if an older deployment baseline is needed.
