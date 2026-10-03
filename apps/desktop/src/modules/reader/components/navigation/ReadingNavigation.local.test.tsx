// @vitest-environment jsdom
import { useEffect, useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadingNavigationScope, useReadingNavigation, type ReadingAdapter, type ReadingPosition } from './ReadingNavigation';
import { ReadingViewSession } from './ReadingViewSession';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Reader({ adapter, name, pdf }: { adapter: ReadingAdapter; name: string; pdf: boolean }) {
  const scroll = useRef<HTMLDivElement>(null);
  const navigation = useReadingNavigation()!;
  useEffect(() => {
    Object.defineProperty(scroll.current, 'clientWidth', { configurable: true, value: 600 });
    return navigation.register(adapter, scroll.current);
  }, [adapter, navigation.register]);
  return <>
    <button onClick={() => { navigation.beginUserNavigation(); navigation.remember(); adapter.navigate({ pageIdx: 10 }); }}>{name} toolbar page</button>
    <button onClick={() => { navigation.beginUserNavigation(); adapter.restore({ ...adapter.capture()!, zoom: 2 }); }}>{name} toolbar zoom</button>
    <div ref={scroll} data-testid={name}>
    <button onClick={() => {
      navigation.markJumpHandled('citation', { localOnly: true });
      if (pdf) { navigation.remember(); adapter.navigate({ pageIdx: 9 }); }
      else navigation.navigate({ pageIdx: 9, focus: false }, { localOnly: true });
    }}>{name} citation</button>
  </div></>;
}

function fixture() {
  let position: ReadingPosition = { pageIdx: 0, offset: 0, left: 0 };
  return {
    capture: () => position,
    navigate: vi.fn((target: { pageIdx: number }) => { position = { ...position, pageIdx: target.pageIdx }; return true; }),
    restore: vi.fn((next: ReadingPosition) => { position = next; })
  };
}

it.each(['pdf', 'reflow'] as const)('keeps a targeted %s jump local, then resumes linking on user input', kind => {
  vi.useFakeTimers();
  const target = fixture(), peer = fixture();
  const ui = render(<>
    <ReadingViewSession workspaceRoot="w" active surface={{ kind, entryId: 'e' }}>
      <ReadingNavigationScope><Reader adapter={target} name="target" pdf={kind === 'pdf'} /></ReadingNavigationScope>
    </ReadingViewSession>
    <ReadingViewSession workspaceRoot="w" active surface={{ kind, entryId: 'e', viewId: 'copy' }}>
      <ReadingNavigationScope><Reader adapter={peer} name="peer" pdf={kind === 'pdf'} /></ReadingNavigationScope>
    </ReadingViewSession>
  </>);
  peer.restore.mockClear();
  fireEvent.click(ui.getByText('target citation'));
  fireEvent.scroll(ui.getByTestId('target'));
  act(() => vi.runAllTimers());
  expect(target.capture().pageIdx).toBe(9);
  expect(peer.restore).not.toHaveBeenCalled();
  // Delayed virtual row/zoom corrections are still part of the local jump.
  fireEvent.scroll(ui.getByTestId('target'));
  act(() => vi.runAllTimers());
  expect(peer.restore).not.toHaveBeenCalled();
  fireEvent.wheel(ui.getByTestId('target'));
  fireEvent.scroll(ui.getByTestId('target'));
  act(() => vi.runAllTimers());
  expect(peer.restore).toHaveBeenCalledOnce();
  expect(peer.restore.mock.calls[0][0].pageIdx).toBe(9);
});

it.each(['page', 'zoom'])('resumes linking on explicit toolbar %s navigation after a local citation', action => {
  vi.useFakeTimers();
  const target = fixture(), peer = fixture();
  const ui = render(<>
    <ReadingViewSession workspaceRoot="w" active surface={{ kind: 'pdf', entryId: 'e' }}>
      <ReadingNavigationScope><Reader adapter={target} name="target" pdf /></ReadingNavigationScope>
    </ReadingViewSession>
    <ReadingViewSession workspaceRoot="w" active surface={{ kind: 'pdf', entryId: 'e', viewId: 'copy' }}>
      <ReadingNavigationScope><Reader adapter={peer} name="peer" pdf /></ReadingNavigationScope>
    </ReadingViewSession>
  </>);
  peer.restore.mockClear();
  fireEvent.click(ui.getByText('target citation'));
  fireEvent.scroll(ui.getByTestId('target')); act(() => vi.runAllTimers());
  expect(peer.restore).not.toHaveBeenCalled();
  // Controls are outside the scroll owner, so no scroll-container pointer/wheel
  // event can accidentally make this regression pass.
  fireEvent.click(ui.getByText(`target toolbar ${action}`));
  fireEvent.scroll(ui.getByTestId('target')); act(() => vi.runAllTimers());
  expect(peer.restore).toHaveBeenCalledOnce();
  expect(peer.restore.mock.calls[0][0].pageIdx).toBe(action === 'page' ? 10 : 9);
  expect(peer.restore.mock.calls[0][0].zoom).toBeUndefined();
  peer.restore.mockClear();
  fireEvent.click(ui.getByText('target citation'));
  fireEvent.scroll(ui.getByTestId('target')); act(() => vi.runAllTimers());
  expect(peer.restore).not.toHaveBeenCalled();
});
