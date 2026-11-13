import { Check, Pin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { getLibraryViewTitle, type LibraryView } from '@/modules/library/utils/libraryView';

export type LibraryTabNavigation = { view: LibraryView; title: string; onSwitch: (view: LibraryView) => void };
const views: LibraryView[] = ['all', 'recent', 'unparsed', 'parsed', 'parsing', 'failed', 'no_pdf', 'hidden', 'trash'];

export function LibraryTabHoverSwitch({ navigation, dragging, pinned, onSelect }: {
  navigation: LibraryTabNavigation; dragging: boolean; pinned: boolean; onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (dragging) setOpen(false); }, [dragging]);
  return <HoverCard open={open && !dragging} onOpenChange={value => setOpen(value && !dragging)}>
    <HoverCardTrigger asChild>
      <button type="button" onClick={onSelect} onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); }
        if (event.key === 'Escape') setOpen(false);
      }}>
        {pinned && <Pin size={12} aria-hidden="true" className="workspace-tab-pin" />}
        <span className="truncate">{navigation.title}</span>
      </button>
    </HoverCardTrigger>
    <HoverCardContent align="start" side="bottom" sideOffset={6} className="w-60 p-2"
      onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
      <div className="border-b border-border px-1.5 pb-2 text-xs font-medium">条目库 · 快速切换</div>
      <div className="grid max-h-80 gap-0.5 overflow-y-auto pt-1">
        {views.map(view => {
          const label = getLibraryViewTitle(view);
          const active = navigation.view === view && navigation.title === label;
          return <Button key={view} size="sm" variant={active ? 'secondary' : 'ghost'}
            className="w-full justify-start" aria-current={active ? 'page' : undefined}
            onClick={() => { setOpen(false); navigation.onSwitch(view); }}>
            {active ? <Check size={14} aria-hidden="true" /> : <span className="w-3.5" aria-hidden="true" />}{label}
          </Button>;
        })}
      </div>
    </HoverCardContent>
  </HoverCard>;
}
