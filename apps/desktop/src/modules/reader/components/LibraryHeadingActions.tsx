import { Children, Fragment, isValidElement, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useReflowToolbarLayout } from './reflow/useReflowToolbarLayout';

function flatten(nodes: ReactNode): ReactNode[] {
  return Children.toArray(nodes).flatMap(node => isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment
    ? flatten(node.props.children) : [node]);
}

/** Keep one mounted copy of each action, including its dialog and disabled state. */
export function LibraryHeadingActions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const items = flatten(children);
  const keys = items.map((item, index) => `${index}:${isValidElement(item) ? item.key : ''}`);
  const layout = useReflowToolbarLayout(false, open, JSON.stringify(keys));
  const count = Math.min(items.length, layout.visibleCount);
  const overflow = count < items.length;
  const hidden = 'absolute -left-[10000px] top-0 invisible pointer-events-none';
  return <div ref={layout.rowRef} aria-label="条目库操作" className="relative ml-auto flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-1.5">
    {items.map((item, index) => <div key={keys[index]} data-reflow-toolbar-item={index}
      aria-hidden={index >= count || undefined} className={`w-max shrink-0 ${index >= count ? hidden : ''}`}>
      {open && index >= count ? null : item}
    </div>)}
    <Popover open={open && overflow} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button ref={layout.menuRef} size="default" variant="outline" aria-label="更多条目库操作" title="更多操作"
        aria-hidden={!overflow || undefined} className={`shrink-0 gap-1 text-xs ${overflow ? '' : hidden}`}><MoreHorizontal size={14} /><span>更多</span></Button></PopoverTrigger>
      <PopoverContent viewportAligned align="end" className="w-64 max-w-[calc(100vw-2rem)]"
        onCloseAutoFocus={event => {
          if (layout.menuRef.current?.getAttribute('aria-hidden') !== 'true') return;
          event.preventDefault();
          [...layout.rowRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? []]
            .find(control => !control.closest('[aria-hidden="true"]'))?.focus({ preventScroll: true });
        }}>
        <div className="flex flex-wrap items-center gap-2">{open ? items.slice(count) : null}</div>
      </PopoverContent>
    </Popover>
  </div>;
}
