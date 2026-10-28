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
  vi.setSystemTime(new Date('2026-10-23T12:00:00'));
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [{ width: 400, height: 600 }]) as unknown as DOMRectList;
  });
  vi.mocked(readReadingState).mockResolvedValue({ entry_id: 'a', current_page_idx: null } as never);
  vi.mocked(updateReadingState).mockImplementation(async (_, entryId, update) => ({ entry_id: entryId, ...update }) as never);
});

const checkpoints = () => vi.mocked(updateReadingState).mock.calls.flatMap(([, , update]) => update.reading_session ? [update.reading_session] : []);

it('keeps one period across periodic saves and page interactions, then splits after idle', async () => {
  render(<Reader id="a" />);
  fireEvent.pointerDown(screen.getByTestId('a'));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  fireEvent.scroll(screen.getByTestId('a'));
  await act(async () => { await vi.advanceTimersByTimeAsync(75_000); });
  expect(new Set(checkpoints().map(item => item.id)).size).toBe(1);
  expect(Math.max(...checkpoints().map(item => item.active_ms))).toBe(90_000);
  fireEvent.pointerDown(screen.getByTestId('a'));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(new Set(checkpoints().map(item => item.id)).size).toBe(2);
  expect(checkpoints().slice(-1)[0].active_ms).toBe(15_000);
});

it('splits at local midnight without moving all time into the next day', async () => {
  vi.setSystemTime(new Date('2026-12-31T23:59:55'));
  render(<Reader id="a" />);
  fireEvent.pointerDown(screen.getByTestId('a'));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(checkpoints().map(item => [item.local_date, item.active_ms])).toEqual([['2026-12-31', 5_000], ['2027-01-01', 10_000]]);
});

it('ends on blur and does not count a sleep gap or merge a resumed period', async () => {
  render(<Reader id="a" />);
  fireEvent.pointerDown(screen.getByTestId('a'));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  fireEvent.blur(window);
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(Math.max(...checkpoints().map(item => item.active_ms))).toBe(15_000);
  fireEvent.focus(window);
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  const ids = new Set(checkpoints().map(item => item.id)); expect(ids.size).toBe(2);
  vi.setSystemTime(new Date(Date.now() + 600_000));
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  fireEvent.pointerDown(screen.getByTestId('a'));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(new Set(checkpoints().map(item => item.id)).size).toBe(3);
  expect(checkpoints().every(item => item.active_ms <= 15_000)).toBe(true);
});

it('retries a failed checkpoint with the same identity instead of creating another period', async () => {
  vi.mocked(updateReadingState).mockRejectedValueOnce(new Error('reply lost'));
  render(<Reader id="a" />);
  fireEvent.pointerDown(screen.getByTestId('a'));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(checkpoints()).toHaveLength(2);
  expect(checkpoints()[0].id).toBe(checkpoints()[1].id);
  expect(checkpoints().map(item => item.active_ms)).toEqual([15_000, 30_000]);
});

it('starts a new period on changing papers and never appends the previous paper time to the new one', async () => {
  const view = render(<Reader id="a" />);
  fireEvent.pointerDown(screen.getByTestId('a'));
  await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
  view.rerender(<Reader id="b" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
  const calls = vi.mocked(updateReadingState).mock.calls.filter(([, , update]) => update.reading_session);
  expect(calls.find(([, id]) => id === 'a')?.[2].reading_session?.active_ms).toBe(8_000);
  expect(calls.find(([, id]) => id === 'b')?.[2].reading_session?.active_ms).toBe(15_000);
  expect(calls[0][2].reading_session?.id).not.toBe(calls[1][2].reading_session?.id);
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
