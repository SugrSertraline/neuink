import { useEffect, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { SourceSnapshotImage } from '@/shared/components/SourceSnapshotImage';
import { resolveSourceSnapshotAssetUrl } from '@/shared/components/sourceSnapshotAssets';
import type { SourceSegment } from '@/shared/types/domain';
import type { ReflowContentPreference } from '@/shared/lib/reflowContentPreferences';
import type { ReflowVisualSize } from '@/shared/lib/readerPreferences';
import { PaperTextPreview } from '../navigation/PaperReferences';
import { readCachedPdfSegmentSnapshot } from './pdfSourceSnapshot';

/** One segment owns three independent layers. Parsed/translated text can retain its existing reader renderer. */
export function ReflowContentLayers({ segment, content, relatedImagePath, entryId, workspaceRoot, pdfDocument, pdfError,
  onRequirePdfDocument, onRetryPdf, translatedText, size, imageDetailEnabled, parsedContent, translationContent, pairedContent }: {
  segment: SourceSegment; content: ReflowContentPreference; relatedImagePath: string | null; entryId: string;
  workspaceRoot: string | null; pdfDocument: PDFDocumentProxy | null; pdfError?: string | null;
  onRequirePdfDocument: () => void; onRetryPdf?: () => void; translatedText?: string | null;
  size: ReflowVisualSize; imageDetailEnabled: boolean;
  parsedContent?: ReactNode; translationContent?: ReactNode; pairedContent?: ReactNode;
}) {
  const markdown = segment.markdown ?? segment.text;
  const parsed = parsedReflowMarkdown(markdown);
  const multiple = [content.image, content.parsed, content.translation].filter(Boolean).length > 1;
  const preview = (text: string) => <PaperTextPreview allowScroll={false} markdown={text} segmentType={segment.segment_type}
    sourceEntryId={entryId} workspaceRoot={workspaceRoot} showMermaidDiagrams />;
  return <div className="grid min-w-0 gap-3">
    {content.image ? <section aria-label="片段原图">
      {multiple ? <LayerLabel>原图</LayerLabel> : null}
      <ReflowOriginalVisual key={`${entryId}:${segment.uid}:${segment.page_idx}:${segment.bbox?.join(',')}:${relatedImagePath}`} segment={segment} relatedImagePath={relatedImagePath}
        entryId={entryId} workspaceRoot={workspaceRoot} pdfDocument={pdfDocument} pdfError={pdfError}
        onRequirePdfDocument={onRequirePdfDocument} onRetryPdf={onRetryPdf} size={size} imageDetailEnabled={imageDetailEnabled} />
    </section> : null}
    {pairedContent && content.translation ? <section aria-label={content.parsed ? '片段解析与翻译' : '片段翻译'}>
      {multiple ? <LayerLabel>{content.parsed ? '解析后内容与翻译' : '翻译'}</LayerLabel> : null}
      {pairedContent}
    </section> : <>
    {content.parsed ? <section aria-label="片段解析后内容">
      {multiple ? <LayerLabel>解析后内容</LayerLabel> : null}
      {parsed && !resolveSourceSnapshotAssetUrl(parsed, workspaceRoot, entryId) ? parsedContent ?? preview(parsed) : <Unavailable>此片段没有独立的解析内容。</Unavailable>}
    </section> : null}
    {content.translation ? <section aria-label="片段翻译">
      {multiple ? <LayerLabel>翻译</LayerLabel> : null}
      {translatedText?.trim() ? translationContent ?? preview(translatedText) : <Unavailable>暂无翻译，可通过翻译任务生成。</Unavailable>}
    </section> : null}
    </>}
    {!content.image && !content.parsed && !content.translation ? <Unavailable>内容已关闭，右键可调整此片段显示。</Unavailable> : null}
  </div>;
}

export function parsedReflowMarkdown(markdown: string) {
  return markdown.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();
}

function LayerLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-xs font-medium text-muted-foreground">{children}</div>;
}
function Unavailable({ children }: { children: React.ReactNode }) {
  return <p role="status" className="py-2 text-xs text-muted-foreground">{children}</p>;
}

function ReflowOriginalVisual({ segment, relatedImagePath, entryId, workspaceRoot, pdfDocument, pdfError, onRequirePdfDocument,
  onRetryPdf, size, imageDetailEnabled }: {
  segment: SourceSegment; relatedImagePath: string | null; entryId: string; workspaceRoot: string | null;
  pdfDocument: PDFDocumentProxy | null; pdfError?: string | null; onRequirePdfDocument: () => void;
  onRetryPdf?: () => void; size: ReflowVisualSize; imageDetailEnabled: boolean;
}) {
  const markdown = segment.markdown ?? segment.text;
  const asset = resolveSourceSnapshotAssetUrl(relatedImagePath ?? segment.asset_path ?? '', workspaceRoot, entryId)
    ?? resolveSourceSnapshotAssetUrl(markdown.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1] ?? markdown, workspaceRoot, entryId);
  const [assetFailed, setAssetFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<{ document: PDFDocumentProxy; url: string | null } | null>(null);
  const needsPdf = !asset || assetFailed;
  useEffect(() => {
    if (!needsPdf || !segment.bbox) return;
    if (!pdfDocument) { if (!pdfError) onRequirePdfDocument(); return; }
    let active = true;
    void readCachedPdfSegmentSnapshot(pdfDocument, segment).then(url => {
      if (active) setSnapshot({ document: pdfDocument, url });
    }).catch(() => { if (active) setSnapshot({ document: pdfDocument, url: null }); });
    return () => { active = false; };
  }, [needsPdf, pdfDocument, pdfError, segment, onRequirePdfDocument, attempt]);
  if (asset && !assetFailed) return <SourceSnapshotImage alt="片段原图" src={asset} size={size} detailEnabled={imageDetailEnabled} onError={() => setAssetFailed(true)} />;
  const current = snapshot?.document === pdfDocument ? snapshot : null;
  if (current?.url) return <SourceSnapshotImage alt="PDF 原文截图" src={current.url} size={size} detailEnabled={imageDetailEnabled} />;
  if (!segment.bbox || pdfError || current) return <Unavailable>
    原图暂不可用。可右键开启解析内容。
    {assetFailed || current ? <Button size="xs" variant="ghost" onClick={event => {
      event.stopPropagation(); setAssetFailed(false); setSnapshot(null); setAttempt(value => value + 1);
    }}>重试原图</Button> : null}
    {onRetryPdf && pdfError ? <Button size="xs" variant="ghost" onClick={event => { event.stopPropagation(); onRetryPdf(); }}>重试原文</Button> : null}
  </Unavailable>;
  return <Unavailable>正在载入原文截图…</Unavailable>;
}
