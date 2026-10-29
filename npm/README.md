# @lkyhfx/pdfcraft-node

PDFCraft Rust bindings for Node.js 24, Linux x64/arm64 glibc. No PDF command-line
tools are required. Prebuilt platform packages install through optionalDependencies.
License: MIT OR Apache-2.0; third-party notices accompany every binary package.

```js
const { compressPdf, compressPdfFile } = require('@lkyhfx/pdfcraft-node')
const smaller = await compressPdf(buffer, { mode: 'balanced', timeoutMs: 120000 })
await compressPdfFile('/input.pdf', '/output.pdf', { mode: 'lossless' })
```

All calls return Promises. See index.d.ts for options. Modes: lossless does not
actively lower image quality (it is not byte-level losslessness); balanced uses
150 PPI above 225 PPI with JPEG quality 60; strong uses 96 PPI above 144 PPI with
JPEG quality 60. Unsupported image encodings stay intact. Output is reparsed and
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
