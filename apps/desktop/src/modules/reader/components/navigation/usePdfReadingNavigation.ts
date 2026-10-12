import { useEffect, useRef, type RefObject } from 'react';
import type { SourceSegment } from '@/shared/types/domain';
import { revealPdfPage } from '../pdf-reader/pdfPageNavigation';
import { scrollToPage, scrollToPdfRect, scrollToSegment } from '../pdf-reader/readerUtils';
import { useReadingNavigation, type ReadingPosition } from './ReadingNavigation';
import { capturePdfReadingPosition, restorePdfReadingPosition } from './pdfReadingPosition';
import { findSourceSegment } from '@/shared/lib/listItemSegments';

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
    let geometryObserver: ResizeObserver | undefined;
    let pendingPosition: ReadingPosition | null = null;
    const cancelRestore = () => {
      restoreVersion += 1; cancelAnimationFrame(frame);
      geometryObserver?.disconnect(); geometryObserver = undefined;
      pendingPosition = null;
    };
    const unregister = register({
      cancelRestore,
      capture: () => {
        const position = pendingPosition ?? capturePdfReadingPosition(scrollRef.current);
        if (!position) return null;
        return { ...position,
          ...(zoomRef.current ? { zoom: zoomRef.current.value } : {}) };
      },
      restore: position => {
        const container = scrollRef.current;
        if (!container) return;
        cancelRestore();
        const version = restoreVersion;
        const restore = () => {
          if (cancelled || version !== restoreVersion) return;
          restorePdfReadingPosition(container, position);
          const page = [...container.querySelectorAll<HTMLElement>('[data-pdf-page-index]')]
            .find(node => Number(node.dataset.pdfPageIndex) === position.pageIdx);
          const canvas = page?.querySelector('[data-guide="pdf-page"]');
          // Lazy pages initially use an estimated paper ratio. Reapply the
          // anchor when PDF.js commits the real height, then release the observer.
          if (!page || !canvas || canvas.getAttribute('data-pdf-geometry-ready') === 'true' || typeof ResizeObserver === 'undefined') return;
          pendingPosition = position;
          geometryObserver = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              if (cancelled || version !== restoreVersion) return;
              restorePdfReadingPosition(container, position);
              if (canvas.getAttribute('data-pdf-geometry-ready') === 'true') {
                geometryObserver?.disconnect(); geometryObserver = undefined;
                pendingPosition = null;
              }
            });
          });
          geometryObserver.observe(page);
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
        cancelRestore();
        const container = scrollRef.current;
        if (!container) return false;
        const segment = target.segmentUid ? findSourceSegment(segments, target.segmentUid) : undefined;
        if (segment) flash(segment.uid);
        const moved = scrollToPdfRect(target.pageIdx, target.rect ?? segment?.bbox, container)
          || (segment ? scrollToSegment(segment.uid, container) : false) || scrollToPage(target.pageIdx, container);
        if (moved) container.focus({ preventScroll: true });
        return moved;
      }
    }, scrollRef.current);
    return () => { cancelled = true; cancelRestore(); unregister(); };
  }, [enabled, flash, register, scrollRef, segments]);
}
