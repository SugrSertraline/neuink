import type { NoteReviewBlock } from './noteReviewDiff';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

type Change = Extract<NoteReviewBlock, { kind: 'change' }>;
export const noteChangeKind = (block: Change) => !block.beforeCount ? '新增' : !block.afterCount ? '删除' : '修改';

/** Unified diff: signs and old/new line numbers remain readable without relying on color. */
export function NoteDiffLines({ block }: { block: Change }) {
  return <div className="min-w-0 font-mono text-xs leading-5" aria-label={`${noteChangeKind(block)}内容对比`}>
    {(['before', 'after'] as const).map(side => {
      const count = side === 'before' ? block.beforeCount : block.afterCount;
      if (!count) return null;
      const removed = side === 'before';
      return <div key={side} className={removed ? 'bg-destructive/10' : 'bg-success/10'}>
        {block[side].split('\n').map((line, index) => <div key={index} data-diff-line={removed ? 'removed' : 'added'}
          className="grid min-w-0 grid-cols-[2.5rem_2.5rem_1.25rem_minmax(0,1fr)]">
          <span aria-hidden="true" className="select-none border-r border-border/50 px-1 text-right text-muted-foreground">{removed ? block.beforeLine + index : ''}</span>
          <span aria-hidden="true" className="select-none border-r border-border/50 px-1 text-right text-muted-foreground">{removed ? '' : block.afterLine + index}</span>
          <span className={`select-none text-center font-semibold ${removed ? 'text-destructive' : 'text-success'}`} aria-label={removed ? '删除' : '新增'}>{removed ? '−' : '+'}</span>
          <pre className="min-w-0 whitespace-pre-wrap px-2 font-mono [overflow-wrap:anywhere]">{line || ' '}</pre>
        </div>)}
      </div>;
    })}
  </div>;
}

export function NoteDiffContext({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n');
  const long = lines.length > 8;
  const content = (value: string) => <pre className="my-1 min-w-0 whitespace-pre-wrap px-2 font-mono text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{value}</pre>;
  return <div className="min-w-0">
    {content(long && !expanded ? lines.slice(0, 3).join('\n') : text)}
    {long ? <Button variant="ghost" size="xs" className="h-auto w-full whitespace-normal py-1 text-muted-foreground" aria-expanded={expanded}
      onClick={() => setExpanded(value => !value)}>{expanded ? '收起未修改内容' : `展开 ${lines.length - 6} 行未修改内容`}</Button> : null}
    {long && !expanded ? content(lines.slice(-3).join('\n')) : null}
  </div>;
}
