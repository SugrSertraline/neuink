import type { AssistantContextItem, AssistantContextPlan } from '@/shared/types/assistant';
import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import { AssistantContextItemChip } from './AssistantContextItemChip';

export function AssistantContextSummary({ items, plan, onOpenSource }: {
  items: AssistantContextItem[];
  plan?: AssistantContextPlan | null;
  onOpenSource: (source: ConversationSourceLink) => void;
}) {
  return <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1 rounded-md border bg-muted/20 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
    <span className="mr-0.5 font-medium text-foreground/80">引用资料</span>
    {items.map(item => <AssistantContextItemChip key={item.id} item={item} onOpenSource={onOpenSource} />)}
    {plan?.summary ? <span className="min-w-0 basis-full truncate pt-0.5 text-[10px] text-muted-foreground">{plan.summary}</span> : null}
  </div>;
}
