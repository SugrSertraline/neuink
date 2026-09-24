// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import type { SourceSegment } from '@/shared/types/domain';
import { readReflowSelection, useReflowTextSelection } from './useReflowTextSelection';
const segment: SourceSegment = { uid: 's', text: 'Full paragraph context', markdown: null, page_idx: 2, segment_type: 'paragraph', bbox: null };
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.getSelection()?.removeAllRanges(); });
function select(node: HTMLElement, other = node) {
  const range = document.createRange();
  range.setStart(node.firstChild!, 0); range.setEnd(other.firstChild!, 6);
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 100, 20));
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); return selection;
}
it('captures the exact excerpt and refuses selections spanning another passage or pane', () => {
  // jsdom does not implement range geometry.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const ui = render(<><div data-testid="reader"><p data-reading-selection-source="s">Chosen words</p><p data-reading-selection-source="other">Second text</p></div><div data-testid="other-pane" /></>);
  const root = ui.getByTestId('reader'), chosen = ui.getByText('Chosen words');
  const selection = select(chosen);
  expect(readReflowSelection(root, [segment], selection)).toMatchObject({ segment, selection: { text: 'Chosen', page_idx: 2 } });
  expect(readReflowSelection(ui.getByTestId('other-pane'), [segment], selection)).toBeNull();
  expect(readReflowSelection(root, [segment], select(chosen, ui.getByText('Second text')))).toBeNull();
});
it('dismisses on reader scrolling but permits interaction inside the selection toolbar', () => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  function Reader() {
    const ref = useRef<HTMLDivElement>(null), selection = useReflowTextSelection(ref, [segment]);
    return <><div ref={ref} data-testid="reader" onPointerUp={selection.capture}><p data-reading-selection-source="s">Chosen words</p></div>
      {selection.pending ? <div data-reading-selection-toolbar><button>提问</button></div> : null}</>;
  }
  render(<Reader />); select(screen.getByText('Chosen words'));
  fireEvent.pointerUp(screen.getByTestId('reader'));
  fireEvent.pointerDown(screen.getByText('提问'));
  expect(screen.getByText('提问')).toBeTruthy();
  fireEvent.scroll(screen.getByTestId('reader'));
  expect(screen.queryByText('提问')).toBeNull();
  fireEvent.pointerUp(screen.getByTestId('reader'));
  expect(screen.getByText('提问')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByText('提问')).toBeNull();
});
