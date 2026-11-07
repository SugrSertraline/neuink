import { describe, expect, it } from 'vitest';

import { readPageBoxes, visibleBoxFromBoxes } from './pdfPageBoxes';
import { buildReadingPdfFixture, READING_PDF_FIXTURES } from './testFixtures/buildReadingPdfFixtures';
import { appendRevision, classicPdf, compressedPdf, pageTreeBodies } from './testFixtures/pdfStructureFixtures';

const LETTER_PAGE = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>';

function textOf(bytes: Uint8Array) {
  return new TextDecoder('latin1').decode(bytes);
}

function bytesOf(text: string) {
  return new TextEncoder().encode(text);
}

describe('readPageBoxes with classic cross-reference tables', () => {
  it('reads MediaBox and CropBox from the fixtures, including a CropBox that differs from the MediaBox', async () => {
    const result = await readPageBoxes(buildReadingPdfFixture(READING_PDF_FIXTURES.crop_box));
    expect(result).toEqual({
      proof: 'independent',
      pages: [
        { media_box: [0, 0, 612, 792], crop_box: [36, 36, 576, 756] },
        { media_box: [0, 0, 612, 792], crop_box: [0, 0, 612, 792] }
      ]
    });
  });

  it('follows page-tree inheritance, indirect boxes, and the CropBox default', async () => {
    const result = await readPageBoxes(
      classicPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 612 792] /CropBox 5 0 R >>',
        '<< /Type /Page /Parent 2 0 R >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 700] >>',
        '[10 10 600 780]'
      ])
    );
    expect(result).toEqual({
      proof: 'independent',
      pages: [
        { media_box: [0, 0, 612, 792], crop_box: [10, 10, 600, 780] },
        { media_box: [0, 0, 500, 700], crop_box: [10, 10, 600, 780] }
      ]
    });
  });

  it('keeps MediaBox and CropBox separate when only the MediaBox differs', async () => {
    const candidate = await readPageBoxes(
      buildReadingPdfFixture({
        producer: 'boxes',
        pages: [{ mediaBox: [0, 0, 620, 800], cropBox: [0, 0, 600, 780], text: 'A' }]
      })
    );
    const origin = await readPageBoxes(
      buildReadingPdfFixture({
        producer: 'boxes',
        pages: [{ mediaBox: [0, 0, 612, 792], cropBox: [0, 0, 600, 780], text: 'A' }]
      })
    );
    expect(candidate.proof === 'independent' && origin.proof === 'independent').toBe(true);
    if (candidate.proof !== 'independent' || origin.proof !== 'independent') return;
    expect(candidate.pages[0].crop_box).toEqual(origin.pages[0].crop_box);
    expect(candidate.pages[0].media_box).not.toEqual(origin.pages[0].media_box);
  });

  it('reports unavailable when a page has no MediaBox anywhere in its chain', async () => {
    const result = await readPageBoxes(
      classicPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R >>'
      ])
    );
    expect(result.proof).toBe('unavailable');
  });

  it('reports unavailable for a MediaBox with three numbers', async () => {
    const result = await readPageBoxes(classicPdf(pageTreeBodies(['<< /Type /Page /MediaBox [0 0 612] >>'])));
    expect(result.proof).toBe('unavailable');
  });

  it('reports unavailable when /Count disagrees with the page tree', async () => {
    const result = await readPageBoxes(
      classicPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 2 >>',
        LETTER_PAGE
      ])
    );
    expect(result.proof).toBe('unavailable');
  });

  it('reports unavailable for a page tree that contains itself', async () => {
    const result = await readPageBoxes(
      classicPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 1 >>',
        LETTER_PAGE
      ])
    );
    expect(result.proof).toBe('unavailable');
  });

  it('reports unavailable when the trailer Root is not a catalog, instead of letting pdf-lib choose one', async () => {
    const result = await readPageBoxes(classicPdf(pageTreeBodies([LETTER_PAGE]), { root: 2 }));
    expect(result.proof).toBe('unavailable');
  });

  it('reports unavailable for an encrypted file', async () => {
    const result = await readPageBoxes(
      classicPdf([...pageTreeBodies([LETTER_PAGE]), '<< /Filter /Standard >>'], { trailerExtra: '/Encrypt 4 0 R' })
    );
    expect(result.proof).toBe('unavailable');
  });

  it('reports unavailable when a classic entry points at the wrong offset', async () => {
    const text = textOf(classicPdf(pageTreeBodies([LETTER_PAGE])));
    const damaged = text.replace(/\n(\d{10}) 00000 n/, (_match, offset: string) => {
      return `\n${String(Number(offset) + 1).padStart(10, '0')} 00000 n`;
    });
    expect(damaged).not.toBe(text);
    expect((await readPageBoxes(bytesOf(damaged))).proof).toBe('unavailable');
  });

  it('reports unavailable when startxref does not point at a cross-reference section', async () => {
    const text = textOf(classicPdf(pageTreeBodies([LETTER_PAGE])));
    const damaged = text.replace(/startxref\n\d+/, 'startxref\n5');
    expect((await readPageBoxes(bytesOf(damaged))).proof).toBe('unavailable');
  });

  it('reports unavailable for a file with no startxref', async () => {
    const text = textOf(classicPdf(pageTreeBodies([LETTER_PAGE])));
    expect((await readPageBoxes(bytesOf(text.replace('startxref', 'startref')))).proof).toBe('unavailable');
  });

  it('reports unavailable for truncated and non-PDF bytes', async () => {
    const bytes = classicPdf(pageTreeBodies([LETTER_PAGE]));
    expect((await readPageBoxes(bytes.slice(0, 60))).proof).toBe('unavailable');
    expect((await readPageBoxes(bytesOf('not a pdf at all'))).proof).toBe('unavailable');
  });
});

describe('readPageBoxes with cross-reference streams and object streams', () => {
  const bodies = pageTreeBodies([
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 700] /CropBox [10 10 480 680] >>',
    LETTER_PAGE
  ]);

  it('reads the same boxes from a Flate-compressed cross-reference stream and object stream', async () => {
    const result = await readPageBoxes(compressedPdf(bodies, [2, 3, 4]));
    expect(result).toEqual({
      proof: 'independent',
      pages: [
        { media_box: [0, 0, 500, 700], crop_box: [10, 10, 480, 680] },
        { media_box: [0, 0, 612, 792], crop_box: [0, 0, 612, 792] }
      ]
    });
  });

  it('reads a compressed file where only the pages are packed and the catalog stays direct', async () => {
    const result = await readPageBoxes(compressedPdf(bodies, [3, 4]));
    expect(result.proof).toBe('independent');
    if (result.proof !== 'independent') return;
    expect(result.pages.map((page) => page.media_box)).toEqual([
      [0, 0, 500, 700],
      [0, 0, 612, 792]
    ]);
  });

  it('reports unavailable for an object stream that carries decode parameters', async () => {
    const result = await readPageBoxes(
      compressedPdf(bodies, [2, 3, 4], { objectStreamParams: '/DecodeParms << /Predictor 12 /Columns 4 >>' })
    );
    expect(result.proof).toBe('unavailable');
  });
});

describe('readPageBoxes with incremental updates', () => {
  it('uses the newest revision of a page object', async () => {
    const base = classicPdf(pageTreeBodies([LETTER_PAGE]));
    const updated = appendRevision(base, {
      3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'
    });
    const result = await readPageBoxes(updated);
    expect(result).toEqual({
      proof: 'independent',
      pages: [{ media_box: [0, 0, 595, 842], crop_box: [0, 0, 595, 842] }]
    });
  });
});

describe('visibleBoxFromBoxes', () => {
  it('intersects the boxes the way PDF.js builds the page view', () => {
    expect(visibleBoxFromBoxes([0, 0, 612, 792], [36, 36, 576, 756])).toEqual([36, 36, 576, 756]);
    expect(visibleBoxFromBoxes([0, 0, 100, 100], [200, 200, 300, 300])).toBeNull();
  });
});
