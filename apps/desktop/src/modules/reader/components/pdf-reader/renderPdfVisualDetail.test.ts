// @vitest-environment jsdom
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';
import { renderPdfVisualDetail } from './renderPdfVisualDetail';

afterEach(() => vi.restoreAllMocks());
const segment: SourceSegment = { uid: 'table', page_idx: 2, segment_type: 'table', text: '', markdown: null, bbox: [100, 200, 900, 400] };
function fixture() {
  const cancel = vi.fn();
  const context = {} as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,result');
  const render = vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel });
  const getPage = vi.fn().mockResolvedValue({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render });
  return { pdf: { getPage } as unknown as PDFDocumentProxy, getPage, render, cancel };
}
describe('PDF visual detail raster', () => {
  it('renders the original page region at inspection resolution, releases its canvas, and respects the page index', async () => {
    const { pdf, getPage, render } = fixture();
    const result = await renderPdfVisualDetail(pdf, segment, new AbortController().signal);
    expect(result).toContain('data:image/png');
    expect(getPage).toHaveBeenCalledWith(3);
    const call = render.mock.calls[0][0];
    expect(call.viewport).toEqual({ width: 2400, height: 3200 });
    expect(call.transform).toEqual([1, 0, 0, 1, -224, -624]);
    expect(call.canvas.width).toBe(0);
    expect(call.canvas.height).toBe(0);
  });
  it('bounds large regions and uses the rotated PDF viewport geometry', async () => {
    const { pdf, getPage, render } = fixture();
    getPage.mockResolvedValue({ getViewport: ({ scale }: { scale: number }) => ({ width: 2000 * scale, height: 1000 * scale }), render });
    let dimensions = { width: 0, height: 0 };
    render.mockImplementation(input => { dimensions = { width: input.canvas.width, height: input.canvas.height }; return { promise: Promise.resolve(), cancel: vi.fn() }; });
    await renderPdfVisualDetail(pdf, { ...segment, bbox: [0, 0, 1000, 1000] }, new AbortController().signal);
    expect(dimensions.width).toBeLessThanOrEqual(2560);
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(4_000_000);
    expect(dimensions.width).toBe(dimensions.height * 2);
  });
  it('cancels an in-flight render and rejects invalid/aborted requests before rendering', async () => {
    const { pdf, render, cancel } = fixture();
    let reject!: (reason: Error) => void;
    cancel.mockImplementation(() => reject(new Error('cancelled')));
    render.mockReturnValue({ promise: new Promise((_, fail) => { reject = fail; }), cancel });
    const controller = new AbortController();
    const result = renderPdfVisualDetail(pdf, segment, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(result).rejects.toThrow('cancelled');
    expect(cancel).toHaveBeenCalledOnce();
    await expect(renderPdfVisualDetail(pdf, segment, controller.signal)).rejects.toThrow();
    await expect(renderPdfVisualDetail(pdf, { ...segment, bbox: [100, 100, 100, 100] }, new AbortController().signal)).rejects.toThrow();
    expect(render).toHaveBeenCalledOnce();
  });
});
