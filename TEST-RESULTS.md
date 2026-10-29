# Verification

Stage 1 (2026-10-30, Node 24.20.0 / Rust 1.97.0)

- Linux x64 and arm64 GNU release addons compiled against pinned PDFCraft v0.15.0.
- Six compression integration cases passed on x64, including all three modes,
  PDF 1.4/1.5/1.7, synthetic images and rich catalog, validation, signed-PDF refusal,
  atomic file failure/same-path replacement, active cancellation, hard timeout,
  parallel calls and input snapshot ownership.
- Fixtures are deterministic synthetic PDFs. Real CJK/seal/scan/complex transparency
  acceptance and comparisons to other PDF engines are not claimed.
