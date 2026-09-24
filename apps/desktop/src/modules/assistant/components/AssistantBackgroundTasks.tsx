import { Loader2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AssistantBackgroundRunSnapshot } from './assistantBackgroundRuns';

export function AssistantBackgroundTasks({ runs, currentConversationId, onOpen, onStop }: {
  runs: AssistantBackgroundRunSnapshot[];
  currentConversationId: string | null;
  onOpen: (id: string) => void;
  onStop: (controller: AbortController) => void;
}) {
  const background = runs.filter(run => run.conversationId !== currentConversationId || !run.conversationId);
  if (!background.length) return null;
  return <section aria-label="后台对话" className="mt-2 border-t pt-1 text-xs">
    <div className="px-1 py-1 text-[11px] text-muted-foreground">后台运行 · {background.length}</div>
    <div className="max-h-28 overflow-y-auto overscroll-contain">
      {background.map((run, index) => <div key={run.conversationId ?? `starting-${index}`} className="flex min-w-0 items-center gap-1">
        <Button type="button" variant="ghost" size="xs" className="min-w-0 flex-1 justify-start font-normal"
          disabled={!run.conversationId} title={run.conversation?.title ?? run.question}
          onClick={() => run.conversationId && onOpen(run.conversationId)}>
          <Loader2 aria-hidden="true" className="shrink-0 motion-safe:animate-spin motion-reduce:animate-none" size={12} />
          <span className="truncate">{run.conversation?.title ?? run.question}</span>
          <span className="shrink-0 text-muted-foreground">{run.abortController.signal.aborted ? '正在停止' : '运行中'}</span>
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" disabled={run.abortController.signal.aborted}
          aria-label={`停止后台对话 ${run.conversation?.title ?? run.question}`} title="停止这个对话"
          onClick={() => onStop(run.abortController)}><Square aria-hidden="true" size={12} /></Button>
      </div>)}
    </div>
  </section>;
}
