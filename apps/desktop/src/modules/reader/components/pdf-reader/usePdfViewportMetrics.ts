import { useCallback, useEffect, useRef, useState } from 'react';

import type { SourceSegment } from '@/shared/types/domain';

import {
  DEFAULT_PAGE_WIDTH,
  PDF_RAIL_WIDTH,
  PDF_VIEWPORT_PADDING
} from './readerConstants';
import { findNearestSegmentUidInViewport } from './readerUtils';

const VIEWPORT_WIDTH_COMMIT_DELAY_MS = 240;
const SPLIT_RESIZE_WIDTH_COMMIT_INTERVAL_MS = 72;
const RESTORE_WIDTH_CHECK_DELAY_MS = 160;
const MIN_PDF_VIEWPORT_WIDTH = PDF_RAIL_WIDTH + PDF_VIEWPORT_PADDING + 80;

export function usePdfViewportMetrics({
  notePaneOpen,
  segments
}: {
  notePaneOpen: boolean;
  segments: SourceSegment[];
}) {
  const pdfScrollRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const widthAnimationFrameRef = useRef<number | null>(null);
  const widthCommitTimerRef = useRef<number | null>(null);
  const restoreCheckTimerRef = useRef<number | null>(null);
  const widthCommitModeRef = useRef<'debounce' | 'throttle' | null>(null);
  const measuredWidthRef = useRef(DEFAULT_PAGE_WIDTH);
  const hasMeasuredWidthRef = useRef(false);
  const [pdfScrollElement, setPdfScrollElement] = useState<HTMLDivElement | null>(null);
  const [pdfViewportWidth, setPdfViewportWidth] = useState(DEFAULT_PAGE_WIDTH);
  const [activeScrollSegmentUid, setActiveScrollSegmentUid] = useState<
    string | null
  >(null);

  const bindPdfScrollElement = useCallback((element: HTMLDivElement | null) => {
    pdfScrollRef.current = element;
    setPdfScrollElement((current) => (current === element ? current : element));
  }, []);

  useEffect(() => {
    const element = pdfScrollElement;
    if (!element) {
      return undefined;
    }

    const updateViewportWidth = (commitImmediately = false) => {
      const viewportWidth = element.clientWidth;
      // WebView2 can briefly report a 1px viewport when a native window is
      // minimized. Committing it collapses every PDF page to a 1px bitmap.
      if (viewportWidth < MIN_PDF_VIEWPORT_WIDTH) {
        if (widthCommitTimerRef.current !== null) {
          window.clearTimeout(widthCommitTimerRef.current);
          widthCommitTimerRef.current = null;
          widthCommitModeRef.current = null;
        }
        return;
      }

      measuredWidthRef.current = viewportWidth;
      if (!hasMeasuredWidthRef.current || commitImmediately) {
        if (widthCommitTimerRef.current !== null) {
          window.clearTimeout(widthCommitTimerRef.current);
          widthCommitTimerRef.current = null;
        }
        widthCommitModeRef.current = null;
        hasMeasuredWidthRef.current = true;
        setPdfViewportWidth((current) =>
          current === viewportWidth ? current : viewportWidth
        );
      } else if (document.body.classList.contains('is-workspace-split-resizing')) {
        if (widthCommitModeRef.current === 'throttle') {
          return;
        }
        if (widthCommitTimerRef.current !== null) {
          window.clearTimeout(widthCommitTimerRef.current);
        }
        widthCommitModeRef.current = 'throttle';
        widthCommitTimerRef.current = window.setTimeout(() => {
          widthCommitTimerRef.current = null;
          widthCommitModeRef.current = null;
          const committedWidth = measuredWidthRef.current;
          setPdfViewportWidth((current) =>
            current === committedWidth ? current : committedWidth
          );
        }, SPLIT_RESIZE_WIDTH_COMMIT_INTERVAL_MS);
      } else {
        if (widthCommitTimerRef.current !== null) {
          window.clearTimeout(widthCommitTimerRef.current);
        }
        widthCommitModeRef.current = 'debounce';
        widthCommitTimerRef.current = window.setTimeout(() => {
          widthCommitTimerRef.current = null;
          widthCommitModeRef.current = null;
          const committedWidth = measuredWidthRef.current;
          setPdfViewportWidth((current) =>
            current === committedWidth ? current : committedWidth
          );
        }, VIEWPORT_WIDTH_COMMIT_DELAY_MS);
      }
    };

    const scheduleImmediateViewportWidthUpdate = () => {
      if (widthAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(widthAnimationFrameRef.current);
      }
      widthAnimationFrameRef.current = window.requestAnimationFrame(() => {
        widthAnimationFrameRef.current = null;
        updateViewportWidth(true);
      });
    };

    const remeasureAfterWindowRestore = () => {
      scheduleImmediateViewportWidthUpdate();
      if (restoreCheckTimerRef.current !== null) {
        window.clearTimeout(restoreCheckTimerRef.current);
      }
      // Focus/visibility can precede the final WebView layout by one frame.
      restoreCheckTimerRef.current = window.setTimeout(() => {
        restoreCheckTimerRef.current = null;
        scheduleImmediateViewportWidthUpdate();
      }, RESTORE_WIDTH_CHECK_DELAY_MS);
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) remeasureAfterWindowRestore();
    };

    updateViewportWidth(true);

    const observer = new ResizeObserver(() => updateViewportWidth());
    observer.observe(element);
    window.addEventListener(
      'neuink:reader-surface-change',
      scheduleImmediateViewportWidthUpdate
    );
    window.addEventListener('resize', scheduleImmediateViewportWidthUpdate);
    window.addEventListener('focus', remeasureAfterWindowRestore);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (widthAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(widthAnimationFrameRef.current);
        widthAnimationFrameRef.current = null;
      }
      if (widthCommitTimerRef.current !== null) {
        window.clearTimeout(widthCommitTimerRef.current);
        widthCommitTimerRef.current = null;
      }
      if (restoreCheckTimerRef.current !== null) {
        window.clearTimeout(restoreCheckTimerRef.current);
        restoreCheckTimerRef.current = null;
      }
      widthCommitModeRef.current = null;
      observer.disconnect();
      window.removeEventListener(
        'neuink:reader-surface-change',
        scheduleImmediateViewportWidthUpdate
      );
      window.removeEventListener('resize', scheduleImmediateViewportWidthUpdate);
      window.removeEventListener('focus', remeasureAfterWindowRestore);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pdfScrollElement]);

  useEffect(() => {
    const element = pdfScrollElement;
    if (!element) {
      return undefined;
    }

    const updateActiveSegment = () => {
      const nextActiveSegmentUid = findNearestSegmentUidInViewport(element);
      setActiveScrollSegmentUid((current) =>
        current === nextActiveSegmentUid ? current : nextActiveSegmentUid
      );
    };

    const scheduleActiveSegmentUpdate = () => {
      if (animationFrameRef.current !== null) {
        return;
      }

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        updateActiveSegment();
      });
    };

    updateActiveSegment();
    element.addEventListener('scroll', scheduleActiveSegmentUpdate, {
      passive: true
    });

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      element.removeEventListener('scroll', scheduleActiveSegmentUpdate);
    };
  }, [notePaneOpen, pdfScrollElement, segments]);

  return {
    activeScrollSegmentUid,
    bindPdfScrollElement,
    pdfScrollRef,
    pdfViewportWidth
  };
}
