import { createPointerDropSession } from './pointerDropSession';

export type EntryTagDragState = { entryId: string; x: number; y: number };
const session = createPointerDropSession<{ entryId: string }>();
export const beginEntryTagDrag = (entryId: string, x: number, y: number) => session.begin({ entryId }, x, y);
export const updateEntryTagDrag = session.update;
export const cancelEntryTagDrag = session.cancel;
export const getEntryTagDragState = session.getState;
export const subscribeEntryTagDrag = session.subscribe;
export const isEntryTagDropTargetActive = session.isTargetActive;
export function finishEntryTagDrag(x: number, y: number) { void Promise.resolve(session.finish(x, y)).catch(() => undefined); }
export function registerEntryTagDropTarget(target: { element: HTMLElement; onDrop: (entryId: string) => unknown }) {
  return session.register({ element: target.element, onDrop: ({ entryId }) => target.onDrop(entryId) });
}
