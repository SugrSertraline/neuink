import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { SourceSegment } from '@/shared/types/domain';
import type { PendingPdfTextSelection } from '../pdf-reader/PdfTextSelectionToolbar';
import { findSourceSegment } from '@/shared/lib/listItemSegments';

/** A selection belongs to one rendered passage; never borrow another pane's selection. */
export function readReflowSelection(root: HTMLElement, segments: SourceSegment[], selection: Selection | null): PendingPdfTextSelection | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const element = (node: Node) => node instanceof Element ? node : node.parentElement;
  let start = element(range.startContainer)?.closest<HTMLElement>('[data-reading-selection-source]');
  let end = element(range.endContainer)?.closest<HTMLElement>('[data-reading-selection-source]');
  if (start && end && start !== end) {
    // A drag across sibling items still owns the actual selected text, anchored to their shared list.
    start = start.parentElement?.closest<HTMLElement>('[data-reading-selection-source]');
    end = end.parentElement?.closest<HTMLElement>('[data-reading-selection-source]');
  }
  if (!start || start !== end || !root.contains(start)) return null;
  if (element(range.startContainer)?.closest('[data-hover-surface], [data-reading-selection-toolbar]')) return null;
  const segment = findSourceSegment(segments, start.dataset.readingSelectionSource ?? '');
  const text = selection.toString().trim();
  if (!segment || !text) return null;
  const rect = range.getBoundingClientRect();
  return { segment, selection: { text, page_idx: segment.page_idx, rects: [] },
    anchorRect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
    position: { x: rect.left, y: rect.bottom } };
}

export function useReflowTextSelection(root: RefObject<HTMLDivElement>, segments: SourceSegment[]) {
  const [pending, setPending] = useState<PendingPdfTextSelection | null>(null);
  const clear = useCallback(() => setPending(null), []);
  const close = useCallback(() => {
    clear();
    const selection = window.getSelection();
    if (selection?.anchorNode && selection.focusNode &&
      root.current?.contains(selection.anchorNode) && root.current.contains(selection.focusNode)) {
      selection.removeAllRanges();
    }
  }, [clear, root]);
  const capture = () => setPending(root.current ? readReflowSelection(root.current, segments, window.getSelection()) : null);
  useEffect(() => {
    if (!pending) return;
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-reading-selection-toolbar]')) return;
      // Clear the old toolbar at the start of a new gesture, without erasing the
      // native range before the browser has processed Shift-click or dragging.
      if (event.type === 'pointerdown' || target === document ||
        (target instanceof Node && target.contains(root.current))) clear();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('blur', clear);
    window.addEventListener('neuink:reader-surface-change', close);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('blur', clear);
      window.removeEventListener('neuink:reader-surface-change', close);
      window.removeEventListener('keydown', escape);
    };
  }, [clear, close, pending, root]);
  return { pending, close, capture };
}
