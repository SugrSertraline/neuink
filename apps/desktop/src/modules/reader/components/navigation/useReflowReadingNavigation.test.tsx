// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Virtualizer } from '@tanstack/react-virtual';
import { buildReflowSegmentGroups } from '../reflow/buildReflowBlocks';
import type { ReadingAdapter } from './ReadingNavigation';
import { useReflowReadingNavigation } from './useReflowReadingNavigation';

const mocks = vi.hoisted(() => ({ adapter: null as ReadingAdapter | null, unregister: vi.fn(), register: vi.fn() }));
vi.mock('./ReadingNavigation', () => ({ useReadingNavigation: () => ({ register: mocks.register }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); document.body.replaceChildren(); });

function fixture() {
  vi.useFakeTimers();
  const scroll = document.createElement('div'), row = document.createElement('div');
  row.dataset.reflowVirtualItem = ''; row.dataset.index = '0'; scroll.append(row); document.body.append(scroll);
  const layout = { start: 100, height: 120, scale: 1.25 };
  Object.defineProperties(scroll, { clientWidth: { value: 400 }, offsetWidth: { value: 400 } });
  scroll.getBoundingClientRect = () => new DOMRect(0, 40, 400 * layout.scale, 500);
  row.getBoundingClientRect = () => new DOMRect(0, 40 + (layout.start - scroll.scrollTop) * layout.scale, 400 * layout.scale, layout.height * layout.scale);
  scroll.scrollTop = 134;
  const groups = buildReflowSegmentGroups([{ uid: 'p', page_idx: 4, text: 'Text', markdown: null, bbox: null, segment_type: 'paragraph' }]);
  const index = new Map([['p', 0]]), ref = { current: scroll };
  const offsets = vi.fn((offset: number) => { scroll.scrollTop = offset; });
  const virtualizer = { scrollToIndex: () => { scroll.scrollTop = 0; }, scrollToOffset: offsets,
    getVirtualItems: () => { throw new Error('Estimated positions must not be used as retained anchors'); } } as unknown as Virtualizer<HTMLDivElement, Element>;
  mocks.register.mockImplementation((adapter: ReadingAdapter) => { mocks.adapter = adapter; return mocks.unregister; });
  const view = renderHook(() => useReflowReadingNavigation(ref, groups, virtualizer, index));
  return { scroll, layout, view, offsets, adapter: mocks.adapter! };
}

it('uses measured DOM rows and CSS scale, without drift after repeated restores', () => {
  const { scroll, layout, view, offsets, adapter } = fixture();
  const position = adapter.capture()!;
  expect(position.offset).toBeCloseTo(34 / 120);
  layout.start = 205; layout.height = 180;
  for (let i = 0; i < 100; i++) {
    adapter.restore(position);
    act(() => vi.runAllTimers());
    expect(scroll.scrollTop).toBeCloseTo(256);
    expect(adapter.capture()!.offset).toBeCloseTo(position.offset);
    expect(vi.getTimerCount()).toBe(0);
  }
  expect(offsets).toHaveBeenCalledTimes(300); // Three corrections, never an idle loop.
  view.unmount(); expect(mocks.unregister).toHaveBeenCalledOnce();
});

it('cancels all pending correction frames on navigation, user cancellation and unmount', () => {
  const { view, offsets, adapter } = fixture();
  const position = adapter.capture()!;
  adapter.restore(position); adapter.cancelRestore?.(); act(() => vi.runAllTimers());
  expect(offsets).not.toHaveBeenCalled();
  act(() => { adapter.restore(position); adapter.navigate({ pageIdx: 4, segmentUid: 'p' }); vi.runAllTimers(); });
  expect(offsets).not.toHaveBeenCalled();
  adapter.restore(position); view.unmount(); act(() => vi.runAllTimers());
  expect(offsets).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
