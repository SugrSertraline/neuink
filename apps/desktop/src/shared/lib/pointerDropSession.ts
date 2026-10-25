/** In-window pointer drags never serialize document text through the OS clipboard. */
export function createPointerDropSession<T extends object>() {
  type State = T & { x: number; y: number };
  type Target = { element: HTMLElement; accepts?: (item: T) => boolean; onDrop: (item: T) => unknown };
  let active: State | null = null;
  const listeners = new Set<() => void>();
  const targets = new Set<Target>();
  const notify = () => { for (const listener of listeners) listener(); };
  const targetAt = (x: number, y: number, item: T) => {
    const hit = document.elementFromPoint?.(x, y);
    return [...targets].reverse().find(target => {
      // Exclude clipped, covered and disabled targets, including other workspaces.
      if (hit !== undefined && (!hit || !target.element.contains(hit))) return false;
      if (target.accepts && !target.accepts(item)) return false;
      const bounds = target.element.getBoundingClientRect();
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    }) ?? null;
  };
  const cancel = () => { if (active) { active = null; notify(); } };
  return {
    begin(item: T, x: number, y: number) { active = { ...item, x, y }; notify(); },
    update(x: number, y: number) { if (active) { active = { ...active, x, y }; notify(); } },
    finish(x: number, y: number) {
      const item = active;
      const target = item ? targetAt(x, y, item) : null;
      cancel();
      if (item && target) return target.onDrop(item);
    },
    cancel,
    getState: () => active,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    register(target: Target) { targets.add(target); return () => { targets.delete(target); }; },
    isTargetActive(element: HTMLElement, state = active) { return Boolean(state && targetAt(state.x, state.y, state)?.element === element); },
  };
}
