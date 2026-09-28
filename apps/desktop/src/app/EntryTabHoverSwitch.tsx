import { Check, Pin } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';
import { workspaceSurfaceLabel, type WorkspaceSurface } from './workspaceSurface';

export type EntryTabView = 'entry-overview' | 'pdf' | 'reflow';

export const entryTabViews: Array<{ kind: EntryTabView; label: string }> = [
  { kind: 'entry-overview', label: '条目详情' },
  { kind: 'pdf', label: 'PDF' },
  { kind: 'reflow', label: '重排视图' }
];

export function EntryTabHoverSwitch({
  dragging,
  entry,
  onSelect,
  onSwitch,
  pinned,
  surface
}: {
  dragging: boolean;
  entry?: { id: string; title: string; pdfFileName?: string | null };
  onSelect: () => void;
  onSwitch: (view: EntryTabView) => void;
  pinned: boolean;
  surface: Extract<WorkspaceSurface, { kind: EntryTabView }>;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (dragging) setOpen(false);
  }, [dragging]);

  return (
    <HoverCard open={open && !dragging} onOpenChange={(next) => setOpen(next && !dragging)}>
      <HoverCardTrigger asChild onPointerMove={(event) => { if (dragging) event.preventDefault(); }}>
        <button type="button" onClick={onSelect}>
          {pinned ? <Pin size={12} aria-hidden="true" className="workspace-tab-pin" /> : null}
          <span className="truncate">{workspaceSurfaceLabel(surface, entry ? [entry] : [])}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="w-60 p-2"
        side="bottom"
        sideOffset={6}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="min-w-0 border-b border-border px-1.5 pb-2">
          <div className="truncate text-xs font-medium text-foreground" title={entry?.title}>{entry?.title ?? '条目'}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">快速切换视图</div>
        </div>
        <div className="grid gap-0.5 pt-1">
          {entryTabViews.map(({ kind, label }) => {
            const active = surface.kind === kind;
            const unavailable = kind !== 'entry-overview' && !entry?.pdfFileName;
            return <Button
              key={kind}
              aria-current={active ? 'page' : undefined}
              className={cn('w-full justify-start', active && 'font-semibold')}
              disabled={active || unavailable}
              size="sm"
              title={unavailable ? '该条目尚未添加 PDF' : undefined}
              type="button"
              variant={active ? 'secondary' : 'ghost'}
              onClick={() => { setOpen(false); onSwitch(kind); }}
            >
              {active ? <Check size={14} aria-hidden="true" /> : <span aria-hidden="true" className="w-3.5" />}
              {label}
            </Button>;
          })}
        </div>
        {!entry?.pdfFileName ? <p className="px-1.5 pt-1 text-xs text-muted-foreground">添加 PDF 后可使用 PDF 和重排视图。</p> : null}
      </HoverCardContent>
    </HoverCard>
  );
}
