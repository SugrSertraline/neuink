// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderSurfaceFrame } from './ReaderSurfaceFrame';

let appearance = 'standard';
const observers: ResizeObserverCallback[] = [];
vi.mock('@/shared/components/AppearanceProvider', () => ({useAppearance: () => ({appearance})}));
beforeEach(() => {
  appearance = 'standard'; observers.length = 0; vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(16),16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { observers.push(callback); }
    observe() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(72);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function Fixture() {
  return <ReaderSurfaceFrame toolbar={<button>工具</button>}><div data-reader-body data-reader-scroll><textarea defaultValue="未保存内容"/><div data-testid="nested-scroll"/></div></ReaderSurfaceFrame>;
}
describe('ReaderSurfaceFrame', () => {
  it('preserves the document, focus and scroll when material is switched, and cleans transient state', () => {
    const {container, rerender, getByRole} = render(<Fixture/>);
    const frame=container.querySelector<HTMLElement>('[data-reader-frame]')!;
    const scroll=container.querySelector<HTMLElement>('[data-reader-scroll]')!;
    const editor=getByRole('textbox'); editor.focus(); scroll.scrollTop=260;
    expect(observers).toHaveLength(0);
    appearance='liquid-glass'; rerender(<Fixture/>);
    expect(frame.style.getPropertyValue('--reader-toolbar-height')).toBe('72px');
    expect(frame.dataset.readerScrolled).toBe('true');
    expect(getByRole('textbox')).toBe(editor); expect(document.activeElement).toBe(editor);
    expect(scroll.scrollTop).toBe(260);
    fireEvent.scroll(scroll); appearance='standard'; rerender(<Fixture/>);
    act(()=>vi.runAllTimers());
    expect(frame.hasAttribute('data-reader-scrolling')).toBe(false);
    expect(frame.style.getPropertyValue('--reader-toolbar-height')).toBe('');
    expect(scroll.scrollTop).toBe(260); expect(getByRole('textbox')).toBe(editor);
  });
  it('batches the local reading scroll, ignores inner controls, and settles without hiding the toolbar', () => {
    appearance='liquid-glass';
    const {container,getByTestId,getByRole} = render(<Fixture/>);
    const frame=container.querySelector<HTMLElement>('[data-reader-frame]')!;
    const scroll=container.querySelector<HTMLElement>('[data-reader-scroll]')!;
    fireEvent.scroll(getByTestId('nested-scroll'));
    expect(frame.dataset.readerScrolling).toBeUndefined();
    scroll.scrollTop=240; fireEvent.scroll(scroll); scroll.scrollTop=300; fireEvent.scroll(scroll);
    expect(frame.dataset.readerScrolling).toBe('true');
    act(()=>vi.advanceTimersByTime(16)); expect(frame.dataset.readerScrolled).toBe('true');
    act(()=>vi.advanceTimersByTime(160)); expect(frame.dataset.readerScrolling).toBe('false');
    expect(getByRole('button',{name:'工具'})).toBeTruthy();
    scroll.scrollTop=0; fireEvent.scroll(scroll); act(()=>vi.advanceTimersByTime(16));
    expect(frame.dataset.readerScrolled).toBe('false');
  });
  it('keeps split readers independent and measures a wrapped toolbar without changing scroll', () => {
    appearance='liquid-glass';
    const {container} = render(<><Fixture/><Fixture/></>);
    const frames=container.querySelectorAll<HTMLElement>('[data-reader-frame]');
    const scroll=frames[0].querySelector<HTMLElement>('[data-reader-scroll]')!;
    scroll.scrollTop=420; fireEvent.scroll(scroll); act(()=>vi.advanceTimersByTime(16));
    expect(frames[0].dataset.readerScrolled).toBe('true'); expect(frames[1].dataset.readerScrolled).toBe('false');
    vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockReturnValue(110);
    act(()=>observers[0]([], {} as ResizeObserver));
    expect(frames[0].style.getPropertyValue('--reader-toolbar-height')).toBe('110px');
    expect(scroll.scrollTop).toBe(420);
  });
});
