import type { RefObject, UIEventHandler } from 'react';
import { Button } from '@/components/ui/button';
import { ChatMessage } from '../components/ChatMessage';
import { ResearchReport } from './ResearchReport';
import type { ResearchModel } from './useResearchTasks';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { AssistantNoteProposal } from '@/shared/types/assistant';
import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';

/** Research shares the chat renderer, composer and scrolling contract. */
export function ResearchPanel({ root, model, entries, onApply, onOpenSource, scrollRef, contentRef, endRef, onScroll, historyOpen, onCloseHistory }: {
  root: string | null; model: ResearchModel; entries: LibraryEntry[];
  onApply: (proposal: AssistantNoteProposal) => Promise<AssistantNoteProposal>;
  onOpenSource: (source: ConversationSourceLink) => void;
  scrollRef: RefObject<HTMLDivElement>; contentRef: RefObject<HTMLDivElement>; endRef: RefObject<HTMLDivElement>;
  onScroll: UIEventHandler<HTMLDivElement>; historyOpen: boolean; onCloseHistory: () => void;
}) {
  const thread = model.thread.length ? model.thread : model.task ? [model.task] : [];
  return <div ref={scrollRef} onScroll={onScroll} className="h-full min-h-0 overflow-y-auto overscroll-contain" aria-label="深度研究消息">
    <div ref={contentRef} className="min-w-0 space-y-3 p-3">
      {historyOpen ? <section aria-label="研究历史" className="space-y-1 border-b pb-2">
        <div className="flex items-center justify-between"><strong className="text-xs">研究历史</strong><Button size="xs" variant="ghost" onClick={onCloseHistory}>关闭</Button></div>
        {model.tasks.map(task => <button type="button" key={task.id} className="block w-full rounded-sm px-2 py-2 text-left text-xs hover:bg-muted focus-visible:outline-primary" aria-pressed={model.selected === task.id}
          onClick={() => { model.select(task.id); onCloseHistory(); }}><span className="line-clamp-2">{task.query}</span><span className="text-muted-foreground">{task.created_at.slice(0, 10)} · {task.stage}</span></button>)}
        {!model.tasks.length ? <p className="py-2 text-xs text-muted-foreground">还没有研究记录。</p> : null}
      </section> : null}
      {!root ? <p className="text-xs text-muted-foreground">打开资料库后即可开始研究。</p> : model.selected && !model.task ? <p role="status" className="text-xs text-muted-foreground">正在读取研究记录…</p>
        : !thread.length ? <p className="text-xs leading-6 text-muted-foreground">提出你的研究问题，我会自动检索可用来源、比较方法，并给出带引用的完整回答。可用 @ 附加论文和笔记。</p> : null}
      {thread.map(task => <div key={task.id} className="space-y-3">
        <ChatMessage message={{ message_id: task.id + '-question', role: 'user', content: task.query, source_links: [], created_at: task.created_at }} streaming={false} onOpenSource={onOpenSource} />
        {task.report ? <ChatMessage message={{ message_id: task.id + '-answer', role: 'assistant', content: task.report, source_links: [], created_at: task.created_at }} streaming={task.status === 'running'} onOpenSource={onOpenSource} /> : null}
        <div role={task.status === 'running' ? 'status' : undefined} className="text-xs text-muted-foreground">{task.stage}</div>
        {task.error ? <p role="alert" className="text-xs text-destructive">{task.error}</p> : null}
        {root && task.report ? <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">来源与报告操作</summary><ResearchReport root={root} task={task} entries={entries} onApply={onApply} /></details> : null}
      </div>)}
      <div ref={endRef} />
    </div>
  </div>;
}

export function ResearchSetup({ model, onOpenSettings }: { model: ResearchModel; onOpenSettings: () => void }) {
  const active = model.status?.active;
  if (!model.status) return model.error ? <div className="mb-2 text-xs"><p role="alert" className="text-destructive">{model.error}</p><Button size="xs" variant="ghost" disabled={model.busy} onClick={() => void model.refresh()}>重新检查</Button></div> : <p role="status" className="mb-2 text-xs text-muted-foreground">正在检查研究组件…</p>;
  return <div className="mb-2 space-y-2 text-xs">
    {!model.status.ready && !active ? <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 text-muted-foreground">首次使用需要安装研究组件。</span><Button size="xs" onClick={onOpenSettings}>前往设置安装</Button></div> : null}
    {active?.installation ? <div className="flex flex-wrap items-center gap-2"><span role="status" className="min-w-0 flex-1 text-muted-foreground">{active.stage}{active.progress != null ? ` · ${active.progress}%` : ''}</span><Button size="xs" variant="outline" onClick={onOpenSettings}>查看安装进度</Button></div> : null}
    {model.error || model.status.error ? <p role="alert" className="text-destructive">{model.error ?? model.status.error}</p> : null}
    {model.status.pending_save ? <Button size="xs" variant="outline" disabled={model.busy} onClick={() => void model.command({ kind: 'retry_save' })}>重试保存回答</Button> : null}
  </div>;
}
