// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import { PdfTextSelectionToolbar, type PendingPdfTextSelection } from './PdfTextSelectionToolbar';
import { ReadingSelectionToolbarProvider } from './ReadingSelectionToolbarProvider';

const first: PendingPdfTextSelection = {
  position: { x: 100, y: 100 },
  segment: { uid: 'one', page_idx: 0, segment_type: 'paragraph', text: 'context', markdown: null, bbox: null },
  selection: { page_idx: 0, text: 'first selection', rects: [] },
};
const second = { ...first, position: { x: 500, y: 500 }, segment: { ...first.segment, uid: 'two', page_idx: 1 },
  selection: { ...first.selection, text: 'second selection', page_idx: 1 } };
const toast = { dismiss: vi.fn(), notify: vi.fn(() => 'toast') };
const translate = vi.fn(async ({ text }: { text: string }) => `译文：${text}`);
const close = vi.fn();

function Fixture({ selection, host = false, other = null }: { selection: PendingPdfTextSelection | null; host?: boolean; other?: PendingPdfTextSelection | null }) {
  const toolbar = <><PdfTextSelectionToolbar pending={selection} autoTranslate onTranslate={translate} onClose={close} />
    {host && <PdfTextSelectionToolbar pending={other} autoTranslate onTranslate={translate} onClose={close} />}</>;
  return <ToastContext.Provider value={toast}>{host ? <ReadingSelectionToolbarProvider>{toolbar}</ReadingSelectionToolbarProvider> : toolbar}</ToastContext.Provider>;
}

function pointer(element: Element, type: string, x: number, y: number, id = 1, extra = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: true }, ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [key, { value }])) });
  fireEvent(element, event);
}

beforeEach(() => {
  vi.clearAllMocks();
  translate.mockReset().mockImplementation(async ({ text }) => `译文：${text}`);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const element = this;
    const left = Number.parseFloat(element.style.left) || 100;
    const top = Number.parseFloat(element.style.top) || 100;
    return { left, top, right: left + 300, bottom: top + 160, width: 300, height: 160, x: left, y: top, toJSON: () => ({}) };
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(160);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('pinned reading selection toolbar', () => {
  it('closes with Escape from the reading body, including a pinned toolbar without a native selection', async () => {
    const view = render(<Fixture selection={first} />);
    await view.findByText('译文：first selection');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    close.mockClear();
    fireEvent.click(view.getByRole('button', { name: '固定' }));
    view.rerender(<Fixture selection={null} />);
    expect(view.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('keeps the same dialog, position and translation when selection temporarily disappears, then updates in place', async () => {
    const view = render(<Fixture selection={first} />);
    await view.findByText('译文：first selection');
    const dialog = view.getByRole('dialog');
    await waitFor(() => expect(dialog.style.opacity).toBe('1'));
    fireEvent.click(view.getByRole('button', { name: '固定' }));
    const { left, top } = dialog.style;
    view.rerender(<Fixture selection={null} />);
    expect(view.getByRole('dialog')).toBe(dialog);
    expect(view.getByText('译文：first selection')).toBeTruthy();
    expect(view.getByRole('button', { name: '翻译' }).hasAttribute('disabled')).toBe(true);
    view.rerender(<Fixture selection={second} />);
    await view.findByText('译文：second selection');
    await waitFor(() => expect(dialog.style.left).toBe(left));
    expect(dialog.style.top).toBe(top);
    expect(translate).toHaveBeenCalledTimes(2);
    fireEvent.click(view.getByRole('button', { name: '取消固定' }));
    await waitFor(() => expect(dialog.style.top).not.toBe(top));
  });

  it('shares one stable pinned dialog across PDF page publishers', async () => {
    const view = render(<Fixture selection={first} host />);
    await view.findByText('译文：first selection');
    const dialog = view.getByRole('dialog');
    fireEvent.click(view.getByRole('button', { name: '固定' }));
    view.rerender(<Fixture selection={null} other={second} host />);
    await view.findByText('译文：second selection');
    expect(view.getAllByRole('dialog')).toHaveLength(1);
    expect(view.getByRole('dialog')).toBe(dialog);
    expect(dialog.dataset.pinned).toBe('true');
  });

  it('moves only after the threshold, ignores another pointer, and commits a drag', async () => {
    const view = render(<Fixture selection={first} />);
    const dialog = view.getByRole('dialog');
    await waitFor(() => expect(dialog.style.opacity).toBe('1'));
    fireEvent.click(view.getByRole('button', { name: '固定' }));
    const origin = Number.parseFloat(dialog.style.left);
    const handle = view.getByRole('button', { name: /拖动选区工具/ });
    pointer(handle, 'pointerdown', 100, 100, 1, { button: 2 });
    pointer(handle, 'pointerdown', 100, 100, 1, { isPrimary: false });
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
    pointer(handle, 'pointerdown', 100, 100);
    pointer(handle, 'pointermove', 102, 100);
    expect(document.body.style.userSelect).not.toBe('none');
    pointer(handle, 'pointermove', 160, 100, 2);
    expect(document.body.style.userSelect).not.toBe('none');
    pointer(handle, 'pointermove', 160, 140);
    expect(document.body.style.userSelect).toBe('none');
    pointer(handle, 'pointerup', 160, 140);
    await waitFor(() => expect(Number.parseFloat(dialog.style.left)).toBe(origin + 60));
    expect(document.body.style.userSelect).toBe('');
  });

  it.each(['pointercancel', 'lostpointercapture', 'Escape', 'blur'])('rolls back a drag on %s without closing the panel', async cancel => {
    const view = render(<Fixture selection={first} />);
    const dialog = view.getByRole('dialog');
    await waitFor(() => expect(dialog.style.opacity).toBe('1'));
    fireEvent.click(view.getByRole('button', { name: '固定' }));
    const origin = dialog.style.left;
    const handle = view.getByRole('button', { name: /拖动选区工具/ });
    pointer(handle, 'pointerdown', 100, 100);
    pointer(handle, 'pointermove', 160, 140);
    await waitFor(() => expect(dialog.style.left).not.toBe(origin));
    if (cancel === 'Escape') fireEvent.keyDown(handle, { key: 'Escape' });
    else if (cancel === 'blur') fireEvent.blur(window);
    else pointer(handle, cancel, 160, 140);
    await waitFor(() => expect(dialog.style.left).toBe(origin));
    expect(document.body.style.userSelect).toBe('');
    expect(close).not.toHaveBeenCalled();
  });

  it('supports keyboard movement, clamps to viewport edges and cleans up an unfinished drag on unmount', async () => {
    const view = render(<Fixture selection={first} />);
    const dialog = view.getByRole('dialog');
    await waitFor(() => expect(dialog.style.opacity).toBe('1'));
    fireEvent.click(view.getByRole('button', { name: '固定' }));
    const handle = view.getByRole('button', { name: /拖动选区工具/ });
    const origin = Number.parseFloat(dialog.style.left);
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    await waitFor(() => expect(Number.parseFloat(dialog.style.left)).toBe(origin + 20));
    pointer(handle, 'pointerdown', 100, 100);
    pointer(handle, 'pointermove', -1000, -1000);
    await waitFor(() => expect(dialog.style.left).toBe('8px'));
    expect(dialog.style.top).toBe('8px');
    view.unmount();
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
  });

  it('dismisses retained content and pinning on reader changes', async () => {
    const view = render(<Fixture selection={first} />);
    await view.findByText('译文：first selection');
    fireEvent.click(view.getByRole('button', { name: '固定' }));
    view.rerender(<Fixture selection={null} />);
    act(() => { window.dispatchEvent(new Event('neuink:reader-surface-change')); });
    expect(view.queryByRole('dialog')).toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not overwrite a new selection with an earlier translation result', async () => {
    let finishFirst!: (text: string) => void;
    translate.mockImplementationOnce(() => new Promise<string>(resolve => { finishFirst = resolve; }));
    const view = render(<Fixture selection={first} />);
    fireEvent.click(view.getByRole('button', { name: '固定' }));
    view.rerender(<Fixture selection={second} />);
    await view.findByText('译文：second selection');
    await act(async () => { finishFirst('过时译文'); });
    expect(view.queryByText('过时译文')).toBeNull();
  });
});
