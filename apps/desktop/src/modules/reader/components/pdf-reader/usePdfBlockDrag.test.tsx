// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pdfBlockDrag, type PdfBlockDragItem } from '@/shared/lib/pdfBlockDrag';
import { usePdfBlockDrag } from './usePdfBlockDrag';

class Pointer extends MouseEvent {
  pointerId: number;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 7; this.isPrimary = init.isPrimary ?? true; }
}
beforeEach(() => vi.stubGlobal('PointerEvent', Pointer));
afterEach(() => { cleanup(); pdfBlockDrag.cancel(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const item: PdfBlockDragItem = { entryId: 'paper', workspaceRoot: 'library', bbox: [100, 200, 800, 400],
  segment: { uid: 'paragraph', page_idx: 2, text: 'Block text', markdown: 'Block text' } as PdfBlockDragItem['segment'] };

function Harness({ context = 'paper', enabled = true, onClick = () => {} }: { context?: string; enabled?: boolean; onClick?: () => void }) {
  const drag = usePdfBlockDrag(context, enabled);
  return <div data-testid="page" data-ready={drag.ctrlHeld} data-pending={Boolean(drag.dragItem)}
    onPointerDownCapture={event => drag.start(event, item)}
    onPointerMove={drag.pointerHandlers.onPointerMove} onPointerUp={drag.pointerHandlers.onPointerUp}
    onPointerCancel={drag.pointerHandlers.onPointerCancel} onLostPointerCapture={drag.pointerHandlers.onLostPointerCapture}
    onClickCapture={event => { if (drag.consumeClick()) event.stopPropagation(); }} onClick={onClick}>
    <span>Selectable PDF text</span><button type="button">Existing action</button><a href="#reference">Reference</a>
  </div>;
}
function setup() {
  const onClick = vi.fn();
  const view = render(<Harness onClick={onClick} />);
  const page = view.getByTestId('page');
  Object.assign(page, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  const text = view.getByText('Selectable PDF text');
  const down = (init: PointerEventInit = {}) => fireEvent.pointerDown(text, { button: 0, buttons: 1, pointerId: 7, ctrlKey: true, clientX: 20, clientY: 20, ...init });
  const move = (init: PointerEventInit = {}) => fireEvent.pointerMove(page, { buttons: 1, pointerId: 7, clientX: 600, clientY: 200, ...init });
  const up = (init: PointerEventInit = {}) => fireEvent.pointerUp(page, { button: 0, pointerId: 7, clientX: 600, clientY: 200, ...init });
  const target = document.createElement('div');
  document.body.append(target);
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(500, 100, 300, 250));
  const onDrop = vi.fn();
  const unregister = pdfBlockDrag.register({ element: target, onDrop });
  return { ...view, page, text, down, move, up, onClick, onDrop, target, dispose: () => { unregister(); target.remove(); } };
}

it('captures Ctrl at pointerdown, keeps the block when Ctrl is released, drops once and consumes its click', () => {
  const ui = setup();
  try {
    expect(ui.down()).toBe(false);
    expect(ui.page.setPointerCapture).toHaveBeenCalledWith(7);
    fireEvent.keyUp(window, { key: 'Control', ctrlKey: false });
    ui.move({ ctrlKey: false });
    ui.up({ pointerId: 8 });
    expect(ui.onDrop).not.toHaveBeenCalled();
    ui.up(); ui.up(); fireEvent.click(ui.page);
    expect(ui.onDrop).toHaveBeenCalledOnce();
    expect(ui.onDrop.mock.calls[0][0].segment).toBe(item.segment);
    expect(ui.onClick).not.toHaveBeenCalled();
    expect(document.body.style.userSelect).toBe('');
  } finally { ui.dispose(); }
});
it('leaves native selection alone, including pressing Ctrl after dragging has started', () => {
  const ui = setup();
  try {
    expect(ui.down({ ctrlKey: false })).toBe(true);
    ui.move({ ctrlKey: true }); ui.up({ ctrlKey: true });
    expect(ui.page.setPointerCapture).not.toHaveBeenCalled();
    expect(ui.onDrop).not.toHaveBeenCalled();
    expect(document.body.style.userSelect).toBe('');
  } finally { ui.dispose(); }
});
it('does not add or select a block for a Ctrl click below the threshold', () => {
  const ui = setup();
  try {
    ui.down(); ui.move({ clientX: 23, clientY: 20 }); ui.up({ clientX: 23, clientY: 20 }); fireEvent.click(ui.text);
    expect(ui.onClick).not.toHaveBeenCalled(); expect(ui.onDrop).not.toHaveBeenCalled();
    // If no compatibility click follows cancellation, the next ordinary gesture is still usable.
    ui.down(); fireEvent.keyDown(window, { key: 'Escape' });
    ui.down({ ctrlKey: false }); ui.up({ clientX: 20, clientY: 20 }); fireEvent.click(ui.text);
    expect(ui.onClick).toHaveBeenCalledOnce();
  } finally { ui.dispose(); }
});
it.each([{ altKey: true }, { shiftKey: true }, { metaKey: true }, { isPrimary: false }, { button: 2 }])('does not claim a different gesture: %j', modifiers => {
  const ui = setup();
  try { expect(ui.down(modifiers)).toBe(true); ui.move(); ui.up(); expect(ui.onDrop).not.toHaveBeenCalled(); }
  finally { ui.dispose(); }
});
it.each(['Existing action', 'Reference'])('leaves %s interactive with Ctrl held', label => {
  const ui = setup();
  try {
    expect(fireEvent.pointerDown(ui.getByText(label), { button: 0, ctrlKey: true })).toBe(true);
    expect(ui.page.setPointerCapture).not.toHaveBeenCalled();
  } finally { ui.dispose(); }
});
it('only highlights the Ctrl gesture outside editable controls and clears on blur', () => {
  const ui = setup();
  try {
    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true }); expect(ui.page.dataset.ready).toBe('true');
    fireEvent.keyUp(window, { key: 'Control' }); expect(ui.page.dataset.ready).toBe('false');
    fireEvent.keyDown(ui.getByRole('button'), { key: 'Control', ctrlKey: true }); expect(ui.page.dataset.ready).toBe('false');
    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true }); fireEvent(window, new Event('blur'));
    expect(ui.page.dataset.ready).toBe('false');
  } finally { ui.dispose(); }
});
it('cancels a drop outside the composer', () => {
  const ui = setup();
  try { ui.down(); ui.move(); ui.up({ clientX: 400 }); expect(ui.onDrop).not.toHaveBeenCalled(); expect(pdfBlockDrag.getState()).toBeNull(); }
  finally { ui.dispose(); }
});
it.each(['Escape', 'pointercancel', 'blur', 'lostpointercapture', 'unmount', 'context', 'disabled', 'surface'])('cancels a block drag on %s', kind => {
  const ui = setup();
  try {
    ui.down(); ui.move();
    if (kind === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    if (kind === 'pointercancel') fireEvent.pointerCancel(ui.page, { pointerId: 7 });
    if (kind === 'lostpointercapture') fireEvent.lostPointerCapture(ui.page, { pointerId: 7 });
    if (kind === 'blur') fireEvent(window, new Event('blur'));
    if (kind === 'surface') fireEvent(window, new Event('neuink:reader-surface-change'));
    if (kind === 'unmount') ui.unmount();
    if (kind === 'context') ui.rerender(<Harness context="different" />);
    if (kind === 'disabled') ui.rerender(<Harness enabled={false} />);
    act(() => { pdfBlockDrag.finish(600, 200); });
    expect(ui.onDrop).not.toHaveBeenCalled();
    expect(pdfBlockDrag.getState()).toBeNull();
    expect(document.body.style.userSelect).toBe('');
  } finally { ui.dispose(); }
});
it('scrolls the native viewport at its edge and stops scrolling after cancellation', () => {
  vi.useFakeTimers();
  const ui = setup();
  try {
    Object.defineProperties(ui.target, { scrollHeight: { value: 1000 }, clientHeight: { value: 250 } });
    ui.target.style.overflowY = 'auto';
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => ui.target });
    ui.down(); ui.move({ clientY: 345 });
    act(() => vi.advanceTimersByTime(34));
    expect(ui.target.scrollTop).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: 'Escape' });
    const stopped = ui.target.scrollTop;
    act(() => vi.advanceTimersByTime(100));
    expect(ui.target.scrollTop).toBe(stopped);
  } finally { delete (document as Partial<Document>).elementFromPoint; ui.dispose(); }
});
