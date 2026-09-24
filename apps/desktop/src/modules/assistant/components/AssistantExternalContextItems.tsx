import { FileText, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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
      <span className="px-1 py-0.5 font-medium text-foreground/80">附加资料</span>
      {items.map((item) => (
        <span
          className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-1.5 py-0.5"
          key={item.id}
          title={contextItemLabel(item)}
        >
          <FileText className="shrink-0 text-primary" size={11} aria-hidden="true" />
          {item.kind === 'segment' ? <Popover>
            <PopoverTrigger asChild><button type="button" className="flex min-w-0 items-center gap-1 text-left hover:underline focus-visible:outline focus-visible:outline-ring"
              aria-label={`查看${item.id.startsWith('selection:') ? '选区' : '片段'}：${item.entryTitle}，第 ${item.pageIdx + 1} 页`}>
              <span className="min-w-0 truncate">{item.id.startsWith('selection:') ? '选区' : '片段'} · {item.entryTitle}</span>
              <span className="shrink-0">· 第 {item.pageIdx + 1} 页</span>
            </button></PopoverTrigger>
            <PopoverContent viewportAligned className="w-80 max-w-[calc(100vw-2rem)] p-3">
              <p className="break-words text-xs font-medium">{item.entryTitle} · 第 {item.pageIdx + 1} 页</p>
              <p className="mt-2 max-h-48 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-sm">{item.text}</p>
            </PopoverContent>
          </Popover> : <span className="max-w-40 truncate">{contextItemChipTitle(item)}</span>}
          <button
            aria-label={`移除 ${contextItemLabel(item)}`}
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
