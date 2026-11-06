import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { IdeationState } from '@/shared/ipc/ideationApi';
import { arrangeBoard, type BoardLayout } from './ideationLayout';
import { hasNodeOverlap, positionBranchSlots } from './ideationSlots';
import type { BranchSlot } from './ideationBranches';

/** Real positions persist; suggestions adapt locally without rearranging on insertion. */
export function useIdeationLayout(state: IdeationState | null, boardId: string | undefined, sourceId: string | null,
  update: (change: (current: IdeationState) => IdeationState) => void) {
  const [request, setRequest] = useState(0);
  const [canvasWidth, setCanvasWidth] = useState(Infinity);
  const stacked = canvasWidth < 624;
  const [result, setResult] = useState<(BoardLayout & { boardId: string; version: number }) | null>(null);
  const previousRequest = useRef(0);
  const [consumed, setConsumed] = useState<{ sourceId: string | null; ids: string[] }>({ sourceId: null, ids: [] });
  const cached = useRef<{ boardId?: string; sourceId: string | null; slots: BranchSlot[]; stacked?: boolean }>({ sourceId: null, slots: [] });
  useLayoutEffect(() => { setConsumed({ sourceId, ids: [] }); }, [boardId, sourceId]);
  useLayoutEffect(() => {
    if (!state || !boardId) return;
    const explicit = previousRequest.current !== request;
    previousRequest.current = request;
    if (!explicit && !hasNodeOverlap(state.placements)) return;
    const next = arrangeBoard(state);
    cached.current = { sourceId: null, slots: [] };
    setResult(current => ({ ...next, boardId, version: (current?.version ?? 0) + 1 }));
    const positions = new Map(next.placements.map(p => [p.id, p]));
    update(current => ({ ...current, placements: current.placements.map(p => {
      const placed = positions.get(p.id);
      return placed && !p.locked ? { ...p, x: placed.x, y: placed.y } : p;
    }) }));
    // Repair overlap on opening, or honor an explicit whole-board arrangement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, request]);
  const branchSlots = useMemo(() => {
    if (!state) return [];
    const retained = cached.current.boardId === boardId && cached.current.sourceId === sourceId && cached.current.stacked === stacked ? cached.current.slots : [];
    const slots = positionBranchSlots(state, sourceId, retained, consumed.sourceId === sourceId ? consumed.ids : [], stacked);
    cached.current = { boardId, sourceId, slots, stacked };
    return slots;
  }, [state?.placements, state?.cards, state?.links, boardId, sourceId, consumed, result, stacked]);
  const current = result?.boardId === boardId ? result : null;
  return { branchSlots, setCanvasWidth, layoutRoutes: current?.routes ?? {}, layoutVersion: current?.version ?? 0,
    consumeSlot: (slot: BranchSlot) => { if (slot.sourceId === sourceId) setConsumed(current => ({ sourceId, ids: [...(current.sourceId === sourceId ? current.ids : []), slot.id] })); },
    revealSlot: (id: string) => setConsumed(current => ({ sourceId, ids: current.sourceId === sourceId ? current.ids.filter(value => value !== id) : [] })),
    arrange: () => setRequest(value => value + 1) };
}
