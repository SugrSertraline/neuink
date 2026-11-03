// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceSegment } from '@/shared/types/domain';
import { ToastContext } from '@/shared/hooks/useToast';
import { PdfSourcePage } from './PdfSourcePage';
import { groupSegmentsByPage } from './readerUtils';
import { renderPdfVisualDetail } from './renderPdfVisualDetail';

vi.mock('./PdfCanvasPage', () => ({ PdfCanvasPage: () => null, PdfTextSelectionHighlightLayer: () => null }));
vi.mock('./renderPdfVisualDetail', () => ({ renderPdfVisualDetail: vi.fn() }));

const pdf = {} as PDFDocumentProxy;
const figure: SourceSegment = { uid: 'figure', page_idx: 0, segment_type: 'figure', bbox: [100, 100, 900, 800],
  asset_path: 'https://example.com/figure.png', text: 'Figure 1', markdown: null };

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(renderPdfVisualDetail).mockResolvedValue('data:image/png;base64,preview');
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; isPrimary = true; });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function setup(segment = figure, options: { suppressRegions?: boolean; altClickOpensNote?: boolean } = {}) {
  const toggle = vi.fn(), note = vi.fn();
  const props = { activeAnnotationId: null, annotationsBySegmentUid: new Map(), flashSegmentUid: null,
    hoveredSegmentUid: null, hoverPreviewEnabled: false, hoverPreviewShowRegion: false, hoverPreviewShowOriginal: false,
    hoverPreviewShowNote: false, hoverPreviewShowAnnotation: false, hoverPreviewShowTranslation: false, inlineAnnotationHoverEnabled: false,
    notesBySegmentUid: new Map(), page: groupSegmentsByPage([segment], 1)[0],
    pageWidth: 800, pdfDocument: pdf, renderEnabled: false, renderPriority: 'visible' as const, showRegions: false,
    sourceBacklinksBySegmentUid: {}, sourceEntryId: 'test', suppressRegions: false, translationBySegmentUid: new Map(),
    translationMode: 'hover' as const, translationStatus: null, translationVisible: false, workspaceRoot: null,
    onCloseSegmentOverlay: vi.fn(), onOpenSegmentAnnotation: vi.fn(), onOpenSegmentNote: note,
    onOpenSourceBacklink: vi.fn(), onToggleSegment: toggle, ...options };
  const view = (extra = {}) => <ToastContext.Provider value={{ dismiss: vi.fn(), notify: () => 'toast' }}>
    <PdfSourcePage {...props} {...extra} />
  </ToastContext.Provider>;
  const ui = render(view());
  const hit = ui.getByTestId('pdf-page-hit-layer-0');
  vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000));
  return { ...ui, hit, toggle, note, view };
}
function click(hit: HTMLElement, detail = 1, extra: MouseEventInit = {}) {
  fireEvent.pointerDown(hit, { button: 0, clientX: 300, clientY: 300, ...extra });
  fireEvent.pointerUp(hit, { button: 0, clientX: 300, clientY: 300, ...extra });
  fireEvent.click(hit, { button: 0, clientX: 300, clientY: 300, detail, ...extra });
}
function doubleClick(hit: HTMLElement, extra: MouseEventInit = {}) {
  click(hit, 1, extra); click(hit, 2, extra);
  fireEvent.doubleClick(hit, { button: 0, clientX: 300, clientY: 300, detail: 2, ...extra });
}

describe('PDF figure/table detail gesture', () => {
  it('opens a figure without first opening its single-click note, closes outside and restores focus without navigation', async () => {
    const { hit, toggle } = setup();
    doubleClick(hit);
    const dialog = screen.getByRole('dialog', { name: '图片详情' });
    expect(within(dialog).getByAltText('第 1 页 · 图片').getAttribute('src')).toBe(figure.asset_path);
    expect(renderPdfVisualDetail).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(600));
    expect(toggle).not.toHaveBeenCalled();
    const backdrop = document.querySelector('[data-slot="dialog-overlay"]')!;
    fireEvent.pointerDown(backdrop, { button: 0 });
    fireEvent.pointerUp(backdrop, { button: 0 });
    fireEvent.click(backdrop, { button: 0 });
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => vi.runOnlyPendingTimers());
    expect(document.activeElement).toBe(hit);
  });
  it('keeps the single-click action and cancels stale clicks on scroll or document switch', () => {
    const { hit, toggle, rerender, view } = setup();
    click(hit);
    expect(toggle).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(510));
    expect(toggle).toHaveBeenCalledOnce();
    click(hit); fireEvent.scroll(window);
    act(() => vi.advanceTimersByTime(510));
    expect(toggle).toHaveBeenCalledOnce();
    click(hit); rerender(view({ sourceEntryId: 'another-paper' }));
    act(() => vi.advanceTimersByTime(510));
    expect(toggle).toHaveBeenCalledOnce();
  });
  it('preserves text double-click selection and never magnifies paragraphs or modified clicks', () => {
    const { hit, toggle } = setup({ ...figure, segment_type: 'paragraph' });
    doubleClick(hit);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(toggle).toHaveBeenCalledTimes(2);
  });
  it.each([{ ctrlKey: true }, { altKey: true }, { shiftKey: true }, { metaKey: true }, { button: 2 }])('ignores non-default gestures: %j', extra => {
    const { hit } = setup(); doubleClick(hit, extra);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('does not magnify during layout dragging or after a moved pointer', () => {
    const { hit, rerender, view } = setup(figure, { suppressRegions: true });
    doubleClick(hit); expect(screen.queryByRole('dialog')).toBeNull();
    rerender(view({ suppressRegions: false }));
    fireEvent.pointerDown(hit, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.click(hit, { button: 0, detail: 2, clientX: 300, clientY: 300 });
    fireEvent.doubleClick(hit, { button: 0, detail: 2, clientX: 300, clientY: 300 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps an open viewer through layout resize but closes when the reader surface changes', () => {
    const { hit, rerender, view } = setup();
    doubleClick(hit);
    const dialog = screen.getByRole('dialog');
    rerender(view({ suppressRegions: true, pageWidth: 600 }));
    expect(screen.getByRole('dialog')).toBe(dialog);
    act(() => window.dispatchEvent(new Event('neuink:reader-surface-change')));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('opens a table over its selectable text and cancels the native word selection', async () => {
    const { hit, toggle } = setup({ ...figure, segment_type: 'table' });
    const layer = document.createElement('div'); layer.className = 'pdf-text-layer';
    const text = document.createElement('span'); text.textContent = 'Table cell'; layer.append(text); hit.append(layer);
    click(text);
    fireEvent.pointerDown(text, { button: 0, clientX: 300, clientY: 300 });
    const range = document.createRange(); range.selectNodeContents(text);
    window.getSelection()?.addRange(range);
    fireEvent.pointerUp(text, { button: 0, clientX: 300, clientY: 300 });
    fireEvent.click(text, { button: 0, detail: 2, clientX: 300, clientY: 300 });
    fireEvent.doubleClick(text, { button: 0, detail: 2, clientX: 300, clientY: 300 });
    await act(async () => {});
    const dialog = screen.getByRole('dialog', { name: '表格详情' });
    expect(within(dialog).getByAltText('第 1 页 · 表格').getAttribute('src')).toContain('data:image/png');
    expect(window.getSelection()?.isCollapsed).toBe(true);
    act(() => vi.advanceTimersByTime(600));
    expect(toggle).not.toHaveBeenCalled();
  });
  it('falls back to the PDF when the original figure fails and exposes the same viewer from the menu', async () => {
    const { hit } = setup();
    fireEvent.contextMenu(hit, { clientX: 300, clientY: 300 });
    fireEvent.click(screen.getByRole('menuitem', { name: '放大查看' }));
    fireEvent.error(within(screen.getByRole('dialog')).getByAltText('第 1 页 · 图片'));
    await act(async () => {});
    expect(renderPdfVisualDetail).toHaveBeenCalledOnce();
    expect(within(screen.getByRole('dialog')).getByAltText('第 1 页 · 图片').getAttribute('src')).toContain('data:image/png');
  });
  it('crops the visible continuation page instead of the table first page', async () => {
    const table: SourceSegment = { ...figure, segment_type: 'table', bbox: [100, 900, 900, 1400] };
    const { rerender, view } = setup(table);
    rerender(view({ page: groupSegmentsByPage([table], 2)[1] }));
    const hit = screen.getByTestId('pdf-page-hit-layer-1');
    vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000));
    doubleClick(hit); await act(async () => {});
    expect(renderPdfVisualDetail).toHaveBeenCalledWith(pdf, expect.objectContaining({ page_idx: 1, bbox: [100, 0, 900, 400] }), expect.any(AbortSignal));
    expect(within(screen.getByRole('dialog')).getByAltText('第 2 页 · 表格')).toBeTruthy();
  });
  it('shows recoverable crop failure, and aborts/ignores a late result when closed', async () => {
    vi.mocked(renderPdfVisualDetail).mockRejectedValueOnce(new Error('unavailable'));
    const { hit } = setup({ ...figure, asset_path: null, segment_type: 'table' });
    doubleClick(hit); await act(async () => {});
    expect(screen.getByRole('status').textContent).toContain('图片无法读取');
    let resolve!: (src: string) => void;
    vi.mocked(renderPdfVisualDetail).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: '重试图片' }));
    expect(screen.getByRole('status').textContent).toContain('正在加载');
    const calls = vi.mocked(renderPdfVisualDetail).mock.calls;
    const signal = calls[calls.length - 1][2];
    fireEvent.keyDown(screen.getByRole('region', { name: '图片详情内容' }), { key: 'Escape' });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve('data:image/png;base64,late'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
