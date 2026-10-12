import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';

type AssistantContextChipProps = {
  label: string;
  title: string;
  kindLabel: string;
  text?: string | null;
  pageIdx?: number | null;
  entryId?: string;
  workspaceRoot?: string | null;
  onOpen?: () => void;
  onRemove?: () => void;
};

/** The chip reserves its remove slot so hovering never moves the surrounding text. */
export function AssistantContextChip({ label, title, kindLabel, text, pageIdx, entryId,
  workspaceRoot, onOpen, onRemove }: AssistantContextChipProps) {
  const [open, setOpen] = useState(false);
  const location = pageIdx != null ? `${kindLabel} · 第 ${pageIdx + 1} 页` : kindLabel;
  const description = `${title}，${location}`;
  return <HoverCard open={open} onOpenChange={setOpen}>
    <span data-assistant-context-chip className="group/context-chip inline-flex min-w-0 max-w-full select-none items-center rounded-full border border-primary/25 bg-primary/10 align-baseline text-primary">
      <HoverCardTrigger asChild openOnClick={!onOpen}>
        <Button type="button" size="xs" variant="ghost"
          className="h-6 min-w-0 max-w-[18rem] shrink gap-1 rounded-full px-1.5 py-0 text-xs leading-5 text-primary"
          aria-disabled={false}
          aria-label={`${onOpen ? '定位引用' : '查看引用'}：${description}`}
          onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
          onClick={event => { event.stopPropagation(); if (onOpen) { setOpen(false); onOpen(); } }}>
          <span className="shrink-0 font-medium">{location}</span>
          <span className="min-w-0 truncate">{label}</span>
        </Button>
      </HoverCardTrigger>
      {onRemove ? <Button type="button" size="icon-xs" variant="ghost"
        className="mr-0.5 size-5 shrink-0 rounded-full text-muted-foreground opacity-0 pointer-events-none group-hover/context-chip:pointer-events-auto group-hover/context-chip:opacity-100 group-focus-within/context-chip:pointer-events-auto group-focus-within/context-chip:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
        aria-label={`移除引用：${description}`}
        onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
        onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); onRemove(); }}>
        <X size={12} aria-hidden="true" />
      </Button> : null}
    </span>
    <HoverCardContent side="top" align="start" className="w-96 p-3" aria-label={`引用详情：${description}`}>
      <div className="mb-2 border-b border-border pb-2">
        <div className="text-xs text-muted-foreground">{location}</div>
        <div className="mt-1 break-words text-sm font-medium">{title}</div>
        {label !== title && !text?.trim() ? <div className="mt-1 break-words text-xs text-muted-foreground">{label}</div> : null}
      </div>
      {text?.trim() ? <SourceSnapshotPreview markdown={text} workspaceRoot={workspaceRoot}
        sourceEntryId={entryId} compact flush allowScroll={false} showMermaidDiagrams={false} />
        : <p className="text-xs text-muted-foreground">{pageIdx != null ? '此引用没有保存片段正文。' : '此引用包含该资料的阅读范围。'}</p>}
      {onOpen ? <Button type="button" variant="ghost" size="xs" className="mt-2 text-primary"
        onClick={() => { setOpen(false); onOpen(); }}>定位原文</Button> : null}
    </HoverCardContent>
  </HoverCard>;
}
