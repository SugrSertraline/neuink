import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AssistantBackgroundTasks } from '@/modules/assistant/components/AssistantBackgroundTasks';
import type { AssistantBackgroundRunSnapshot } from '@/modules/assistant/components/assistantBackgroundRuns';
import { ChatMessage } from '@/modules/assistant/components/ChatMessage';
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
createRoot(document.getElementById('root')!).render(<TooltipProvider>
  <main className="bg-background p-3 text-foreground" style={{ width: narrow ? 240 : 420, zoom: zoom ? 1.25 : 1 }}>
    <h1 className="mb-2 text-sm">助手 · 对话与后台任务</h1>
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
</TooltipProvider>);
