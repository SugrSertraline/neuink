// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';
import { buildPaperReferenceIndex } from './paperReferenceIndex';
import { collectPdfTextReferences, readPdfLinkText } from './pdfTextReferences';

const reference: SourceSegment = { uid: 'r12', text: '[12] Existing reference', markdown: null, page_idx: 7, bbox: [0, 0, 500, 100], segment_type: 'paragraph', sub_type: 'reference' };
const index = buildPaperReferenceIndex([reference]);
let nodes: { node: Text; left: number; top: number }[];
let surface: HTMLDivElement, layer: HTMLDivElement;
beforeEach(() => {
  nodes = []; surface = document.createElement('div'); layer = document.createElement('div'); surface.append(layer); document.body.append(surface);
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 800));
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = new Range();
    const rects = () => {
      const first = nodes.findIndex(item => item.node === range.startContainer);
      const last = nodes.findIndex(item => item.node === range.endContainer);
      return nodes.slice(first, last + 1).map(({ node, left, top }, i) => {
        const start = i === 0 ? range.startOffset : 0;
        const end = first + i === last ? range.endOffset : node.length;
        return new DOMRect(left + start * 6, top, (end - start) * 6, 12);
      });
    };
    range.getClientRects = () => rects() as unknown as DOMRectList;
    range.getBoundingClientRect = () => {
      const boxes = rects(), first = boxes[0], last = boxes[boxes.length - 1];
      return first ? new DOMRect(first.left, first.top, last.right - first.left, last.bottom - first.top) : new DOMRect();
    };
    return range;
  });
});
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
function span(text: string, left: number, top = 50) {
  const element = document.createElement('span'); const node = document.createTextNode(text);
  element.append(node); layer.append(element); nodes.push({ node, left, top }); return node;
}

describe('PDF text reference geometry', () => {
  it('recognizes a citation split across PDF spans without changing selectable text', () => {
    const opening = span('[', 60), digits = span('12', 66); span(']', 78);
    const selection = window.getSelection()!, range = new Range(); range.setStart(opening, 0); range.setEnd(digits, 2); selection.addRange(range);
    const html = layer.innerHTML;
    const links = collectPdfTextReferences(layer, surface, index);
    expect(links).toHaveLength(3);
    expect(links.every(link => link.targets[0].segmentUid === 'r12')).toBe(true);
    expect(layer.innerHTML).toBe(html); expect(selection.toString()).toBe('[12');
    expect(links[1].rect).toEqual([66 / 600, 50 / 800, 78 / 600, 62 / 800]);
  });
  it.each([{ left: 66, top: 80 }, { left: 300, top: 50 }])('does not combine another line or column into a citation: %o', ({ left, top }) => {
    span('[', 60); span('12]', left, top);
    expect(collectPdfTextReferences(layer, surface, index)).toEqual([]);
  });
  it('reads only the linked digits inside a grouped citation, without selecting adjacent references', () => {
    span('See [1, 12].', 60);
    expect(readPdfLinkText(layer, surface, [108 / 600, 48 / 800, 120 / 600, 64 / 800])).toBe('12');
  });
});
