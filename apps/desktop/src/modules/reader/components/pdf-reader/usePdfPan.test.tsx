// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePdfPan } from './usePdfPan';

class Pointer extends MouseEvent {
  pointerId: number;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 7;
    this.isPrimary = init.isPrimary ?? true;
  }
}
beforeEach(() => { vi.stubGlobal('PointerEvent', Pointer); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function Harness({ context = 'paper', enabled = true, onSelect = () => {} }: {
  context?: string; enabled?: boolean; onSelect?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { active, ...handlers } = usePdfPan({ scrollRef: ref, context, enabled });
  return <div ref={ref} tabIndex={0} data-testid="viewport" data-active={active} {...handlers}>
    <div onPointerDownCapture={onSelect} onClick={onSelect}>PDF text</div>
    <input aria-label="Comment" /><button>Action</button><a href="#link">Link</a>
    <div contentEditable suppressContentEditableWarning>Editor</div>
  </div>;
}

function setup(scale = 1) {
  const onSelect = vi.fn();
  const ui = render(<Harness onSelect={onSelect} />);
  const viewport = ui.getByTestId('viewport');
  const text = ui.getByText('PDF text');
  Object.defineProperties(viewport, {
    offsetWidth: { value: 400 }, offsetHeight: { value: 300 },
    clientWidth: { value: 400 }, clientHeight: { value: 300 },
    scrollWidth: { value: 1200 }, scrollHeight: { value: 2400 },
  });
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 100, 400 * scale, 300 * scale));
  Object.assign(viewport, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  viewport.scrollLeft = 200; viewport.scrollTop = 400;
  const space = () => fireEvent.keyDown(viewport, { code: 'Space', key: ' ' });
  const down = (init: PointerEventInit = {}) => fireEvent.pointerDown(text, { pointerId: 7, button: 0, buttons: 1, clientX: 300, clientY: 200, ...init });
  const move = (init: PointerEventInit = {}) => {
    fireEvent.pointerMove(window, { pointerId: 7, buttons: 1, clientX: 250, clientY: 150, ...init });
    act(() => { vi.advanceTimersByTime(20); });
  };
  const up = (init: PointerEventInit = {}) => fireEvent.pointerUp(window, { pointerId: 7, button: 0, clientX: 250, clientY: 150, ...init });
  return { ...ui, viewport, text, onSelect, space, down, move, up };
}

it.each([1, 1.25])('pans both axes at %sx UI scale, captures the pointer and consumes the click', scale => {
  const ui = setup(scale);
  expect(ui.space()).toBe(false);
  expect(ui.viewport.dataset.pdfPan).toBe('ready');
  expect(ui.down()).toBe(false);
  ui.move();
  expect(ui.viewport.scrollLeft).toBe(200 + 50 / scale);
  expect(ui.viewport.scrollTop).toBe(400 + 50 / scale);
  expect(ui.viewport.dataset.pdfPan).toBe('dragging');
  expect(ui.viewport.setPointerCapture).toHaveBeenCalledWith(7);
  ui.up(); fireEvent.click(ui.text);
  expect(ui.onSelect).not.toHaveBeenCalled();
  expect(ui.viewport.dataset.pdfPan).toBe('ready');
  expect(document.body.style.userSelect).toBe('');
  fireEvent.keyUp(window, { code: 'Space', key: ' ' });
  expect(ui.viewport.dataset.pdfPan).toBeUndefined();
});

it('does not scroll or select for a Space click below the drag threshold', () => {
  const ui = setup(); ui.space(); ui.down(); ui.move({ clientX: 302, clientY: 201 });
  ui.up({ clientX: 302, clientY: 201 }); fireEvent.click(ui.text);
  expect(ui.viewport.scrollTop).toBe(400);
  expect(ui.onSelect).not.toHaveBeenCalled();
});

it('stops immediately on releasing Space, flushes the last movement and preserves ordinary selection afterwards', () => {
  const ui = setup(); ui.space(); ui.down();
  fireEvent.pointerMove(window, { pointerId: 7, buttons: 1, clientX: 250, clientY: 150 });
  fireEvent.keyUp(window, { code: 'Space', key: ' ' });
  ui.move({ clientX: 100, clientY: 100 }); ui.up(); fireEvent.click(ui.text);
  expect(ui.viewport.scrollTop).toBe(450);
  expect(ui.onSelect).not.toHaveBeenCalled();
  expect(ui.down()).toBe(true);
  expect(ui.onSelect).toHaveBeenCalledOnce();
});

it('keeps native selection and Ctrl drag intact and does not take over a gesture already in progress', () => {
  const ui = setup();
  ui.down(); ui.space(); ui.move(); ui.up();
  expect(ui.viewport.setPointerCapture).not.toHaveBeenCalled();
  expect(ui.viewport.scrollTop).toBe(400);
  ui.space(); ui.down({ ctrlKey: true }); ui.move(); ui.up();
  expect(ui.viewport.setPointerCapture).not.toHaveBeenCalled();
  expect(ui.onSelect).toHaveBeenCalledTimes(2);
});

it.each(['Comment', 'Action', 'Link', 'Editor'])('leaves Space in %s to the focused control', label => {
  const ui = setup();
  fireEvent.pointerEnter(ui.viewport);
  const control = label === 'Comment' ? ui.getByLabelText(label) : ui.getByText(label);
  expect(fireEvent.keyDown(control, { code: 'Space', key: ' ' })).toBe(true);
  expect(ui.viewport.dataset.pdfPan).toBeUndefined();
  ui.space();
  fireEvent.pointerDown(control, { pointerId: 7, button: 0, buttons: 1 });
  expect(ui.viewport.setPointerCapture).not.toHaveBeenCalled();
});

it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { button: 2 }, { isPrimary: false }])('does not claim another gesture: %j', init => {
  const ui = setup(); ui.space(); ui.down(init);
  expect(ui.viewport.setPointerCapture).not.toHaveBeenCalled();
});

it('uses the hovered reader only, without stealing Space elsewhere', () => {
  const ui = setup();
  const second = render(<Harness context="other" />);
  const other = second.container.firstElementChild as HTMLElement;
  expect(fireEvent.keyDown(window, { code: 'Space', key: ' ' })).toBe(true);
  fireEvent.pointerEnter(ui.viewport);
  fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
  expect(ui.viewport.dataset.pdfPan).toBe('ready');
  expect(other.dataset.pdfPan).toBeUndefined();
});

it('takes Space from a mouse-focused sidebar switch after the pointer returns to the PDF', () => {
  const ui = setup();
  const onKeyDown = vi.fn(), onKeyUp = vi.fn(), onClick = vi.fn();
  const sidebar = render(<button role="switch" aria-checked="false" onClick={onClick}
    onKeyDown={onKeyDown} onKeyUp={onKeyUp}>Assistant</button>);
  const toggle = sidebar.getByRole('switch');
  fireEvent.pointerDown(toggle, { button: 0, buttons: 1 });
  act(() => toggle.focus());
  fireEvent.pointerUp(toggle, { button: 0 });
  fireEvent.click(toggle);
  // Opening a sidebar can resize the PDF before the pointer returns.
  ui.rerender(<Harness context="resized-paper" />);
  fireEvent.pointerEnter(ui.viewport);
  expect(fireEvent.keyDown(toggle, { code: 'Space', key: ' ' })).toBe(false);
  expect(onKeyDown).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(ui.viewport);
  expect(ui.viewport.dataset.pdfPan).toBe('ready');
  ui.down(); ui.move(); ui.up();
  expect(ui.viewport.scrollTop).toBe(450);
  expect(fireEvent.keyUp(toggle, { code: 'Space', key: ' ' })).toBe(false);
  expect(onKeyUp).not.toHaveBeenCalled();
  expect(onClick).toHaveBeenCalledOnce();
});

it.each(['Tab', 'ArrowRight', 'Enter'])('preserves keyboard control focus after %s even with the pointer over the PDF', key => {
  const ui = setup();
  const button = ui.getByRole('button');
  fireEvent.pointerDown(button, { button: 0, buttons: 1 });
  act(() => button.focus());
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.pointerMove(ui.text, { buttons: 0 });
  fireEvent.keyDown(button, { key });
  expect(fireEvent.keyDown(button, { code: 'Space', key: ' ' })).toBe(true);
  expect(ui.viewport.dataset.pdfPan).toBeUndefined();
  expect(document.activeElement).toBe(button);
});

it.each(['Comment', 'Editor', 'Action'])('does not take Space while the pointer is still over %s', label => {
  const ui = setup();
  const control = label === 'Comment' ? ui.getByLabelText(label) : ui.getByText(label);
  fireEvent.pointerEnter(ui.viewport);
  fireEvent.pointerDown(control, { button: 0, buttons: 1 });
  act(() => control.focus());
  fireEvent.pointerUp(control, { button: 0 });
  fireEvent.pointerMove(control, { buttons: 0 });
  expect(fireEvent.keyDown(control, { code: 'Space', key: ' ' })).toBe(true);
  expect(ui.viewport.dataset.pdfPan).toBeUndefined();
});

it.each(['Comment', 'Editor'])('keeps typing Space in a mouse-focused %s when the pointer returns to the PDF', label => {
  const ui = setup();
  const control = label === 'Comment' ? ui.getByLabelText(label) : ui.getByText(label);
  fireEvent.pointerDown(control, { button: 0, buttons: 1 });
  act(() => control.focus());
  fireEvent.pointerUp(control, { button: 0 });
  fireEvent.pointerMove(ui.text, { buttons: 0 });
  expect(fireEvent.keyDown(control, { code: 'Space', key: ' ' })).toBe(true);
  expect(ui.viewport.dataset.pdfPan).toBeUndefined();
});

it('does not steal Space from a dialog control over a reader', () => {
  const ui = setup();
  const dialog = render(<div role="dialog"><button>Confirm</button></div>);
  const button = dialog.getByText('Confirm');
  fireEvent.pointerDown(button, { button: 0, buttons: 1 });
  act(() => button.focus());
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.pointerEnter(ui.viewport);
  expect(fireEvent.keyDown(button, { code: 'Space', key: ' ' })).toBe(true);
  expect(ui.viewport.dataset.pdfPan).toBeUndefined();
});

it('hands mouse-retained button focus to only the hovered reader in a split view', () => {
  const ui = setup();
  const button = ui.getByText('Action');
  const second = render(<Harness context="other" />);
  const other = second.container.firstElementChild as HTMLElement;
  fireEvent.pointerDown(button, { button: 0, buttons: 1 });
  act(() => button.focus());
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.pointerMove(other, { buttons: 0 });
  fireEvent.keyDown(button, { code: 'Space', key: ' ' });
  expect(ui.viewport.dataset.pdfPan).toBeUndefined();
  expect(other.dataset.pdfPan).toBe('ready');
  expect(document.activeElement).toBe(other);
});

it('ignores other pointers, clamps to document edges and continues outside the viewport', () => {
  const ui = setup(); ui.space(); ui.down();
  ui.move({ pointerId: 8 }); ui.up({ pointerId: 8 });
  expect(ui.viewport.scrollTop).toBe(400);
  ui.move({ clientX: -2000, clientY: -3000 });
  expect(ui.viewport.scrollLeft).toBe(800); expect(ui.viewport.scrollTop).toBe(2100);
  ui.move({ clientX: 5000, clientY: 5000 });
  expect(ui.viewport.scrollLeft).toBe(0); expect(ui.viewport.scrollTop).toBe(0);
});

it.each(['Escape', 'pointercancel', 'lostpointercapture', 'blur', 'resize', 'hidden', 'surface', 'unmount', 'context', 'disabled', 'focus'])('rolls back and cleans up on %s', reason => {
  const ui = setup();
  document.body.style.cursor = 'crosshair'; document.body.style.userSelect = 'text';
  ui.space(); ui.down(); ui.move();
  if (reason === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
  if (reason === 'pointercancel') fireEvent.pointerCancel(window, { pointerId: 7 });
  if (reason === 'lostpointercapture') fireEvent.lostPointerCapture(ui.viewport, { pointerId: 7 });
  if (reason === 'blur' || reason === 'resize') fireEvent(window, new Event(reason));
  if (reason === 'hidden') { vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); fireEvent(document, new Event('visibilitychange')); }
  if (reason === 'surface') fireEvent(window, new Event('neuink:reader-surface-change'));
  if (reason === 'unmount') ui.unmount();
  if (reason === 'context') ui.rerender(<Harness context="different" />);
  if (reason === 'disabled') ui.rerender(<Harness enabled={false} />);
  if (reason === 'focus') fireEvent.focusIn(ui.getByRole('textbox'));
  ui.move(); ui.up();
  expect(ui.viewport.scrollLeft).toBe(200); expect(ui.viewport.scrollTop).toBe(400);
  expect(ui.viewport.dataset.pdfPan).toBeUndefined();
  expect(document.body.style.cursor).toBe('crosshair'); expect(document.body.style.userSelect).toBe('text');
  expect(ui.viewport.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(vi.getTimerCount()).toBe(0);
  document.body.style.cursor = ''; document.body.style.userSelect = '';
});

it('does not arm in loading, empty or error states', () => {
  const ui = setup(); ui.rerender(<Harness enabled={false} />);
  expect(ui.space()).toBe(true); expect(ui.down()).toBe(true);
  expect(ui.viewport.dataset.pdfPan).toBeUndefined();
});
