// The document pane owns page presentation. Navigation callers only request a
// page; the same source/search helpers work with a scroll document or a book.
type RevealPage = (pageIdx: number, afterReveal: () => void) => boolean;
const pageReveals = new WeakMap<HTMLElement, RevealPage>();

export function registerPdfPageReveal(container: HTMLElement, reveal: RevealPage) {
  pageReveals.set(container, reveal);
  return () => { if (pageReveals.get(container) === reveal) pageReveals.delete(container); };
}

export function revealPdfPage(container: HTMLElement, pageIdx: number, afterReveal: () => void) {
  return pageReveals.get(container)?.(pageIdx, afterReveal) ?? false;
}

export function bookRowForPage(rows: readonly (readonly { pageIdx: number }[])[], pageIdx: number) {
  const index = rows.findIndex(row => row.some(page => page.pageIdx === pageIdx));
  return index < 0 ? 0 : index;
}
