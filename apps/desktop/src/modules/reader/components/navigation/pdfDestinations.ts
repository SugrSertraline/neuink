import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ReadingTarget } from './ReadingNavigation';

export type NativePdfLink = { id: string; label: string; dest: string | unknown[]; rect: [number, number, number, number] };
const destinations = new WeakMap<PDFDocumentProxy, Map<string, Promise<ReadingTarget>>>();

export async function readNativePdfLinks(document: PDFDocumentProxy, pageIdx: number): Promise<NativePdfLink[]> {
  const page = await document.getPage(pageIdx + 1);
  const viewport = page.getViewport({ scale: 1 });
  const annotations = await page.getAnnotations({ intent: 'display' });
  return annotations.flatMap((annotation: { id?: string; dest?: unknown; rect?: number[]; subtype?: string; contentsObj?: { str?: string } }) => {
    if (annotation.subtype !== 'Link' || !(typeof annotation.dest === 'string' || Array.isArray(annotation.dest)) || annotation.rect?.length !== 4) return [];
    const [a, b, c, d] = viewport.convertToViewportRectangle(annotation.rect);
    const rect: NativePdfLink['rect'] = [Math.max(0, Math.min(a,c) / viewport.width), Math.max(0, Math.min(b,d) / viewport.height),
      Math.min(1, Math.max(a,c) / viewport.width), Math.min(1, Math.max(b,d) / viewport.height)];
    if (!rect.every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1]) return [];
    return [{ id: annotation.id ?? `${pageIdx}:${rect.join(':')}`, label: annotation.contentsObj?.str || '文内引用', dest: annotation.dest, rect }];
  });
}

export function resolvePdfDestination(document: PDFDocumentProxy, dest: NativePdfLink['dest']): Promise<ReadingTarget> {
  let cache = destinations.get(document);
  if (!cache) { cache = new Map(); destinations.set(document, cache); }
  const key = JSON.stringify(dest);
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = resolve(document, dest).catch(error => { cache!.delete(key); throw error; });
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(key, pending); return pending;
}

async function resolve(document: PDFDocumentProxy, dest: NativePdfLink['dest']): Promise<ReadingTarget> {
  const values = typeof dest === 'string' ? await document.getDestination(dest) : dest;
  if (!Array.isArray(values) || values.length < 2) throw new Error('PDF 中没有可用的跳转目标');
  const ref = values[0];
  const pageIdx = typeof ref === 'number' ? ref : ref && typeof ref === 'object' && 'num' in ref && 'gen' in ref
    ? await document.getPageIndex(ref as { num: number; gen: number }) : -1;
  if (!Number.isInteger(pageIdx) || pageIdx < 0 || pageIdx >= document.numPages) throw new Error('PDF 目标页码无效');
  const page = await document.getPage(pageIdx + 1);
  const viewport = page.getViewport({ scale: 1 });
  const mode = (values[1] as { name?: string })?.name;
  const top = mode === 'XYZ' ? values[3] : mode === 'FitH' || mode === 'FitBH' ? values[2] : mode === 'FitR' ? values[5] : null;
  const left = mode === 'XYZ' || mode === 'FitR' ? values[2] : null;
  if (typeof top !== 'number' || !Number.isFinite(top)) return { pageIdx };
  const hasLeft = typeof left === 'number' && Number.isFinite(left);
  const [x,y] = viewport.convertToViewportPoint(hasLeft ? left : page.view[0], top);
  if (!hasLeft) {
    const [endX, endY] = viewport.convertToViewportPoint(page.view[2], top);
    const x0 = Math.max(0, Math.min(980, Math.min(x, endX) / viewport.width * 1000));
    const y0 = Math.max(0, Math.min(980, Math.min(y, endY) / viewport.height * 1000));
    return { pageIdx, rect: [x0, y0, Math.min(1000, Math.max(x0 + 20, Math.max(x, endX) / viewport.width * 1000)),
      Math.min(1000, Math.max(y0 + 20, Math.max(y, endY) / viewport.height * 1000))] };
  }
  const nx = Math.max(0, Math.min(980, x / viewport.width * 1000));
  const ny = Math.max(0, Math.min(980, y / viewport.height * 1000));
  return { pageIdx, rect: [nx, ny, Math.min(1000, nx + 20), Math.min(1000, ny + 20)] };
}
