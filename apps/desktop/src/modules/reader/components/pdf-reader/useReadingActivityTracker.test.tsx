// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readReadingState, updateReadingState } from '@/shared/ipc/workspaceApi';
import { ReadingSessionContext } from '../../parallel-reading/ReadingSessionContext';
import { useReadingActivityTracker } from './useReadingActivityTracker';

vi.mock('@/shared/ipc/workspaceApi', () => ({ readReadingState: vi.fn(), updateReadingState: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [{ width: 400, height: 600 }]) as unknown as DOMRectList;
  });
  vi.mocked(readReadingState).mockResolvedValue({ entry_id: 'a', current_page_idx: null } as never);
  vi.mocked(updateReadingState).mockImplementation(async (_, entryId, update) => ({ entry_id: entryId, ...update }) as never);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const pages = [0];
function Reader({ id }: { id: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useReadingActivityTracker({ enabled: true, entryId: id, mode: 'pdf', pageCount: 2, scrollRef, visiblePageIndexes: pages, workspaceRoot: 'root' });
  return <div ref={scrollRef} data-testid={id}>paper {id}</div>;
}

it('counts only the last interacted visible reader, not both panes or hidden tabs', async () => {
  render(<><Reader id="a" /><Reader id="b" /><div hidden><Reader id="hidden" /></div></>);
  await act(async () => { await Promise.resolve(); });
  fireEvent.pointerDown(screen.getByTestId('b'));
  await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
  const calls = vi.mocked(updateReadingState).mock.calls;
  const active = (id: string) => calls.filter(([, entry]) => entry === id).reduce((sum, [, , update]) => sum + update.active_ms_delta, 0);
  expect(active('b')).toBeGreaterThan(0);
  expect(active('a')).toBe(0); expect(active('hidden')).toBe(0);
});

it('does not mark a background comparison ready until its session is active', async () => {
  const ready = vi.fn();
  const view = render(<ReadingSessionContext.Provider value={{ active: false, onReady: ready }}><Reader id="a" /></ReadingSessionContext.Provider>);
  await act(async () => { await Promise.resolve(); });
  expect(ready).not.toHaveBeenCalled();
  view.rerender(<ReadingSessionContext.Provider value={{ active: true, onReady: ready }}><Reader id="a" /></ReadingSessionContext.Provider>);
  expect(ready).toHaveBeenCalledOnce();
});
