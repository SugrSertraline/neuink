import { describe, expect, it } from 'vitest';

import { createPdfDocumentOptions } from './pdfDocumentOptions';

describe('createPdfDocumentOptions', () => {
  it('configures every PDF.js decoder resource from the app origin', () => {
    const pdfBytes = new Uint8Array([1, 2, 3]);
    const options = createPdfDocumentOptions(
      pdfBytes,
      'https://neuink.local/library/current-entry'
    );

    expect(options).toEqual({
      data: pdfBytes,
      cMapUrl: 'https://neuink.local/pdfjs-assets/cmaps/',
      cMapPacked: true,
      iccUrl: 'https://neuink.local/pdfjs-assets/iccs/',
      standardFontDataUrl: 'https://neuink.local/pdfjs-assets/standard_fonts/',
      wasmUrl: 'https://neuink.local/pdfjs-assets/wasm/',
      useWasm: true
    });
  });
});
