// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { bindPdfTextSelectionEdges, pdfTextEdgeCaret } from './pdfTextSelectionEdges';

let dispose = () => {};
const originalCaret = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint');
afterEach(() => {
  dispose();
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  if (originalCaret) Object.defineProperty(document, 'caretRangeFromPoint', originalCaret);
  else Reflect.deleteProperty(document, 'caretRangeFromPoint');
});

function setup() {
  const layer = document.createElement('div');
  layer.innerHTML = '<span>First line</span><span>Last line</span><span>Footnote</span>';
  document.body.append(layer);
  const spans = Array.from(layer.children) as HTMLElement[];
  spans.forEach((span, index) => vi.spyOn(span, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(100, [100, 120, 170][index], 100, 14)));
  const caret = vi.fn((x: number, y: number) => {
    const span = spans.find(s => y >= s.getBoundingClientRect().top && y <= s.getBoundingClientRect().bottom)!;
    const range = document.createRange();
    range.setStart(span.firstChild!, x > 150 ? span.textContent!.length : 0);
    range.collapse(true);
    return range;
  });
  Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: caret });
  dispose = bindPdfTextSelectionEdges(layer);
  const selection = window.getSelection()!;
  const select = (anchor: Node, anchorOffset: number, focus: Node, focusOffset: number) => {
    selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
    document.dispatchEvent(new Event('selectionchange'));
  };
  const mouse = (type: string, x: number, y: number, options: MouseEventInit = {}) =>
    layer.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y, detail: 1, ...options }));
  return { layer, spans, caret, selection, select, mouse };
}

it('snaps the tiny gap below a line to its real glyph and leaves distant whitespace alone', () => {
  const { layer, spans, caret } = setup();
  expect(pdfTextEdgeCaret(layer, { x: 201, y: 135 })).toEqual({ node: spans[1].firstChild, offset: 9 });
  expect(caret).toHaveBeenCalledWith(199.9, 127);
  expect(pdfTextEdgeCaret(layer, { x: 201, y: 151 })).toBeNull();
  expect(pdfTextEdgeCaret(layer, { x: 150, y: 126 })).toBeNull();
});

it('corrects a reverse drag starting just below the last line without including the footnote', () => {
  const { layer, spans, selection, select, mouse } = setup();
  mouse('mousedown', 201, 135);
  mouse('mousemove', 101, 135);
  select(layer, layer.childNodes.length, spans[1].firstChild!, 0);
  expect(selection.toString()).toBe('Last line');
  expect(selection.anchorNode).toBe(spans[1].firstChild);
  // A second native selectionchange must not recursively change the range.
  document.dispatchEvent(new Event('selectionchange'));
  expect(selection.toString()).toBe('Last line');
  mouse('mouseup', 101, 135);
});

it('corrects a forward drag ending below the last line, preserving the first-line anchor', () => {
  const { layer, spans, selection, select, mouse } = setup();
  mouse('mousedown', 101, 106);
  mouse('mousemove', 201, 135);
  select(spans[0].firstChild!, 0, layer, layer.childNodes.length);
  expect(selection.toString()).toBe('First lineLast line');
  expect(selection.focusNode).toBe(spans[1].firstChild);
});

it('keeps native selection offsets while dragging inside text and into a different page', () => {
  const { spans, selection, select, mouse } = setup();
  mouse('mousedown', 120, 106);
  mouse('mousemove', 150, 126);
  select(spans[0].firstChild!, 2, spans[1].firstChild!, 4);
  expect(selection.anchorOffset).toBe(2);
  expect(selection.focusOffset).toBe(4);
  const nextPage = document.createTextNode('Next page');
  document.body.append(nextPage);
  select(spans[0].firstChild!, 2, nextPage, 4);
  expect(selection.focusNode).toBe(nextPage);
  expect(selection.focusOffset).toBe(4);
});

it.each([{ shiftKey: true }, { altKey: true }, { detail: 2 }, { detail: 3 }])('preserves modified or word-selection gestures: %o', options => {
  const { layer, spans, selection, select, mouse } = setup();
  mouse('mousedown', 201, 135, options);
  mouse('mousemove', 101, 135);
  select(layer, 3, spans[1].firstChild!, 0);
  expect(selection.toString()).toBe('Last lineFootnote');
});

it.each(['pointercancel', 'blur', 'neuink:reader-surface-change', 'Escape', 'unmount'])('stops edge repair after %s', event => {
  const { layer, spans, selection, select, mouse } = setup();
  mouse('mousedown', 201, 135);
  if (event === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  else if (event === 'unmount') dispose();
  else window.dispatchEvent(new Event(event));
  select(layer, 3, spans[1].firstChild!, 0);
  expect(selection.toString()).toBe('Last lineFootnote');
});
