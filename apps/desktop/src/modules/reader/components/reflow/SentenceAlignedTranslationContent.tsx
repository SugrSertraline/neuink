import { SentenceTranslationLauncher } from '../../translation/SentenceTranslationAction';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { PaperTextPreview } from '../navigation/PaperReferences';
import { alignSavedTranslation, splitAcademicSentences } from '../../translation/sentenceAlignment';
import { cn } from '@/lib/utils';

export function SentenceAlignedTranslationContent({ source, savedTranslation, showOriginal, showTranslation = true, entryId, workspaceRoot,
  segmentUid, focusedSentenceIndex,
  onEnhance, enhancing, aiError }: {
  source: string; savedTranslation?: string | null; showOriginal: boolean; showTranslation?: boolean; entryId: string; workspaceRoot: string | null;
  segmentUid?: string; focusedSentenceIndex?: number;
  onEnhance?: () => void; enhancing: boolean; aiError?: string | null;
}) {
  const aligned = useMemo(() => savedTranslation ? alignSavedTranslation(source, savedTranslation) : null,
    [source, savedTranslation]);
  const preview = (markdown: string) => <PaperTextPreview allowScroll={false} markdown={markdown} segmentType="paragraph"
    sourceEntryId={entryId} workspaceRoot={workspaceRoot} />;
  const sentenceAction = (sentence: string) => workspaceRoot && segmentUid && source.indexOf(sentence) >= 0 && source.indexOf(sentence) === source.lastIndexOf(sentence)
    ? <SentenceTranslationLauncher target={{ root: workspaceRoot, entryId, segmentUid, paragraph: source, sentence, start: source.indexOf(sentence) }} /> : null;
  const sourceRows = <div className="grid min-w-0 gap-3">
    {splitAcademicSentences(source).map((sentence, index) => <div key={index} lang="en" data-reading-segment-uid={segmentUid}
      data-reading-sentence-index={index}
      className={cn('min-w-0 rounded-sm', focusedSentenceIndex === index && 'bg-primary/10 ring-1 ring-primary/40')}>
      {preview(sentence)}
      {showTranslation ? sentenceAction(sentence) : null}
    </div>)}
  </div>;
  if (!showTranslation) return <div className="grid min-w-0 gap-3" data-paragraph-translation="sentences">
    {sourceRows}
  </div>;
  if (!savedTranslation?.trim()) return <div className="min-w-0 space-y-2" data-paragraph-translation="sentences">
    {showOriginal ? sourceRows : null}
    <p role="status" className="py-2 text-xs text-muted-foreground">{aiError || (enhancing ? '正在翻译此段…' : '暂无译文，请先翻译此段。')}</p>
    {onEnhance ? <Button size="xs" variant="outline" disabled={enhancing} onClick={onEnhance}>{aiError ? '重试翻译' : '翻译此段'}</Button> : null}
  </div>;
  return <div className="min-w-0" data-paragraph-translation="sentences">
    <div className="mb-2 text-xs text-muted-foreground">
      {aligned ? '整体翻译 · 按标点、数字与顺序逐句配对' : '句界无法可靠配对 · 显示原有整段译文'}
    </div>
    {aligned ? <div className="grid min-w-0 gap-3">
      {aligned.map(pair => <div key={pair.id} data-reading-segment-uid={segmentUid}
        data-reading-sentence-index={pair.sourceStartIndex} data-reading-sentence-end-index={pair.sourceEndIndex}
        className={cn('min-w-0 space-y-1 rounded-sm', focusedSentenceIndex !== undefined &&
          focusedSentenceIndex >= pair.sourceStartIndex && focusedSentenceIndex < pair.sourceEndIndex &&
          'bg-primary/10 ring-1 ring-primary/40')}>
        {showOriginal ? <div lang="en">{preview(pair.source)}</div> : null}
        <div lang="zh-CN" className="break-words text-[0.95em] text-muted-foreground">{preview(pair.translation)}</div>
        {pair.sourceEndIndex === pair.sourceStartIndex + 1 ? sentenceAction(pair.source) : null}
      </div>)}
    </div> : <div className="min-w-0 space-y-1">
      {showOriginal ? sourceRows : null}
      <div lang="zh-CN" className="break-words text-[0.95em] text-muted-foreground">{preview(savedTranslation)}</div>
    </div>}
    {aiError ? <p role="status" className="mt-2 text-xs text-destructive">片段翻译失败：{aiError}</p> : null}

  </div>;
}
