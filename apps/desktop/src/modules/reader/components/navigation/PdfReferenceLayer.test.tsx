// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceSegment } from '@/shared/types/domain';
import { PaperReferencesProvider } from './PaperReferences';
import { ReadingNavigationScope, useReadingNavigation } from './ReadingNavigation';
import { PdfReferenceLayer } from './PdfReferenceLayer';
import { readPdfLinkText } from './pdfTextReferences';

vi.mock('./pdfTextReferences', () => ({ collectPdfTextReferences: vi.fn(() => []), readPdfLinkText: vi.fn(() => '[1]') }));
const source = (uid: string, text: string): SourceSegment => ({ uid, text, markdown: null, bbox: [100, 100, 900, 200], page_idx: 2, segment_type: 'paragraph' });
const segments = [source('h', 'References'), source('r1', '[1] First source'), source('r2', '[2] Second source')];
function Adapter({ jump }: { jump: () => boolean }) {
  const nav = useReadingNavigation()!;
  useEffect(() => nav.register({ capture: () => ({ pageIdx: 0, offset: 0, left: 0 }), restore: vi.fn(), navigate: jump }), [nav.register, jump]);
  return null;
}
function fixture() {
  const document = { numPages: 3, getDestination: vi.fn().mockResolvedValue(null), getPage: vi.fn().mockResolvedValue({
    view: [0, 0, 600, 800],
    getViewport: () => ({ width: 600, height: 800, convertToViewportRectangle: () => [60, 80, 80, 96],
      convertToViewportPoint: (x: number, y: number) => [x, 800 - y] }),
    getAnnotations: async () => [{ id: 'broken', subtype: 'Link', dest: 'missing-ref', rect: [60, 704, 80, 720] }]
  }) };
  return { document, pdf: document as unknown as PDFDocumentProxy };
}
function view(pdf: PDFDocumentProxy, jump: () => boolean, sources = segments) {
  return <ReadingNavigationScope><Adapter jump={jump} /><PaperReferencesProvider segments={sources} entryId="e" workspaceRoot={null} pdfDocument={pdf}>
    <div><div className="pdf-text-layer">[1]</div><PdfReferenceLayer document={pdf} pageIdx={0} enabled /></div>
  </PaperReferencesProvider></ReadingNavigationScope>;
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.mocked(readPdfLinkText).mockReturnValue('[1]');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('native PDF citation interactions', () => {
  it('previews the referenced right-column item, not the left item at the same height', async () => {
    const { pdf, document } = fixture(), jump = vi.fn(() => true);
    document.getDestination.mockResolvedValue([2, { name: 'XYZ' }, 360, 720, null]);
    vi.mocked(readPdfLinkText).mockReturnValue('[2]');
    const left = { ...source('r1', '[1] Left-column first source'), bbox: [100, 100, 450, 200] as SourceSegment['bbox'] };
    const right = { ...source('r2', '[2] Right-column second source'), bbox: [550, 100, 900, 200] as SourceSegment['bbox'] };
    render(view(pdf, jump, [source('h', 'References'), left, right]));
    const trigger = await screen.findByRole('button', { name: '文内引用，预览或定位原文' });
    fireEvent.focus(trigger);
    expect(await screen.findByText('[2] · 第 3 页')).toBeTruthy();
    expect(screen.getByText('[2] Right-column second source')).toBeTruthy();
    expect(screen.queryByText('[1] Left-column first source')).toBeNull();
    fireEvent.click(trigger);
    await waitFor(() => expect(jump).toHaveBeenCalledWith({ pageIdx: 2, rect: [600, 100, 620, 120] }));
  });
  it('previews and navigates to an existing bibliography entry when the native destination is absent', async () => {
    const { pdf } = fixture(), jump = vi.fn(() => true);
    render(view(pdf, jump));
    const trigger = await screen.findByRole('button', { name: '文内引用，预览或定位原文' });
    fireEvent.focus(trigger);
    expect(await screen.findByText('[1] · 第 3 页')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(trigger);
    await waitFor(() => expect(jump).toHaveBeenCalledWith(expect.objectContaining({ segmentUid: 'r1', pageIdx: 2 })));
    await waitFor(() => expect(screen.queryByText('[1] · 第 3 页')).toBeNull());
  });
  it('keeps grouped fallback citations selectable with the keyboard', async () => {
    vi.mocked(readPdfLinkText).mockReturnValue('[1, 2]');
    const { pdf } = fixture(), jump = vi.fn(() => true);
    render(view(pdf, jump));
    fireEvent.keyDown(await screen.findByRole('button', { name: '文内引用，预览或定位原文' }), { key: 'ArrowDown' });
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByRole('button', { name: '定位原文' })).toHaveLength(2));
    fireEvent.click(within(dialog).getAllByRole('button', { name: '定位原文' })[1]);
    expect(jump).toHaveBeenCalledWith(expect.objectContaining({ segmentUid: 'r2' }));
  });
  it('offers a recoverable error when no reliable target exists, and recovers after parsing finishes', async () => {
    const { pdf } = fixture(), jump = vi.fn(() => true);
    const { rerender } = render(view(pdf, jump, []));
    fireEvent.focus(await screen.findByRole('button', { name: '文内引用，预览或定位原文' }));
    expect((await screen.findByRole('alert')).textContent).toContain('内置链接无法定位');
    expect(jump).not.toHaveBeenCalled();
    rerender(view(pdf, jump));
    expect(await screen.findByText('[1] · 第 3 页')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('ignores an in-flight click after the reader closes', async () => {
    const { pdf, document } = fixture(), jump = vi.fn(() => true);
    let finish!: (value: null) => void;
    document.getDestination.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(view(pdf, jump));
    fireEvent.click(await screen.findByRole('button', { name: '文内引用，预览或定位原文' }));
    unmount(); await act(async () => { finish(null); });
    expect(jump).not.toHaveBeenCalled();
  });
});
