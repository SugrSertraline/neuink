// @vitest-environment jsdom

import { cloneElement, Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import type { SourceSegment } from '@/shared/types/domain';
import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
import { ToastContext } from '@/shared/hooks/useToast';

vi.mock('./PdfCanvasPage', () => ({
  PdfCanvasPage: ({ pageWidth }: { pageWidth: number }) => (
    <div data-testid="mock-pdf-canvas" style={{ width: pageWidth }} />
  ),
  PdfTextSelectionHighlightLayer: ({ highlights }: { highlights: Array<{ active?: boolean }> }) => (
    <div
      data-active-highlights={highlights.filter((highlight) => highlight.active).length}
      data-highlight-count={highlights.length}
      data-testid="mock-pdf-highlights"
    />
  ),
}));

import { PdfSourcePage } from './PdfSourcePage';
import * as pdfRenderQueue from './pdfRenderQueue';
import type { PageSegments, SegmentRegionItem } from './types';
import { pdfBlockDrag } from '@/shared/lib/pdfBlockDrag';
import { groupSegmentsByPage } from './readerUtils';

const originalResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.ResizeObserver = originalResizeObserver;
});

describe('PdfSourcePage performance boundaries', () => {
  it.each([false, true])('offers item choice instead of selecting or dragging an ambiguous old list (Ctrl: %s)', ctrlKey => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 7; isPrimary = true; });
    const parent: SourceSegment = { uid: 'old-list', segment_type: 'list', page_idx: 0,
      bbox: [100, 100, 900, 500], text: 'First\nSecond', markdown: '- First\n- Second' };
    const onToggleSegment = vi.fn(), onAddAssistantContext = vi.fn();
    const ui = render(<ToastContext.Provider value={{ dismiss: vi.fn(), notify: () => 'toast' }}>{cloneElement(pdfSourcePage(groupSegmentsByPage([parent], 1)[0]), {
      renderEnabled: true, onToggleSegment, onAddAssistantContext,
    })}</ToastContext.Provider>);
    const hit = ui.getByTestId('pdf-page-hit-layer-0');
    vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000));
    fireEvent.pointerDown(hit, { button: 0, ctrlKey, clientX: 200, clientY: 400 });
    if (!ctrlKey) fireEvent.click(hit, { button: 0, clientX: 200, clientY: 400 });
    expect(onToggleSegment).not.toHaveBeenCalled();
    expect(pdfBlockDrag.getState()).toBeNull();
    fireEvent.click(ui.getByRole('menuitem', { name: '第 2 项' }));
    fireEvent.click(ui.getByRole('menuitem', { name: '附到助手对话' }));
    expect(onAddAssistantContext).toHaveBeenCalledWith(expect.objectContaining({ uid: 'old-list:list-item:1', text: 'Second' }));
  });
  it.each(['bullet', 'reference'])('selects, attaches and Ctrl-drags only the hit %s item', sub_type => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 7; isPrimary = true; });
    const parent: SourceSegment = { uid: 'list', segment_type: 'list', sub_type, page_idx: 0,
      bbox: [100, 100, 900, 500], text: 'First\nSecond', markdown: '- First\n- Second',
      continuation_group_id: 'whole-list', mineru_metadata: { list_item_regions: JSON.stringify([
        { bbox: [100, 100, 900, 250], text: 'First' }, { bbox: [100, 300, 900, 500], text: 'Second' },
      ]) } };
    const onToggleSegment = vi.fn(), onAddAssistantContext = vi.fn(), onCopyContent = vi.fn();
    const ui = render(<ToastContext.Provider value={{ dismiss: vi.fn(), notify: () => 'toast' }}>{cloneElement(pdfSourcePage(groupSegmentsByPage([parent], 1)[0]), {
      renderEnabled: true, onToggleSegment, onAddAssistantContext, onCopyContent, flashSegmentUid: 'list:list-item:1',
    })}</ToastContext.Provider>);
    const hit = ui.getByTestId('pdf-page-hit-layer-0');
    vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000));
    Object.assign(hit, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
    fireEvent.pointerDown(hit, { button: 0, clientX: 200, clientY: 400 });
    fireEvent.click(hit, { button: 0, clientX: 200, clientY: 400 });
    expect(onToggleSegment).toHaveBeenCalledWith(expect.objectContaining({ uid: 'list:list-item:1', text: 'Second', continuation_group_id: null }));
    expect(ui.container.querySelectorAll('.segment-navigation-highlight')).toHaveLength(1);
    fireEvent.contextMenu(hit, { clientX: 200, clientY: 400 });
    expect(ui.getByRole('menu', { name: '列表项操作' }).textContent).toContain('仅针对当前列表项');
    fireEvent.click(ui.getByRole('menuitem', { name: '附到助手对话' }));
    expect(onAddAssistantContext).toHaveBeenCalledWith(expect.objectContaining({ uid: 'list:list-item:1', text: 'Second' }));
    fireEvent.contextMenu(hit, { clientX: 200, clientY: 400 });
    fireEvent.click(ui.getByRole('menuitem', { name: '复制原文内容' }));
    expect(onCopyContent).toHaveBeenCalledWith(expect.objectContaining({ text: 'Second' }));
    fireEvent.contextMenu(hit, { clientX: 200, clientY: 400 });
    fireEvent.click(ui.getByRole('menuitem', { name: '添加整个列表到助手' }));
    expect(onAddAssistantContext).toHaveBeenLastCalledWith(parent);
    fireEvent.pointerDown(hit, { button: 0, buttons: 1, ctrlKey: true, clientX: 200, clientY: 400 });
    fireEvent.pointerMove(hit, { buttons: 1, clientX: 600, clientY: 300 });
    expect(pdfBlockDrag.getState()?.segment).toMatchObject({ uid: 'list:list-item:1', text: 'Second' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(pdfBlockDrag.getState()).toBeNull();
  });
  it.each([true, false])('captures Ctrl drag from the block interior through hover dismissal (preview enabled: %s)', hoverPreviewEnabled => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 7; isPrimary = true; });
    const onAddAssistantContext = vi.fn();
    const onToggleSegment = vi.fn();
    const ui = render(<ToastContext.Provider value={{ dismiss: vi.fn(), notify: () => 'toast' }}>{cloneElement(pdfSourcePage(createPage(1)), { renderEnabled: true, hoverPreviewEnabled, onAddAssistantContext, onToggleSegment })}</ToastContext.Provider>);
    const hit = ui.getByTestId('pdf-page-hit-layer-0');
    vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000));
    fireEvent.pointerEnter(hit, { buttons: 0, clientX: 100, clientY: 100 });
    expect(ui.queryByRole('button', { name: '拖动第 1 页片段到聊天框' })).toBeNull();
    Object.assign(hit, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
    const text = document.createElement('span');
    text.className = 'pdf-text-layer'; text.textContent = 'Original PDF text'; hit.append(text);
    expect(fireEvent.pointerDown(text, { button: 0, buttons: 1, ctrlKey: true, clientX: 300, clientY: 400 })).toBe(false);
    fireEvent.pointerMove(hit, { buttons: 1, clientX: 500, clientY: 250 });
    expect(pdfBlockDrag.getState()?.segment.uid).toBe('segment-0');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(hit, { clientX: 500, clientY: 250 });
    fireEvent.click(hit);
    expect(pdfBlockDrag.getState()).toBeNull();
    expect(onAddAssistantContext).not.toHaveBeenCalled();
    expect(onToggleSegment).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toBe('');
  });
  it('resolves overlapping block edges by geometry rather than the previous hovered block', () => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', MouseEvent);
    const page = createPage(2);
    page.regions[1].bbox = [200, 200, 400, 400];
    const ui = render(cloneElement(pdfSourcePage(page), { hoverPreviewShowOriginal: true }));
    const hit = ui.getByTestId('pdf-page-hit-layer-0');
    vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000));
    fireEvent.pointerEnter(hit, { buttons: 0, clientX: 100, clientY: 100 });
    expect(ui.getByRole('region', { name: '片段悬停预览' }).textContent).toContain('region 0');
    fireEvent.pointerMove(hit, { buttons: 0, clientX: 300, clientY: 201 });
    act(() => vi.advanceTimersByTime(20));
    expect(ui.getByRole('region', { name: '片段悬停预览' }).textContent).toContain('region 1');
    fireEvent.pointerMove(hit, { buttons: 0, clientX: 300, clientY: 400 });
    act(() => vi.advanceTimersByTime(20));
    expect(ui.getByRole('region', { name: '片段悬停预览' }).textContent).toContain('region 0');
  });

  it('hands an open preview to native selection, closes with Escape, then resumes hover on movement', () => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', MouseEvent);
    const onToggleSegment = vi.fn();
    const ui = render(<ToastContext.Provider value={{ dismiss: vi.fn(), notify: () => 'toast' }}>{cloneElement(pdfSourcePage(createPage(1)), {
      hoverPreviewShowOriginal: true, onToggleSegment,
      renderEnabled: true,
      onTranslateTextSelection: async () => 'translation',
    })}</ToastContext.Provider>);
    const hit = ui.getByTestId('pdf-page-hit-layer-0');
    vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000));
    const textLayer = document.createElement('div');
    textLayer.className = 'pdf-text-layer';
    textLayer.textContent = 'Chosen passage';
    hit.appendChild(textLayer);
    fireEvent.pointerEnter(hit, { buttons: 0, clientX: 100, clientY: 100 });
    expect(document.querySelector('[data-slot="pointer-preview"]')).toBeTruthy();
    fireEvent.pointerDown(textLayer, { button: 0, buttons: 1, clientX: 100, clientY: 100 });
    const range = document.createRange();
    range.selectNodeContents(textLayer);
    range.getClientRects = () => [new DOMRect(100, 100, 150, 20)] as unknown as DOMRectList;
    range.getBoundingClientRect = () => new DOMRect(100, 100, 150, 20);
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    act(() => vi.advanceTimersByTime(30));
    expect(ui.queryByRole('dialog', { name: '选区操作' })).toBeNull();
    expect(document.querySelector('[data-slot="pointer-preview"]')).toBeNull();
    fireEvent.pointerUp(textLayer, { button: 0, clientX: 250, clientY: 100 });
    fireEvent.click(hit, { button: 0, clientX: 250, clientY: 100 });
    act(() => vi.advanceTimersByTime(30));
    expect(ui.getByRole('dialog', { name: '选区操作' })).toBeTruthy();
    expect(onToggleSegment).not.toHaveBeenCalled();
    fireEvent.pointerMove(hit, { buttons: 0, clientX: 260, clientY: 100 });
    act(() => vi.advanceTimersByTime(30));
    expect(document.querySelector('[data-slot="pointer-preview"]')).toBeNull();
    fireEvent.keyDown(hit, { key: 'Escape' });
    expect(ui.queryByRole('dialog', { name: '选区操作' })).toBeNull();
    expect(window.getSelection()?.isCollapsed).toBe(true);
    fireEvent.pointerMove(hit, { buttons: 0, clientX: 270, clientY: 100 });
    act(() => vi.advanceTimersByTime(30));
    expect(document.querySelector('[data-slot="pointer-preview"]')).toBeTruthy();
  });

  it('restores hover on the next pointer frame after scrolling without blocking PDF rendering', () => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', MouseEvent);
    const interaction = vi.spyOn(pdfRenderQueue, 'notifyPdfInteraction');
    const result = render(cloneElement(pdfSourcePage(createPage(1)), { hoverPreviewShowOriginal: true }));
    const hitLayer = result.getByTestId('pdf-page-hit-layer-0');
    vi.spyOn(hitLayer, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, toJSON: () => ({}),
    });
    fireEvent.pointerEnter(hitLayer, { buttons: 0, clientX: 100, clientY: 100 });
    expect(document.querySelector('[data-slot="pointer-preview"]')).toBeTruthy();
    fireEvent.scroll(document);
    expect(document.querySelector('[data-slot="pointer-preview"]')).toBeNull();
    fireEvent.pointerMove(hitLayer, { buttons: 0, clientX: 110, clientY: 110 });
    act(() => { vi.advanceTimersByTime(20); });
    expect(document.querySelector('[data-slot="pointer-preview"]')).toBeTruthy();
    expect(interaction).not.toHaveBeenCalled();
  });
  it('updates offscreen page widths when a split is opened, resized, and closed', () => {
    const page = pdfSourcePage(createPage(0));
    const result = render(page);

    // Keep every other prop stable to exercise the memo boundary, not incidental
    // updates from freshly created maps or page objects.
    for (const pageWidth of [440, 300, 560, 800]) {
      result.rerender(cloneElement(page, { pageWidth }));
      expect(result.getByTestId('mock-pdf-canvas').style.width).toBe(`${pageWidth}px`);
    }
  });

  it('keeps the translated page visible while zoom temporarily suppresses region interactions', () => {
    const translation: TranslatedSegment = {
      error: null,
      page_idx: 0,
      segment_type: 'paragraph',
      segment_uid: 'segment-0',
      source_hash: 'source-hash',
      source_text: 'region 0',
      status: 'translated',
      translated_text: '缩放后仍可阅读的译文',
      updated_at: '2026-09-28T00:00:00Z',
    };
    const page = cloneElement(pdfSourcePage(createPage(1)), {
      renderEnabled: true,
      translationBySegmentUid: new Map([['segment-0', translation]]),
      translationMode: 'replace',
      translationVisible: true,
    });
    const result = render(page);
    expect(result.getByText('缩放后仍可阅读的译文')).toBeTruthy();

    result.rerender(cloneElement(page, { pageWidth: 960, suppressRegions: true }));
    expect(result.getByText('缩放后仍可阅读的译文')).toBeTruthy();
    expect(result.container.querySelector('[data-segment-uid="segment-0"]')?.getAttribute('role')).toBeNull();

    result.rerender(cloneElement(page, { pageWidth: 960, suppressRegions: false }));
    expect(result.getByText('缩放后仍可阅读的译文')).toBeTruthy();
  });

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

  it('marks only the focused persisted annotation as active', () => {
    const page = createPage(1);
    const annotation = {
      annotation_id: 'annotation-1',
      content: 'Selected conclusion',
      created_at: '2026-09-05T00:00:00Z',
      importance: 'normal' as const,
      kind: 'highlight',
      segment_uid: 'segment-0',
      text_selection: {
        color: 'yellow' as const,
        page_idx: 0,
        rects: [[100, 100, 300, 140] as [number, number, number, number]],
        text: 'Selected source text',
      },
      updated_at: '2026-09-05T00:00:00Z',
    };
    const result = render(
      pdfSourcePage(
        page,
        null,
        new Map([['segment-0', [annotation]]]),
        annotation.annotation_id,
      ),
    );

    const layer = result.getByTestId('mock-pdf-highlights');
    expect(layer.dataset.highlightCount).toBe('1');
    expect(layer.dataset.activeHighlights).toBe('1');
  });

  it('shows only the hit selection annotation, then restores the segment preview with source text', () => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', MouseEvent);
    const annotation = {
      annotation_id: 'annotation-1', segment_uid: 'segment-0', kind: 'translation',
      content: 'B 的译文', importance: 'normal' as const,
      text_selection: { color: 'yellow' as const, page_idx: 0,
        rects: [[100, 100, 300, 140] as [number, number, number, number]], text: 'B' },
      created_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-05T00:00:00Z',
    };
    const otherAnnotation = {
      ...annotation, annotation_id: 'annotation-2', content: 'C 的译文',
      text_selection: { ...annotation.text_selection,
        rects: [[310, 100, 350, 140] as [number, number, number, number]], text: 'C' },
    };
    const ui = render(cloneElement(pdfSourcePage(createPage(1), null,
      new Map([['segment-0', [annotation, otherAnnotation]]])), { hoverPreviewShowAnnotation: true }));
    const hit = ui.getByTestId('pdf-page-hit-layer-0');
    vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000));

    fireEvent.pointerEnter(hit, { buttons: 0, clientX: 200, clientY: 120 });
    const selectionPreview = ui.getByRole('region', { name: '选区批注悬停预览' });
    expect(selectionPreview.textContent).toContain('B 的译文');
    expect(selectionPreview.textContent).toContain('批注原文B');
    expect(selectionPreview.textContent).not.toContain('C 的译文');
    expect(ui.queryByRole('region', { name: '片段悬停预览' })).toBeNull();

    fireEvent.pointerMove(hit, { buttons: 0, clientX: 400, clientY: 400 });
    act(() => vi.advanceTimersByTime(20));
    expect(ui.queryByRole('region', { name: '选区批注悬停预览' })).toBeNull();
    const segmentPreview = ui.getByRole('region', { name: '片段悬停预览' });
    expect(segmentPreview.textContent).toContain('批注原文B');
    expect(segmentPreview.textContent).toContain('B 的译文');
    expect(segmentPreview.textContent).toContain('C 的译文');
  });

});

function renderPdfSourcePage(page: PageSegments) {
  return render(pdfSourcePage(page));
}

function pdfSourcePage(
  page: PageSegments,
  flashSegmentUid: string | null = null,
  annotationsBySegmentUid = new Map(),
  activeAnnotationId: string | null = null,
) {
  return (
    <PdfSourcePage
      activeAnnotationId={activeAnnotationId}
      annotationsBySegmentUid={annotationsBySegmentUid}
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
