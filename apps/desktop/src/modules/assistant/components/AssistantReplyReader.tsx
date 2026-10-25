import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import { ChatMessage } from './ChatMessage';
import { useAssistantReading } from './AssistantReplyActionsContext';

/** Workspace owns tab lifetime; this read-only surface owns its single scroll viewport. */
export function AssistantReplyReader({ message }: { message: ConversationMessage }) {
  const actions = useAssistantReading();
  if (!actions) return <p role="alert">回复阅读暂不可用，请重新打开对话。</p>;
  return <section aria-label="完整回复" className="flex h-full min-h-0 min-w-0 flex-col bg-card">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-sm font-medium">
      <span>完整回复 <span className="ml-2 font-normal text-muted-foreground">只读</span></span>
      {message.source_links.length > 0 && <span className="text-xs font-normal text-muted-foreground">点击证据索引查看来源</span>}
    </header>
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-4">
      <div className="mx-auto max-w-5xl"><ChatMessage message={message} streaming={false} reading
        onOpenSource={source => actions.openSource(source, { replyId: message.message_id })} onAddSciverseSource={actions.addSciverseSource} /></div>
    </div>
  </section>;
}
