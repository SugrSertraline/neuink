// @vitest-environment jsdom
import { useEffect, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadingNavigationScope, useReadingNavigation, type ReadingAdapter, type ReadingPosition } from './ReadingNavigation';
import { ReadingSnapshotStore, ReadingStateRetention } from './ReadingStateRetention';

afterEach(() => { cleanup(); vi.useRealTimers(); });
function Reader({ adapter }: { adapter: ReadingAdapter }) {
  const ref = useRef<HTMLDivElement>(null);
  const nav = useReadingNavigation()!;
  useEffect(() => {
    Object.defineProperty(ref.current, 'clientWidth', { configurable: true, value: 600 });
    return nav.register(adapter, ref.current);
  }, [adapter, nav.register]);
  return <div ref={ref} data-testid="scroll">
    <button onClick={() => nav.navigate({ pageIdx: 9 })}>jump</button>
    <button disabled={!nav.canBack} onClick={nav.back}>back</button>
    <button disabled={!nav.canForward} onClick={nav.forward}>forward</button>
    <button onClick={() => nav.markJumpHandled('request-1')}>mark request</button>
    <span>{nav.hasRetainedPosition ? 'retained' : 'fresh'}</span>
    <button onClick={() => { if (!nav.isJumpHandled('request-1')) nav.navigate({ pageIdx: 1 }); }}>old request</button>
  </div>;
}
function fixture() {
  let current: ReadingPosition = { pageIdx: 4, offset: .37, left: 25, zoom: 1.25 };
  return { capture: () => ({ ...current }),
    restore: vi.fn((p: ReadingPosition) => { current = p; }),
    navigate: vi.fn(() => { current = { pageIdx: 9, offset: .15, left: 0 }; return true; }),
    cancelRestore: vi.fn() };
}
function Page({ mounted, adapter, identity = 'pdf:root:entry' }: { mounted: boolean; adapter: ReadingAdapter; identity?: string }) {
  return <ReadingStateRetention>{mounted && <ReadingNavigationScope key={identity} retentionKey={identity}><Reader adapter={adapter} /></ReadingNavigationScope>}</ReadingStateRetention>;
}
it('restores page offset, zoom, history and handled jumps after idle release, independently of heavy instances', () => {
  vi.useFakeTimers();
  const first = fixture();
  const view = render(<Page mounted adapter={first} />);
  fireEvent.click(screen.getByText('jump'));
  fireEvent.click(screen.getByText('back'));
  fireEvent.click(screen.getByText('mark request'));
  fireEvent.scroll(screen.getByTestId('scroll'));
  act(() => vi.runAllTimers());
  // Hidden containers must not replace a valid anchor with zero geometry.
  Object.defineProperty(screen.getByTestId('scroll'), 'clientWidth', { value: 0 });
  fireEvent.scroll(screen.getByTestId('scroll'));
  view.rerender(<Page mounted={false} adapter={first} />);
  const second = fixture();
  view.rerender(<Page mounted adapter={second} />);
  expect(screen.getByText('retained')).toBeTruthy();
  act(() => vi.runAllTimers());
  expect(second.restore).toHaveBeenLastCalledWith({ pageIdx: 4, offset: .37, left: 25, zoom: 1.25 });
  fireEvent.click(screen.getByText('old request'));
  expect(second.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('forward'));
  expect(second.restore).toHaveBeenLastCalledWith({ pageIdx: 9, offset: .15, left: 0 });
  view.rerender(<Page mounted adapter={second} identity="pdf:other-root:entry" />);
  expect(screen.getByText('fresh')).toBeTruthy();
  expect((screen.getByText('back') as HTMLButtonElement).disabled).toBe(true);
  view.unmount();
  render(<Page mounted adapter={fixture()} />);
  expect(screen.getByText('fresh')).toBeTruthy(); // Closing the tab releases its store.
});

it('bounds per-tab snapshots and cancels pending restores/listeners during repeated release', () => {
  vi.useFakeTimers();
  const store = new ReadingSnapshotStore();
  for (let i = 0; i < 100; i++) store.get(`document-${i}`).position = { pageIdx: i, offset: 0, left: 0 };
  expect(store.size).toBe(8);
  expect(store.get('document-0').position).toBeNull();
  const adapter = fixture();
  const view = render(<Page mounted adapter={adapter} />);
  for (let i = 0; i < 100; i++) {
    const oldElement = screen.getByTestId('scroll');
    fireEvent.scroll(oldElement);
    act(() => vi.runAllTimers());
    view.rerender(<Page mounted={false} adapter={adapter} />);
    expect(vi.getTimerCount()).toBe(0);
    const cancelled = adapter.cancelRestore.mock.calls.length;
    fireEvent.wheel(oldElement);
    expect(adapter.cancelRestore).toHaveBeenCalledTimes(cancelled);
    view.rerender(<Page mounted adapter={adapter} />);
    // Unmount before the scheduled restore runs on every second cycle.
    if (i % 2) act(() => vi.runAllTimers());
  }
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('limits navigation history to eighty positions', () => {
  let pageIdx = 0;
  const adapter: ReadingAdapter = { capture: () => ({ pageIdx, offset: 0, left: 0 }),
    navigate: () => { pageIdx += 1; return true; }, restore: vi.fn() };
  render(<Page mounted adapter={adapter} />);
  for (let i = 0; i < 120; i++) fireEvent.click(screen.getByText('jump'));
  for (let i = 0; i < 100; i++) fireEvent.click(screen.getByText('back'));
  expect(adapter.restore).toHaveBeenCalledTimes(80);
  expect((screen.getByText('back') as HTMLButtonElement).disabled).toBe(true);
});

it('retries an interrupted restore when asynchronously loaded rows replace the adapter', () => {
  vi.useFakeTimers();
  const original = fixture();
  const view = render(<Page mounted adapter={original} />);
  fireEvent.scroll(screen.getByTestId('scroll')); act(() => vi.runAllTimers());
  view.rerender(<Page mounted={false} adapter={original} />);
  const loading = fixture();
  view.rerender(<Page mounted adapter={loading} />);
  act(() => vi.advanceTimersToNextTimer()); // Restore started, measurements still pending.
  const ready = fixture();
  view.rerender(<Page mounted adapter={ready} />);
  act(() => vi.runAllTimers());
  expect(ready.restore).toHaveBeenLastCalledWith({ pageIdx: 4, offset: .37, left: 25, zoom: 1.25 });
  expect(vi.getTimerCount()).toBe(0);
});

it('gives new navigation and user scrolling priority over an old pending restoration', () => {
  vi.useFakeTimers();
  const adapter = fixture();
  const view = render(<Page mounted adapter={adapter} />);
  fireEvent.scroll(screen.getByTestId('scroll'));
  act(() => vi.runAllTimers());
  view.rerender(<Page mounted={false} adapter={adapter} />);
  view.rerender(<Page mounted adapter={adapter} />);
  fireEvent.click(screen.getByText('jump'));
  act(() => vi.runAllTimers());
  expect(adapter.restore).not.toHaveBeenCalled();
  view.rerender(<Page mounted={false} adapter={adapter} />);
  view.rerender(<Page mounted adapter={adapter} />);
  fireEvent.wheel(screen.getByTestId('scroll'));
  act(() => vi.runAllTimers());
  expect(adapter.restore).not.toHaveBeenCalled();
});
