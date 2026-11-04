import { useEffect, useRef } from 'react';
import { dismissHoverInteractions, hoverInteractionBlocked } from '@/components/ui/hover-interactions';
import type { FoldLevel } from './useFoldReader';

const LEVELS = ['full', 'brief', 'key', 'takeaway', 'topic'] as const;
const CONTROLS = 'button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-hover-surface], [data-reading-selection-toolbar]';
export const FOLD_GESTURE_HINT = 'Ctrl + 滚轮切换本段详略：上滚更详细，下滚更简略；段落聚焦后也可使用 Ctrl + ↑ / ↓。';

/** The existing reader owns the level; this hook only interprets input on one paragraph. */
export function useFoldLevelGesture({ enabled, level, scope, onChange, onInteraction }: {
  enabled: boolean;
  level: FoldLevel;
  scope: string;
  onChange: (level: Exclude<FoldLevel, 'off'>) => void;
  onInteraction: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const current = useRef({ level, onChange, onInteraction });
  current.current = { level, onChange, onInteraction };

  useEffect(() => {
    const element = root.current;
    if (!enabled || !element) return;
    let accumulated = 0, lastWheel = -Infinity, lastStep = -Infinity, lastDirection = 0;
    const step = (direction: number) => {
      const index = LEVELS.findIndex(value => value === current.current.level);
      if (index < 0) return;
      const next = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index + direction))];
      dismissHoverInteractions(); current.current.onInteraction();
      if (next !== current.current.level) current.current.onChange(next);
    };
    const accepts = (event: MouseEvent | KeyboardEvent) => event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
      !event.defaultPrevented && !hoverInteractionBlocked() && !(event.target instanceof Element && event.target.closest(CONTROLS));
    const wheel = (event: WheelEvent) => {
      if (!accepts(event) || event.buttons || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      // Own this gesture even at either end of the ladder, avoiding accidental browser zoom.
      event.preventDefault(); event.stopPropagation();
      const now = performance.now(), direction = Math.sign(event.deltaY);
      if (now - lastWheel > 180 || direction !== lastDirection) accumulated = 0;
      if (direction !== lastDirection) lastStep = -Infinity;
      lastWheel = now; lastDirection = direction;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(48, element.clientHeight) : 1);
      accumulated += pixels;
      if (now - lastStep < 240) { accumulated = 0; return; }
      if (Math.abs(accumulated) < 48) return;
      accumulated = 0; lastStep = now; step(direction);
    };
    const key = (event: KeyboardEvent) => {
      if (event.target !== element || !accepts(event) || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) step(event.key === 'ArrowUp' ? -1 : 1);
    };
    // React's delegated wheel listeners are passive, so the paragraph owns a native listener.
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('keydown', key);
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('keydown', key);
    };
  }, [enabled, scope]);

  return root;
}
