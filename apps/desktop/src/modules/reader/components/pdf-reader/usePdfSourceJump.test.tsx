// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePdfSourceJump } from './usePdfSourceJump';
import type { PdfJumpRequest } from '../../types';

const frames = new Map<number, FrameRequestCallback>();
let counter = 0;
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++counter, callback); return counter; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { cleanup(); frames.clear(); vi.unstubAllGlobals(); });
const flush = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); });
const request: PdfJumpRequest = { kind: 'segment', segmentUid: 's', pageIdx: 3, requestKey: 1, targetSurfaceKey: 'pdf:p' };

it('waits for loading and uses fresh navigation after rerenders, acknowledging only after scrolling', () => {
  const events: string[] = [];
  const navigate = vi.fn(() => { events.push('scroll'); return true; });
  const markHandled = vi.fn(() => events.push('handled'));
  const ui = renderHook(({ ready, navigate }) => usePdfSourceJump({ entryId: 'p', request, ready, navigate, markHandled }),
    { initialProps: { ready: false, navigate } });
  flush(); expect(navigate).not.toHaveBeenCalled();
  ui.rerender({ ready: true, navigate });
  const refreshed = vi.fn(() => { events.push('scroll'); return true; });
  ui.rerender({ ready: true, navigate: refreshed });
  expect(markHandled).not.toHaveBeenCalled();
  flush();
  expect(navigate).not.toHaveBeenCalled();
  expect(refreshed).toHaveBeenCalledWith(request);
  expect(events).toEqual(['scroll', 'handled']);
  expect(markHandled).toHaveBeenCalledWith('p:1', { localOnly: true });
});

it('does not acknowledge a cancelled frame or a blocked navigation, and accepts the next evidence', () => {
  const navigate = vi.fn(() => false), markHandled = vi.fn();
  const ui = renderHook(({ request }) => usePdfSourceJump({ entryId: 'p', request, ready: true, navigate, markHandled }),
    { initialProps: { request: request as PdfJumpRequest | null } });
  ui.rerender({ request: null }); flush();
  expect(navigate).not.toHaveBeenCalled();
  ui.rerender({ request }); flush();
  expect(markHandled).not.toHaveBeenCalled();
  navigate.mockReturnValue(true);
  const next = { ...request, requestKey: 2 };
  ui.rerender({ request: next }); flush();
  expect(markHandled).toHaveBeenCalledWith('p:2', { localOnly: true });
});
