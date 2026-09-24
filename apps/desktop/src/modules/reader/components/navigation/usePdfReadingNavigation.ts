import { useEffect, useRef, type RefObject } from 'react';
import type { SourceSegment } from '@/shared/types/domain';
import { revealPdfPage } from '../pdf-reader/pdfPageNavigation';
import { scrollToPage, scrollToPdfRect, scrollToSegment } from '../pdf-reader/readerUtils';
import { useReadingNavigation } from './ReadingNavigation';
import { capturePdfReadingPosition, restorePdfReadingPosition } from './pdfReadingPosition';

export function usePdfReadingNavigation(scrollRef: RefObject<HTMLDivElement>, segments: SourceSegment[], enabled: boolean,
  flash: (uid: string) => void, zoom?: { value: number; restore: (value: number) => void }) {
  const register = useReadingNavigation()?.register;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    if (!register || !enabled) return;
    let cancelled = false;
    let frame = 0;
    let restoreVersion = 0;
    const unregister = register({
      cancelRestore: () => { restoreVersion += 1; cancelAnimationFrame(frame); },
      capture: () => {
        const position = capturePdfReadingPosition(scrollRef.current);
        if (!position) return null;
        return { ...position,
          ...(zoomRef.current ? { zoom: zoomRef.current.value } : {}) };
      },
      restore: position => {
        const container = scrollRef.current;
        if (!container) return;
        const version = ++restoreVersion;
        cancelAnimationFrame(frame);
        const restore = () => {
          if (cancelled || version !== restoreVersion) return;
          restorePdfReadingPosition(container, position);
        };
        const reveal = () => {
          if (cancelled || version !== restoreVersion) return;
          if (!revealPdfPage(container, position.pageIdx, restore)) restore();
        };
        if (position.zoom !== undefined && zoomRef.current && position.zoom !== zoomRef.current.value) {
          zoomRef.current.restore(position.zoom);
          // Let React resize the page before restoring its relative offset.
          frame = requestAnimationFrame(() => { frame = requestAnimationFrame(reveal); });
        } else reveal();
      },
      navigate: target => {
        restoreVersion += 1;
        cancelAnimationFrame(frame);
        const container = scrollRef.current;
        if (!container) return false;
        const segment = target.segmentUid ? segments.find(s => s.uid === target.segmentUid || s.continuation_group_id === target.segmentUid) : undefined;
        if (segment) flash(segment.uid);
        const moved = scrollToPdfRect(target.pageIdx, target.rect ?? segment?.bbox, container)
          || (segment ? scrollToSegment(segment.uid, container) : false) || scrollToPage(target.pageIdx, container);
        if (moved) container.focus({ preventScroll: true });
        return moved;
      }
    }, scrollRef.current);
    return () => { cancelled = true; cancelAnimationFrame(frame); unregister(); };
  }, [enabled, flash, register, scrollRef, segments]);
}
