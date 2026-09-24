import { useEffect, useState } from 'react';
import { Check, Languages, RotateCcw } from 'lucide-react';
import type { SourceSegment } from '@/shared/types/domain';
import { PaperTextPreview as SourceSnapshotPreview } from '../navigation/PaperReferences';
import type { ParagraphTranslation, TranslationPart, ParagraphLiveProgress, TranslationTiming } from '@/shared/ipc/paragraphTranslationApi';
import { useParagraphTranslation, useParagraphProgress } from './ParagraphTranslationContext';
import { SegmentMenuButton } from '../SegmentMenuButton';
import { hasParagraphTranslation, hasSentenceTranslation, paragraphTranslationRunning } from './paragraphTranslationState';

export function ParagraphTranslationActions({ segment, close, viewControls = true, onTranslate, hasDocumentTranslation = false }: {
  segment: SourceSegment; close: () => void; viewControls?: boolean; onTranslate?: (view?: ParagraphTranslation['view']) => void; hasDocumentTranslation?: boolean;
}) {
  const { context, record } = useParagraphTranslation(segment);
  if (!context) return null;
  const submitting = context.pending.has(segment.uid);
  const running = paragraphTranslationRunning(record);
  const supplement = !hasSentenceTranslation(record) && (hasParagraphTranslation(record) || hasDocumentTranslation);
  const failed = record?.paragraph.status === 'failed' || record?.sentences.status === 'failed';
  const run = (retry: boolean) => { onTranslate?.(supplement ? 'sentences' : undefined); context.translate(segment.uid, retry); close(); };
  return <div className="my-1 border-y py-1" role="group" aria-label="段落翻译">
    <SegmentMenuButton disabled={!context.ready || submitting || running} onClick={() => run(supplement)}
      icon={<Languages size={14} aria-hidden="true" />} label={running || submitting ? (supplement ? '正在补充逐句翻译…' : '正在翻译此段…') : supplement ? '补充逐句翻译' : record ? '重新翻译此段' : '翻译此段'} />
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

export function ParagraphTranslationContent({ record, entryId, root, view = record.view, showOriginal = true }: {
  record: ParagraphTranslation; entryId: string; root: string | null; view?: ParagraphTranslation['view']; showOriginal?: boolean;
}) {
  const live = useParagraphProgress(record);
  const running = record.paragraph.status === 'running' || record.sentences.status === 'running';
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!running) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [running]);
  const renderText = (text: string, partial = false) => partial
    ? <div className="whitespace-pre-wrap break-words">{text}</div>
    : <SourceSnapshotPreview allowScroll={false} markdown={text} segmentType="paragraph" sourceEntryId={entryId} workspaceRoot={root} />;
  const paragraphPreview = live.paragraph?.paragraph;
  const sentencePreview = live.sentences?.sentences;
  const streaming = view === 'paragraph' ? Boolean(paragraphPreview) : Boolean(sentencePreview?.length);
  const paragraph = paragraphPreview || record.paragraph.value;
  const pairs = sentencePreview?.length
    ? live.sentences!.sources.map((source, index) => ({ id: index + 1, source, translation: sentencePreview[index]?.translation ?? '' }))
    : record.sentences.value;
  const selected = view === 'sentences' ? record.sentences : record.paragraph;
  return <div className="min-w-0" data-paragraph-translation={view}>
    {view === 'sentences' && pairs?.length ? <div className="grid min-w-0 gap-3">
      {pairs.map(pair => <div key={pair.id} className="min-w-0 space-y-1">
        {showOriginal ? <div lang="en">{renderText(pair.source)}</div> : null}
        {pair.translation ? <div lang="zh-CN" className="text-[0.95em] text-muted-foreground">{renderText(pair.translation, streaming)}</div> : null}
      </div>)}
    </div> : <div className="min-w-0 space-y-2">
      {showOriginal ? <div lang="en">{renderText(record.source_text)}</div> : null}
      {view === 'paragraph' && paragraph ? <div lang="zh-CN" className="text-[0.95em] text-muted-foreground">{renderText(paragraph, streaming)}</div> : null}
    </div>}
    <p role="status" className="mt-2 text-xs text-muted-foreground">
      <span title={timingTitle(record.paragraph.timing ?? live.paragraph?.timing)}>{statusText('整段', record.paragraph, live.paragraph, now)}</span>
      {' · '}<span title={timingTitle(record.sentences.timing ?? live.sentences?.timing)}>{statusText('逐句', record.sentences, live.sentences, now)}</span>
      {streaming ? '（正在生成，完成后校验）' : selected.value && selected.status !== 'succeeded' ? '（显示上次结果）' : ''}
    </p>
  </div>;
}
