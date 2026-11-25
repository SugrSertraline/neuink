import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

import { createPdfDocumentOptions } from '@/modules/reader/components/pdf-reader/pdfDocumentOptions';
import {
  readEntryMineruOriginPdf,
  readMineruZipOriginPdf,
  readPdfBytes
} from '@/shared/ipc/workspaceApi';

import { readPageBoxes, visibleBoxFromBoxes, type PdfBox } from './pdfPageBoxes';

/**
 * Summary of one PDF as PDF.js reports it. The Rust side (`reading_pdf.rs`)
 * compares two summaries and checks that each one matches its file by SHA-256.
 *
 * `media_box` and `crop_box` come from `pdfPageBoxes.ts`, not from PDF.js.
 * They are `null` when the document's geometry could not be read independently.
 */
export type PdfPageSummary = {
  view_box: [number, number, number, number];
  media_box: PdfBox | null;
  crop_box: PdfBox | null;
  rotate: number;
  user_unit: number;
  text_anchor: string;
};

export type GeometryProof = 'independent' | 'unavailable';

export type PdfDocumentSummary = {
  sha256: string;
  page_count: number;
  geometry_proof: GeometryProof;
  pages: PdfPageSummary[];
};

export type PdfPairSummary = {
  candidate: PdfDocumentSummary;
  origin: PdfDocumentSummary;
};

/** Must match `TEXT_ANCHOR_MAX_CHARS` in `reading_pdf.rs`. */
export const TEXT_ANCHOR_MAX_CHARS = 64;

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Normalizes whitespace and Unicode form, then keeps the leading characters of a page. */
export function textAnchorFromPageText(raw: string): string {
  const normalized = raw.normalize('NFKC').split(/\s+/).filter(Boolean).join(' ');
  return Array.from(normalized).slice(0, TEXT_ANCHOR_MAX_CHARS).join('');
}

/**
 * True when the parsed MediaBox and CropBox reproduce PDF.js's `view`. A
 * non-overlapping pair is reported by PDF.js as the MediaBox.
 */
function viewAgrees(
  boxes: { media_box: PdfBox; crop_box: PdfBox },
  view: [number, number, number, number]
): boolean {
  const expected = visibleBoxFromBoxes(boxes.media_box, boxes.crop_box) ?? boxes.media_box;
  return expected.every((value, index) => Math.abs(value - view[index]) <= 1e-3);
}

/** The pdf.js module in use. Tests may pass the legacy Node build; the app uses the default. */
export type PdfJsModule = typeof pdfjsLib;

function openPdf(bytes: Uint8Array, pdfjs: PdfJsModule) {
  let nativeWorker: Worker | null = null;
  let worker: pdfjsLib.PDFWorker | null = null;
  if (typeof window !== 'undefined' && 'Worker' in window) {
    nativeWorker = new PdfWorker();
    worker = pdfjs.PDFWorker.create({ port: nativeWorker });
  }
  const task = pdfjs.getDocument({ ...createPdfDocumentOptions(bytes), ...(worker ? { worker } : {}) });
  // A password prompt would never be answered here, so it fails the summary instead.
  const passwordFailure = new Promise<never>((_resolve, reject) => {
    task.onPassword = () => reject(new Error('PDF 已加密，无法校验。'));
  });
  const release = async () => {
    try { await task.destroy(); } catch { /* a failed load has nothing left to free */ }
    try { worker?.destroy(); } catch { /* the worker is released by the port below */ }
    try { nativeWorker?.terminate(); } catch { /* already terminated */ }
  };
  return { promise: Promise.race([task.promise, passwordFailure]), task, release };
}

/** Reads every page with PDF.js and returns the summary the verifier needs. */
export async function summarizePdfDocument(
  bytes: ArrayBuffer,
  pdfjs: PdfJsModule = pdfjsLib
): Promise<PdfDocumentSummary> {
  const sha256 = await sha256Hex(bytes);
  const boxes = await readPageBoxes(new Uint8Array(bytes));
  const session = openPdf(new Uint8Array(bytes.slice(0)), pdfjs);
  try {
    // The loading task owns the document; `session.release` destroys it.
    const document = await session.promise;
    const pages: PdfPageSummary[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
        const [x0, y0, x1, y1] = page.view;
        const pageBoxes = boxes.proof === 'independent' ? boxes.pages[pageNumber - 1] : undefined;
        // The parsed boxes must reproduce the view PDF.js reports. If they do not,
        // the parser and PDF.js disagree, so neither box is trusted for this page.
        const agrees = pageBoxes !== undefined && viewAgrees(pageBoxes, [x0, y0, x1, y1]);
        pages.push({
          view_box: [x0, y0, x1, y1],
          media_box: agrees ? pageBoxes.media_box : null,
          crop_box: agrees ? pageBoxes.crop_box : null,
          rotate: page.rotate,
          user_unit: page.userUnit,
          text_anchor: textAnchorFromPageText(text)
        });
      } finally {
        page.cleanup();
      }
    }
    const geometryProven =
      boxes.proof === 'independent' &&
      pages.length > 0 &&
      pages.every((page) => page.media_box !== null && page.crop_box !== null);
    return {
      sha256,
      page_count: document.numPages,
      geometry_proof: geometryProven ? 'independent' : 'unavailable',
      pages
    };
  } finally {
    await session.release();
  }
}

async function summarizeOrExplain(label: string, bytes: ArrayBuffer, pdfjs: PdfJsModule): Promise<PdfDocumentSummary> {
  try {
    return await summarizePdfDocument(bytes, pdfjs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`无法读取${label}（${reason}），未写入。`);
  }
}

/** Summarizes a candidate PDF and the MinerU origin copy it must match. */
export async function buildReadingPdfVerification(
  candidate: ArrayBuffer,
  origin: ArrayBuffer,
  pdfjs: PdfJsModule = pdfjsLib
): Promise<PdfPairSummary> {
  return {
    candidate: await summarizeOrExplain('候选 PDF', candidate, pdfjs),
    origin: await summarizeOrExplain('MinerU 原件 paper_origin.pdf', origin, pdfjs)
  };
}

/** Builds the verification for importing `pdfPath` together with the MinerU ZIP at `zipPath`. */
export async function verifyMineruZipReadingPdf(zipPath: string, pdfPath: string): Promise<PdfPairSummary> {
  const origin = await readMineruZipOriginPdf(zipPath);
  const candidate = await readPdfBytes(pdfPath);
  return buildReadingPdfVerification(candidate, origin);
}

/** Builds the verification for replacing an entry's reading PDF with `pdfPath`. */
export async function verifyEntryReadingPdfReplacement(
  root: string,
  entryId: string,
  pdfPath: string
): Promise<PdfPairSummary> {
  const origin = await readEntryMineruOriginPdf(root, entryId);
  const candidate = await readPdfBytes(pdfPath);
  return buildReadingPdfVerification(candidate, origin);
}
