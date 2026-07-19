import { FileText, X } from "lucide-react";

import type { AssistantContextItem } from "@/shared/types/assistant";

import {
  contextItemChipTitle,
  contextItemLabel,
} from "./assistantContextTargets";

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
      <span className="px-1 py-0.5 font-medium text-foreground/80">Context</span>
      {items.map((item) => (
        <span
          className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-1.5 py-0.5"
          key={item.id}
          title={contextItemLabel(item)}
        >
          <FileText className="shrink-0 text-primary" size={11} aria-hidden="true" />
          <span className="max-w-40 truncate">{contextItemChipTitle(item)}</span>
          <button
            aria-label={`Remove ${contextItemLabel(item)}`}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-muted"
            type="button"
            onClick={() => onRemove(item.id)}
          >
            <X size={11} aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  );
}
