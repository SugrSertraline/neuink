import { useEffect, useState } from 'react';
import { Check, Languages, RotateCcw } from 'lucide-react';
import type { SourceSegment } from '@/shared/types/domain';
import { PaperTextPreview as SourceSnapshotPreview } from '../navigation/PaperReferences';
import type { ParagraphTranslation, TranslationPart, ParagraphLiveProgress, TranslationTiming } from '@/shared/ipc/paragraphTranslationApi';
import { useParagraphTranslation, useParagraphProgress } from './ParagraphTranslationContext';
import { SegmentMenuButton } from '../SegmentMenuButton';
import { hasParagraphTranslation, paragraphTranslationRunning } from './paragraphTranslationState';
import { SentenceAlignedTranslationContent } from './SentenceAlignedTranslationContent';

export function ParagraphTranslationActions({ segment, close, viewControls = true, onTranslate, hasDocumentTranslation = false }: {
  segment: SourceSegment; close: () => void; viewControls?: boolean; onTranslate?: (view?: ParagraphTranslation['view']) => void; hasDocumentTranslation?: boolean;
}) {
  const { context, record } = useParagraphTranslation(segment);
  if (!context) return null;
  const submitting = context.pending.has(segment.uid);
  const running = paragraphTranslationRunning(record);
  const translated = hasParagraphTranslation(record) || hasDocumentTranslation;
  const failed = record?.paragraph.status === 'failed';
  const run = (retry: boolean) => { onTranslate?.(); context.translate(segment.uid, retry); close(); };
  return <div className="my-1 border-y py-1" role="group" aria-label="段落翻译">
    <SegmentMenuButton disabled={!context.ready || submitting || running} onClick={() => run(false)}
      icon={<Languages size={14} aria-hidden="true" />} label={running || submitting ? '正在翻译此段…' : translated ? '重新翻译此段' : '翻译此段'} />
    {failed ? <SegmentMenuButton disabled={submitting || running} onClick={() => run(true)} icon={<RotateCcw size={14} aria-hidden="true" />} label="重试失败的翻译" /> : null}
    {record && viewControls ? <div role="group" aria-label="对照方式">
      <div className="px-2 py-1 text-xs text-muted-foreground">对照方式</div>
      {(['paragraph', 'sentences'] as const).map(view => <SegmentMenuButton key={view} role="menuitemradio" aria-checked={record.view === view}
        disabled={submitting} onClick={() => { context.setView(segment.uid, view); close(); }}
        icon={<span className="inline-flex size-3.5 shrink-0">{record.view === view ? <Check size={14} aria-hidden="true" /> : null}</span>}
        label={view === 'paragraph' ? '整段对照' : '逐句对照'} />)}
    </div> : null}
  </div>;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;
function statusText(name: string, part: TranslationPart<unknown>, live?: ParagraphLiveProgress, now = Date.now()) {
  if (part.status === 'failed') return `${name}翻译失败：${part.error ?? '请右键重试'}`;
  if (part.status === 'succeeded') return `${name}已完成${part.timing ? ` · ${seconds(part.timing.total_ms)}` : ''}`;
  const elapsed = live ? ` · ${seconds(live.timing.total_ms + Math.max(0, now - (live.receivedAt ?? now)))}` : '';
  if (live?.phase === 'queued') return `${name}排队中${elapsed}`;
  if (live?.phase === 'rate_limited') return `${name}限流等待，自动重试${elapsed}`;
  return `${name}翻译中…${elapsed}`;
}
function timingTitle(timing?: TranslationTiming | null) {
  return timing ? `排队 ${seconds(timing.queued_ms)}，限流等待 ${seconds(timing.rate_limit_ms)}，生成与传输 ${seconds(timing.generation_ms)}` : undefined;
}

export function ParagraphTranslationContent({ record, entryId, root, view = record.view, showOriginal = true,
  segmentUid, focusedSentenceIndex }: {
  record: ParagraphTranslation; entryId: string; root: string | null; view?: ParagraphTranslation['view']; showOriginal?: boolean;
  segmentUid?: string; focusedSentenceIndex?: number;
}) {
  const live = useParagraphProgress(record);
  const running = record.paragraph.status === 'running';
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!running) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [running]);
  const renderText = (text: string, partial = false) => partial
    ? <div className="whitespace-pre-wrap break-words">{text}</div>
    : <SourceSnapshotPreview allowScroll={false} markdown={text} segmentType="paragraph" sourceEntryId={entryId} workspaceRoot={root} />;
  const paragraphPreview = live.paragraph?.paragraph;
  const streaming = Boolean(paragraphPreview);
  const paragraph = paragraphPreview || record.paragraph.value;
  return <div className="min-w-0" data-paragraph-translation={view === 'sentences' && !streaming ? undefined : view}>
    {view === 'sentences' && !streaming ? <SentenceAlignedTranslationContent
      source={record.source_text} savedTranslation={paragraph} showOriginal={showOriginal}
      entryId={entryId} workspaceRoot={root} segmentUid={segmentUid}
      focusedSentenceIndex={focusedSentenceIndex} enhancing={false} /> : <div className="min-w-0 space-y-2">
      {showOriginal ? <div lang="en">{renderText(record.source_text)}</div> : null}
      {paragraph ? <div lang="zh-CN" className="text-[0.95em] text-muted-foreground">{renderText(paragraph, streaming)}</div> : null}
    </div>}
    <p role="status" className="mt-2 text-xs text-muted-foreground">
      <span title={timingTitle(record.paragraph.timing ?? live.paragraph?.timing)}>{statusText('片段', record.paragraph, live.paragraph, now)}</span>
      {streaming ? '（正在生成，完成后校验）' : paragraph && record.paragraph.status !== 'succeeded' ? '（显示上次结果）' : ''}
    </p>
  </div>;
}
