import { useEffect, useRef, useState, type RefObject } from 'react';
import { readReadingState, updateReadingState } from '@/shared/ipc/workspaceApi';
import { emitReadingStateUpdated } from '@/shared/lib/readingStateEvents';
import type { EntryReadingState, ReadingMode } from '@/shared/types/domain';
import { useReadingSession } from '../../parallel-reading/ReadingSessionContext';
import { ReadingSessionBuffer } from './readingSessionBuffer';

const IDLE_AFTER_MS = 60_000;
const FLUSH_EVERY_MS = 15_000;
const PAGE_VISIT_AFTER_MS = 2_000;
const readerIsVisible = (element: HTMLElement | null) => Boolean(element?.isConnected && element.getClientRects().length);
type ActiveReader = { element: HTMLElement | null; finish: () => void };
let activeReader: ActiveReader | null = null;

export function useReadingActivityTracker({ enabled, entryId, mode, pageCount, scrollRef, visiblePageIndexes, workspaceRoot }: {
  enabled: boolean; entryId: string; mode: ReadingMode; pageCount: number;
  scrollRef: RefObject<HTMLDivElement>; visiblePageIndexes: number[]; workspaceRoot: string | null;
}) {
  const session = useReadingSession();
  const sessionRef = useRef(session); sessionRef.current = session;
  const visiblePagesRef = useRef(visiblePageIndexes); visiblePagesRef.current = visiblePageIndexes;
  const contextRef = useRef(''); contextRef.current = `${workspaceRoot}:${entryId}`;
  const [savedState, setSavedState] = useState<EntryReadingState | null>(null);
  useEffect(() => {
    if (enabled && pageCount > 0 && session?.active) session.onReady();
  }, [enabled, pageCount, session?.active, session?.onReady]);

  useEffect(() => {
    setSavedState(null);
    if (!workspaceRoot || !enabled || pageCount <= 0) return;
    const context = `${workspaceRoot}:${entryId}`;
    const container = scrollRef.current;
    const interactionRoot = container?.closest('[data-reading-frame]') ?? container?.closest('.workspace-pane-surface') ?? container;
    const buffer = new ReadingSessionBuffer();
    const acknowledged = new Map<string, number>();
    const dwell = new Map<number, number>();
    const visited = new Set<number>();
    let alive = true, flushing = false, finalRetries = 0;
    let lastInteraction = Date.now(), lastTick = Date.now(), sentLocation = '';
    let autoClaim = true, wasVisible = readerIsVisible(container);
    const publish = (state: EntryReadingState) => {
      if (contextRef.current !== context) return;
      if (alive) setSavedState(state);
      emitReadingStateUpdated(state);
    };
    void readReadingState(workspaceRoot, entryId).then(state => { if (alive) publish(state); }).catch(() => undefined);

    async function flush() {
      if (flushing) return;
      const location = visiblePagesRef.current.join(',');
      const snapshots = buffer.snapshots();
      const pages = [...visited];
      if (!snapshots.length && !pages.length && location === sentLocation) return;
      const currentPage = visiblePagesRef.current[0] ?? null;
      // Capture location before waiting: another paper may reuse this component while IPC is pending.
      flushing = true;
      let success = false;
      try {
        for (const snapshot of snapshots.length ? snapshots : [undefined]) {
          const state = await updateReadingState(workspaceRoot!, entryId, {
            mode, current_page_idx: currentPage, page_count: pageCount, visited_pages: pages,
            active_ms_delta: snapshot ? snapshot.active_ms - (acknowledged.get(snapshot.id) ?? 0) : 0,
            session_start: false, local_date: snapshot?.local_date ?? null, reading_session: snapshot,
          });
          if (snapshot) { buffer.acknowledge(snapshot); acknowledged.set(snapshot.id, snapshot.active_ms); }
          pages.forEach(page => visited.delete(page));
          sentLocation = location;
          publish(state);
        }
        success = true;
      } catch {
        // Keep exact checkpoints for the next flush. Backend replay is idempotent even if its reply was lost.
      } finally {
        flushing = false;
        if (!alive && buffer.snapshots().length && (success || finalRetries++ < 3)) {
          window.setTimeout(() => { void flush(); }, success ? 0 : 1_000);
        }
      }
    }

    const owner: ActiveReader = { element: container, finish: () => {
      sample(Date.now()); buffer.end(); autoClaim = false;
      if (activeReader === owner) activeReader = null;
      void flush();
    } };
    function sample(now: number) {
      const start = lastTick;
      lastTick = now;
      const eligible = activeReader === owner && sessionRef.current?.active !== false && readerIsVisible(container)
        && document.visibilityState === 'visible' && document.hasFocus() && visiblePagesRef.current.length > 0;
      // Sleep, clock changes and suspended event loops end a period; never credit the missing wall time.
      if (!eligible || now < start || now - start > 2_000) { buffer.end(); return; }
      const end = Math.min(now, lastInteraction + IDLE_AFTER_MS);
      if (end > start) {
        buffer.add(start, end);
        for (const page of visiblePagesRef.current) {
          const value = (dwell.get(page) ?? 0) + end - start;
          dwell.set(page, value);
          if (value >= PAGE_VISIT_AFTER_MS) visited.add(page);
        }
      }
      if (now >= lastInteraction + IDLE_AFTER_MS) buffer.end();
    }
    const markInteraction = (event?: Event) => {
      if (event && event.target instanceof Node && !interactionRoot?.contains(event.target)) {
        if (activeReader === owner && (event.type === 'pointerdown' || event.type === 'keydown')) owner.finish();
        return;
      }
      if (sessionRef.current?.active === false || !readerIsVisible(container)) return;
      const now = Date.now(); sample(now);
      if (activeReader !== owner) activeReader?.finish();
      activeReader = owner; autoClaim = true;
      lastInteraction = now; lastTick = now;
    };
    container?.addEventListener('scroll', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction);
    window.addEventListener('pointerdown', markInteraction);
    window.addEventListener('wheel', markInteraction, { passive: true });
    const tick = window.setInterval(() => {
      const visible = readerIsVisible(container) && sessionRef.current?.active !== false;
      if (!visible && wasVisible) owner.finish();
      if (visible && !wasVisible) { autoClaim = true; lastInteraction = Date.now(); lastTick = lastInteraction; }
      wasVisible = visible;
      if (activeReader && !readerIsVisible(activeReader.element)) activeReader.finish();
      if (!activeReader && visible && autoClaim) activeReader = owner;
      sample(Date.now());
    }, 1_000);
    const timer = window.setInterval(() => { void flush(); }, FLUSH_EVERY_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') owner.finish();
      else { lastTick = Date.now(); autoClaim = true; lastInteraction = lastTick; }
    };
    const onBlur = () => owner.finish();
    const onFocus = () => { lastTick = Date.now(); lastInteraction = lastTick; autoClaim = true; };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      owner.finish(); alive = false;
      window.clearInterval(tick); window.clearInterval(timer);
      container?.removeEventListener('scroll', markInteraction);
      window.removeEventListener('keydown', markInteraction); window.removeEventListener('pointerdown', markInteraction); window.removeEventListener('wheel', markInteraction);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus);
    };
  }, [enabled, entryId, mode, pageCount, workspaceRoot, scrollRef]);
  return savedState;
}
