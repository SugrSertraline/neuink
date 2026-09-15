import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SidebarSectionHeader } from './SidebarSectionHeader';
import { SidebarPanelResizeHandle, useSidebarPanelGroup } from './SidebarPanelGroup';

/** Sibling panels share available height; each body owns its scroll, never the stack. */
export function SidebarPanel({ name, label, open, onToggle, toggleLabel, action, children, weight = 1 }: {
  name: string; label: string; open: boolean; onToggle: () => void; toggleLabel?: string;
  action?: ReactNode; children: ReactNode; weight?: number;
}) {
  const bodyId = useId();
  const panelId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const group = useSidebarPanelGroup();
  const register = group?.register;
  useLayoutEffect(() => {
    if (register && panelRef.current) return register({ name, open, weight, element: panelRef.current });
  }, [register, name, open, weight]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  useLayoutEffect(() => {
    const viewport = bodyRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (open && viewport) viewport.scrollTop = scrollTop.current;
  }, [open]);
  return <><SidebarPanelResizeHandle name={name} /><section ref={panelRef} id={panelId} aria-label={name} data-sidebar-panel={name} className="flex min-h-7 min-w-0 flex-col overflow-hidden border-t border-border/60"
    style={{ flex: open ? `${group?.weights[name] ?? weight} 1 0%` : '0 0 auto' }}>
    <SidebarSectionHeader className="shrink-0 rounded-none bg-muted/40" label={label} open={open} onToggle={onToggle}
      toggleLabel={toggleLabel} controlsId={bodyId} action={action} />
    <div ref={bodyRef} id={bodyId} hidden={!open} className="min-h-0 flex-1" onScrollCapture={event => {
      if (open && event.target instanceof HTMLElement && event.target.dataset.slot === 'scroll-area-viewport') scrollTop.current = event.target.scrollTop;
    }}>
      <ScrollArea className="h-full min-h-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]]:overscroll-contain">
        <div className="px-2 py-1">{children}</div>
      </ScrollArea>
    </div>
  </section></>;
}
