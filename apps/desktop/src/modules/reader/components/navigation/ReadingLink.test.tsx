// @vitest-environment jsdom
import { useEffect, useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReadingLinkMode } from '@/shared/lib/readerPreferences';
import { ReadingNavigationScope, useReadingNavigation, type ReadingAdapter, type ReadingPosition } from './ReadingNavigation';
import { ReadingViewSession } from './ReadingViewSession';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function fixture(pageIdx = 0) {
  let position: ReadingPosition = { pageIdx, offset: .25, left: 17, zoom: 1.25 };
  return {
    capture: () => ({ ...position }),
    set: (next: Partial<ReadingPosition>) => { position = { ...position, ...next }; },
    restore: vi.fn((next: ReadingPosition) => { position = next; }),
    navigate: vi.fn((target: { pageIdx: number; segmentUid?: string }) => { position = { ...position, pageIdx: target.pageIdx, segmentUid: target.segmentUid }; return true; }),
    cancelRestore: vi.fn(),
  };
}
function Reader({ name, adapter }: { name: string; adapter: ReadingAdapter }) {
  const ref = useRef<HTMLDivElement>(null), nav = useReadingNavigation()!;
  useEffect(() => {
    Object.defineProperty(ref.current, 'clientWidth', { configurable: true, value: 500 });
    return nav.register(adapter, ref.current);
  }, [adapter, nav.register]);
  return <>
    <button onClick={() => { nav.beginUserNavigation(); adapter.navigate({ pageIdx: 6 }); }}>{name} page</button>
    <div ref={ref} data-testid={name}>
      <button onClick={() => nav.linkTarget({ pageIdx: 4, segmentUid: 's', sentenceIndex: 2 })}>{name} block</button>
      <button onClick={() => nav.navigate({ pageIdx: 3, segmentUid: 'rail' })}>{name} rail</button>
      <button onClick={() => nav.navigate({ pageIdx: 5 }, { localOnly: true })}>{name} citation</button>
    </div>
    <output data-testid={`${name}-sentence`}>{nav.linkedTarget?.sentenceIndex}</output>
  </>;
}
function Pair({ left, right, mode = 'scroll', kind = 'pdf', active = true, root = 'w', entry = 'e' }: {
  left: ReadingAdapter; right: ReadingAdapter; mode?: ReadingLinkMode; kind?: 'pdf' | 'reflow'; active?: boolean; root?: string; entry?: string;
}) {
  return <>
    <ReadingViewSession workspaceRoot="w" active surface={{ kind: 'pdf', entryId: 'e' }} linkMode={mode}>
      <ReadingNavigationScope><Reader name="L" adapter={left} /></ReadingNavigationScope>
    </ReadingViewSession>
    <ReadingViewSession workspaceRoot={root} active={active} surface={{ kind, entryId: entry, viewId: 'copy' }} linkMode={mode}>
      <ReadingNavigationScope><Reader name="R" adapter={right} /></ReadingNavigationScope>
    </ReadingViewSession>
  </>;
}
function tick() { act(() => vi.runAllTimers()); }

it.each(['pdf', 'reflow'] as const)('synchronizes scroll in both directions with a %s peer, coalesces frames and prevents echo', kind => {
  vi.useFakeTimers(); const left = fixture(), right = fixture();
  const ui = render(<Pair left={left} right={right} kind={kind} />);
  left.restore.mockClear(); right.restore.mockClear();
  fireEvent.wheel(ui.getByTestId('L')); left.set({ pageIdx: 2, segmentUid: 'p', segmentOffset: .4 });
  for (let i = 0; i < 20; i++) fireEvent.scroll(ui.getByTestId('L'));
  tick(); expect(right.restore).toHaveBeenCalledOnce();
  expect(right.restore.mock.calls[0][0]).toMatchObject({ pageIdx: 2, segmentUid: 'p', segmentOffset: .4, left: 17, zoom: undefined });
  expect(right.restore.mock.calls[0][0].sourceKind).toBe(kind === 'reflow' ? 'pdf' : undefined);
  fireEvent.scroll(ui.getByTestId('R')); tick(); expect(left.restore).not.toHaveBeenCalled();
  fireEvent.wheel(ui.getByTestId('R')); right.set({ pageIdx: 7 }); fireEvent.scroll(ui.getByTestId('R')); tick();
  expect(left.restore).toHaveBeenCalledOnce(); expect(left.capture().pageIdx).toBe(7);
  fireEvent.scroll(ui.getByTestId('L')); tick(); expect(right.restore).toHaveBeenCalledOnce();
});

it.each(['pdf', 'reflow'] as const)('keeps manual scrolling independent in click mode but links clicks to a %s peer without stealing focus', kind => {
  vi.useFakeTimers(); const left = fixture(1), right = fixture(8);
  const ui = render(<Pair left={left} right={right} kind={kind} mode="click" />);
  expect(right.restore).not.toHaveBeenCalled();
  for (const side of ['L', 'R']) { fireEvent.wheel(ui.getByTestId(side)); fireEvent.scroll(ui.getByTestId(side)); tick(); }
  expect(right.restore).not.toHaveBeenCalled(); expect(left.restore).not.toHaveBeenCalled();
  ui.getByText('L block').focus(); fireEvent.click(ui.getByText('L block'));
  expect(left.capture().pageIdx).toBe(1);
  expect(right.navigate).toHaveBeenLastCalledWith({ pageIdx: 4, segmentUid: 's', sentenceIndex: 2, focus: false });
  expect(document.activeElement).toBe(ui.getByText('L block'));
  expect(ui.getByTestId('R-sentence').textContent).toBe('2');
  fireEvent.scroll(ui.getByTestId('R')); tick(); expect(left.navigate).not.toHaveBeenCalled();
  fireEvent.wheel(ui.getByTestId('R')); fireEvent.scroll(ui.getByTestId('R')); tick();
  expect(ui.getByTestId('R-sentence').textContent).toBe(''); expect(left.navigate).not.toHaveBeenCalled();
  fireEvent.click(ui.getByText('R block')); expect(left.navigate).toHaveBeenCalledOnce();
});

it('links navigation and toolbar clicks in click mode, preserving explicitly targeted citations', () => {
  vi.useFakeTimers(); const left = fixture(), right = fixture();
  const ui = render(<Pair left={left} right={right} mode="click" />);
  fireEvent.click(ui.getByText('L rail')); expect(right.capture().pageIdx).toBe(3);
  right.navigate.mockClear(); fireEvent.click(ui.getByText('L citation'));
  fireEvent.scroll(ui.getByTestId('L')); tick(); expect(right.navigate).not.toHaveBeenCalled();
  fireEvent.click(ui.getByText('L page')); fireEvent.scroll(ui.getByTestId('L')); tick();
  expect(right.capture().pageIdx).toBe(6);
  right.navigate.mockClear(); fireEvent.wheel(ui.getByTestId('L')); fireEvent.scroll(ui.getByTestId('L')); tick();
  expect(right.navigate).not.toHaveBeenCalled();
});

it('changes modes without moving either side or publishing a queued scroll; resumes on the next user action', () => {
  vi.useFakeTimers(); const left = fixture(), right = fixture();
  const ui = render(<Pair left={left} right={right} />); right.restore.mockClear();
  fireEvent.wheel(ui.getByTestId('L')); left.set({ pageIdx: 2 }); fireEvent.scroll(ui.getByTestId('L'));
  ui.rerender(<Pair left={left} right={right} mode="click" />); tick();
  expect(right.restore).not.toHaveBeenCalled(); expect(right.navigate).not.toHaveBeenCalled();
  left.set({ pageIdx: 7 }); fireEvent.scroll(ui.getByTestId('L')); tick();
  ui.rerender(<Pair left={left} right={right} />); tick();
  expect(right.restore).not.toHaveBeenCalled();
  fireEvent.wheel(ui.getByTestId('L')); fireEvent.scroll(ui.getByTestId('L')); tick();
  expect(right.capture().pageIdx).toBe(7); expect(right.restore).toHaveBeenCalledOnce();
  ui.unmount(); tick(); expect(vi.getTimerCount()).toBe(0);
});

it.each([{ active: false }, { root: 'other' }, { entry: 'other' }])('isolates hidden readers, workspaces and papers: %j', options => {
  vi.useFakeTimers(); const left = fixture(), right = fixture();
  const ui = render(<Pair left={left} right={right} {...options} />); right.restore.mockClear();
  fireEvent.click(ui.getByText('L block')); fireEvent.wheel(ui.getByTestId('L')); fireEvent.scroll(ui.getByTestId('L')); tick();
  expect(right.navigate).not.toHaveBeenCalled(); expect(right.restore).not.toHaveBeenCalled();
});

it('ignores unavailable geometry and failed peer navigation without creating a linked sentence', () => {
  vi.useFakeTimers(); const left = fixture(), right = fixture();
  const ui = render(<Pair left={left} right={right} mode="click" />);
  Object.defineProperty(ui.getByTestId('R'), 'clientWidth', { configurable: true, value: 0 });
  fireEvent.click(ui.getByText('L block')); expect(right.navigate).not.toHaveBeenCalled();
  Object.defineProperty(ui.getByTestId('R'), 'clientWidth', { configurable: true, value: 500 });
  right.navigate.mockReturnValueOnce(false); fireEvent.click(ui.getByText('L block'));
  expect(ui.getByTestId('R-sentence').textContent).toBe('');
});
