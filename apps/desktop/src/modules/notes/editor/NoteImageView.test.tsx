// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps, ElementType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteImageView } from './NoteImageView';

vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: ({ as: Wrapper = 'div', ...props }: ComponentProps<'div'> & { as?: ElementType }) => {
    const Component = Wrapper;
    return <Component {...props} />;
  }
}));

let imageBottom = 500;
let scale = 1;
let frames: FrameRequestCallback[];
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height,
  x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) });
beforeEach(() => {
  imageBottom = 500; scale = 1; frames = [];
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([rect(0, 0, 100, 100)] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if (this.tagName === 'FIGURE') return rect(100, 200, 600, imageBottom - 200);
    if (this.dataset.slot === 'overlay-viewport') return rect(0, 0, 1000 * scale, 800 * scale);
    if (this.getAttribute('aria-label') === '图片设置') return rect(0, 0, 360 * scale, 40 * scale);
    return rect(100, 80, 600, 600);
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
});
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function flush() { const pending = frames.splice(0); act(() => pending.forEach(callback => callback(0))); }
function setup() {
  const owner = document.createElement('div'); owner.style.overflowY = 'auto'; owner.scrollTop = 160;
  const middle = document.createElement('div');
  const editorRoot = document.createElement('div'); editorRoot.style.minHeight = '520px';
  Object.defineProperty(editorRoot, 'scrollHeight', { value: 1400 });
  middle.append(editorRoot); owner.append(middle); document.body.append(owner);
  const scrollBy = vi.fn(); owner.scrollBy = scrollBy;
  const updates = new Set<() => void>();
  const editor = { isEditable: true, view: { dom: editorRoot },
    on: (_name: string, fn: () => void) => updates.add(fn), off: (_name: string, fn: () => void) => updates.delete(fn) };
  const updateAttributes = vi.fn();
  const props = { editor, extension: { options: { entryId: 'entry-1', noteId: 'note-1' } },
    node: { attrs: { alignment: 'center', alt: '示例图片', src: 'image.png', width: 60 } }, selected: true, updateAttributes
  } as unknown as Parameters<typeof NoteImageView>[0];
  const result = render(<NoteImageView {...props}/>, { container: editorRoot, baseElement: document.body });
  return { ...result, props, editor, updates, owner, editorRoot, updateAttributes, scrollBy };
}

describe('NoteImageView', () => {
  it('updates alignment and clamps numeric width using the original editor attributes', () => {
    const result = setup();
    fireEvent.click(result.getByRole('button', { name: '左对齐' }));
    fireEvent.change(result.getByRole('spinbutton', { name: '图片宽度百分比' }), { target: { value: '4' } });
    expect(result.updateAttributes.mock.calls).toEqual([[{ alignment: 'left' }], [{ width: 10 }]]);
  });
  it('holds both control axes and document extent without scrolling or remounting the range', () => {
    const result = setup();
    const slider = result.getByRole('slider');
    const toolbar = result.getByRole('group', { name: '图片设置' });
    const position = toolbar.getAttribute('style');
    fireEvent.pointerDown(slider, { pointerId: 7, button: 0 });
    expect(result.owner.style.overflowAnchor).toBe('none');
    expect(result.editorRoot.style.minHeight).toBe('1400px');
    imageBottom = 260;
    result.rerender(<NoteImageView {...result.props} node={{ ...result.props.node, attrs: { ...result.props.node.attrs, width: 10 } } as unknown as typeof result.props.node}/>);
    fireEvent.scroll(result.owner); flush();
    expect(result.getByRole('slider')).toBe(slider);
    expect(toolbar.getAttribute('style')).toBe(position);
    expect(result.owner.scrollTop).toBe(160);
    expect(result.scrollBy).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { pointerId: 8 });
    expect(result.owner.style.overflowAnchor).toBe('none');
    fireEvent.pointerUp(window, { pointerId: 7 });
    expect(result.owner.style.overflowAnchor || '').toBe('');
    expect(result.editorRoot.style.minHeight).toBe('520px');
  });
  it('converts viewport coordinates once at 125% and reanchors for ordinary scrolling', () => {
    scale = 1.25;
    const result = setup();
    const toolbar = result.getByRole('group', { name: '图片设置' });
    expect(toolbar.style.left).toBe('140px');
    expect(toolbar.style.top).toBe('404px');
    imageBottom = 400;
    fireEvent.scroll(result.owner); flush();
    expect(toolbar.style.top).toBe('324px');
    imageBottom = 60;
    fireEvent.scroll(result.owner); flush();
    expect(toolbar.style.visibility).toBe('hidden');
  });
  it.each(['pointercancel', 'lostpointercapture', 'blur', 'unmount', 'readonly', 'escape'])('releases temporary layout and listeners on %s', (reason) => {
    const result = setup();
    fireEvent.pointerDown(result.getByRole('slider'), { pointerId: 9 });
    if (reason === 'pointercancel') fireEvent.pointerCancel(window, { pointerId: 9 });
    if (reason === 'lostpointercapture') fireEvent(result.getByRole('slider'), new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 9 }));
    if (reason === 'blur') fireEvent.blur(window);
    if (reason === 'unmount') result.unmount();
    if (reason === 'escape') fireEvent.keyDown(result.getByRole('slider'), { key: 'Escape' });
    if (reason === 'readonly') {
      act(() => { result.editor.isEditable = false; result.updates.forEach(fn => fn()); });
      expect(result.queryByRole('slider')).toBeNull();
    }
    expect(result.editorRoot.style.minHeight).toBe('520px');
    expect(result.owner.style.overflowAnchor || '').toBe('');
  });
  it('keeps controls fixed for keyboard resizing and leaves Tab navigation native', () => {
    const result = setup(); const slider = result.getByRole('slider'); const toolbar = result.getByRole('group');
    slider.focus(); const top = toolbar.style.top;
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    imageBottom = 320; fireEvent.scroll(result.owner); flush();
    expect(toolbar.style.top).toBe(top);
    fireEvent.keyUp(slider, { key: 'ArrowLeft' });
    expect(result.editorRoot.style.minHeight).toBe('520px');
    fireEvent.keyDown(slider, { key: 'Tab' });
    expect(result.editorRoot.style.minHeight).toBe('520px');
  });
});
