import { translatedSentenceGeometry } from './pdfSentenceHover';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { hasPdfTextSelection, pdfPageContentRect } from './pdfCanvasDom';
import { resolvePdfSelectionAnchorSegment } from './pdfPageAnnotations';
import type { PendingPdfTextSelection } from './PdfTextSelectionToolbar';
import type { PageSegments } from './types';

/** Geometry and text must belong to the same page; never clear another pane's selection. */
function readSelection(element: HTMLDivElement, page: PageSegments): PendingPdfTextSelection | null {
  const translatedLayer = Array.from(element.querySelectorAll<HTMLElement>('[data-pdf-translation-region]'))
    .find(layer => hasPdfTextSelection(layer));
  if (!translatedLayer && !hasPdfTextSelection(element.querySelector('.pdf-text-layer'))) return null;
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range) return null;
  const pageRect = pdfPageContentRect(element);
  if (pageRect.width <= 0 || pageRect.height <= 0) return null;
  const coordinate = (value: number) => Math.round(Math.min(1000, Math.max(0, value)) * 100) / 100;
  const rects = Array.from(range.getClientRects()).map(rect => [
    coordinate(((Math.max(rect.left, pageRect.left) - pageRect.left) / pageRect.width) * 1000),
    coordinate(((Math.max(rect.top, pageRect.top) - pageRect.top) / pageRect.height) * 1000),
    coordinate(((Math.min(rect.right, pageRect.right) - pageRect.left) / pageRect.width) * 1000),
    coordinate(((Math.min(rect.bottom, pageRect.bottom) - pageRect.top) / pageRect.height) * 1000),
  ] as [number, number, number, number]).filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0);
  const text = selection?.toString().trim() ?? '';
  if (!text || !rects.length) return null;
  const rect = range.getBoundingClientRect();
  const region = translatedLayer ? page.regions.find(item => item.id === translatedLayer.dataset.pdfTranslationRegion) : null;
  let original: PendingPdfTextSelection['original'];
  if (region && translatedLayer) {
    const sentences = translatedSentenceGeometry(translatedLayer, region, pageRect, translatedLayer.textContent ?? '');
    const start = range.cloneRange(); start.collapse(true);
    const end = range.cloneRange(); end.collapse(false);
    const matches = sentences?.filter(sentence => {
      if (!sentence.textRange) return false;
      const sentenceStart = sentence.textRange.cloneRange(); sentenceStart.collapse(true);
      const sentenceEnd = sentence.textRange.cloneRange(); sentenceEnd.collapse(false);
      return start.compareBoundaryPoints(Range.START_TO_START, sentenceEnd) < 0 &&
        end.compareBoundaryPoints(Range.START_TO_START, sentenceStart) > 0;
    });
    original = matches?.length
      ? { text: matches.map(sentence => sentence.source).join(' '), notice: '显示所选译文所在句的原文' }
      : { text: region.sourceSegment.markdown ?? region.sourceSegment.text, notice: '无法准确对应句子，已显示整段原文' };
  }
  return {
    original,
    position: { x: rect.left, y: rect.bottom },
    anchorRect: { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top },
    segment: region?.sourceSegment ?? resolvePdfSelectionAnchorSegment({ pageIdx: page.pageIdx, rects, regions: page.regions, text }),
    selection: { page_idx: page.pageIdx, rects, text },
  };
}

function hasPageSelection(element: HTMLElement | null) {
  return Boolean(element && Array.from(element.querySelectorAll<HTMLElement>('.pdf-text-layer, [data-pdf-translation-region]'))
    .some(layer => hasPdfTextSelection(layer)));
}

function isSelectionControl(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('[data-reading-selection-toolbar], [data-hover-surface]'));
}

/** The page owns capture/dismissal; the reader's stable toolbar owns editing and pinning. */
export function usePdfTextSelection(root: RefObject<HTMLDivElement>, page: PageSegments, enabled: boolean) {
  const [pending, setPending] = useState<PendingPdfTextSelection | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const gesture = useRef(false);
  const timer = useRef<number | null>(null);
  const dismissed = useRef<{ anchor: Node | null; focus: Node | null; start: number; end: number } | null>(null);
  const cancelCapture = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const clear = useCallback(() => {
    cancelCapture();
    gesture.current = false;
    const selection = window.getSelection();
    dismissed.current = selection ? { anchor: selection.anchorNode, focus: selection.focusNode,
      start: selection.anchorOffset, end: selection.focusOffset } : null;
    pendingRef.current = null;
    setPending(null);
  }, [cancelCapture]);
  const close = useCallback(() => {
    clear();
    if (hasPageSelection(root.current)) {
      window.getSelection()?.removeAllRanges();
    }
  }, [clear, root]);
  const capture = useCallback((element = root.current, explicit = false) => {
    if (!enabled || gesture.current || (!explicit && isSelectionControl(document.activeElement))) return;
    const selection = window.getSelection();
    const previous = dismissed.current;
    // selectionchange can already be queued when blur/cancel dismisses the UI.
    // Suppress that exact range, not the next user selection or a timed cooldown.
    if (previous && selection?.anchorNode === previous.anchor && selection.focusNode === previous.focus &&
      selection.anchorOffset === previous.start && selection.focusOffset === previous.end) return;
    setPending(element ? readSelection(element, page) : null);
  }, [enabled, page, root]);
  const scheduleCapture = useCallback(() => {
    cancelCapture();
    if (!enabled || gesture.current) return;
    if (!pendingRef.current && !hasPageSelection(root.current)) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      capture();
    }, 24);
  }, [cancelCapture, capture, enabled, root]);
  const begin = useCallback(() => {
    clear();
    gesture.current = true;
  }, [clear]);
  const finish = useCallback(() => {
    gesture.current = false;
    dismissed.current = null;
    scheduleCapture();
  }, [scheduleCapture]);

  useEffect(() => {
    if (!enabled) { clear(); return; }
    const pointerDown = (event: PointerEvent) => {
      // Portalled controls and preview text keep their own selection and drafts.
      if (!isSelectionControl(event.target)) clear();
    };
    const pointerUp = () => { if (gesture.current) finish(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isSelectionControl(event.target)) return;
      if (!pendingRef.current && !hasPageSelection(root.current)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const scroll = (event: Event) => {
      if (isSelectionControl(event.target)) return;
      // Native drag-selection can auto-scroll; it is still the same held gesture.
      if (gesture.current) { cancelCapture(); return; }
      // Other panes and the selection panel have independent scroll owners.
      if (event.target === document || (event.target instanceof Node && event.target.contains(root.current))) clear();
    };
    document.addEventListener('selectionchange', scheduleCapture);
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', clear);
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', clear);
    window.addEventListener('neuink:reader-surface-change', close);
    return () => {
      cancelCapture();
      gesture.current = false;
      document.removeEventListener('selectionchange', scheduleCapture);
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', clear);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', clear);
      window.removeEventListener('neuink:reader-surface-change', close);
    };
  }, [cancelCapture, clear, close, enabled, finish, root, scheduleCapture]);

  return { pending, begin, finish, clear, close, capture };
}
