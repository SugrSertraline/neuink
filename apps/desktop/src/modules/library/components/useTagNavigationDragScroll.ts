import { useEffect, type RefObject } from 'react';
import { getEntryTagDragState, subscribeEntryTagDrag, updateEntryTagDrag } from '@/shared/lib/entryDragData';

// Scroll the existing sidebar viewport, not an additional list container.
export function useTagNavigationDragScroll(rootRef: RefObject<HTMLElement>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let frame: number | null = null;
    let disposed = false;
    const tick = () => {
      frame = null;
      const drag = getEntryTagDragState();
      const viewport = rootRef.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
      if (!drag || !viewport || disposed) return;
      const bounds = viewport.getBoundingClientRect();
      if (drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom) {
        const edge = Math.min(40, bounds.height / 4);
        const direction = drag.y < bounds.top + edge ? -1 : drag.y > bounds.bottom - edge ? 1 : 0;
        if (direction) {
          const scale = bounds.height / (viewport.offsetHeight || bounds.height) || 1;
          const before = viewport.scrollTop;
          viewport.scrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, before + direction * 10 / scale));
          if (before !== viewport.scrollTop) updateEntryTagDrag(drag.x, drag.y);
        }
      }
      if (frame === null && !disposed) frame = window.requestAnimationFrame(tick);
    };
    const onDrag = () => {
      if (getEntryTagDragState()) {
        if (frame === null && !disposed) frame = window.requestAnimationFrame(tick);
      } else if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
    };
    const unsubscribe = subscribeEntryTagDrag(onDrag);
    onDrag();
    return () => {
      disposed = true;
      unsubscribe();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [rootRef, enabled]);
}
