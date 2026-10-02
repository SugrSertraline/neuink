import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChatMessage, MarkdownMessageContent } from '@/modules/assistant/components/ChatMessage';
import { buildAssistantScope } from '@/modules/assistant/components/assistantScope';
import { NoteReviewProvider, useNoteReview } from '@/modules/assistant/review/NoteReviewContext';
import { NoteReviewPage } from '@/modules/assistant/review/NoteReviewPage';
import { noteReviewVersions } from '@/modules/assistant/review/noteReviewDiff';
import { useNoteReviewActions } from '@/modules/assistant/review/useNoteReviewActions';
import type { AssistantNoteProposal } from '@/shared/types/assistant';
import type { ConversationSourceLink, LocalConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import '@/styles/globals.css';

// Synthetic, deterministic interaction fixture. No model, workspace IPC or disk writes.
const diagram = 'mindmap\n  root((时序研究))\n    研究任务\n      预测\n      分类\n    处理流程\n      数据清洗\n      特征提取\n      模型评估\n    评价指标\n      MAE\n      F1';
const addition = `## 时序研究思维导图\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\n预测分支采用“数据清洗 → 特征提取 → 模型评估”，评价指标为 MAE。[S1]\n\n分类分支使用 F1 评价。[S2]\n\n这是基于示例解析文本的主题整理，不是对论文图片的逐像素复原。`;
const original = '# 时序研究笔记\n\n这段是已有笔记，追加时需要保留。';
const sources: LocalConversationSourceLink[] = [
  { entry_id: 'forecast', entry_title: '预测方法研究（虚构示例）', segment_uid: 'figure-1', page_idx: 1,
    quote: '示例 MinerU 结构化输出：flowchart LR; 数据清洗 --> 特征提取 --> 模型评估。指标名称：MAE。未提供数值。' },
  { entry_id: 'classify', entry_title: '时序分类研究（虚构示例）', segment_uid: 'table-1', page_idx: 2,
    quote: '示例 MinerU 表格输出：任务 = 时序分类；评价指标 = F1。未提供数值。' }
];
const tags = [{ id: 'timeseries', name: '时序研究', parent_id: null, created_at: '', updated_at: '' },
  { id: 'empty', name: '空标签', parent_id: null, created_at: '', updated_at: '' }];
const entries = ['forecast', 'classify', 'outside'].map(id => ({ id, title: id,
  tagIds: id === 'outside' ? [] : ['timeseries'], contents: [] })) as unknown as LibraryEntry[];
const proposalTemplate: AssistantNoteProposal = { id: 'diagram-demo', entryId: 'notes', entryTitle: '研究记录（示例）',
  noteId: 'summary', noteTitle: '时序研究笔记', title: '时序研究笔记', action: 'append', status: 'pending', createdAt: '',
  beforeMarkdown: original, markdown: addition, sources: sources.map((source, index) => ({
    marker: `[S${index + 1}]`, entryId: source.entry_id, entryTitle: source.entry_title,
    pageIdx: source.page_idx, segmentUid: source.segment_uid, quote: source.quote
  })) };

function Fixture({ onView, view }: { onView: (view: string) => void; view: string }) {
  const review = useNoteReview()!;
  const [tag, setTag] = useState('timeseries');
  const [generated, setGenerated] = useState(false);
  const [proposal, setProposal] = useState<AssistantNoteProposal | null>(null);
  const [note, setNote] = useState(original);
  const [source, setSource] = useState<ConversationSourceLink | null>(null);
  const scope = buildAssistantScope({ activeEntry: null, activeTag: null, entries, selectedTagIds: [tag], tags });
  useEffect(() => review.publish(proposal ? [{ conversationId: 'demo', messageId: 'answer', proposal }] : []), [proposal, review.publish]);
  const apply = async () => {
    if (!proposal || proposal.status !== 'pending') return;
    setNote(noteReviewVersions(proposal).after);
    setProposal({ ...proposal, status: 'applied' });
    onView('note');
  };
  const reject = async () => {
    if (!proposal || proposal.status !== 'pending') return;
    setProposal({ ...proposal, status: 'rejected' });
    onView('note');
  };
  useNoteReviewActions({ conversationId: 'demo', disabled: false, apply, reject });
  const openSource = (value: ConversationSourceLink) => { setSource(value); onView('source'); };
  const reset = () => { setGenerated(false); setProposal(null); setNote(original); setSource(null); onView('note'); };
  return <main className="flex h-screen min-w-0 flex-col bg-background text-foreground">
    <header className="shrink-0 border-b px-4 py-3">
      <h1 className="text-base font-medium">标签 → 思维导图 → 笔记追加</h1>
      <p className="mt-1 text-xs text-muted-foreground">交互演示：虚构论文、预设回答，无模型请求，不读写你的资料库。确认只更新本页示例，刷新即可重置。</p>
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,360px)_minmax(0,1fr)] max-[640px]:grid-cols-1 max-[640px]:grid-rows-2">
      <aside aria-label="示例对话" className="assistant-message-layout min-h-0 min-w-0 overflow-y-auto border-r p-3">
        <label htmlFor="demo-tag" className="mb-1 block text-sm">选择标签</label>
        <Select value={tag} onValueChange={value => { setTag(value); reset(); }}>
          <SelectTrigger id="demo-tag" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{tags.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
        <p className="my-2 text-xs text-muted-foreground">范围内 {scope.entry_ids.length} 篇；不会读取标签外的示例论文。</p>
        <Button size="sm" disabled={generated || !scope.entry_ids.length} onClick={() => setGenerated(true)}>生成示例思维导图</Button>
        {!scope.entry_ids.length && <p role="status" className="mt-2 text-sm">这个标签没有论文，请选择其他标签。</p>}
        {generated && <div className="mt-3 space-y-3">
          <ChatMessage message={{ message_id: 'question', role: 'user', created_at: '', source_links: [], content: '@时序研究 请结合解析后的流程图和表格，整理思维导图。' }} streaming={false} onOpenSource={openSource} />
          <ChatMessage message={{ message_id: 'answer', role: 'assistant', created_at: '', source_links: sources, content: addition }}
            noteProposals={proposal ? [proposal] : []} streaming={false} onOpenSource={openSource}
            onApplyNoteProposal={apply} onRejectNoteProposal={reject} />
          {!proposal && <Button variant="outline" className="h-auto whitespace-normal" onClick={() => { setProposal(proposalTemplate); onView('review'); }}>继续：把这个图追加到《时序研究笔记》</Button>}
        </div>}
        <Button className="mt-3" variant="ghost" size="xs" onClick={reset}>重置演示</Button>
      </aside>
      <section aria-label="示例笔记工作区" className="flex min-h-0 min-w-0 flex-col">
        <nav aria-label="示例页面" className="flex shrink-0 flex-wrap gap-1 border-b bg-muted p-2">
          <Button size="sm" variant={view === 'note' ? 'secondary' : 'ghost'} onClick={() => onView('note')}>笔记正文</Button>
          {proposal && <><Button size="sm" variant={view === 'review' ? 'secondary' : 'ghost'} onClick={() => onView('review')}>修改审阅</Button>
            <Button size="sm" variant={view === 'preview' ? 'secondary' : 'ghost'} onClick={() => onView('preview')}>修改后预览</Button></>}
        </nav>
        {view === 'review' && proposal ? <div className="min-h-0 flex-1"><NoteReviewPage proposalId={proposal.id} onOpenNote={() => onView('note')} /></div>
          : <div className="min-h-0 flex-1 overflow-auto p-4">
            {view === 'source' && source ? <><h2 className="mb-3 text-sm font-medium">来源内容（虚构演示数据）</h2><p>{source.quote}</p></>
              : <>{view === 'preview' && <p className="mb-3 text-sm text-muted-foreground">只读预览，不代表已写入。请到“修改审阅”确认或忽略。</p>}
                {proposal?.status === 'applied' && <p role="status" className="mb-3 text-sm text-success">已追加到示例笔记，原内容保留。没有写入真实资料库。</p>}
                {proposal?.status === 'rejected' && <p role="status" className="mb-3 text-sm text-muted-foreground">已忽略，笔记未改变。</p>}
                <MarkdownMessageContent content={view === 'preview' && proposal ? noteReviewVersions(proposal).after : note}
                  sources={sources} streaming={false} onOpenSource={openSource} /></>}
          </div>}
      </section>
    </div>
  </main>;
}
function Showcase() {
  const [view, setView] = useState('note');
  return <TooltipProvider><NoteReviewProvider onOpen={() => setView('review')} onShowAssistant={() => {}}>
    <Fixture onView={setView} view={view} />
  </NoteReviewProvider></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Showcase />);
