import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { PdfDocumentSummary, PdfJsModule } from './readingPdfVerification';
import { buildReadingPdfFixture, READING_PDF_FIXTURES } from './testFixtures/buildReadingPdfFixtures';

// pdf.js touches DOMMatrix and document when its modules load. Text extraction
// never draws or reads layout, so these stubs are enough for node-side tests.
if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === 'undefined') {
  (globalThis as { DOMMatrix?: unknown }).DOMMatrix = class DOMMatrixStub {};
}
if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
  (globalThis as { document?: unknown }).document = { baseURI: 'http://localhost/' };
}

/**
 * Golden files shared with the Rust tests in `crates/neuink-workspace`.
 * They are produced by the pdf.js legacy build because the default build fails
 * in Node (MD5 path). Both builds share the text extraction code; the app uses the default build.
 * Regenerate with `NEUINK_WRITE_PDF_FIXTURES=1 npx vitest run src/shared/pdf/readingPdfVerification.test.ts`.
 */
const FIXTURE_DIR = fileURLToPath(
  new URL('../../../../../crates/neuink-workspace/tests/fixtures/reading_pdf/', import.meta.url)
);
const SUMMARY_PATH = `${FIXTURE_DIR}summaries.json`;
const writing = process.env.NEUINK_WRITE_PDF_FIXTURES === '1';

let pdfjs: PdfJsModule;
let summarizeModule: typeof import('./readingPdfVerification');

function fixturePath(name: string) {
  return `${FIXTURE_DIR}${name}.pdf`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function readFixture(name: string): ArrayBuffer {
  return toArrayBuffer(new Uint8Array(readFileSync(fixturePath(name))));
}

function summarize(bytes: ArrayBuffer) {
  return summarizeModule.summarizePdfDocument(bytes, pdfjs);
}

beforeAll(async () => {
  summarizeModule = await import('./readingPdfVerification');
  pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsModule;
  if (!writing) return;
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const golden: Record<string, PdfDocumentSummary> = {};
  for (const [name, spec] of Object.entries(READING_PDF_FIXTURES)) {
    const bytes = buildReadingPdfFixture(spec);
    writeFileSync(fixturePath(name), bytes);
    golden[name] = await summarize(toArrayBuffer(bytes));
  }
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(golden, null, 2)}\n`);
});

describe('textAnchorFromPageText', () => {
  it('collapses whitespace, applies NFKC, and keeps at most 64 characters', () => {
    expect(summarizeModule.textAnchorFromPageText('  Attention\n\n is   all\tyou need ')).toBe('Attention is all you need');
    expect(summarizeModule.textAnchorFromPageText('ﬁrst')).toBe('first');
    expect(summarizeModule.textAnchorFromPageText('x'.repeat(100))).toHaveLength(64);
  });
});

describe('reading PDF summaries from PDF.js', () => {
  it('matches the committed golden summary for every fixture', async () => {
    const golden = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8')) as Record<string, PdfDocumentSummary>;
    for (const name of Object.keys(READING_PDF_FIXTURES)) {
      expect(await summarize(readFixture(name)), name).toEqual(golden[name]);
    }
  });

  it('reads page count, visible box, rotation, and text anchors from the origin fixture', async () => {
    const summary = await summarize(readFixture('origin'));
    expect(summary.page_count).toBe(2);
    expect(summary.pages.map((page) => page.view_box)).toEqual([
      [0, 0, 612, 792],
      [0, 0, 612, 792]
    ]);
    expect(summary.pages.map((page) => page.rotate)).toEqual([0, 0]);
    expect(summary.pages.map((page) => page.text_anchor)).toEqual(['Attention Anchor One', 'Second Page Anchor']);
    expect(summary.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports the rotation, box, page count, and text changes the Rust verifier must reject', async () => {
    expect((await summarize(readFixture('rotate'))).pages[1].rotate).toBe(90);
    expect((await summarize(readFixture('crop_box'))).pages[0].view_box).toEqual([36, 36, 576, 756]);
    expect((await summarize(readFixture('media_box'))).pages[0].view_box).toEqual([0, 0, 595, 842]);
    expect((await summarize(readFixture('text'))).pages[1].text_anchor).toBe('Different Second Page');
    expect((await summarize(readFixture('page_count'))).page_count).toBe(3);
  });

  it('rejects bytes that PDF.js cannot read, with a message that says nothing was written', async () => {
    await expect(
      summarizeModule.buildReadingPdfVerification(
        toArrayBuffer(new TextEncoder().encode('%PDF-1.4 truncated')),
        readFixture('origin'),
        pdfjs
      )
    ).rejects.toThrow('未写入');
  });
});

describe('buildReadingPdfVerification', () => {
  it('returns one summary per file, each bound to its own bytes', async () => {
    const verification = await summarizeModule.buildReadingPdfVerification(
      readFixture('resaved'),
      readFixture('origin'),
      pdfjs
    );
    expect(verification.candidate.sha256).toBe((await summarize(readFixture('resaved'))).sha256);
    expect(verification.origin.sha256).toBe((await summarize(readFixture('origin'))).sha256);
  });
});
