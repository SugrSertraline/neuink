import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  beginEditAssistantQueuedMessage, cancelAssistantQueuedMessage, cancelEditAssistantQueuedMessage,
  resumeAssistantMessageQueue, saveAssistantQueuedMessage, updateAssistantQueuedMessageEdit,
  type AssistantMessageQueueSnapshot,
} from './assistantBackgroundRuns';

/** The registry owns drafts/edit locks; this surface owns only disclosure and list scrolling. */
export function AssistantMessageQueue({ queue, running }: { queue: AssistantMessageQueueSnapshot | null; running: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const listId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const focusEditId = useRef<string | null>(null);
  const restoreFocus = () => toggleRef.current?.focus({ preventScroll: true });
  useLayoutEffect(() => {
    if (!focusEditId.current) return;
    const input = [...(sectionRef.current?.querySelectorAll('textarea') ?? [])]
      .find(element => element.id === `${listId}-${focusEditId.current}`);
    if (!input) return;
    focusEditId.current = null;
    input.focus({ preventScroll: true });
  }, [queue, listId]);
  if (!queue?.items.length) return null;
  const editing = queue.items.some(item => item.editing);
  return <section ref={sectionRef} aria-label="待发送消息" className="mb-2 min-w-0 border-b pb-2 text-xs">
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <Button ref={toggleRef} type="button" variant="ghost" size="xs" className="min-w-0 justify-start px-1"
        aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>
        {expanded ? <ChevronDown /> : <ChevronRight />} 待发送 · {queue.items.length}
      </Button>
      <span className="text-muted-foreground">{queue.paused ? '已暂停' : editing ? '编辑中' : '依次发送'}</span>
      {queue.paused && !running && <Button type="button" variant="outline" size="xs" className="ml-auto"
        disabled={editing} onClick={() => resumeAssistantMessageQueue(queue.id)}>继续队列</Button>}
    </div>
    {queue.paused && <p className="mt-1 px-1 leading-5 text-muted-foreground">
      {queue.pauseReason === 'stopped' ? '当前任务已停止，待发送消息已保留。' : queue.pauseReason === 'failed'
        ? '上一条未完成，请核对结果后继续。' : '暂时无法发送，请核对当前对话。'}
    </p>}
    <div id={listId} hidden={!expanded} className="max-h-48 min-w-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
      {queue.items.map((item, index) => <div key={item.id} className="min-w-0 border-t py-1.5 first:border-t-0">
        {item.editing ? <>
          <label htmlFor={`${listId}-${item.id}`} className="mb-1 block px-1">编辑待发送消息 {index + 1}</label>
          <Textarea id={`${listId}-${item.id}`} value={item.editText ?? item.draft.question}
            className="min-h-20 resize-y text-xs leading-5 md:text-xs"
            onChange={event => updateAssistantQueuedMessageEdit(queue.id, item.id, event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelEditAssistantQueuedMessage(queue.id, item.id); restoreFocus(); }
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                if (saveAssistantQueuedMessage(queue.id, item.id, item.editText ?? item.draft.question)) restoreFocus();
              }
            }} />
          <p className="px-1 pt-1 text-[11px] leading-4 text-muted-foreground">仅修改问题文字；已选择的 @ 对象、附加资料与模型保持排队时的设置。需要更换资料请取消本条后重新发送；保存前不会发送本条及后续消息。</p>
          <div className="mt-1 flex flex-wrap justify-end gap-1">
            <Button type="button" size="xs" variant="ghost" onClick={() => { cancelAssistantQueuedMessage(queue.id, item.id); restoreFocus(); }}>取消这条消息</Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => { cancelEditAssistantQueuedMessage(queue.id, item.id); restoreFocus(); }}>取消编辑</Button>
            <Button type="button" size="xs" disabled={!(item.editText ?? item.draft.question).trim()}
              onClick={() => { if (saveAssistantQueuedMessage(queue.id, item.id, item.editText ?? item.draft.question)) restoreFocus(); }}>保存修改</Button>
          </div>
        </> : <div className="flex min-w-0 items-start gap-1">
          <span className="shrink-0 px-1 leading-6 text-muted-foreground">{index + 1}</span>
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words py-0.5 leading-5 [overflow-wrap:anywhere]">{item.draft.question}</p>
          <Button type="button" variant="ghost" size="icon-xs" className="shrink-0" title="编辑未发送消息"
            aria-label={`编辑待发送消息 ${index + 1}`} onClick={() => {
              focusEditId.current = item.id;
              if (!beginEditAssistantQueuedMessage(queue.id, item.id)) focusEditId.current = null;
            }}><Pencil /></Button>
          <Button type="button" variant="ghost" size="icon-xs" className="shrink-0" title="取消未发送消息"
            aria-label={`取消待发送消息 ${index + 1}`} onClick={() => { cancelAssistantQueuedMessage(queue.id, item.id); restoreFocus(); }}><X /></Button>
        </div>}
      </div>)}
    </div>
  </section>;
}
