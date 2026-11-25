import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AssistantComposerEditor, type AssistantComposerDraft } from '@/modules/assistant/components/AssistantComposerEditor';
import { AssistantReplyActionsContext } from '@/modules/assistant/components/AssistantReplyActionsContext';
import { ChatMessage } from '@/modules/assistant/components/ChatMessage';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { AssistantContextInput, AssistantContextItem } from '@/shared/types/assistant';
import { AssistantExternalContextItems } from '@/modules/assistant/components/AssistantExternalContextItems';
import type { ConversationMessage, ConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { SourceSegment } from '@/shared/types/domain';
import { pdfBlockDrag } from '@/shared/lib/pdfBlockDrag';

/** Uses the real editor and drop registration; no model or persistence calls. */
export function PdfBlockComposerPreview({ entry, segment, onOpenSource, externalItems = [], onRemoveExternal = () => {} }: {
  entry: LibraryEntry; segment: SourceSegment; onOpenSource: (source: ConversationSourceLink) => void;
  externalItems?: AssistantContextItem[]; onRemoveExternal?: (id: string) => void;
}) {
  const [draft, setDraft] = useState<AssistantComposerDraft | null>(null);
  const [items, setItems] = useState<AssistantContextInput[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [message, setMessage] = useState<ConversationMessage | null>(null);
  const surface = useRef<HTMLElement>(null);
  useEffect(() => () => pdfBlockDrag.cancel(), []);
  const previewDrop = (finish = false) => {
    const rect = surface.current?.querySelector('[data-material="composer"]')?.getBoundingClientRect();
    if (!rect) return;
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    if (finish) pdfBlockDrag.finish(x, y);
    else pdfBlockDrag.begin({ entryId: entry.id, workspaceRoot: null, segment, bbox: segment.bbox ?? [0, 0, 1000, 1000] }, x, y);
  };
  const previewMessage = () => {
    if (!draft && !externalItems.length) return;
    setMessage({ message_id: 'preview-message', role: 'user', content: draft?.snapshot.text ?? '查看这些列表项',
      source_links: [], created_at: '', parts: [{ type: 'context-snapshot', composer: draft?.snapshot,
        items: [...externalItems, ...items.map(item => ({ ...item, id: item.id ?? item.entryId, addedAt: '' }))] }] });
  };
  return <AssistantReplyActionsContext.Provider value={{ root: null, openSource: onOpenSource, openReply: () => {},
    addSciverseSource: async () => { throw new Error('预览不导入资料'); } }}>
    <aside ref={surface} className="flex min-h-0 min-w-0 flex-col gap-3 border-l bg-card p-3">
    <div className="text-sm font-medium">聊天草稿</div>
    <p className="text-xs text-muted-foreground">按住 Ctrl，从左侧 PDF 片段任意位置拖入。本页仅检查草稿，不发送消息。</p>
    <details className="text-xs">
      <summary className="cursor-pointer">输入状态检查</summary>
      <div className="mt-2 flex flex-wrap gap-1">
        <Button size="xs" variant="outline" disabled={disabled} onClick={() => previewDrop()}>显示拖入遮罩</Button>
        <Button size="xs" variant="outline" onClick={() => previewDrop(true)}>松开</Button>
        <Button size="xs" variant="outline" onClick={() => pdfBlockDrag.cancel()}>取消</Button>
        <Button size="xs" variant="outline" aria-pressed={disabled} onClick={() => setDisabled(value => !value)}>只读</Button>
        <Button size="xs" variant="outline" disabled={!draft?.snapshot.mentions.length && !externalItems.length} onClick={previewMessage}>预览已发送引用</Button>
      </div>
      <label className="mt-2 block">标题<Input className="mt-1" placeholder="输入标题" disabled={disabled} /></label>
      <label className="mt-2 block">说明<Textarea className="mt-1" placeholder="输入说明" disabled={disabled} /></label>
    </details>
    <div className="min-h-0 flex-1 overflow-auto">
      {message ? <ChatMessage message={message} streaming={false} onOpenSource={onOpenSource} />
        : <p className="text-xs text-muted-foreground">拖入后，可在“输入状态检查”中预览已发送引用样式。</p>}
    </div>
    <AssistantExternalContextItems items={externalItems.filter(item => !draft?.snapshot.mentions.some(mention => mention.id === item.id))} onRemove={onRemoveExternal} />
    <AssistantComposerEditor composerDraft={draft} contextItems={externalItems} entries={[entry]} tags={[]} disabled={disabled} draftQuestion={null}
      actions={<Button size="sm" disabled={disabled || !draft?.snapshot.text.trim()}>发送</Button>}
      resetKey={0} onDraftQuestionConsumed={() => {}} onSubmit={() => {}}
      onChange={(snapshot, items, document) => {
        for (const mention of draft?.snapshot.mentions ?? []) if (!snapshot.mentions.some(next => next.id === mention.id)) onRemoveExternal(mention.id);
        setDraft({ document, snapshot }); setItems(items);
      }} />
  </aside></AssistantReplyActionsContext.Provider>;
}
