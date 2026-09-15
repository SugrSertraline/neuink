import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { readCachedPdfSegmentSnapshot } from '@/modules/reader/components/reflow/pdfSourceSnapshot';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import type { SourceSegment } from '@/shared/types/domain';
import { resolveNoteImageSrc } from './NoteImage';
import type { SourceLinkAttrs, SourceLinkSnapshotAssetContext } from './SourceLinkNode';
import {
  buildOriginalSnapshotCacheKey, persistOriginalSnapshotAsset,
  readOriginalSnapshotAssetCache, resolveSourcePdfDocument
} from './sourceLinkSnapshotAssets';

export function SourceLinkOriginalPreview({ attrs, pdfDocument, snapshotAssetContext, onShowText }: {
  attrs: SourceLinkAttrs;
  pdfDocument: PDFDocumentProxy | null;
  snapshotAssetContext: SourceLinkSnapshotAssetContext | null;
  onShowText: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<{ status: 'loading' | 'ready' | 'failed' | 'empty'; url: string | null }>({ status: 'loading', url: null });
  const sourceSegment = useMemo<SourceSegment | null>(() => attrs.sourceBbox && attrs.page ? {
    asset_path: attrs.snapshotAssetPath ?? null,
    bbox: attrs.sourceBbox,
    markdown: attrs.snapshotText || null,
    page_idx: Math.max(0, attrs.page - 1),
    segment_type: attrs.segmentType ?? 'paragraph',
    text: attrs.snapshotText ?? '',
    uid: attrs.segmentUid ?? attrs.anchorId
  } : null, [attrs.sourceBbox, attrs.page, attrs.snapshotAssetPath, attrs.snapshotText, attrs.segmentType, attrs.segmentUid, attrs.anchorId]);
  const cacheKey = buildOriginalSnapshotCacheKey(attrs, snapshotAssetContext);
  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | null = null;
    const load = async () => {
      const cached = attempt === 0 && cacheKey ? readOriginalSnapshotAssetCache(cacheKey) : null;
      if (cached || !sourceSegment) {
        const url = cached || attrs.snapshotAssetPath || null;
        setSnapshot({ status: url ? 'ready' : 'empty', url });
        return;
      }
      setSnapshot({ status: 'loading', url: null });
      try {
        const resolved = await resolveSourcePdfDocument(pdfDocument, attrs, snapshotAssetContext);
        if (cancelled) { resolved.release(); return; }
        release = resolved.release;
        const url = resolved.document ? await readCachedPdfSegmentSnapshot(resolved.document, sourceSegment) : null;
        release(); release = null;
        if (cancelled) return;
        if (!url) { setSnapshot({ status: 'failed', url: null }); return; }
        const saved = cacheKey ? await persistOriginalSnapshotAsset(cacheKey, url, attrs, snapshotAssetContext) : null;
        if (!cancelled) setSnapshot({ status: 'ready', url: saved ?? url });
      } catch {
        if (!cancelled) setSnapshot({ status: 'failed', url: null });
      } finally {
        release?.(); release = null;
      }
    };
    void load();
    return () => { cancelled = true; release?.(); release = null; };
  }, [attempt, cacheKey, sourceSegment, pdfDocument, snapshotAssetContext, attrs.sourceEntryId, attrs.snapshotAssetPath]);

  if (snapshot.status === 'loading') {
    return <div role="status" className="flex min-h-24 items-center justify-center text-xs text-muted-foreground">正在读取 PDF 截图…</div>;
  }
  if (snapshot.status === 'ready' && snapshot.url) {
    const savedInNote = snapshot.url !== attrs.snapshotAssetPath;
    const url = savedInNote && snapshotAssetContext?.noteOwner?.kind === 'tag_reading'
      ? resolveNoteImageSrc(snapshot.url, snapshotAssetContext) : snapshot.url;
    return <SourceSnapshotPreview
      compact imageDetailEnabled imageFillWidth markdown="" previewMode="original"
      relatedImagePath={url}
      segmentType={attrs.segmentType ?? undefined}
      sourceEntryId={!savedInNote || snapshot.url.startsWith('data:') ? attrs.sourceEntryId : snapshotAssetContext?.entryId ?? attrs.sourceEntryId}
      workspaceRoot={attrs.workspaceRoot ?? snapshotAssetContext?.workspaceRoot ?? null}
      onImageError={() => setSnapshot({ status: 'failed', url: null })}
    />;
  }
  return <div className="grid gap-2 py-3 text-xs">
    <p role="status">{snapshot.status === 'empty' ? '这条引用还没有保存 PDF 截图。' : '无法读取 PDF 截图，请确认来源文件仍在工作区中。'}</p>
    <div className="flex flex-wrap gap-2">
      {snapshot.status === 'failed' && <Button size="xs" variant="outline" onClick={() => setAttempt((value) => value + 1)}>重试截图</Button>}
      {attrs.snapshotText?.trim() && <Button size="xs" variant="outline" onClick={onShowText}>查看文本摘录</Button>}
    </div>
  </div>;
}
