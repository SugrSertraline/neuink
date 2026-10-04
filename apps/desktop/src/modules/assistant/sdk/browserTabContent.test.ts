import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateBrowserTab, type BrowserTabSnapshot } from '@/shared/ipc/browserApi';
import { extractPdfText } from './pdfTextExtractor';
import { resolveBrowserContent } from './browserTabContent';

vi.mock('@/shared/ipc/browserApi', () => ({ validateBrowserTab: vi.fn() }));
vi.mock('./pdfTextExtractor', async original => ({ ...await original<typeof import('./pdfTextExtractor')>(), extractPdfText: vi.fn() }));
const target = { id: 'tab', title: 'PDF', url: 'https://example.org/paper.pdf', navigationId: 'nav' };
const snapshot: BrowserTabSnapshot = { title: '', url: target.url, text: '', selection: '', truncated: false,
  capturedAt: '', limitations: [], contentType: 'pdf', pdfBase64: btoa('%PDF-fixture') };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(validateBrowserTab).mockResolvedValue(undefined);
  vi.mocked(extractPdfText).mockResolvedValue({ pageCount: 10, pages: [{ page_idx: 0, text: 'Readable PDF', truncated: false }] });
});
describe('browser PDF adapter reuses PDF.js', () => {
  it('reads bounded pages, revalidates the same tab and removes binary transport data', async () => {
    const result = await resolveBrowserContent(snapshot, target, undefined, 1, 8);
    expect(extractPdfText).toHaveBeenCalledWith(new TextEncoder().encode('%PDF-fixture'), 1, 8, expect.any(AbortSignal));
    expect(validateBrowserTab).toHaveBeenCalledWith(target);
    expect(result).toMatchObject({ contentType: 'pdf', extractor: 'pdfjs', pageCount: 10, pagesRead: [1], truncated: true });
    expect(result.text).toBe('[PDF 第 1 页]\nReadable PDF');
    expect(result).not.toHaveProperty('pdfBase64');
  });
  it('drops extracted text after navigation or close', async () => {
    vi.mocked(validateBrowserTab).mockRejectedValue(new Error('网页已切换'));
    await expect(resolveBrowserContent(snapshot, target, undefined)).rejects.toThrow('网页已切换');
  });
  it('uses the native capture generation even when the submitted UI did not yet have one', async () => {
    await resolveBrowserContent({ ...snapshot, navigationId: 'captured-generation' }, { ...target, navigationId: undefined }, undefined);
    expect(validateBrowserTab).toHaveBeenCalledWith({ ...target, navigationId: 'captured-generation' });
  });
  it('reports scans without claiming OCR', async () => {
    vi.mocked(extractPdfText).mockResolvedValue({ pageCount: 1, pages: [{ page_idx: 0, text: ' ', truncated: false }] });
    await expect(resolveBrowserContent(snapshot, target, undefined)).rejects.toThrow('扫描件');
  });
  it('keeps text bounded and discloses partial extraction', async () => {
    vi.mocked(extractPdfText).mockResolvedValue({ pageCount: 2, pages: [{ page_idx: 0, text: '字'.repeat(40_000), truncated: false }] });
    const result = await resolveBrowserContent(snapshot, target, undefined);
    expect(result.text.length).toBe(32_000); expect(result.truncated).toBe(true);
  });
  it('does not process missing, excessive or already cancelled data', async () => {
    await expect(resolveBrowserContent({ ...snapshot, pdfBase64: '' }, target, undefined)).rejects.toThrow('数据缺失');
    await expect(resolveBrowserContent({ ...snapshot, pdfBase64: 'a'.repeat(16 * 1024 * 1024 + 1) }, target, undefined)).rejects.toThrow('限制');
    const abort = new AbortController(); abort.abort();
    await expect(resolveBrowserContent(snapshot, target, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(extractPdfText).not.toHaveBeenCalled();
  });
  it('never decodes media bytes in an HTML/video snapshot', async () => {
    const result = await resolveBrowserContent({ ...snapshot, contentType: 'video_metadata', text: 'Description' }, target, undefined);
    expect(result.text).toBe('Description'); expect(result).not.toHaveProperty('pdfBase64');
    expect(extractPdfText).not.toHaveBeenCalled(); expect(validateBrowserTab).not.toHaveBeenCalled();
  });
});
