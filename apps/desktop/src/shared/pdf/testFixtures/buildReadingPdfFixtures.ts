/** Test-only builder for small hand-written PDFs. Output is ASCII with a correct xref table. */

export type FixturePage = {
  mediaBox: [number, number, number, number];
  cropBox?: [number, number, number, number];
  rotate?: number;
  text: string;
};

export type FixtureSpec = {
  pages: FixturePage[];
  producer: string;
};

function escapePdfText(text: string) {
  if (/[()\\]/.test(text)) throw new Error(`fixture text must not contain parentheses or backslashes: ${text}`);
  return text;
}

/** Builds a PDF whose objects, offsets, and trailer are consistent. */
export function buildReadingPdfFixture(spec: FixtureSpec): Uint8Array {
  const pageCount = spec.pages.length;
  const pageObject = (index: number) => 4 + index * 2;
  const contentObject = (index: number) => 5 + index * 2;
  const infoObject = 4 + pageCount * 2;
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${spec.pages.map((_, i) => `${pageObject(i)} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  spec.pages.forEach((page, index) => {
    const box = (values: number[]) => `[${values.join(' ')}]`;
    const cropEntry = page.cropBox ? ` /CropBox ${box(page.cropBox)}` : '';
    const rotateEntry = page.rotate ? ` /Rotate ${page.rotate}` : '';
    objects[pageObject(index)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox ${box(page.mediaBox)}${cropEntry}${rotateEntry} ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject(index)} 0 R >>`;
    const stream = `BT /F1 12 Tf 72 700 Td (${escapePdfText(page.text)}) Tj ET`;
    objects[contentObject(index)] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[infoObject] = `<< /Producer (${escapePdfText(spec.producer)}) >>`;

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let number = 1; number <= infoObject; number += 1) {
    offsets[number] = body.length;
    body += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${infoObject + 1}\n0000000000 65535 f \n`;
  for (let number = 1; number <= infoObject; number += 1) {
    body += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${infoObject + 1} /Root 1 0 R /Info ${infoObject} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

const LETTER: [number, number, number, number] = [0, 0, 612, 792];

/** Named fixtures. Each variant changes exactly one property from `origin`, except `resaved`. */
export const READING_PDF_FIXTURES: Record<string, FixtureSpec> = {
  origin: {
    producer: 'fixture-origin',
    pages: [
      { mediaBox: LETTER, text: 'Attention Anchor One' },
      { mediaBox: LETTER, text: 'Second Page Anchor' },
    ],
  },
  // Same content with different metadata: different bytes, must still pass.
  resaved: {
    producer: 'fixture-resaved',
    pages: [
      { mediaBox: LETTER, text: 'Attention Anchor One' },
      { mediaBox: LETTER, text: 'Second Page Anchor' },
    ],
  },
  page_count: {
    producer: 'fixture-origin',
    pages: [
      { mediaBox: LETTER, text: 'Attention Anchor One' },
      { mediaBox: LETTER, text: 'Second Page Anchor' },
      { mediaBox: LETTER, text: 'Extra Trailing Page' },
    ],
  },
  rotate: {
    producer: 'fixture-origin',
    pages: [
      { mediaBox: LETTER, text: 'Attention Anchor One' },
      { mediaBox: LETTER, rotate: 90, text: 'Second Page Anchor' },
    ],
  },
  media_box: {
    producer: 'fixture-origin',
    pages: [
      { mediaBox: [0, 0, 595, 842], text: 'Attention Anchor One' },
      { mediaBox: LETTER, text: 'Second Page Anchor' },
    ],
  },
  crop_box: {
    producer: 'fixture-origin',
    pages: [
      { mediaBox: LETTER, cropBox: [36, 36, 576, 756], text: 'Attention Anchor One' },
      { mediaBox: LETTER, text: 'Second Page Anchor' },
    ],
  },
  text: {
    producer: 'fixture-origin',
    pages: [
      { mediaBox: LETTER, text: 'Attention Anchor One' },
      { mediaBox: LETTER, text: 'Different Second Page' },
    ],
  },
};
