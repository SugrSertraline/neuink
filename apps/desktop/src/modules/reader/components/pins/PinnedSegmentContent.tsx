import { memo, useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { SourceSnapshotImage } from '@/shared/components/SourceSnapshotImage';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import { resolveSourceSnapshotAssetUrl } from '@/shared/components/sourceSnapshotAssets';
import type { SourceSegment } from '@/shared/types/domain';
import { readCachedPdfSegmentSnapshot } from '../reflow/pdfSourceSnapshot';

export const PinnedSegmentContent = memo(function PinnedSegmentContent({ segment, pdfDocument, workspaceRoot, entryId }: {
  segment: SourceSegment; pdfDocument: PDFDocumentProxy | null; workspaceRoot: string | null; entryId: string;
}) {
  const [assetFailed, setAssetFailed] = useState(false);
  const [snapshot, setSnapshot] = useState<{ status: 'loading' | 'ready' | 'error'; url?: string }>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const visual = segment.segment_type === 'figure';
  const asset = visual ? resolveSourceSnapshotAssetUrl(segment.asset_path || segment.markdown || segment.text, workspaceRoot, entryId) : null;
  const needsSnapshot = visual && (!asset || assetFailed);

  useEffect(() => {
    if (!needsSnapshot) return;
    let current = true;
    setSnapshot({ status: 'loading' });
    void readCachedPdfSegmentSnapshot(pdfDocument, segment).then(url => {
      if (current) setSnapshot(url ? { status: 'ready', url } : { status: 'error' });
    }, () => { if (current) setSnapshot({ status: 'error' }); });
    return () => { current = false; };
  }, [needsSnapshot, pdfDocument, segment, attempt]);

  if (!visual) return <SourceSnapshotPreview markdown={segment.markdown || segment.text}
    segmentType={segment.segment_type} relatedImagePath={segment.asset_path}
    workspaceRoot={workspaceRoot} sourceEntryId={entryId} allowScroll={false} />;

  if (needsSnapshot && snapshot.status === 'loading') return <div className="grid h-full place-items-center text-xs text-muted-foreground" role="status">正在载入图片…</div>;
  const url = needsSnapshot ? snapshot.url : asset;
  if (!url) return <div className="flex h-full flex-col items-center justify-center gap-2 text-xs" role="status">
    <p>图片暂时无法显示</p>
    <Button size="xs" variant="outline" onClick={() => { setAssetFailed(false); setAttempt(value => value + 1); }}>重新加载</Button>
  </div>;
  return <SourceSnapshotImage alt={`固钉图片 · 第 ${segment.page_idx + 1} 页`} src={url}
    className="h-full max-h-full w-full rounded-none border-0 object-contain" onError={() => setAssetFailed(true)} />;
});
