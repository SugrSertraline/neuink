import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { clampReadingDays, persistReadingChartPreferences, readReadingChartPreferences, type ReadingChartMode } from './readingTrend';

/** Only plot surfaces own wheel zoom; the surrounding dashboard retains normal scrolling. */
export function useReadingTrendZoom(mode: ReadingChartMode) {
  const [daysByMode, setDaysByMode] = useState(() => readReadingChartPreferences().daysByMode);
  const days = daysByMode[mode];
  const rootRef = useRef<HTMLDivElement>(null);
  const value = useRef(daysByMode); value.current = daysByMode;
  const focus = useRef<{ point: Element; plot: Element } | null>(null);
  const update = (next: number) => {
    const point = document.activeElement, plot = point?.closest('[data-reading-zoom]');
    focus.current = point && plot && rootRef.current?.contains(plot) ? { point, plot } : null;
    value.current = { ...value.current, [mode]: clampReadingDays(next) }; setDaysByMode(value.current);
  };
  useLayoutEffect(() => {
    const previous = focus.current; focus.current = null;
    if (previous && !previous.point.isConnected) previous.plot.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus({ preventScroll: true });
  }, [days]);
  useEffect(() => { persistReadingChartPreferences({ daysByMode }); }, [daysByMode]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let accumulated = 0, previous = 0;
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-reading-zoom]') || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY) return;
      // Keep the graph stationary even at the range limits; headings/gutters still scroll the page.
      event.preventDefault(); event.stopPropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 128 : 1);
      const now = performance.now();
      if (now - previous > 180 || Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
      previous = now; accumulated += delta;
      if (Math.abs(accumulated) < 40) return;
      const steps = Math.trunc(accumulated / 40);
      accumulated -= steps * 40;
      update(value.current[mode] + Math.max(-14, Math.min(14, steps * 2)));
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => root.removeEventListener('wheel', wheel);
  }, [mode]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const delta = event.key === '+' || event.key === '=' ? -7 : event.key === '-' ? 7 : null;
    if (delta === null && event.key !== '0') return;
    event.preventDefault(); event.stopPropagation(); update(delta === null ? 28 : value.current[mode] + delta);
  };
  return { days, daysByMode, rootRef, onKeyDown };
}
