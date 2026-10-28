import { alignSavedTranslation, splitAcademicSentences, splitPdfTextSentences } from '../../translation/sentenceAlignment';
import type { SegmentRegionItem } from './types';

export type PdfSentenceRect = readonly [number, number, number, number];
export type PdfSentenceGeometry = { index: number; source: string; linkedSentenceIndex: number | null; rects: PdfSentenceRect[] };

type TextRun = { node: Text; start: number; end: number };

function grams(text: string) {
  const compact = text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return new Set(Array.from({ length: Math.max(0, compact.length - 2) }, (_, index) => compact.slice(index, index + 3)));
}

function similarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared++;
  return 2 * shared / (left.size + right.size);
}

export function matchingSentenceOrder(source: string, pdfText: string) {
  const sourceSentences = splitAcademicSentences(source);
  const pdfSentences = splitPdfTextSentences(pdfText);
  if (!sourceSentences.length || !pdfSentences.length || sourceSentences.length > 30 || pdfSentences.length > 30) return null;
  const sourceGrams = sourceSentences.map(grams);
  const sourceIndexes: Array<number | null> = [];
  let previousIndex = -1;
  for (const pdfSentence of pdfSentences) {
    const pdfGrams = grams(pdfSentence);
    const candidates = sourceGrams.map((source, index) => ({ index, score: similarity(source, pdfGrams) }))
      .sort((left, right) => right.score - left.score);
    const best = candidates[0];
    const second = candidates[1]?.score ?? 0;
    // Partial page fragments can be shorter; require a clear lead over other sentences.
    const confident = best && best.index > previousIndex && best.score - second >= 0.16 &&
      (best.score >= 0.66 || (best.score >= 0.5 && best.score - second >= 0.2 && pdfGrams.size >= 55));
    const index = confident ? best.index : null;
    sourceIndexes.push(index);
    if (index !== null) previousIndex = index;
  }
  return sourceIndexes.some(index => index !== null) ? { sourceSentences, pdfSentences, sourceIndexes } : null;
}

function intersects(rect: DOMRect, bounds: { left: number; top: number; right: number; bottom: number }) {
  return rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom;
}

function normalizedRect(rect: DOMRect, page: DOMRect, bounds: { left: number; top: number; right: number; bottom: number }): PdfSentenceRect | null {
  const left = Math.max(rect.left, bounds.left);
  const top = Math.max(rect.top, bounds.top);
  const right = Math.min(rect.right, bounds.right);
  const bottom = Math.min(rect.bottom, bounds.bottom);
  if (right <= left || bottom <= top) return null;
  return [(left - page.left) / page.width * 1000, (top - page.top) / page.height * 1000,
    (right - page.left) / page.width * 1000, (bottom - page.top) / page.height * 1000];
}

function mergeLineRects(rects: PdfSentenceRect[]) {
  const lines: Array<[number, number, number, number]> = [];
  for (const rect of rects) {
    const line = lines.find(candidate => Math.min(candidate[3], rect[3]) - Math.max(candidate[1], rect[1]) >
      Math.min(candidate[3] - candidate[1], rect[3] - rect[1]) * 0.5);
    if (line) {
      line[0] = Math.min(line[0], rect[0]);
      line[1] = Math.min(line[1], rect[1]);
      line[2] = Math.max(line[2], rect[2]);
      line[3] = Math.max(line[3], rect[3]);
    } else lines.push([rect[0], rect[1], rect[2], rect[3]]);
  }
  return lines;
}

/** Use PDF text for hover geometry and the parsed sentence order for reflow navigation. */
export function pdfSentenceGeometry(layer: HTMLElement, region: SegmentRegionItem, page: DOMRect): PdfSentenceGeometry[] | null {
  if (region.sourceSegment.segment_type !== 'paragraph' || !page.width || !page.height) return null;
  const [x1, y1, x2, y2] = region.bbox;
  const bounds = { left: page.left + x1 / 1000 * page.width - 3, top: page.top + y1 / 1000 * page.height - 3,
    right: page.left + x2 / 1000 * page.width + 3, bottom: page.top + y2 / 1000 * page.height + 3 };
  const runs: TextRun[] = [];
  let pdfText = '';
  let previous: DOMRect | null = null;
  for (const span of layer.querySelectorAll<HTMLElement>('span')) {
    const textNodes = Array.from(span.childNodes).filter((node): node is Text => node.nodeType === Node.TEXT_NODE);
    if (!textNodes.length) continue;
    const rect = span.getBoundingClientRect();
    if (!intersects(rect, bounds)) continue;
    const text = textNodes.map(node => node.data).join('');
    if (!text) continue;
    if (previous && pdfText && !/\s$/.test(pdfText) && !/^\s/.test(text) &&
      (rect.top > previous.bottom - Math.min(rect.height, previous.height) * 0.5 || rect.left - previous.right > 2)) {
      pdfText += ' ';
    }
    for (const node of textNodes) {
      const value = node.data;
      runs.push({ node, start: pdfText.length, end: pdfText.length + value.length });
      pdfText += value;
    }
    previous = rect;
  }
  const pdfSentences = splitPdfTextSentences(pdfText);
  if (!pdfSentences.length || pdfSentences.length > 30) return null;
  const sourceText = region.sourceSegment.markdown ?? region.sourceSegment.text;
  const match = matchingSentenceOrder(sourceText, pdfText);
  const result: PdfSentenceGeometry[] = [];
  let cursor = 0;
  for (let index = 0; index < pdfSentences.length; index++) {
    const sentence = pdfSentences[index];
    const start = pdfText.indexOf(sentence, cursor);
    if (start < 0) return null;
    const end = start + sentence.length;
    cursor = end;
    const rects: PdfSentenceRect[] = [];
    for (const run of runs) {
      if (run.end <= start || run.start >= end) continue;
      const range = document.createRange();
      range.setStart(run.node, Math.max(0, start - run.start));
      range.setEnd(run.node, Math.min(run.node.length, end - run.start));
      for (const rect of range.getClientRects()) {
        const clipped = normalizedRect(rect, page, bounds);
        if (clipped) rects.push(clipped);
      }
      range.detach();
    }
    if (!rects.length) return null;
    const linkedSentenceIndex = match?.sourceIndexes[index] ?? null;
    result.push({ index, source: linkedSentenceIndex !== null ? match!.sourceSentences[linkedSentenceIndex] : sentence,
      linkedSentenceIndex, rects: mergeLineRects(rects) });
  }
  return result;
}

/** Measure the rendered translation itself; never reuse the hidden PDF text geometry. */
export function translatedSentenceGeometry(layer: HTMLElement, region: SegmentRegionItem, page: DOMRect,
  translated: string): PdfSentenceGeometry[] | null {
  if (region.sourceSegment.segment_type !== 'paragraph' || !page.width || !page.height) return null;
  const pairs = alignSavedTranslation(region.sourceSegment.markdown ?? region.sourceSegment.text, translated);
  if (!pairs?.length) return null;
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  const positions: Array<{ node: Text; offset: number }> = [];
  let rendered = '';
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    for (let offset = 0; offset < node.length; offset++) {
      if (/\s/u.test(node.data[offset])) continue;
      rendered += node.data[offset];
      positions.push({ node, offset });
    }
  }
  const texts = pairs.map(pair => pair.translation.replace(/\s/gu, ''));
  // Markdown, math or an incomplete rendering may not map faithfully to the saved text.
  if (!rendered || texts.join('') !== rendered) return null;
  const [x1, y1, x2, y2] = region.bbox;
  const bounds = { left: page.left + x1 / 1000 * page.width, top: page.top + y1 / 1000 * page.height,
    right: page.left + x2 / 1000 * page.width, bottom: page.top + y2 / 1000 * page.height };
  let cursor = 0;
  const result: PdfSentenceGeometry[] = [];
  for (const [index, pair] of pairs.entries()) {
    const length = texts[index].length;
    if (!length) return null;
    const start = positions[cursor], end = positions[cursor + length - 1];
    if (!start || !end) return null;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    const rects = Array.from(range.getClientRects()).map(rect => normalizedRect(rect, page, bounds))
      .filter((rect): rect is PdfSentenceRect => rect !== null);
    range.detach();
    if (!rects.length) return null;
    result.push({ index, source: pair.source, linkedSentenceIndex: pair.sourceStartIndex, rects: mergeLineRects(rects) });
    cursor += length;
  }
  return result;
}

export function sentenceAtPoint(sentences: PdfSentenceGeometry[], page: DOMRect, x: number, y: number) {
  const px = (x - page.left) / page.width * 1000;
  const py = (y - page.top) / page.height * 1000;
  return sentences.find(sentence => sentence.rects.some(([left, top, right, bottom]) =>
    px >= left && px <= right && py >= top && py <= bottom)) ?? null;
}
