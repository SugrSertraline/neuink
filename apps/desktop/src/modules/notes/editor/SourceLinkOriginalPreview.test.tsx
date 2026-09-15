// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceLinkOriginalPreview } from './SourceLinkOriginalPreview';
import type { SourceLinkAttrs } from './SourceLinkNode';
import { resolveSourcePdfDocument } from './sourceLinkSnapshotAssets';
import { readCachedPdfSegmentSnapshot } from '@/modules/reader/components/reflow/pdfSourceSnapshot';

vi.mock('./sourceLinkSnapshotAssets', () => ({
  buildOriginalSnapshotCacheKey: () => 'test-cache',
  readOriginalSnapshotAssetCache: () => null,
  persistOriginalSnapshotAsset: vi.fn(async () => null),
  resolveSourcePdfDocument: vi.fn()
}));
vi.mock('@/modules/reader/components/reflow/pdfSourceSnapshot', () => ({ readCachedPdfSegmentSnapshot: vi.fn() }));
const attrs:SourceLinkAttrs = { anchorId:'sl-original', sourceEntryId:'source', segmentUid:'seg', page:3, sourceBbox:[0,0,100,100], snapshotText:'已保存的摘录' };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('SourceLinkOriginalPreview', () => {
  it('shows loading, permits retry after failure, and releases every acquired PDF', async () => {
    const release = vi.fn();
    vi.mocked(resolveSourcePdfDocument).mockResolvedValue({ document: {} as any, release });
    vi.mocked(readCachedPdfSegmentSnapshot).mockRejectedValueOnce(new Error('render failed')).mockResolvedValueOnce('data:image/png;base64,eA==');
    const result = render(<SourceLinkOriginalPreview attrs={attrs} pdfDocument={null} snapshotAssetContext={null} onShowText={vi.fn()} />);
    expect(result.getByRole('status').textContent).toContain('正在读取');
    fireEvent.click(await result.findByRole('button', { name:'重试截图' }));
    await waitFor(() => expect(result.getByRole('img')).toBeTruthy());
    expect(release).toHaveBeenCalledTimes(2);
  });
  it('ignores a completed request after the preview is closed and releases its PDF', async () => {
    const release = vi.fn();
    let resolve!: (value: any) => void;
    vi.mocked(resolveSourcePdfDocument).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const result = render(<SourceLinkOriginalPreview attrs={attrs} pdfDocument={null} snapshotAssetContext={null} onShowText={vi.fn()} />);
    result.unmount();
    resolve({ document: {}, release });
    await waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(readCachedPdfSegmentSnapshot).not.toHaveBeenCalled();
  });
});
