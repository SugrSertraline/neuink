import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

import { notifyPdfInteraction } from './pdfRenderQueue';

const PAGE_RENDER_OVERSCAN = 1;
const PAGE_RENDER_PRELOAD_PX = 600;

type PdfPageVisibility = {
  renderPageIndexes: Set<number>;
  visiblePageIndexes: Set<number>;
};

export function useVisiblePdfPages({
  pageCount,
  enabled = true,
  scrollRef
}: {
  pageCount: number;
  enabled?: boolean;
  scrollRef: RefObject<HTMLDivElement>;
}) {
  const [visibility, setVisibility] = useState<PdfPageVisibility>(() =>
    initialVisibility(pageCount)
  );

  useEffect(() => {
    setVisibility(initialVisibility(pageCount));
  }, [pageCount]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || pageCount === 0 || !enabled) return undefined;

    const visiblePages = new Set<number>();
    const nearbyPages = new Set<number>();
    const commitVisibility = () => {
      setVisibility((current) => {
        const nextVisible = visiblePages.size > 0
          ? new Set(visiblePages)
          : current.visiblePageIndexes;
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
    const updateEntries = (target: Set<number>, entries: IntersectionObserverEntry[], meaningful = false) => {
      for (const entry of entries) {
        const pageIdx = Number((entry.target as HTMLElement).dataset.pdfPageIndex);
        if (!Number.isInteger(pageIdx)) continue;
        // A preceding page's 12px bottom edge can remain visible after a page
        // command. It must not become the current page or accrue reading time.
        const enoughPageVisible = !meaningful || !entry.intersectionRect ||
          entry.intersectionRect.height >= Math.min(48, entry.boundingClientRect.height * .12);
        if (entry.isIntersecting && enoughPageVisible) target.add(pageIdx);
        else target.delete(pageIdx);
      }
      commitVisibility();
    };

    const updateVisiblePageFromScrollPosition = () => {
      if (typeof document.elementFromPoint !== 'function') return null;
      const rootRect = root.getBoundingClientRect();
      if (rootRect.width <= 0 || rootRect.height <= 0) return null;

      const pageIndexes = new Set<number>();
      const readingHeight = Math.max(0, rootRect.height - topInset);
      for (const ratio of [0.35, 0.5, 0.65]) {
        const element = document.elementFromPoint(
          rootRect.left + rootRect.width / 2,
          rootRect.top + topInset + readingHeight * ratio
        );
        const page = element?.closest<HTMLElement>('[data-pdf-page-index]');
        if (!page || !root.contains(page)) continue;
        const pageIdx = Number(page.dataset.pdfPageIndex);
        if (Number.isInteger(pageIdx)) pageIndexes.add(pageIdx);
      }

      if (pageIndexes.size === 0) return null;
      const foundNewPage = [...pageIndexes].some((pageIdx) => !visiblePages.has(pageIdx));
      for (const pageIdx of pageIndexes) {
        visiblePages.add(pageIdx);
        nearbyPages.add(pageIdx);
      }
      commitVisibility();
      return foundNewPage;
    };

    const pageElements = root.querySelectorAll<HTMLElement>('[data-pdf-page-index]');
    let visibleObserver: IntersectionObserver | undefined;
    let topInset = -1;
    const updateViewport = () => {
      const rect = root.getBoundingClientRect();
      const scale = root.offsetHeight > 0 ? rect.height / root.offsetHeight || 1 : 1;
      // Page navigation uses scroll-padding to clear floating controls. Visibility
      // must use the same unobscured viewport, in physical CSS pixels at UI zoom.
      const inset = Math.max(0, (parseFloat(getComputedStyle(root).scrollPaddingTop) || 0) * scale);
      if (inset === topInset) return;
      topInset = inset;
      visibleObserver?.disconnect();
      visibleObserver = new IntersectionObserver(
        (entries) => updateEntries(visiblePages, entries, true),
        { root, threshold: [0, .01, .05, .1], ...(inset > 0 ? { rootMargin: `${-inset}px 0px 0px 0px` } : {}) }
      );
      for (const element of pageElements) visibleObserver.observe(element);
    };
    updateViewport();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewport);
    resize?.observe(root);
    const toolbar = root.closest('[data-reader-frame]')?.querySelector('[data-material="reader-toolbar"]');
    if (toolbar) resize?.observe(toolbar);
    const nearbyObserver = new IntersectionObserver(
      (entries) => updateEntries(nearbyPages, entries),
      { root, rootMargin: `${PAGE_RENDER_PRELOAD_PX}px 0px` }
    );
    for (const element of pageElements) {
      nearbyObserver.observe(element);
    }

    const handleScroll = () => {
      const pageChanged = updateVisiblePageFromScrollPosition();
      notifyPdfInteraction({
        abortVisible: pageChanged !== false,
        preservePreload: true
      });
    };
    root.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      visibleObserver?.disconnect();
      resize?.disconnect();
      nearbyObserver.disconnect();
      root.removeEventListener('scroll', handleScroll);
    };
  }, [enabled, pageCount, scrollRef]);

  return visibility;
}

function initialVisibility(pageCount: number): PdfPageVisibility {
  const visiblePageIndexes = pageCount > 0 ? new Set([0]) : new Set<number>();
  return {
    renderPageIndexes: withPageOverscan(visiblePageIndexes, pageCount),
    visiblePageIndexes
  };
}

function withPageOverscan(source: Set<number>, pageCount: number) {
  if (pageCount <= 0) return new Set<number>();
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
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}
