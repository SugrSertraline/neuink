import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ChatMessage } from '@/modules/assistant/components/ChatMessage';
import { NoteReviewProvider, useNoteReview } from '@/modules/assistant/review/NoteReviewContext';
import { NoteReviewPage } from '@/modules/assistant/review/NoteReviewPage';
import { NoteReviewBanner } from '@/modules/assistant/review/NoteReviewBanner';
import { useNoteReviewActions } from '@/modules/assistant/review/useNoteReviewActions';
import type { AssistantNoteProposal } from '@/shared/types/assistant';
import '@/styles/globals.css';

// Only synthetic content. No workspace, provider or persistence access.
const params = new URLSearchParams(location.search);
const base: AssistantNoteProposal = {
  id: 'demo', entryId: 'entry', entryTitle: '交互设计研究', noteId: 'note', title: '论文阅读笔记：研究结论与局限性',
  action: 'replace', status: 'pending', createdAt: '', sources: [],
  beforeMarkdown: '# 研究概述\n\n研究讨论对话式辅助工具如何参与论文阅读。\n\n## 核心结论\n\n工具提升了所有参与者的阅读效率。\n\n## 研究方法\n\n采用小规模用户实验，并分析问卷与访谈结果。\n\n## 局限性\n\n没有明显局限。\n\n## 后续计划\n\n需要进一步验证。',
  markdown: '# 研究概述\n\n研究讨论对话式辅助工具如何参与论文阅读。\n\n## 核心结论\n\n部分参与者完成任务更快，但不能推广到所有读者。\n\n## 研究方法\n\n采用小规模用户实验，并分析问卷与访谈结果。\n\n## 局限性\n\n- 样本规模有限。\n- 缺少长期使用效果评估。\n\n## 后续计划\n\n扩大样本，并记录参与者在真实阅读任务中的表现。'
};
function Fixture() {
  const review = useNoteReview()!;
  const [proposal, setProposal] = useState<AssistantNoteProposal>(params.has('error') ? { ...base, beforeMarkdown: null, status: 'error', error: '原文已发生变化，请重新生成修改。' } : base);
  useEffect(() => review.publish([{ conversationId: 'demo-conversation', messageId: 'message', proposal }]), [review.publish, proposal]);
  useNoteReviewActions({ conversationId: 'demo-conversation', disabled: false,
    apply: async () => { setProposal(current => ({ ...current, status: 'applied' })); },
    reject: async () => { setProposal(current => ({ ...current, status: 'rejected' })); } });
  return <main className="grid h-full min-h-0 bg-background text-foreground" style={{ gridTemplateColumns: params.has('narrow') ? '1fr' : `${params.has('minimum') ? 220 : 300}px minmax(0, 1fr)` }}>
    {!params.has('narrow') ? <aside className="assistant-message-layout min-w-0 overflow-auto border-r p-2">
      <h1 className="mb-2 text-sm font-medium">助手</h1>
      <ChatMessage message={{ message_id: 'message', role: 'assistant', created_at: '', source_links: [], content: '我建议调整结论范围，并补充研究局限。修改尚未应用。编号 `note_proposal_1790071869098_o14ao1uayek`。' }}
        noteProposals={[proposal]} streaming={false} onOpenSource={() => {}}
        onApplyNoteProposal={() => setProposal({ ...proposal, status: 'applied' })}
        onRejectNoteProposal={() => setProposal({ ...proposal, status: 'rejected' })} />
      {review.returnRequest ? <p role="status">已定位到对应对话提案（示例）</p> : null}
    </aside> : null}
    <div className="flex min-h-0 min-w-0 flex-col">
      <NoteReviewBanner entryId="entry" noteId="note" />
      <div className="min-h-0 flex-1"><NoteReviewPage proposalId="demo" onOpenNote={() => {}} /></div>
      <Button size="xs" variant="ghost" onClick={() => setProposal(base)}>重置示例</Button>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<TooltipProvider><NoteReviewProvider onOpen={() => {}} onShowAssistant={() => {}}><Fixture /></NoteReviewProvider></TooltipProvider>);
document.documentElement.style.height = '100%';
document.body.style.height = '100%';
document.getElementById('root')!.style.height = '100%';
if (params.has('zoom')) document.documentElement.style.zoom = '1.25';
