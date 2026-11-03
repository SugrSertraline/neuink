import { ChevronRight, GripVertical } from 'lucide-react';
import { useLayoutEffect, useRef, type KeyboardEventHandler, type PointerEventHandler } from 'react';
import { Button } from '@/components/ui/button';

/** One boundary control changes from a resize grip into an expand arrow. */
export function SidebarBoundaryControl({ open, width, minWidth, maxWidth, onExpand, onPointerDown, onKeyDown }: {
  open: boolean; width: number; minWidth: number; maxWidth: number; onExpand: () => void;
  onPointerDown: PointerEventHandler<HTMLDivElement>; onKeyDown: KeyboardEventHandler<HTMLDivElement>;
}) {
  const grip = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLButtonElement>(null);
  const previousOpen = useRef(open);
  useLayoutEffect(() => {
    if (previousOpen.current !== open) (open ? grip.current : arrow.current)?.focus({ preventScroll: true });
    previousOpen.current = open;
  }, [open]);
  return open ? <div ref={grip} className="app-sidebar-resizer" role="separator" tabIndex={0}
    aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={minWidth} aria-valuemax={maxWidth} aria-valuenow={width}
    title="单击收起侧栏；拖动调整宽度；左右方向键微调，Enter 或空格收起"
    onPointerDown={onPointerDown} onKeyDown={onKeyDown}>
    <span className="app-sidebar-resizer-grip" data-material="opaque-sidebar-handle" aria-hidden="true"><GripVertical size={12} /></span>
  </div> : <Button ref={arrow} type="button" variant="ghost" size="icon-sm" className="app-sidebar-expander"
    data-material="opaque-sidebar-handle" aria-label="打开侧栏" aria-expanded={false} title="展开侧栏" onClick={onExpand}>
    <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
  </Button>;
}
