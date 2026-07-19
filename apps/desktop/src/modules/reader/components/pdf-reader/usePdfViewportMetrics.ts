import { useEffect, useRef, useState } from 'react';

import type { SourceSegment } from '@/shared/types/domain';

import { DEFAULT_PAGE_WIDTH } from './readerConstants';
import { findNearestSegmentUidInViewport } from './readerUtils';

const VIEWPORT_WIDTH_COMMIT_DELAY_MS = 240;

export function usePdfViewportMetrics({
  notePaneOpen,
  segments
}: {
  notePaneOpen: boolean;
  segments: SourceSegment[];
}) {
  const pdfScrollRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const widthCommitTimerRef = useRef<number | null>(null);
  const measuredWidthRef = useRef(DEFAULT_PAGE_WIDTH);
  const hasMeasuredWidthRef = useRef(false);
  const [pdfViewportWidth, setPdfViewportWidth] = useState(DEFAULT_PAGE_WIDTH);
  const [activeScrollSegmentUid, setActiveScrollSegmentUid] = useState<
    string | null
  >(null);

  useEffect(() => {
    const element = pdfScrollRef.current;
    if (!element) {
      return undefined;
    }

    const updateViewportWidth = () => {
      if (document.body.classList.contains('is-workspace-split-resizing')) {
        return;
      }

      const viewportWidth = element.clientWidth;
      if (viewportWidth <= 0) {
        return;
      }

      measuredWidthRef.current = viewportWidth;
      if (!hasMeasuredWidthRef.current) {
        hasMeasuredWidthRef.current = true;
        setPdfViewportWidth(viewportWidth);
      } else {
        if (widthCommitTimerRef.current !== null) {
          window.clearTimeout(widthCommitTimerRef.current);
        }
        widthCommitTimerRef.current = window.setTimeout(() => {
          widthCommitTimerRef.current = null;
          const committedWidth = measuredWidthRef.current;
          setPdfViewportWidth((current) =>
            current === committedWidth ? current : committedWidth
          );
        }, VIEWPORT_WIDTH_COMMIT_DELAY_MS);
      }

    };

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

    updateViewportWidth();
    updateActiveSegment();

    const observer = new ResizeObserver(updateViewportWidth);
    observer.observe(element);

    element.addEventListener('scroll', scheduleActiveSegmentUpdate, {
      passive: true
    });

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (widthCommitTimerRef.current !== null) {
        window.clearTimeout(widthCommitTimerRef.current);
        widthCommitTimerRef.current = null;
      }
      observer.disconnect();
      element.removeEventListener('scroll', scheduleActiveSegmentUpdate);
    };
  }, [notePaneOpen, segments]);

  return {
    activeScrollSegmentUid,
    pdfScrollRef,
    pdfViewportWidth
  };
}
