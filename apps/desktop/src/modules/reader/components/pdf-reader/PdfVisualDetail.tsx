import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Dialog } from '@/components/ui/dialog';
import { SourceSnapshotImageDetail } from '@/shared/components/SourceSnapshotImageDetail';
import { resolveSourceSnapshotAssetUrl } from '@/shared/components/sourceSnapshotAssets';
import type { SourceSegment } from '@/shared/types/domain';
import { renderPdfVisualDetail } from './renderPdfVisualDetail';

export function PdfVisualDetail({ segment, pdfDocument, workspaceRoot, entryId, onClose, onRestoreFocus }: {
  segment: SourceSegment; pdfDocument: PDFDocumentProxy; workspaceRoot: string | null; entryId: string;
  onClose: () => void; onRestoreFocus: () => void;
}) {
  const asset = segment.asset_path ? resolveSourceSnapshotAssetUrl(segment.asset_path, workspaceRoot, entryId) : null;
  const [assetFailed, setAssetFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const useAsset = segment.segment_type === 'figure' && Boolean(asset) && !assetFailed;
  const [snapshot, setSnapshot] = useState<{ src: string | null; error: boolean }>({ src: null, error: false });
  useEffect(() => {
    if (useAsset) return;
    const controller = new AbortController();
    setSnapshot({ src: null, error: false });
    void renderPdfVisualDetail(pdfDocument, segment, controller.signal).then(src => {
      if (!controller.signal.aborted) setSnapshot({ src, error: false });
    }).catch(() => {
      if (!controller.signal.aborted) setSnapshot({ src: assetFailed ? null : asset, error: !asset || assetFailed });
    });
    return () => controller.abort();
  }, [pdfDocument, segment, useAsset, asset, assetFailed, attempt]);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <SourceSnapshotImageDetail title={segment.segment_type === 'table' ? '表格详情' : '图片详情'}
      alt={`第 ${segment.page_idx + 1} 页 · ${segment.segment_type === 'table' ? '表格' : '图片'}`}
      src={useAsset ? asset : snapshot.src} loadError={!useAsset && snapshot.error}
      onImageError={() => { if (asset && !assetFailed) setAssetFailed(true); }}
      onRetry={() => { setAssetFailed(false); setAttempt(value => value + 1); }}
      onCloseAutoFocus={onRestoreFocus} />
  </Dialog>;
}
