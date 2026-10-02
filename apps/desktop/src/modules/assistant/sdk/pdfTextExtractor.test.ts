// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractPdfText, slicePdfText } from './pdfTextExtractor';

const fake = vi.hoisted(() => ({
  terminate: vi.fn(), destroyWorker: vi.fn(), destroyDocument: vi.fn(), cleanup: vi.fn(),
  text: vi.fn(), getPage: vi.fn(), getDocument: vi.fn(),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({ default: class { terminate = fake.terminate; } }));
vi.mock('pdfjs-dist', () => ({
  PDFWorker: { create: () => ({ destroy: fake.destroyWorker }) }, getDocument: fake.getDocument,
}));
beforeEach(() => {
  vi.resetAllMocks();
  fake.text.mockResolvedValue({ items: [{ str: '中文摘要', hasEOL: true }, { str: 'English\0 text', hasEOL: false }] });
  fake.getPage.mockResolvedValue({ getTextContent: fake.text, cleanup: fake.cleanup });
  fake.destroyDocument.mockResolvedValue(undefined);
  fake.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 4, getPage: fake.getPage }), destroy: fake.destroyDocument });
});
afterEach(() => { vi.useRealTimers(); });

describe('PDF text worker lifecycle', () => {
  it('does not split emoji at JSON text and citation boundaries', () => {
    expect(slicePdfText('a😀z', 0, 2)).toBe('a');
    expect(slicePdfText('a😀z', 2, 4)).toBe('😀z');
    expect(slicePdfText('中文', 0, 1)).toBe('中');
  });
  it('extracts mixed-language physical pages and releases every worker over repeated reads', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 50; i++) {
      const result = await extractPdfText(new Uint8Array([1]), 3, 3, new AbortController().signal);
      expect(result).toEqual({ pageCount: 4, pages: [2, 3].map(page_idx => ({ page_idx, text: '中文摘要\nEnglish text', truncated: false })) });
    }
    expect(fake.cleanup).toHaveBeenCalledTimes(100);
    expect(fake.destroyDocument).toHaveBeenCalledTimes(50);
    expect(fake.destroyWorker).toHaveBeenCalledTimes(50);
    expect(fake.terminate).toHaveBeenCalledTimes(50);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans up a failed page read and preserves an explicit error', async () => {
    fake.text.mockRejectedValue(new Error('broken font'));
    await expect(extractPdfText(new Uint8Array([1]), 1, 1, new AbortController().signal)).rejects.toThrow('文字读取失败');
    expect(fake.cleanup).toHaveBeenCalledOnce(); expect(fake.terminate).toHaveBeenCalledOnce();
  });
  it('cancels an in-flight page and removes its abort listener', async () => {
    fake.text.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const reading = extractPdfText(new Uint8Array([1]), 1, 1, controller.signal);
    const rejected = expect(reading).rejects.toThrow();
    await vi.waitFor(() => expect(fake.text).toHaveBeenCalledOnce());
    controller.abort(); await rejected;
    expect(fake.cleanup).toHaveBeenCalledOnce(); expect(fake.terminate).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
  it('rejects password prompts instead of waiting forever', async () => {
    const loading = { promise: new Promise(() => {}), destroy: fake.destroyDocument, onPassword: undefined as (() => void) | undefined };
    fake.getDocument.mockReturnValue(loading);
    const reading = extractPdfText(new Uint8Array([1]), 1, 1, new AbortController().signal);
    const rejected = expect(reading).rejects.toThrow('PDF 已加密');
    await vi.waitFor(() => expect(loading.onPassword).toBeTypeOf('function'));
    loading.onPassword!(); await rejected; expect(fake.terminate).toHaveBeenCalledOnce();
  });
  it('terminates a worker even if document destruction never acknowledges', async () => {
    vi.useFakeTimers(); fake.destroyDocument.mockReturnValue(new Promise(() => {}));
    const reading = extractPdfText(new Uint8Array([1]), 1, 1, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1001); await reading;
    expect(fake.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds long pages and does not start an already-canceled read', async () => {
    fake.text.mockResolvedValue({ items: [{ str: 'x'.repeat(21_000) }] });
    const result = await extractPdfText(new Uint8Array([1]), 1, 1, new AbortController().signal);
    expect(result.pages[0].text).toHaveLength(20_000); expect(result.pages[0].truncated).toBe(true);
    const controller = new AbortController(); controller.abort(); fake.getDocument.mockClear();
    await expect(extractPdfText(new Uint8Array([1]), 1, 1, controller.signal)).rejects.toThrow();
    expect(fake.getDocument).not.toHaveBeenCalled();
  });
});
