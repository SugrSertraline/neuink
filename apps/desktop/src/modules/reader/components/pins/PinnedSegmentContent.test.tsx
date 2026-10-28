// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceSegment } from '@/shared/types/domain';
import { readCachedPdfSegmentSnapshot } from '../reflow/pdfSourceSnapshot';
import { PinnedSegmentContent } from './PinnedSegmentContent';

vi.mock('../reflow/pdfSourceSnapshot', () => ({ readCachedPdfSegmentSnapshot: vi.fn() }));
vi.mock('@/shared/components/sourceSnapshotAssets', async importOriginal => ({
  ...await importOriginal<object>(),
  resolveSourceSnapshotAssetUrl: (path: string) => path === 'images/figure.png' ? '/parsed-figure.png' : null
}));
const segment: SourceSegment = { uid: 'figure-1', segment_type: 'figure', page_idx: 2, bbox: [100, 100, 900, 600],
  asset_path: 'images/figure.png', text: '', markdown: null };
const pdf = {} as PDFDocumentProxy;
const props = { entryId: 'paper', workspaceRoot: 'library', pdfDocument: pdf };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('uses the parsed image without rerendering the PDF, then falls back to the exact PDF region on failure', async () => {
  const crop = vi.mocked(readCachedPdfSegmentSnapshot).mockResolvedValue('/original-region.png');
  const ui = render(<PinnedSegmentContent {...props} segment={segment} />);
  expect(ui.getByRole('img').getAttribute('src')).toBe('/parsed-figure.png');
  expect(crop).not.toHaveBeenCalled();
  fireEvent.error(ui.getByRole('img'));
  await waitFor(() => expect(ui.getByRole('img').getAttribute('src')).toBe('/original-region.png'));
  expect(crop).toHaveBeenCalledExactlyOnceWith(pdf, segment);
});
it('shows loading, failure and a retry for a figure without an extracted image', async () => {
  let finish!: (url: string | null) => void;
  const crop = vi.mocked(readCachedPdfSegmentSnapshot)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce('/retried-region.png');
  const ui = render(<PinnedSegmentContent {...props} segment={{ ...segment, asset_path: null }} />);
  expect(ui.getByRole('status').textContent).toContain('正在载入图片');
  await act(async () => finish(null));
  expect(ui.getByRole('status').textContent).toContain('暂时无法显示');
  fireEvent.click(ui.getByRole('button', { name: '重新加载' }));
  await waitFor(() => expect(ui.getByRole('img').getAttribute('src')).toBe('/retried-region.png'));
  expect(crop).toHaveBeenCalledTimes(2);
});
it('ignores a late snapshot after switching content or removing a pin', async () => {
  let finish!: (url: string | null) => void;
  vi.mocked(readCachedPdfSegmentSnapshot).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const ui = render(<PinnedSegmentContent {...props} segment={{ ...segment, asset_path: null }} />);
  ui.rerender(<PinnedSegmentContent {...props} segment={{ ...segment, uid: 'paragraph', segment_type: 'paragraph', asset_path: null, text: 'New source' }} />);
  await act(async () => finish('/late-region.png'));
  expect(ui.queryByRole('img')).toBeNull();
  expect(ui.getByText('New source')).toBeTruthy();
  ui.rerender(<PinnedSegmentContent {...props} segment={{ ...segment, asset_path: null }} />);
  ui.unmount();
  await act(async () => finish('/closed-region.png'));
});
it.each(['paragraph', 'table', 'math', 'list'] as const)('renders parsed %s without starting a PDF image request', type => {
  const text = type === 'table' ? '| A | B |\n|---|---|\n| 1 | 2 |' : type === 'math' ? '$x^2$' : type === 'list' ? '- Alpha\n- Beta' : 'A paragraph';
  const ui = render(<PinnedSegmentContent {...props} segment={{ ...segment, segment_type: type, asset_path: null, text }} />);
  expect(ui.container.textContent?.trim().length).toBeGreaterThan(0);
  if (type === 'table') expect(ui.getByRole('table')).toBeTruthy();
  if (type === 'math') expect(ui.container.querySelector('.katex'), ui.container.innerHTML).toBeTruthy();
  expect(readCachedPdfSegmentSnapshot).not.toHaveBeenCalled();
});
