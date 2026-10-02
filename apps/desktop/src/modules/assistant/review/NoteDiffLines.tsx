import type { NoteReviewBlock } from './noteReviewDiff';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import { useAssistantReading } from '../components/AssistantReplyActionsContext';

type Change = Extract<NoteReviewBlock, { kind: 'change' }>;
export const noteChangeKind = (block: Change) => !block.beforeCount ? '新增' : !block.afterCount ? '删除' : '修改';

export function NoteRenderedContent({ text, entryId }: { text: string; entryId?: string }) {
  const reading = useAssistantReading();
  return <div className="min-w-0 px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]">
    {text.trim() ? <SourceSnapshotPreview markdown={text} sourceEntryId={entryId} workspaceRoot={reading?.root} normalization="none" renderedOnly flush />
      : <p className="text-xs text-muted-foreground">空白内容</p>}
  </div>;
}

/** Signs describe the change; content is rendered just as it is when read. */
export function NoteDiffLines({ block, entryId }: { block: Change; entryId?: string }) {
  return <div className="min-w-0" aria-label={`${noteChangeKind(block)}内容对比`}>
    {(['before', 'after'] as const).map(side => {
      const count = side === 'before' ? block.beforeCount : block.afterCount;
      if (!count) return null;
      const removed = side === 'before';
      return <div key={side} data-diff-line={removed ? 'removed' : 'added'} className={removed ? 'border-l-2 border-destructive bg-destructive/5' : 'border-l-2 border-success bg-success/5'}>
        <div className={`px-3 pt-2 text-xs font-medium ${removed ? 'text-destructive' : 'text-success'}`}>
          {removed ? '− 修改前' : '+ 修改后'} · {noteChangeKind(block)}
        </div>
        <NoteRenderedContent text={block[side]} entryId={entryId} />
      </div>;
    })}
  </div>;
}

export function NoteDiffContext({ text, entryId }: { text: string; entryId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n');
  const long = lines.length > 8;
  return <div className="min-w-0">
    {long ? <Button variant="ghost" size="xs" className="h-auto w-full whitespace-normal py-1 text-muted-foreground" aria-expanded={expanded}
      onClick={() => setExpanded(value => !value)}>{expanded ? '收起未修改内容' : '展开未修改内容'}</Button> : null}
    {!long || expanded ? <NoteRenderedContent text={text} entryId={entryId} /> : null}
  </div>;
}
