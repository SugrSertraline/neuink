# PDFium binary provenance

- Upstream release: [pdfium-binaries chromium/8125](https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium%2F8125) (PDFium 158.0.8125.0).
- Asset: [pdfium-win-x64.tgz](https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F8125/pdfium-win-x64.tgz), SHA-256 `9a964261760cff52570aabf038ab346d3a5034dd8b30d0d5fe8861235d356b8b`.
- Bundled `pdfium.dll`: SHA-256 `4b0dec92555d69437bef0df37be630181ab3e83a6823ca264ede355a4f2ef994`. It matched `bin/pdfium.dll` in the downloaded archive byte for byte.
- The archive's 18 files under `licenses/` match the files here; its root `LICENSE` matches `pdfium-binaries-LICENSE.txt` (SHA-256 comparisons).
- Checked 2026-11-16. The bundled binary targets Windows x64 only; the Tauri resource list does not supply native PDFium libraries for other platforms. Cross-platform packaging and the upstream project's policy on vendored binaries still require review. This comparison does not constitute a legal opinion.
