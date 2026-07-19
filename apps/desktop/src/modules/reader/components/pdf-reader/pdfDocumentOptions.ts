const PDFJS_ASSET_PATH = '/pdfjs-assets/';

export function createPdfDocumentOptions(
  pdfBytes: Uint8Array,
  baseUri = document.baseURI
) {
  const assetRoot = new URL(PDFJS_ASSET_PATH, baseUri).href;

  return {
    data: pdfBytes,
    cMapUrl: `${assetRoot}cmaps/`,
    cMapPacked: true,
    iccUrl: `${assetRoot}iccs/`,
    standardFontDataUrl: `${assetRoot}standard_fonts/`,
    wasmUrl: `${assetRoot}wasm/`,
    useWasm: true
  };
}
