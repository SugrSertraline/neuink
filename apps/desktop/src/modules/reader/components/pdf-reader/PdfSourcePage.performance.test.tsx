// @vitest-environment jsdom

import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import type { SourceSegment } from '@/shared/types/domain';

vi.mock('./PdfCanvasPage', () => ({
  PdfCanvasPage: () => <div data-testid="mock-pdf-canvas" />,
  PdfTextSelectionHighlightLayer: () => <div data-testid="mock-pdf-highlights" />,
}));

import { PdfSourcePage } from './PdfSourcePage';
import type { PageSegments, SegmentRegionItem } from './types';

const originalResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
});

describe('PdfSourcePage performance boundaries', () => {
  it('does not attach per-region ResizeObservers in hover translation mode', () => {
    const observe = vi.fn();
    globalThis.ResizeObserver = class ResizeObserverMock {
      observe = observe;
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;

    renderPdfSourcePage(createPage(80));

    expect(observe).not.toHaveBeenCalled();
  });

  it('does not commit again while the pointer stays inside the same region', () => {
    let commits = 0;
    const onRender: ProfilerOnRenderCallback = () => {
      commits += 1;
    };
    const result = render(
      <Profiler id="pdf-page" onRender={onRender}>
        {pdfSourcePage(createPage(1))}
      </Profiler>,
    );
    const hitLayer = result.getByTestId('pdf-page-hit-layer-0');
    vi.spyOn(hitLayer, 'getBoundingClientRect').mockReturnValue({
      bottom: 1000,
      height: 1000,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerEnter(hitLayer, { buttons: 0, clientX: 100, clientY: 100 });
    const commitsAfterFirstEntry = commits;
    expect(commitsAfterFirstEntry).toBeGreaterThan(1);

    fireEvent.pointerEnter(hitLayer, { buttons: 0, clientX: 120, clientY: 120 });
    expect(commits).toBe(commitsAfterFirstEntry);
  });

  it('highlights only the navigated segment edge', () => {
    const result = render(pdfSourcePage(createPage(2), 'segment-1'));
    const firstSegment = result.container.querySelector('#segment-segment-0');
    const targetSegment = result.container.querySelector('#segment-segment-1');

    expect(firstSegment?.classList.contains('segment-navigation-highlight')).toBe(false);
    expect(targetSegment?.classList.contains('segment-navigation-highlight')).toBe(true);
    expect((targetSegment as HTMLElement | null)?.style.border).toBe(
      '3px solid var(--primary)',
    );
  });

});

function renderPdfSourcePage(page: PageSegments) {
  return render(pdfSourcePage(page));
}

function pdfSourcePage(
  page: PageSegments,
  flashSegmentUid: string | null = null,
) {
  return (
    <PdfSourcePage
      annotationsBySegmentUid={new Map()}
      flashSegmentUid={flashSegmentUid}
      hoveredSegmentUid={null}
      hoverPreviewEnabled
      hoverPreviewShowOriginal={false}
      hoverPreviewShowNote={false}
      hoverPreviewShowAnnotation={false}
      hoverPreviewShowRegion={false}
      hoverPreviewShowTranslation={false}
      notesBySegmentUid={new Map()}
      page={page}
      pageWidth={800}
      pdfDocument={{} as PDFDocumentProxy}
      renderEnabled={false}
      renderPriority="visible"
      showRegions={false}
      sourceBacklinksBySegmentUid={{}}
      sourceEntryId="entry-test"
      suppressRegions={false}
      translationBySegmentUid={new Map()}
      translationMode="hover"
      translationStatus={null}
      translationVisible={false}
      workspaceRoot={null}
      onCloseSegmentOverlay={() => undefined}
      onOpenSegmentAnnotation={() => undefined}
      onOpenSegmentNote={() => undefined}
      onOpenSourceBacklink={() => undefined}
      onToggleSegment={() => undefined}
      altClickOpensNote
    />
  );
}

function createPage(regionCount: number): PageSegments {
  const regions = Array.from({ length: regionCount }, (_, index) =>
    createRegion(index),
  );
  return {
    pageIdx: 0,
    regions,
    segments: regions.map((region) => region.sourceSegment),
  };
}

function createRegion(index: number): SegmentRegionItem {
  const offset = index * 2;
  const segment = {
    asset_path: null,
    bbox: [offset, offset, Math.min(500, offset + 100), Math.min(500, offset + 100)],
    block_role: null,
    continuation_group_id: null,
    markdown: `region ${index}`,
    mineru_metadata: null,
    page_idx: 0,
    segment_type: 'text',
    text: `region ${index}`,
    uid: `segment-${index}`,
    visual_group_id: null,
  } as unknown as SourceSegment;
  return {
    bbox: [0, 0, 500, 500],
    hoverGroupUid: segment.uid,
    id: `region-${index}`,
    isContinuation: false,
    pageIdx: 0,
    relationGroupUid: null,
    segment,
    sourceSegment: segment,
  };
}
