import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import { cancelUserInput, getUserInputs, subscribeUserInputs, submitUserInput, updateUserInputDraft, userInputAnswerError,
  type PendingUserInput } from '../runtime/userInput';
import { MarkdownMessageContent } from './ChatMessage';
import { AssistantContentPreview } from './AssistantContentPreview';

export function UserInputPanel({ root, conversationId, onOpen, onOpenSource }: {
  root: string | null; conversationId: string | null; onOpen: (id: string) => void;
  onOpenSource: (source: ConversationSourceLink) => void;
}) {
  const requests = useSyncExternalStore(subscribeUserInputs, getUserInputs);
  return <>{requests.filter(item => item.root === root).map(item => item.conversationId === conversationId
    ? <QuestionForm key={item.id} item={item} onOpenSource={onOpenSource} />
    : <Button key={item.id} size="sm" variant="outline" className="mb-2 h-auto max-w-full whitespace-normal py-1"
        onClick={() => onOpen(item.conversationId)}>另一个对话等待选择，点击查看</Button>)}</>;
}

function QuestionForm({ item, onOpenSource }: { item: PendingUserInput; onOpenSource: (source: ConversationSourceLink) => void }) {
  const [error, setError] = useState<string | null>(null);
  const incomplete = userInputAnswerError(item, item.draft);
  return <section aria-label="回答助手问题" className="mb-2 flex max-h-[min(30rem,50vh)] min-h-0 min-w-0 flex-col rounded-md border border-primary/30 bg-card text-sm leading-6">
    <header className="shrink-0 border-b px-3 py-2">
      <p role="status" className="font-medium">等待你的选择</p><p className="break-words">{item.title}</p>
      {item.previewMarkdown?.trim() ? <div className="mt-1"><AssistantContentPreview title={item.title} label="预览方案／笔记结构">
        <MarkdownMessageContent content={item.previewMarkdown} sources={item.sources} streaming={false} onOpenSource={onOpenSource} />
      </AssistantContentPreview></div> : null}
    </header>
    <div className="min-h-0 overflow-y-auto overscroll-contain px-3 py-2">
      {item.questions.map(question => {
        const answer = Object.prototype.hasOwnProperty.call(item.draft, question.id) ? item.draft[question.id] : { selected: [], text: '' };
        const update = (next: typeof answer) => { setError(null); updateUserInputDraft(item.id, { ...item.draft, [question.id]: next }); };
        return <fieldset key={question.id} className="mb-3 min-w-0 last:mb-0">
          <legend className="mb-1 break-words font-medium">{question.title}<span className="ml-1 font-normal text-muted-foreground">（{question.multiple ? '可多选' : '单选'}）</span></legend>
          {question.options.map(option => <label key={option.id} className="mb-1 flex cursor-pointer items-start gap-2 rounded border p-2 hover:bg-accent/40">
            {question.multiple ? <Checkbox className="mt-1" aria-label={option.label} checked={answer.selected.includes(option.id)}
              onCheckedChange={checked => update({ ...answer, selected: checked ? [...answer.selected, option.id] : answer.selected.filter(id => id !== option.id) })} />
              : <input className="mt-1.5 shrink-0 accent-primary" type="radio" name={`${item.id}-${question.id}`} checked={answer.selected.includes(option.id)}
                onChange={() => update({ ...answer, selected: [option.id] })} />}
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{option.label}{option.description ? <span className="block text-muted-foreground">{option.description}</span> : null}</span>
          </label>)}
          {!question.multiple && answer.selected.length > 0 ? <Button size="xs" variant="ghost" className="h-auto whitespace-normal py-1"
            onClick={() => update({ ...answer, selected: [] })}>清除选择，改为自填</Button> : null}
          <label className="mt-2 block text-muted-foreground" htmlFor={`${item.id}-${question.id}-custom`}>自己的回答或补充</label>
          <Textarea id={`${item.id}-${question.id}-custom`} value={answer.text} maxLength={4000} rows={2}
            className="min-h-16 text-sm" onChange={event => update({ ...answer, text: event.target.value })} />
        </fieldset>;
      })}
    </div>
    <footer className="shrink-0 border-t px-3 py-2">
      <p className="mb-1 text-xs text-muted-foreground">仅提交你的意图；实际写入仍需预览并确认。</p>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => cancelUserInput(item.id)}>取消并停止</Button>
        <Button size="sm" className="h-auto whitespace-normal py-1" disabled={Boolean(incomplete)}
          onClick={() => setError(submitUserInput(item.id))}>提交选择并继续</Button>
      </div>
    </footer>
  </section>;
}
