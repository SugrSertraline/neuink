import type { AssistantContextItem } from "@/shared/types/assistant";
import { AssistantContextItemChip } from './AssistantContextItemChip';

export function AssistantExternalContextItems({
  items,
  onRemove,
}: {
  items: AssistantContextItem[];
  onRemove: (itemId: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 flex min-w-0 flex-wrap gap-1 rounded-md border bg-muted/20 p-1.5 text-[11px] text-muted-foreground">
      <span className="px-1 py-0.5 font-medium text-foreground/80">附加资料</span>
      {items.map(item => <AssistantContextItemChip key={item.id} item={item} onRemove={() => onRemove(item.id)} />)}
    </div>
  );
}
