import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { ConversationMessage, ConversationSourceLink, SciverseLibraryImportResult } from '@/shared/ipc/assistantApi';
import { paperRecords, parsePaperPresentation, type PaperRecord } from '../research/paperPresentation';
import { ResearchPaperAction } from './ResearchPaperActions';
import { SciverseImportButton } from './SciverseImportButton';

export function PaperAnswerContent({ message, content, sources, discovered, streaming, renderMarkdown, onOpenSource, onImport }: {
  message: ConversationMessage; content: string; sources: ConversationSourceLink[];
  discovered: ConversationSourceLink[]; streaming: boolean;
  renderMarkdown: (text: string) => ReactNode;
  onOpenSource: (source: ConversationSourceLink) => void;
  onImport?: (source: Extract<ConversationSourceLink, { provider: 'sciverse' }>) => Promise<SciverseLibraryImportResult>;
}) {
  const records = paperRecords((message.parts ?? []).flatMap(part => part.type === 'tool-result' ? part.researchPapers ?? [] : []), [...sources, ...discovered]);
  const fragments = parsePaperPresentation(content, streaming);
  const used = new Set<string>();
  const row = (record: PaperRecord, reason?: string) => record.kind === 'research'
    ? <ResearchPaperAction key={record.ref} paper={record.paper}>{reason && renderMarkdown(reason)}</ResearchPaperAction>
    : <article key={record.ref} className="min-w-0 border-b py-3 text-sm [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-40">
          <button className="text-left font-medium text-primary hover:underline" onClick={() => onOpenSource(record.source)}>{record.source.title}</button>
          <p className="text-xs text-muted-foreground">{[record.source.publication_year, record.source.venue, [...new Map((record.source.authors ?? []).map(author => [author.trim().toLowerCase(), author.trim()])).values()].slice(0, 3).join(', ')].filter(Boolean).join(' · ')}</p>
          {reason && <div className="mt-1">{renderMarkdown(reason)}</div>}
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-start gap-1">
          <Button variant="ghost" size="sm" onClick={() => onOpenSource(record.source)}>查看</Button>
          {onImport && <SciverseImportButton source={record.source} onImport={onImport} />}
        </div>
      </div>
    </article>;
  const answer = fragments.map((fragment, index) => {
    if (fragment.kind === 'text') return <div key={index}>{renderMarkdown(fragment.text)}</div>;
    if (fragment.kind === 'invalid') return <p key={index} role="alert" className="text-sm text-destructive">论文推荐格式不完整，请重新生成；未创建任何添加操作。</p>;
    if (streaming || fragment.kind === 'pending') return <p key={index} role="status" className="text-sm text-muted-foreground">正在整理论文推荐…</p>;
    let group: string | undefined;
    return <section key={index} aria-label="推荐论文" className="min-w-0">
      {fragment.items.map(item => {
        const record = records.get(item.ref);
        if (!record) return <p key={item.ref} role="alert" className="text-sm text-destructive">这篇推荐没有对应的检索记录，无法查看或添加，请重新检索。</p>;
        if (used.has(item.ref)) return null;
        used.add(item.ref);
        const heading = item.group !== group ? item.group : undefined;
        group = item.group;
        return <div key={item.ref}>{heading && <h3 className="mt-3 text-sm font-semibold">{heading}</h3>}{row(record, item.reason)}</div>;
      })}
    </section>;
  });
  const remaining = [...records.values()].filter(record => !used.has(record.ref));
  return <>
    {answer}
    {!streaming && remaining.length > 0 && <details className="mt-3 min-w-0">
      <summary className="cursor-pointer text-sm text-muted-foreground">{used.size ? '其他检索结果' : '检索候选'}（{remaining.length}）</summary>
      <p className="mt-1 text-xs text-muted-foreground">候选不等于推荐，会议归属和相关性以可核验信息为准。</p>
      {remaining.map(record => row(record))}
    </details>}
  </>;
}
