type Caret = { node: Node; offset: number };
type Point = { x: number; y: number };

/** Absolute PDF text runs leave small gaps where Chromium picks the page end.
 * Snap only those gaps to a nearby real glyph; the browser still owns the drag,
 * word selection, cross-page extension and auto-scroll.
 */
export function pdfTextEdgeCaret(layer: HTMLElement, point: Point): Caret | null {
  let nearest: { element: HTMLElement; rect: DOMRect; distance: number } | null = null;
  for (const element of layer.querySelectorAll<HTMLElement>('span:not(.markedContent)')) {
    if (!element.textContent?.trim()) continue;
    const rotation = element.style.getPropertyValue('--rotate');
    if (rotation && rotation !== '0deg') continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    if (dx === 0 && dy === 0) return null;
    const distance = Math.hypot(dx, dy);
    if (distance > rect.height * 0.5 || (nearest && distance >= nearest.distance)) continue;
    nearest = { element, rect, distance };
  }
  if (!nearest) return null;
  const { element, rect } = nearest;
  const x = Math.max(rect.left + 0.1, Math.min(point.x, rect.right - 0.1));
  const y = (rect.top + rect.bottom) / 2;
  const doc = layer.ownerDocument;
  const range = doc.caretRangeFromPoint?.(x, y);
  return range && element.contains(range.startContainer)
    ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** No pointer capture or preventDefault: native selection and scroll keep ownership. */
export function bindPdfTextSelectionEdges(layer: HTMLElement) {
  const doc = layer.ownerDocument;
  const view = doc.defaultView;
  let drag: { anchor: Caret | null; point: Point } | null = null;
  const clear = () => { drag = null; };
  const repair = () => {
    const selection = view?.getSelection();
    if (!drag || !selection?.anchorNode || !selection.focusNode || !layer.contains(selection.anchorNode)) return;
    const anchor = drag.anchor ?? { node: selection.anchorNode, offset: selection.anchorOffset };
    const focus = (layer.contains(selection.focusNode) ? pdfTextEdgeCaret(layer, drag.point) : null)
      ?? { node: selection.focusNode, offset: selection.focusOffset };
    if (!anchor.node.isConnected || !focus.node.isConnected) { clear(); return; }
    if (anchor.node !== selection.anchorNode || anchor.offset !== selection.anchorOffset ||
      focus.node !== selection.focusNode || focus.offset !== selection.focusOffset) {
      selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    }
  };
  const down = (event: MouseEvent) => {
    clear();
    if (event.defaultPrevented || event.button !== 0 || event.detail > 1 ||
      event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const point = { x: event.clientX, y: event.clientY };
    drag = { anchor: pdfTextEdgeCaret(layer, point), point };
  };
  const move = (event: MouseEvent) => {
    if (!drag) return;
    if (event.buttons !== 1) { clear(); return; }
    drag.point = { x: event.clientX, y: event.clientY };
  };
  const up = (event: MouseEvent) => {
    if (!drag) return;
    drag.point = { x: event.clientX, y: event.clientY };
    repair();
    clear();
  };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') clear(); };
  layer.addEventListener('mousedown', down);
  doc.addEventListener('mousemove', move, true);
  doc.addEventListener('mouseup', up, true);
  doc.addEventListener('selectionchange', repair);
  doc.addEventListener('keydown', key, true);
  view?.addEventListener('blur', clear);
  view?.addEventListener('pointercancel', clear);
  view?.addEventListener('neuink:reader-surface-change', clear);
  return () => {
    clear();
    layer.removeEventListener('mousedown', down);
    doc.removeEventListener('mousemove', move, true);
    doc.removeEventListener('mouseup', up, true);
    doc.removeEventListener('selectionchange', repair);
    doc.removeEventListener('keydown', key, true);
    view?.removeEventListener('blur', clear);
    view?.removeEventListener('pointercancel', clear);
    view?.removeEventListener('neuink:reader-surface-change', clear);
  };
}
