import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReadingChartMode } from './readingTrend';

/** Keep the four tiles mounted and animate their old geometry into the new slots. */
export function useReadingChartSwap() {
  const [primary, setPrimary] = useState<ReadingChartMode>('bar');
  const tiles = useRef(new Map<ReadingChartMode, HTMLElement>());
  const before = useRef(new Map<ReadingChartMode, DOMRect>());
  const animations = useRef<Animation[]>([]);
  const pending = useRef(false);
  const cancel = () => {
    animations.current.forEach(animation => animation.cancel()); animations.current = [];
    tiles.current.forEach(tile => { tile.style.pointerEvents = ''; });
  };
  const select = (mode: ReadingChartMode) => {
    if (mode === primary) return;
    before.current = new Map([...tiles.current].map(([key, tile]) => [key, tile.getBoundingClientRect()]));
    cancel(); pending.current = true; setPrimary(mode);
  };
  useLayoutEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      for (const [mode, tile] of tiles.current) {
        const from = before.current.get(mode), to = tile.getBoundingClientRect();
        if (!from?.width || !to.width || !to.height || !tile.animate) continue;
        const scale = to.width / tile.offsetWidth || 1;
        const animation = tile.animate([
          { transformOrigin: 'top left', transform: `translate(${(from.x - to.x) / scale}px, ${(from.y - to.y) / scale}px) scale(${from.width / to.width}, ${from.height / to.height})` },
          { transformOrigin: 'top left', transform: 'none' },
        ], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
        tile.style.pointerEvents = 'none';
        animation.onfinish = () => { tile.style.pointerEvents = ''; };
        animations.current.push(animation);
      }
    }
    before.current.clear();
    tiles.current.get(primary)?.querySelector<HTMLButtonElement>('[data-chart-point][tabindex="0"]')?.focus({ preventScroll: true });
  }, [primary]);
  useEffect(() => () => cancel(), []);
  const register = (mode: ReadingChartMode, node: HTMLElement | null) => {
    if (node) tiles.current.set(mode, node); else tiles.current.delete(mode);
  };
  return { primary, select, register };
}
