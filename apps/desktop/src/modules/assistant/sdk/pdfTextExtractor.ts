import type { PDFDocumentLoadingTask, PDFWorker } from 'pdfjs-dist';
import { createPdfDocumentOptions } from '@/modules/reader/components/pdf-reader/pdfDocumentOptions';
import type { PdfTextPage } from '@/shared/ipc/pdfTextApi';

/** No rendered canvases, global worker or retained documents. The caller owns the deadline. */
export async function extractPdfText(bytes: Uint8Array, startPage: number, pageCount: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const [pdfjs, { default: PdfWorker }] = await abortablePdfWork(Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?worker')]), signal);
  signal.throwIfAborted();
  let nativeWorker: Worker | undefined;
  let worker: PDFWorker | undefined;
  let loading: PDFDocumentLoadingTask | undefined;
  let disposed: Promise<void> | undefined;
  const dispose = () => disposed ??= new Promise<void>(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return; finished = true; clearTimeout(timer);
      try { worker?.destroy(); } catch { /* Always release the native port as well. */ }
      try { nativeWorker?.terminate(); } catch { /* A previously terminated port is already released. */ }
      resolve();
    };
    // A broken worker must not pin the extraction queue forever while acknowledging destroy.
    const timer = setTimeout(finish, 1000);
    void Promise.resolve().then(() => loading?.destroy()).then(finish, finish);
  });
  const abort = () => { void dispose(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    nativeWorker = new PdfWorker();
    worker = pdfjs.PDFWorker.create({ port: nativeWorker });
    loading = pdfjs.getDocument({ ...createPdfDocumentOptions(bytes), worker, stopAtErrors: true });
    // Password-protected PDFs must fail explicitly, never wait on an invisible prompt.
    const passwordFailure = new Promise<never>((_resolve, reject) => {
      loading!.onPassword = () => reject(new Error('PDF 已加密，需要先在阅读器处理密码或使用可读取的副本。'));
    });
    const document = await abortablePdfWork(Promise.race([loading.promise, passwordFailure]), signal);
    signal.throwIfAborted();
    if (document.numPages > 2000) throw new Error('PDF 超过基础读取的 2000 页上限，请使用完整解析。');
    if (startPage > document.numPages) throw new Error(`页码超出范围，PDF 共 ${document.numPages} 页。`);
    const pages: PdfTextPage[] = [];
    for (let pageNumber = startPage; pageNumber < startPage + pageCount && pageNumber <= document.numPages; pageNumber++) {
      signal.throwIfAborted();
      const page = await abortablePdfWork(document.getPage(pageNumber), signal);
      try {
        const content = await abortablePdfWork(page.getTextContent(), signal);
        signal.throwIfAborted();
        let text = ''; let truncated = false;
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const fragment = item.str.replace(/\0/g, '') + (item.hasEOL ? '\n' : ' ');
          if (text.length + fragment.length > 20_000) { text += slicePdfText(fragment, 0, 20_000 - text.length); truncated = true; break; }
          text += fragment;
        }
        pages.push({ page_idx: pageNumber - 1, text: text.trim(), truncated });
      } finally { page.cleanup(); }
    }
    return { pageCount: document.numPages, pages };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && (error.message.includes('页') || error.message.includes('PDF 已加密'))) throw error;
    throw new Error('PDF 文字读取失败：文件可能加密、损坏或字体不受支持。请在阅读器检查原文件，或使用完整解析。');
  } finally { signal.removeEventListener('abort', abort); await dispose(); }
}

/** Keep UTF-16 boundaries valid for Rust JSON decoding, including emoji at a cutoff. */
export function slicePdfText(text: string, start: number, end: number): string {
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text.charAt(start))) start--;
  if (end > start && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
  return text.slice(start, end);
}

export function abortablePdfWork<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new DOMException('Canceled', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
