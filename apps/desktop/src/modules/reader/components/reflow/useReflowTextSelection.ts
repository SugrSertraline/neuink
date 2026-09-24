import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { SourceSegment } from '@/shared/types/domain';
import type { PendingPdfTextSelection } from '../pdf-reader/PdfTextSelectionToolbar';

/** A selection belongs to one rendered passage; never borrow another pane's selection. */
export function readReflowSelection(root: HTMLElement, segments: SourceSegment[], selection: Selection | null): PendingPdfTextSelection | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const element = (node: Node) => node instanceof Element ? node : node.parentElement;
  const start = element(range.startContainer)?.closest<HTMLElement>('[data-reading-selection-source]');
  const end = element(range.endContainer)?.closest<HTMLElement>('[data-reading-selection-source]');
  if (!start || start !== end || !root.contains(start)) return null;
  const segment = segments.find(value => value.uid === start.dataset.readingSelectionSource);
  const text = selection.toString().trim();
  if (!segment || !text) return null;
  const rect = range.getBoundingClientRect();
  return { segment, selection: { text, page_idx: segment.page_idx, rects: [] },
    anchorRect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
    position: { x: rect.left, y: rect.bottom } };
}

export function useReflowTextSelection(root: RefObject<HTMLDivElement>, segments: SourceSegment[]) {
  const [pending, setPending] = useState<PendingPdfTextSelection | null>(null);
  const close = useCallback(() => setPending(null), []);
  const capture = () => setPending(root.current ? readReflowSelection(root.current, segments, window.getSelection()) : null);
  useEffect(() => {
    if (!pending) return;
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-reading-selection-toolbar]')) return;
      if (event.type === 'scroll' || !(target instanceof Node) || !root.current?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('blur', close);
    window.addEventListener('neuink:reader-surface-change', close);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('neuink:reader-surface-change', close);
      window.removeEventListener('keydown', escape);
    };
  }, [close, pending, root]);
  return { pending, close, capture };
}
