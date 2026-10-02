import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AssistantBackgroundTasks } from '@/modules/assistant/components/AssistantBackgroundTasks';
import type { AssistantBackgroundRunSnapshot } from '@/modules/assistant/components/assistantBackgroundRuns';
import { ChatMessage } from '@/modules/assistant/components/ChatMessage';
import { AssistantReplyActionsContext } from '@/modules/assistant/components/AssistantReplyActionsContext';
import { AssistantReplyReader } from '@/modules/assistant/components/AssistantReplyReader';
import { ResearchPaperActionsProvider } from '@/modules/assistant/components/ResearchPaperActions';
import { ToastContext } from '@/shared/hooks/useToast';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import '@/styles/globals.css';

// Isolated visual fixture: no workspace IPC, model requests or private conversation data.
const message: ConversationMessage = {
  message_id: 'fixture', role: 'assistant', content: '你好！有什么我可以帮你的？',
  created_at: '', source_links: [], parts: [
    { type: 'reasoning', text: '这是用于检查折叠效果的示例思考内容。\n'.repeat(80) },
    { type: 'memory', memory: { summary: '用户发来问候。', decisions: [], entities: [], open_items: [],
      user_preferences: [], last_user_goal: '', message_count: 2, source_count: 0, pending_proposal_count: 0, updated_at: '' } },
  ],
};
const narrow = new URLSearchParams(location.search).has('narrow');
const zoom = new URLSearchParams(location.search).has('zoom');
const research = new URLSearchParams(location.search).has('research');
const researchMessage: ConversationMessage = {
  ...message, message_id: 'research',
  content: '以下是按研究方向整理的检索结果（演示数据）：\n\n```neuink-papers\n{"items":[{"ref":"sciverse:demo-private-id","group":"时间序列预测","reason":"基于摘要讨论不规则采样 [S1]。会议归属待核实。"}]}\n```\n\n检索摘要不足以核实全部实验结论。网页资料参见[论文主页](https://example.com/paper)。',
  parts: [], source_links: [{ provider: 'sciverse', doc_id: 'demo-private-id', page_no: 0,
    title: 'Example Study', authors: ['Example Author', 'Example Author'], publication_year: 2026,
    venue: 'Example Conference', quote: 'Raw retrieval text ![](example-image.jpg)' }]
};
function BackgroundFixture() {
  const [runs, setRuns] = useState<AssistantBackgroundRunSnapshot[]>([{
    root: 'fixture', conversationId: 'background', conversation: null,
    question: '阅读论文并形成笔记（示例）', abortController: new AbortController(),
    error: null, streamingMessageId: null, noteProposalsByMessageId: {}, toolEventsByMessageId: {},
  }]);
  const [selected, setSelected] = useState<string | null>(null);
  return <><AssistantBackgroundTasks runs={runs} currentConversationId={selected}
    onOpen={setSelected} onStop={controller => { controller.abort(); setRuns([...runs]); }} />
    {selected ? <p>已打开后台对话（示例）</p> : null}</>;
}
function Fixture() {
  const [reply, setReply] = useState<ConversationMessage | null>(null);
  const addSciverseSource = async () => ({ entryId: 'demo', message: '演示：已加入本地文库。', status: 'created_metadata_only' as const });
  return <TooltipProvider><ToastContext.Provider value={{ notify: () => 'demo-toast', dismiss: () => undefined }}><ResearchPaperActionsProvider root="fixture"><AssistantReplyActionsContext.Provider value={{ root: 'fixture', openReply: setReply,
    openSource: () => undefined, addSciverseSource }}><div className="flex h-screen min-w-0 gap-2">
  <main className="bg-background p-3 text-foreground" style={{ width: narrow ? 240 : 420, zoom: zoom ? 1.25 : 1 }}>
    <h1 className="mb-2 text-sm">助手 · 对话与后台任务</h1>
    {research && <ChatMessage message={researchMessage} streaming={false} onOpenSource={() => undefined} onAddSciverseSource={addSciverseSource} />}
    <BackgroundFixture />
    <ChatMessage message={{ ...message, message_id: 'user', role: 'user', content: '你好', parts: [] }} streaming={false} onOpenSource={() => undefined} />
    <ChatMessage message={message} streaming={false} onOpenSource={() => undefined} />
    <ChatMessage message={{ ...message, message_id: 'streaming', content: '' }} streaming
      toolEvents={[]}
      onOpenSource={() => undefined} />
    <ChatMessage message={{ ...message, message_id: 'failed', content: '', parts: [
      { type: 'error', message: '示例：资料库无法访问，请检查后重试。' },
    ] }} streaming={false} onOpenSource={() => undefined} />
  </main>
  {reply && <div className="min-w-0 flex-1"><div className="flex items-center border-b bg-muted"><span className="p-2">完整回复 · 标签页演示</span><Button size="xs" variant="ghost" onClick={() => setReply(null)}>关闭标签页</Button></div><AssistantReplyReader message={reply} /></div>}
  </div></AssistantReplyActionsContext.Provider></ResearchPaperActionsProvider></ToastContext.Provider></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
