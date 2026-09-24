import { useEffect, useState, type RefObject } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { ReflowSegmentGroup } from '../reflow/buildReflowBlocks';
import { useReadingNavigation, type ReadingAdapter } from './ReadingNavigation';
import { observeReadingWidth } from './observeReadingWidth';

export function useReflowReadingNavigation(scrollRef: RefObject<HTMLDivElement>, groups: ReflowSegmentGroup[],
  virtualizer: Virtualizer<HTMLDivElement, Element>, groupIndex: Map<string, number>) {
  const navigation = useReadingNavigation();
  const [flashUid, setFlashUid] = useState<string | null>(null);
  useEffect(() => {
    if (!flashUid) return;
    const timer = window.setTimeout(() => setFlashUid(null), 1200);
    return () => window.clearTimeout(timer);
  }, [flashUid]);
  const register = navigation?.register;
  useEffect(() => {
    if (!groups.length) return;
    let frame = 0;
    const cancelResize = () => scrollRef.current?.dispatchEvent(new Event('neuink:reading-navigation'));
    const adapter: ReadingAdapter = {
      cancelRestore: () => cancelAnimationFrame(frame),
      capture: () => {
        const scroll = scrollRef.current;
        if (!scroll || scroll.clientWidth <= 0) return null;
        const viewport = scroll.getBoundingClientRect();
        // Virtualizer estimates can differ from measured rows after remount,
        // especially with CSS zoom. Capture the actual visible DOM anchor.
        const row = [...scroll.querySelectorAll<HTMLElement>('[data-reflow-virtual-item]')]
          .find(element => { const rect = element.getBoundingClientRect(); return rect.height > 0 && rect.bottom > viewport.top + 1; });
        const group = row && groups[Number(row.dataset.index)];
        if (!row || !group) return null;
        const rect = row.getBoundingClientRect();
        return { pageIdx: group.body.page_idx, segmentUid: group.body.uid,
          offset: (viewport.top - rect.top) / rect.height, left: scroll.scrollLeft };
      },
      restore: position => {
        const index = position.segmentUid ? groupIndex.get(position.segmentUid) : undefined;
        if (index === undefined) return;
        virtualizer.scrollToIndex(index, { align: 'start' });
        cancelAnimationFrame(frame);
        const settle = (remaining: number) => {
          frame = requestAnimationFrame(() => {
            const scroll = scrollRef.current;
            const row = scroll?.querySelector<HTMLElement>(`[data-reflow-virtual-item][data-index="${index}"]`);
            if (scroll && row) {
              const viewport = scroll.getBoundingClientRect(), rect = row.getBoundingClientRect();
              const scale = scroll.offsetWidth > 0 ? viewport.width / scroll.offsetWidth : 1;
              if (rect.height > 0 && scale > 0) {
                const delta = (rect.top - viewport.top + position.offset * rect.height) / scale;
                virtualizer.scrollToOffset(Math.max(0, scroll.scrollTop + delta));
                scroll.scrollLeft = position.left;
              }
            }
            // Bounded correction for asynchronous virtual-row measurements.
            if (remaining > 1) settle(remaining - 1);
          });
        };
        settle(3);
      },
      navigate: target => {
        cancelResize();
        cancelAnimationFrame(frame);
        const index = target.segmentUid ? groupIndex.get(target.segmentUid)
          : groups.findIndex(group => group.body.page_idx === target.pageIdx);
        if (index === undefined || index < 0) return false;
        virtualizer.scrollToIndex(index, { align: 'center' });
        scrollRef.current?.focus({ preventScroll: true });
        setFlashUid(groups[index].body.uid); return true;
      }
    };
    const unregister = register?.(adapter, scrollRef.current);
    const stopObserving = scrollRef.current ? observeReadingWidth(scrollRef.current, adapter) : undefined;
    return () => { stopObserving?.(); cancelAnimationFrame(frame); unregister?.(); };
  }, [groupIndex, groups, register, scrollRef, virtualizer]);
  return { flashUid, remember: navigation?.remember, navigate: navigation?.navigate,
    hasRetainedPosition: navigation?.hasRetainedPosition,
    isJumpHandled: navigation?.isJumpHandled, markJumpHandled: navigation?.markJumpHandled };
}
