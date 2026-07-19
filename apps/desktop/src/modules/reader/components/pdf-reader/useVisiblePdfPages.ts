import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const PAGE_RENDER_OVERSCAN = 1;
const PAGE_RENDER_PRELOAD_PX = 600;
const RESIZE_VISIBILITY_DELAY_MS = 180;

type PdfPageVisibility = {
  renderPageIndexes: Set<number>;
  visiblePageIndexes: Set<number>;
};

export function useVisiblePdfPages({
  pageCount,
  scrollRef
}: {
  pageCount: number;
  scrollRef: RefObject<HTMLDivElement>;
}) {
  const animationFrameRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const [visibility, setVisibility] = useState<PdfPageVisibility>(() => ({
    renderPageIndexes: withPageOverscan(new Set([0]), pageCount),
    visiblePageIndexes: pageCount > 0 ? new Set([0]) : new Set()
  }));

  useEffect(() => {
    setVisibility({
      renderPageIndexes: withPageOverscan(new Set([0]), pageCount),
      visiblePageIndexes: pageCount > 0 ? new Set([0]) : new Set()
    });
  }, [pageCount]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || pageCount === 0) {
      return undefined;
    }

    const updateVisiblePages = () => {
      const rootRect = root.getBoundingClientRect();
      if (rootRect.width <= 0 || rootRect.height <= 0) {
        return;
      }
      const visiblePages = new Set<number>();
      const nearbyPages = new Set<number>();
      const pageElements = Array.from(
        root.querySelectorAll<HTMLElement>('[data-pdf-page-index]')
      );

      for (const element of pageElements) {
        const pageIdx = Number(element.dataset.pdfPageIndex);
        if (!Number.isInteger(pageIdx)) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        if (rect.bottom >= rootRect.top && rect.top <= rootRect.bottom) {
          visiblePages.add(pageIdx);
        }
        if (
          rect.bottom >= rootRect.top - PAGE_RENDER_PRELOAD_PX &&
          rect.top <= rootRect.bottom + PAGE_RENDER_PRELOAD_PX
        ) {
          nearbyPages.add(pageIdx);
        }
      }

      setVisibility((current) => {
        const nextVisible = visiblePages.size > 0 ? visiblePages : current.visiblePageIndexes;
        const nextRender = withPageOverscan(
          nearbyPages.size > 0 ? nearbyPages : nextVisible,
          pageCount
        );
        return sameSet(current.visiblePageIndexes, nextVisible) &&
          sameSet(current.renderPageIndexes, nextRender)
          ? current
          : {
              renderPageIndexes: nextRender,
              visiblePageIndexes: nextVisible
            };
      });
    };

    const scheduleVisiblePageUpdate = () => {
      if (animationFrameRef.current !== null) {
        return;
      }

      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        updateVisiblePages();
      });
    };

    const scheduleResizeVisibilityUpdate = () => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        scheduleVisiblePageUpdate();
      }, RESIZE_VISIBILITY_DELAY_MS);
    };

    updateVisiblePages();
    scheduleVisiblePageUpdate();

    const observer = new ResizeObserver(scheduleResizeVisibilityUpdate);
    observer.observe(root);
    root.addEventListener('scroll', scheduleVisiblePageUpdate, { passive: true });

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      observer.disconnect();
      root.removeEventListener('scroll', scheduleVisiblePageUpdate);
    };
  }, [pageCount, scrollRef]);

  return visibility;
}

function withPageOverscan(source: Set<number>, pageCount: number) {
  if (pageCount <= 0) {
    return new Set<number>();
  }

  const visible = source.size > 0 ? source : new Set([0]);
  const next = new Set<number>();

  for (const pageIdx of visible) {
    for (
      let index = Math.max(0, pageIdx - PAGE_RENDER_OVERSCAN);
      index <= Math.min(pageCount - 1, pageIdx + PAGE_RENDER_OVERSCAN);
      index += 1
    ) {
      next.add(index);
    }
  }

  return next;
}

function sameSet(left: Set<number>, right: Set<number>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}
