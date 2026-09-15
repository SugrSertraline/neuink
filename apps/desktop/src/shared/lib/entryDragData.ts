export type EntryTagDragState = {
  entryId: string;
  x: number;
  y: number;
};

type EntryTagDropTarget = {
  element: HTMLElement;
  onDrop: (entryId: string) => Promise<unknown> | unknown;
};

let activeDrag: EntryTagDragState | null = null;
const listeners = new Set<() => void>();
const dropTargets = new Set<EntryTagDropTarget>();

export function beginEntryTagDrag(entryId: string, x: number, y: number) {
  activeDrag = { entryId, x, y };
  notifyListeners();
}

export function updateEntryTagDrag(x: number, y: number) {
  if (!activeDrag) {
    return;
  }
  activeDrag = { ...activeDrag, x, y };
  notifyListeners();
}

export function finishEntryTagDrag(x: number, y: number) {
  const drag = activeDrag;
  const target = drag ? findDropTarget(x, y) : null;
  cancelEntryTagDrag();
  if (drag && target) {
    void Promise.resolve(target.onDrop(drag.entryId)).catch(() => undefined);
  }
}

export function cancelEntryTagDrag() {
  if (!activeDrag) {
    return;
  }
  activeDrag = null;
  notifyListeners();
}

export function getEntryTagDragState() {
  return activeDrag;
}

export function subscribeEntryTagDrag(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registerEntryTagDropTarget(target: EntryTagDropTarget) {
  dropTargets.add(target);
  return () => {
    dropTargets.delete(target);
  };
}

export function isEntryTagDropTargetActive(element: HTMLElement, drag = activeDrag) {
  return Boolean(drag && findDropTarget(drag.x, drag.y)?.element === element);
}

function findDropTarget(x: number, y: number) {
  // Bounding boxes alone can hit rows clipped by a scroller or covered by its
  // sticky toolbar. Only the visible row under the pointer may receive a drop.
  const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : undefined;
  return [...dropTargets].reverse().find(({ element }) => {
    if (hit !== undefined && (!hit || !element.contains(hit))) return false;
    const bounds = element.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }) ?? null;
}

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}
