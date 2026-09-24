import { matchPaperReferences, type ReferenceIndex, type PaperReference } from './paperReferenceIndex';
export type PdfTextReference = { label: string; targets: PaperReference[]; rect: [number,number,number,number] };
type TextRun = { node: Node; start: number; end: number };

function readTextRuns(layer: HTMLElement) {
  const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  const runs: TextRun[] = [];
  let text = '', node: Node | null, previous: DOMRect | null = null;
  while ((node = walker.nextNode())) {
    if (!node.textContent) continue;
    const range = layer.ownerDocument.createRange(); range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    if (previous) {
      const sameLine = Math.abs((rect.top + rect.bottom - previous.top - previous.bottom) / 2) < Math.min(rect.height, previous.height) / 2;
      const gap = rect.left - previous.right;
      // Join fragments such as "[", "12", "]", but never separate columns or lines.
      // A non-whitespace separator prevents citation regexes from bridging lines.
      text += !sameLine || gap < -2 || gap > Math.max(rect.height, previous.height) * 2 ? '\0'
        : gap > Math.min(rect.height, previous.height) * .15 ? ' ' : '';
    }
    runs.push({ node, start: text.length, end: text.length + node.textContent.length });
    text += node.textContent; previous = rect;
  }
  return { text, runs };
}

/** Read PDF.js text geometry without rewriting its selectable text layer. */
export function collectPdfTextReferences(layer: HTMLElement, surface: HTMLElement, index: ReferenceIndex): PdfTextReference[] {
  const bounds = surface.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !index.size) return [];
  const { text, runs } = readTextRuns(layer);
  const result: PdfTextReference[] = [];
  for (const match of matchPaperReferences(text, index)) {
    const first = runs.find(run => run.start <= match.start && run.end > match.start);
    const last = runs.find(run => run.start < match.end && run.end >= match.end);
    if (!first || !last) continue;
    const range = layer.ownerDocument.createRange();
    range.setStart(first.node, match.start - first.start); range.setEnd(last.node, match.end - last.start);
    const seen = new Set<string>();
    for (const rect of Array.from(range.getClientRects())) {
      const id = `${rect.left}:${rect.top}:${rect.right}:${rect.bottom}`;
      if (!rect.width || !rect.height || seen.has(id)) continue;
      seen.add(id);
      result.push({ label: match.label, targets: match.targets, rect: [
        (rect.left - bounds.left)/bounds.width, (rect.top - bounds.top)/bounds.height,
        (rect.right - bounds.left)/bounds.width, (rect.bottom - bounds.top)/bounds.height
      ] });
    }
  }
  return result;
}

/** Read only glyphs inside a native annotation, including links covering a single number in a group. */
export function readPdfLinkText(layer: HTMLElement, surface: HTMLElement, rect: readonly number[]) {
  const bounds = surface.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return '';
  const box = { left: bounds.left + rect[0] * bounds.width, top: bounds.top + rect[1] * bounds.height,
    right: bounds.left + rect[2] * bounds.width, bottom: bounds.top + rect[3] * bounds.height };
  const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const value = node.textContent ?? '';
    const range = layer.ownerDocument.createRange(); range.selectNodeContents(node);
    const span = range.getBoundingClientRect();
    if (span.right <= box.left || span.left >= box.right || span.bottom <= box.top || span.top >= box.bottom) continue;
    let part = '';
    for (let i = 0; i < value.length; i++) {
      range.setStart(node, i); range.setEnd(node, i + 1);
      const character = range.getBoundingClientRect();
      const x = (character.left + character.right)/2, y = (character.top + character.bottom)/2;
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) part += value[i];
    }
    if (part) parts.push(part);
  }
  return parts.join('');
}
