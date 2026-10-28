import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SidebarSectionHeader } from './SidebarSectionHeader';
import { SidebarPanelResizeHandle, useSidebarPanelGroup } from './SidebarPanelGroup';

/** Panels share constrained height but never add blank space beyond their content. Each body owns scrolling. */
export function SidebarPanel({ name, label, open, onToggle, toggleLabel, action, children, weight = 1 }: {
  name: string; label: string; open: boolean; onToggle: () => void; toggleLabel?: string;
  action?: ReactNode; children: ReactNode; weight?: number;
}) {
  const bodyId = useId();
  const panelId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const group = useSidebarPanelGroup();
  const manualHeight = group?.heights[name];
  const register = group?.register;
  useLayoutEffect(() => {
    if (register && panelRef.current) return register({ name, open, weight, element: panelRef.current });
  }, [register, name, open, weight]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [naturalHeight, setNaturalHeight] = useState<number>();
  const scrollTop = useRef(0);
  useLayoutEffect(() => {
    if (!open) return;
    const content = contentRef.current, header = headerRef.current;
    if (!content || !header) return;
    const measure = () => {
      // offsetHeight is in CSS pixels even when the desktop interface is zoomed.
      const height = content.offsetHeight + header.offsetHeight + 1;
      if (height > 1) setNaturalHeight(height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(header);
    return () => observer.disconnect();
  }, [open]);
  useLayoutEffect(() => {
    const viewport = bodyRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (open && viewport) viewport.scrollTop = scrollTop.current;
  }, [open]);
  return <><SidebarPanelResizeHandle name={name} /><section ref={panelRef} id={panelId} aria-label={name} data-sidebar-panel={name} className="flex min-h-7 min-w-0 flex-col overflow-hidden border-t border-border/60"
    style={{ flex: !open ? '0 0 auto' : manualHeight !== undefined ? `0 1 ${manualHeight}px` : `${group?.weights[name] ?? weight} 1 0%`,
      maxHeight: open && manualHeight === undefined ? naturalHeight : undefined }}>
    <div ref={headerRef} data-slot="sidebar-panel-header" className="shrink-0"><SidebarSectionHeader className="rounded-none bg-muted/40" label={label} open={open} onToggle={onToggle}
      toggleLabel={toggleLabel} controlsId={bodyId} action={action} /></div>
    <div ref={bodyRef} id={bodyId} hidden={!open} data-material="panel-body" className="min-h-0 flex-1" onScrollCapture={event => {
      if (open && event.target instanceof HTMLElement && event.target.dataset.slot === 'scroll-area-viewport') scrollTop.current = event.target.scrollTop;
    }}>
      <ScrollArea className="h-full min-h-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]]:overscroll-contain">
        <div ref={contentRef} data-slot="sidebar-panel-content" className="px-2 py-1">{children}</div>
      </ScrollArea>
    </div>
  </section></>;
}
