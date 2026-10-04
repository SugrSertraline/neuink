import { validateBrowserTab, type BrowserTabSnapshot, type BrowserTabTarget } from '@/shared/ipc/browserApi';
import { extractPdfText, abortablePdfWork, slicePdfText } from './pdfTextExtractor';

/** Decode with the existing PDF.js reader, not a new PDF parser or a local-library import. */
export async function resolveBrowserContent(snapshot: BrowserTabSnapshot, target: BrowserTabTarget,
  signal: AbortSignal | undefined, startPage = 1, pageCount = 8): Promise<BrowserTabSnapshot> {
  signal?.throwIfAborted();
  const { pdfBase64, ...safe } = snapshot;
  if (snapshot.contentType !== 'pdf') return safe;
  if (!pdfBase64 || pdfBase64.length > 16 * 1024 * 1024) throw new Error('PDF 数据缺失或超过 12 MiB 读取限制。');
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('PDF 文字提取超时，请缩小页数后重试。')), 20_000);
  try {
    if (signal?.aborted) cancel();
    controller.signal.throwIfAborted();
    const binary = atob(pdfBase64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const extracted = await extractPdfText(bytes, startPage, pageCount, controller.signal);
    // A slow worker must never publish a result for a closed/reloaded/replaced tab.
    await abortablePdfWork(validateBrowserTab({ ...target, navigationId: snapshot.navigationId ?? target.navigationId }), controller.signal);
    controller.signal.throwIfAborted();
    const content = extracted.pages.map(page => `[PDF 第 ${page.page_idx + 1} 页]\n${page.text}`).join('\n\n');
    if (!extracted.pages.some(page => page.text.trim())) throw new Error('这些 PDF 页没有可读取的文字层，可能是扫描件；请导入论文后使用 MinerU 解析。');
    const text = slicePdfText(content, 0, 32_000);
    const pagesRead = extracted.pages.map(page => page.page_idx + 1);
    return { ...safe, text, selection: '', extractor: 'pdfjs', pageCount: extracted.pageCount, pagesRead,
      truncated: snapshot.truncated || text.length < content.length || extracted.pages.some(page => page.truncated)
        || startPage > 1 || pagesRead.length < extracted.pageCount,
      limitations: [...safe.limitations, `本次读取第 ${startPage}–${pagesRead[pagesRead.length - 1]} 页，共 ${extracted.pageCount} 页；其余页未读取。无本地片段标识，可按页码继续读取。`] };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
