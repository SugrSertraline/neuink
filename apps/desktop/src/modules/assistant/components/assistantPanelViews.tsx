import {
  ArrowDown,
  FileDown,
  Loader2,
  Pencil,
  Trash2,
  X
} from 'lucide-react';
import type { ComponentProps, RefObject, UIEventHandler } from 'react';

import { Button } from '@/components/ui/button';
import type {
  AssistantToolTraceEvent,
  ConversationMessage,
  ConversationMeta
} from '@/shared/ipc/assistantApi';
import type { AssistantNoteProposal } from '@/shared/types/assistant';

import { ChatMessage } from './ChatMessage';
import { contextItemChipTitle } from './assistantContextTargets';

type ChatMessageCallbacks = Pick<
  ComponentProps<typeof ChatMessage>,
  | 'onApplyEntryMetaProposal'
  | 'onApplyNoteProposal'
  | 'onApplyTagProposal'
  | 'onOpenSource'
  | 'onRegenerateNoteProposal'
  | 'onRejectEntryMetaProposal'
  | 'onRejectNoteProposal'
  | 'onRejectTagProposal'
  | 'onRetryAgentRun'
>;

type AssistantConversationHistoryProps = {
  busy: boolean;
  conversationId: string | null;
  error: string | null;
  items: ConversationMeta[];
  loading: boolean;
  onClose: () => void;
  onDelete: (item: ConversationMeta) => void;
  onExport: (item: ConversationMeta) => void;
  onOpen: (conversationId: string) => void;
  onRename: (item: ConversationMeta) => void;
  open: boolean;
};

export function AssistantConversationHistory({
  busy,
  conversationId,
  error,
  items,
  loading,
  onClose,
  onDelete,
  onExport,
  onOpen,
  onRename,
  open
}: AssistantConversationHistoryProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="absolute inset-2 z-50 flex min-h-0 flex-col overflow-hidden rounded-md border bg-popover shadow-xl">
      <div className="flex shrink-0 items-center justify-between border-b px-2 py-1.5">
        <span className="text-xs font-semibold">聊天历史</span>
        <Button
          aria-label="关闭聊天历史"
          size="icon-xs"
          type="button"
          variant="ghost"
          onClick={onClose}
        >
          <X aria-hidden="true" size={13} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 size={13} />
            正在加载聊天历史…
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/25 bg-destructive/5 px-2 py-2 text-xs leading-5 text-destructive">
            无法读取聊天历史：{error}
          </div>
        ) : items.length > 0 ? (
          items.map((item) => {
            const historyContextItems = item.context_items ?? [];
            return (
              <div
                className={`mb-1 flex min-w-0 items-stretch gap-1 rounded-md ${
                  conversationId === item.id ? 'bg-muted text-primary' : ''
                }`}
                key={item.id}
              >
                <button
                  className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-xs leading-4 hover:bg-muted"
                  type="button"
                  onClick={() => onOpen(item.id)}
                >
                  <span className="line-clamp-2">{item.title}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {item.message_count} messages
                  </span>
                  {historyContextItems.length > 0 ? (
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      Context: {historyContextItems.map(contextItemChipTitle).join(' / ')}
                    </span>
                  ) : null}
                </button>
                <Button
                  aria-label={`重命名对话 ${item.title}`}
                  className="self-center text-muted-foreground"
                  disabled={busy}
                  size="icon-xs"
                  title="重命名对话"
                  type="button"
                  variant="ghost"
                  onClick={() => onRename(item)}
                >
                  <Pencil aria-hidden="true" size={12} />
                </Button>
                <Button
                  aria-label={`导出对话 ${item.title}`}
                  className="self-center text-muted-foreground"
                  disabled={busy}
                  size="icon-xs"
                  title="导出为笔记"
                  type="button"
                  variant="ghost"
                  onClick={() => onExport(item)}
                >
                  <FileDown aria-hidden="true" size={12} />
                </Button>
                <Button
                  aria-label={`删除对话 ${item.title}`}
                  className="mr-1 self-center text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  size="icon-xs"
                  title="删除对话"
                  type="button"
                  variant="ghost"
                  onClick={() => onDelete(item)}
                >
                  <Trash2 aria-hidden="true" size={12} />
                </Button>
              </div>
            );
          })
        ) : (
          <div className="px-2 py-3 text-xs text-muted-foreground">No conversations</div>
        )}
      </div>
    </div>
  );
}

type AssistantMessageListProps = ChatMessageCallbacks & {
  contentRef: RefObject<HTMLDivElement>;
  endRef: RefObject<HTMLDivElement>;
  hiddenMessageCount: number;
  messageBatchSize: number;
  messagesAtBottom: boolean;
  noteProposalsByMessageId: Record<string, AssistantNoteProposal[]>;
  onLoadEarlier: () => void;
  onReturnToLatest: () => void;
  onScroll: UIEventHandler<HTMLDivElement>;
  renderedMessages: ConversationMessage[];
  scrollRef: RefObject<HTMLDivElement>;
  streamingMessageId: string | null;
  toolEventsByMessageId: Record<string, AssistantToolTraceEvent[]>;
  visibleMessageCount: number;
};

export function AssistantMessageList({
  contentRef,
  endRef,
  hiddenMessageCount,
  messageBatchSize,
  messagesAtBottom,
  noteProposalsByMessageId,
  onApplyEntryMetaProposal,
  onApplyNoteProposal,
  onApplyTagProposal,
  onLoadEarlier,
  onOpenSource,
  onRegenerateNoteProposal,
  onRejectEntryMetaProposal,
  onRejectNoteProposal,
  onRejectTagProposal,
  onRetryAgentRun,
  onReturnToLatest,
  onScroll,
  renderedMessages,
  scrollRef,
  streamingMessageId,
  toolEventsByMessageId,
  visibleMessageCount
}: AssistantMessageListProps) {
  return (
    <div className="relative min-h-0 min-w-0">
      <div
        className="size-full min-h-0 min-w-0 overflow-auto p-2"
        ref={scrollRef}
        onScroll={onScroll}
      >
        <div className="min-h-full" ref={contentRef}>
          {visibleMessageCount > 0 ? (
            <>
              {hiddenMessageCount > 0 ? (
                <div className="mb-2 flex justify-center">
                  <Button size="xs" type="button" variant="ghost" onClick={onLoadEarlier}>
                    加载更早的 {Math.min(messageBatchSize, hiddenMessageCount)} 条消息
                  </Button>
                </div>
              ) : null}
              {renderedMessages.map((message) => (
                <ChatMessage
                  key={message.message_id}
                  message={message}
                  noteProposals={
                    noteProposalsByMessageId[message.message_id] ?? message.note_proposals
                  }
                  streaming={message.message_id === streamingMessageId}
                  toolEvents={toolEventsByMessageId[message.message_id] ?? message.tool_events}
                  onApplyNoteProposal={onApplyNoteProposal}
                  onApplyEntryMetaProposal={onApplyEntryMetaProposal}
                  onApplyTagProposal={onApplyTagProposal}
                  onOpenSource={onOpenSource}
                  onRegenerateNoteProposal={onRegenerateNoteProposal}
                  onRejectNoteProposal={onRejectNoteProposal}
                  onRejectEntryMetaProposal={onRejectEntryMetaProposal}
                  onRejectTagProposal={onRejectTagProposal}
                  onRetryAgentRun={onRetryAgentRun}
                />
              ))}
            </>
          ) : (
            <div className="grid h-full min-h-48 min-w-0 place-items-center overflow-hidden rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs leading-5 text-muted-foreground">
              <span className="block max-w-[13.5rem] whitespace-normal break-words">
                Ask about the current content or pinned context.
              </span>
            </div>
          )}
          <div aria-hidden="true" className="h-px" ref={endRef} />
        </div>
      </div>
      {!messagesAtBottom && visibleMessageCount > 0 ? (
        <Button
          className="absolute bottom-3 right-3 gap-1 rounded-full shadow-md"
          size="xs"
          title="回到最新消息"
          type="button"
          variant="secondary"
          onClick={onReturnToLatest}
        >
          <ArrowDown size={13} aria-hidden="true" />
          最新消息
        </Button>
      ) : null}
    </div>
  );
}
