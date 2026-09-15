// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEntryTagDragState, registerEntryTagDropTarget } from '@/shared/lib/entryDragData';
import { useLibraryEntryDrag } from './useLibraryEntryDrag';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}
let nextFrame: FrameRequestCallback | null = null;
beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { nextFrame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(() => { nextFrame = null; }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function Harness({ context = 'root', onOpen }: { context?: string; onOpen: () => void }) {
  const drag = useLibraryEntryDrag(context);
  return <div data-testid="row" {...drag.entryDragHandlers({ id: 'paper', title: '论文' })}
    onClick={() => { if (!drag.consumeDragClick()) onOpen(); }}>
    <button>行内按钮</button>{drag.entryDragPreview ? <span>拖放预览</span> : null}
  </div>;
}
function setup() {
  const onOpen = vi.fn();
  const view = render(<Harness onOpen={onOpen} />);
  const row = view.getByTestId('row');
  Object.assign(row, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
  const start = () => {
    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10, pointerId: 7 });
    fireEvent.pointerMove(row, { clientX: 80, clientY: 80, pointerId: 7 });
  };
  return { ...view, row, start, onOpen };
}

describe('useLibraryEntryDrag', () => {
  it('distinguishes a click, the movement threshold, nested buttons and non-primary pointers', () => {
    const { row, onOpen, getByRole } = setup();
    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10, pointerId: 7 });
    fireEvent.pointerMove(row, { clientX: 13, clientY: 10, pointerId: 7 });
    expect(getEntryTagDragState()).toBeNull();
    fireEvent.pointerUp(row, { pointerId: 7 });
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.pointerDown(getByRole('button'), { button: 0, pointerId: 7 });
    fireEvent.pointerMove(row, { clientX: 80, clientY: 80, pointerId: 7 });
    fireEvent.pointerDown(row, { button: 0, pointerId: 7, isPrimary: false });
    fireEvent.pointerMove(row, { clientX: 80, clientY: 80, pointerId: 7 });
    expect(getEntryTagDragState()).toBeNull();
  });

  it('assigns exactly once on release and suppresses the following click', () => {
    const { row, start, onOpen } = setup();
    const onDrop = vi.fn();
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 100, top: 0, bottom: 100 } as DOMRect);
    const unregister = registerEntryTagDropTarget({ element: row, onDrop });
    try {
      start();
      fireEvent.pointerUp(row, { clientX: 80, clientY: 80, pointerId: 8 });
      expect(onDrop).not.toHaveBeenCalled();
      fireEvent.pointerUp(row, { clientX: 80, clientY: 80, pointerId: 7 });
      fireEvent.pointerUp(row, { clientX: 80, clientY: 80, pointerId: 7 });
      fireEvent.click(row);
      expect(onDrop).toHaveBeenCalledExactlyOnceWith('paper');
      expect(onOpen).not.toHaveBeenCalled();
      expect(getEntryTagDragState()).toBeNull();
      expect(document.body.style.cursor).toBe('');
    } finally { unregister(); }
  });

  it.each(['Escape', 'pointercancel', 'blur', 'context', 'unmount'] as const)('cleans up without submitting on %s', cancel => {
    const { row, start, unmount, rerender, onOpen, queryByText } = setup();
    const drop = vi.fn();
    const unregister = registerEntryTagDropTarget({ element: row, onDrop: drop });
    try {
      start();
      expect(getEntryTagDragState()?.entryId).toBe('paper');
      if (cancel === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
      if (cancel === 'pointercancel') fireEvent.pointerCancel(row, { pointerId: 7 });
      if (cancel === 'blur') fireEvent(window, new Event('blur'));
      if (cancel === 'context') rerender(<Harness context="other-tag" onOpen={onOpen} />);
      if (cancel === 'unmount') unmount();
      expect(getEntryTagDragState()).toBeNull();
      expect(queryByText('拖放预览')).toBeNull();
      expect(document.body.style.cursor).toBe('');
      expect(document.body.style.userSelect).toBe('');
      expect(nextFrame).toBeNull();
      expect(drop).not.toHaveBeenCalled();
    } finally { unregister(); }
  });

  it('scrolls the bounded target under the pointer and stops after release', () => {
    const { row, start } = setup();
    row.style.overflowY = 'auto';
    Object.defineProperties(row, { clientHeight: { value: 100 }, scrollHeight: { value: 500 } });
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 100, top: 0, bottom: 100, height: 100 } as DOMRect);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => row });
    try {
      start();
      act(() => nextFrame?.(16));
      expect(row.scrollTop).toBeGreaterThan(0);
      fireEvent.pointerUp(row, { clientX: 80, clientY: 80, pointerId: 7 });
      expect(nextFrame).toBeNull();
    } finally { Reflect.deleteProperty(document, 'elementFromPoint'); }
  });
});
