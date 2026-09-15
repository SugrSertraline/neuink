import { createContext, useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

type Panel = { name: string; open: boolean; weight: number; element: HTMLElement };
type PanelGroup = {
  panels: Panel[];
  weights: Record<string, number>;
  register: (panel: Panel) => () => void;
  resize: (name: string, delta: number) => void;
  start: (name: string, event: ReactPointerEvent<HTMLDivElement>) => void;
};
const Context = createContext<PanelGroup | null>(null);
export const useSidebarPanelGroup = () => useContext(Context);

/** Owns only panel proportions and resize gestures; panel bodies keep their scroll and sessions. */
export function SidebarPanelGroup({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const cancelRef = useRef<(() => void) | null>(null);
  const register = useCallback((panel: Panel) => {
    cancelRef.current?.();
    setPanels(current => [...current.filter(item => item.name !== panel.name), panel].sort((a, b) =>
      a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return () => {
      cancelRef.current?.();
      setPanels(current => current.filter(item => item.name !== panel.name));
    };
  }, []);
  useEffect(() => () => cancelRef.current?.(), []);

  const measure = (name: string) => {
    const visible = panels.filter(panel => panel.open);
    const index = visible.findIndex(panel => panel.name === name);
    if (index < 1) return null;
    const upper = visible[index - 1], lower = visible[index];
    // clientY uses physical viewport coordinates, while flex sizes use CSS pixels.
    const scale = lower.element.getBoundingClientRect().height / lower.element.offsetHeight;
    if (!(scale > 0)) return null;
    const heights = Object.fromEntries(visible.map(panel => [panel.name, panel.element.getBoundingClientRect().height / scale]));
    const total = Object.values(heights).reduce((sum, height) => sum + height, 0);
    const totalWeight = visible.reduce((sum, panel) => sum + (weights[panel.name] ?? panel.weight), 0);
    const pairHeight = heights[upper.name] + heights[lower.name];
    const minimum = Math.min(56, pairHeight / 2);
    return { upper, lower, scale, heights, total, totalWeight, pairHeight, minimum };
  };
  const apply = (snapshot: NonNullable<ReturnType<typeof measure>>, delta: number) => {
    const upperHeight = Math.max(snapshot.minimum, Math.min(snapshot.pairHeight - snapshot.minimum, snapshot.heights[snapshot.upper.name] + delta));
    const heights = { ...snapshot.heights, [snapshot.upper.name]: upperHeight, [snapshot.lower.name]: snapshot.pairHeight - upperHeight };
    setWeights(current => ({ ...current, ...Object.fromEntries(Object.entries(heights).map(([name, height]) => [name, height / snapshot.total * snapshot.totalWeight])) }));
  };
  const resize = (name: string, delta: number) => {
    const snapshot = measure(name);
    if (snapshot) apply(snapshot, delta);
  };
  const start: PanelGroup['start'] = (name, event) => {
    if (event.button !== 0) return;
    cancelRef.current?.();
    const snapshot = measure(name);
    if (!snapshot) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.focus({ preventScroll: true });
    const pointerId = event.pointerId, startY = event.clientY, original = weights;
    const cursor = document.body.style.cursor, userSelect = document.body.style.userSelect;
    let moved = false;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const finish = (cancel: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancelled);
      window.removeEventListener('resize', cancelled);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
      cancelRef.current = null;
      if (cancel && moved) setWeights(original);
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (!moved && Math.abs(next.clientY - startY) < 3) return;
      moved = true;
      apply(snapshot, (next.clientY - startY) / snapshot.scale);
    };
    const up = (next: PointerEvent) => { if (next.pointerId === pointerId) finish(false); };
    const cancelled = () => finish(true);
    const key = (next: KeyboardEvent) => {
      if (next.key !== 'Escape') return;
      next.preventDefault();
      next.stopImmediatePropagation();
      finish(true);
    };
    cancelRef.current = cancelled;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelled);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancelled);
    window.addEventListener('resize', cancelled);
  };
  return <Context.Provider value={{ panels, weights, register, resize, start }}>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-sidebar-panel-group>{children}</div>
  </Context.Provider>;
}

export function SidebarPanelResizeHandle({ name }: { name: string }) {
  const group = useSidebarPanelGroup();
  const open = group?.panels.filter(panel => panel.open) ?? [];
  const index = open.findIndex(panel => panel.name === name);
  if (!group || index < 1) return null;
  const upper = open[index - 1], lower = open[index];
  const upperWeight = group.weights[upper.name] ?? upper.weight;
  const lowerWeight = group.weights[lower.name] ?? lower.weight;
  return <div role="separator" aria-orientation="horizontal" tabIndex={0}
    aria-label={`调整${upper.name}与${name}高度`} aria-controls={upper.element.id}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 * upperWeight / (upperWeight + lowerWeight))}
    title="拖动调整高度，也可使用上下方向键"
    className="relative z-10 h-px shrink-0 cursor-row-resize touch-none bg-border outline-none before:absolute before:inset-x-0 before:-top-1 before:h-2 hover:bg-primary focus-visible:bg-primary focus-visible:before:bg-primary/15"
    onPointerDown={event => group.start(name, event)}
    onKeyDown={event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      group.resize(name, (event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 32 : 8));
    }} />;
}
