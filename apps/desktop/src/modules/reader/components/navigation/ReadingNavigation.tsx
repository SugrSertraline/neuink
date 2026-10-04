import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { SourceSegment } from '@/shared/types/domain';
import { useRetainedReadingSnapshot } from './ReadingStateRetention';
import { useReadingViewSession, publishReadingView, subscribeReadingView } from './ReadingViewSession';

export type ReadingTarget = { pageIdx: number; segmentUid?: string; rect?: readonly [number, number, number, number]; focus?: boolean };
export type ReadingPosition = { pageIdx: number; segmentUid?: string; segmentOffset?: number; offset: number; left: number; zoom?: number };
export type ReadingAdapter = {
  capture: () => ReadingPosition | null;
  restore: (position: ReadingPosition) => void;
  navigate: (target: ReadingTarget) => boolean;
  cancelRestore?: () => void;
};
type Navigation = {
  canBack: boolean; canForward: boolean;
  back: () => void; forward: () => void;
  remember: () => void;
  beginUserNavigation: () => void;
  navigate: (target: ReadingTarget, options?: { localOnly?: boolean }) => boolean;
  register: (adapter: ReadingAdapter, scroll?: HTMLElement | null) => () => void;
  hasRetainedPosition: boolean;
  isJumpHandled: (key: string) => boolean;
  markJumpHandled: (key: string, options?: { localOnly?: boolean }) => void;
};
const Context = createContext<Navigation | null>(null);
const LIMIT = 80;
export const segmentTarget = (segment: SourceSegment): ReadingTarget => ({
  pageIdx: segment.page_idx, segmentUid: segment.uid, rect: segment.bbox ?? undefined
});
function samePosition(a: ReadingPosition | undefined, b: ReadingPosition) {
  return a?.pageIdx === b.pageIdx && a.segmentUid === b.segmentUid && a.zoom === b.zoom && Math.abs(a.offset - b.offset) < .002 && Math.abs(a.left - b.left) < 2;
}

export function ReadingNavigationScope({ children, retentionKey }: { children: ReactNode; retentionKey?: string }) {
  const view = useReadingViewSession(), viewRef = useRef(view); viewRef.current = view;
  const snapshot = useRetainedReadingSnapshot(retentionKey);
  const hasRetainedPosition = useRef(Boolean(snapshot.position)).current;
  const needsRestore = useRef(hasRetainedPosition);
  const adapter = useRef<ReadingAdapter | null>(null);
  const stacks = useRef(snapshot);
  const cancelPending = useRef<() => void>(() => {});
  const claimNavigation = useRef<(localOnly?: boolean) => void>(() => {});
  const localNavigation = useRef(false);
  const [, refresh] = useState(0);
  const beginUserNavigation = useCallback(() => {
    claimNavigation.current(false);
    needsRestore.current = false;
    cancelPending.current();
  }, []);
  const remember = useCallback(() => {
    const position = adapter.current?.capture();
    if (!position) return;
    if (!samePosition(stacks.current.back[stacks.current.back.length - 1], position)) {
      stacks.current.back = [...stacks.current.back.slice(-(LIMIT - 1)), position];
    }
    stacks.current.forward = []; refresh(n => n + 1);
  }, []);
  const travel = useCallback((direction: 'back' | 'forward') => {
    if (!adapter.current) return;
    needsRestore.current = false;
    claimNavigation.current();
    cancelPending.current();
    const position = stacks.current[direction].pop();
    const current = adapter.current?.capture();
    if (!position) return;
    if (current) stacks.current[direction === 'back' ? 'forward' : 'back'].push(current);
    adapter.current.restore(position); refresh(n => n + 1);
  }, []);
  const register = useCallback((next: ReadingAdapter, scroll?: HTMLElement | null) => {
    adapter.current = next;
    let frame = 0;
    let captureFrame = 0;
    let restoring = false;
    let following = false;
    claimNavigation.current = (localOnly = false) => { following = false; localNavigation.current = localOnly; };
    const identity = viewRef.current;
    const unlink = identity ? subscribeReadingView(identity.group, { id: identity.id,
      capture: () => viewRef.current?.active ? next.capture() : null,
      receive: position => {
      const current = viewRef.current;
      if (!current?.active || !scroll || scroll.clientWidth <= 0) return;
      following = true;
      needsRestore.current = false;
      const local = next.capture();
      next.restore({ ...position, zoom: undefined, left: local?.left ?? 0 });
    } }) : () => {};
    const capture = () => {
      if (restoring || (scroll && scroll.clientWidth <= 0)) return;
      const position = next.capture();
      if (position) snapshot.position = { ...position };
      const current = viewRef.current;
      if (position && current?.active && !following && !localNavigation.current) publishReadingView(current.group, current.id, position);
    };
    const onScroll = () => {
      // The virtualizer commits measured rows during the scroll event. Reading
      // geometry synchronously can retain a row from the previous layout.
      cancelAnimationFrame(captureFrame);
      captureFrame = requestAnimationFrame(capture);
    };
    const cancel = () => { cancelAnimationFrame(frame); restoring = false; next.cancelRestore?.(); };
    cancelPending.current = cancel;
    const onInput = () => { following = false; localNavigation.current = false; needsRestore.current = false; cancel(); };
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) onInput();
    };
    if (needsRestore.current && snapshot.position) {
      restoring = true;
      const position = { ...snapshot.position };
      frame = requestAnimationFrame(() => {
        next.restore(position);
        // PDF zoom and virtual row measurements may each need another frame.
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => { needsRestore.current = false; restoring = false; capture(); });
          });
        });
      });
    }
    scroll?.addEventListener('scroll', onScroll, { passive: true });
    scroll?.addEventListener('wheel', onInput, { passive: true });
    scroll?.addEventListener('pointerdown', onInput);
    scroll?.addEventListener('keydown', onKey);
    return () => {
      // Unmount cleanup runs after DOM removal/virtualizer teardown; it is too
      // late to capture reliable geometry. Keep the last visible scroll sample.
      cancelAnimationFrame(captureFrame); cancel();
      unlink();
      scroll?.removeEventListener('scroll', onScroll);
      scroll?.removeEventListener('wheel', onInput);
      scroll?.removeEventListener('pointerdown', onInput);
      scroll?.removeEventListener('keydown', onKey);
      if (adapter.current === next) { adapter.current = null; cancelPending.current = () => {}; }
    };
  }, []);
  const isJumpHandled = useCallback((key: string) => snapshot.lastJump === key, [snapshot]);
  const markJumpHandled = useCallback((key: string, options?: { localOnly?: boolean }) => {
    // A citation addresses one view, not every same-document peer. Resume normal
    // position linking after the next user scroll/navigation gesture.
    claimNavigation.current(options?.localOnly);
    snapshot.lastJump = key; needsRestore.current = false; cancelPending.current();
  }, [snapshot]);
  const navigate = useCallback((target: ReadingTarget, options?: { localOnly?: boolean }) => {
    claimNavigation.current(options?.localOnly);
    needsRestore.current = false; cancelPending.current();
    const position = adapter.current?.capture();
    if (!adapter.current?.navigate(target)) return false;
    if (position && !samePosition(stacks.current.back[stacks.current.back.length - 1], position)) {
      stacks.current.back = [...stacks.current.back.slice(-(LIMIT - 1)), position];
    }
    stacks.current.forward = []; refresh(n => n + 1); return true;
  }, []);
  return <Context.Provider value={{ canBack: stacks.current.back.length > 0, canForward: stacks.current.forward.length > 0,
    back: () => travel('back'), forward: () => travel('forward'), remember, beginUserNavigation, navigate, register,
    hasRetainedPosition, isJumpHandled, markJumpHandled }}>
    <div className="contents" onKeyDown={event => {
      if (!event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      if ((event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return;
      event.preventDefault(); event.stopPropagation(); travel(event.key === 'ArrowLeft' ? 'back' : 'forward');
    }}>{children}</div>
  </Context.Provider>;
}
export function useReadingNavigation() { return useContext(Context); }
