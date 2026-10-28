// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookCover } from './BookCover';

const createStage = vi.hoisted(() => vi.fn());
vi.mock('./bookScene', () => ({ createBookStage: createStage }));
let appearance = 'atelier';
vi.mock('@/shared/components/AppearanceProvider', () => ({useAppearance: () => ({appearance})}));
let visibility: IntersectionObserverCallback;
let reduced = false;
let motionFrame: FrameRequestCallback | null = null;
const preferenceListeners = new Set<() => void>();
let stage: { dispose: ReturnType<typeof vi.fn>; rest: ReturnType<typeof vi.fn>; point: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn> };
beforeEach(() => {
  appearance = 'atelier'; reduced = false; preferenceListeners.clear();
  motionFrame = null;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { motionFrame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { motionFrame = null; });
  stage = { dispose: vi.fn(), rest: vi.fn(), point: vi.fn(), resize: vi.fn() };
  createStage.mockReset().mockReturnValue(stage);
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { visibility = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => preferenceListeners.add(fn), removeEventListener: (_: string, fn: () => void) => preferenceListeners.delete(fn) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function show() { await act(async () => visibility([{isIntersecting:true}] as IntersectionObserverEntry[], {} as IntersectionObserver)); }
function Fixture({enabled=true, mode='shelf', onOpen=vi.fn()}: {enabled?:boolean; mode?:'shelf'|'overview'; onOpen?:()=>void}) {
  return <div className="library-shelf-entry" tabIndex={0} role="button" aria-label="打开论文" onClick={onOpen}><BookCover id="paper" title="长标题与中文" topic="软件工程" enabled={enabled} mode={mode}/></div>;
}
describe('book material lifecycle', () => {
  it('keeps the same shelf cover on focus and pointer movement without loading another renderer', async () => {
    const onOpen=vi.fn(); const view=render(<Fixture onOpen={onOpen}/>); await show();
    const cover=view.container.querySelector('.book-volume-front');
    const host=view.container.querySelector<HTMLElement>('.library-book')!;
    vi.spyOn(host,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:100,height:200} as DOMRect);
    expect(createStage).not.toHaveBeenCalled();
    await act(async()=>fireEvent.focusIn(view.getByRole('button')));
    fireEvent(view.getByRole('button'),new MouseEvent('pointermove',{clientX:75,clientY:50,bubbles:true}));
    act(()=>motionFrame?.(16));
    expect(createStage).not.toHaveBeenCalled();
    expect(view.container.querySelector('.book-volume-front')).toBe(cover);
    expect(view.container.querySelector('canvas')).toBeNull();
    expect(host.style.getPropertyValue('--book-tilt-y')).toBe('-15.00deg');
    expect(host.querySelectorAll('.library-book-face')).toHaveLength(5);
    fireEvent.pointerDown(view.getByRole('button')); fireEvent.click(view.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(host.style.getPropertyValue('--book-tilt-y')).toBe('');
  });
  it('returns the shelf to rest on exit, drag and a reduced-motion preference change', async () => {
    const view=render(<Fixture/>); await show();
    const host=view.container.querySelector<HTMLElement>('.library-book')!;
    const button=view.getByRole('button');
    vi.spyOn(host,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:100,height:200} as DOMRect);
    const move=()=>{ fireEvent.pointerEnter(button); fireEvent(button,new MouseEvent('pointermove',{clientX:100,clientY:100,bubbles:true})); act(()=>motionFrame?.(16)); };
    move(); expect(host.style.getPropertyValue('--book-tilt-y')).toBe('-8.00deg');
    fireEvent.pointerLeave(button); expect(host.style.getPropertyValue('--book-tilt-y')).toBe('');
    move(); fireEvent.dragStart(button); expect(host.style.getPropertyValue('--book-tilt-y')).toBe('');
    move(); reduced=true; act(()=>preferenceListeners.forEach(fn=>fn()));
    expect(host.style.getPropertyValue('--book-tilt-y')).toBe('');
    move(); expect(host.style.getPropertyValue('--book-tilt-y')).toBe('');
    expect(createStage).not.toHaveBeenCalled();
  });
  it('restores the visible depth pose on quick re-entry without swapping the cover', async () => {
    const view=render(<Fixture/>); await show();
    const host=view.container.querySelector<HTMLElement>('.library-book')!, button=view.getByRole('button');
    fireEvent.pointerEnter(button); act(()=>motionFrame?.(16));
    expect(host.style.getPropertyValue('--book-tilt-y')).toBe('-22.00deg');
    fireEvent.pointerLeave(button); expect(host.style.getPropertyValue('--book-tilt-y')).toBe('');
    fireEvent.pointerEnter(button); act(()=>motionFrame?.(32));
    expect(host.style.getPropertyValue('--book-tilt-y')).toBe('-22.00deg');
    expect(createStage).not.toHaveBeenCalled();
  });
  it('keeps overview faces live and stops motion when hidden or reduced', async () => {
    const view=render(<Fixture mode="overview"/>); await show();
    const host=view.container.querySelector<HTMLElement>('.library-book')!;
    fireEvent.pointerEnter(view.getByRole('button')); act(()=>motionFrame?.(16));
    expect(host.style.getPropertyValue('--book-tilt-y')).not.toBe('');
    act(()=>visibility([{isIntersecting:false}] as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(host.style.getPropertyValue('--book-tilt-y')).toBe('');
    reduced=true; await show(); fireEvent.pointerEnter(view.getByRole('button')); act(()=>motionFrame?.(32));
    expect(host.style.getPropertyValue('--book-tilt-y')).toBe('');
    expect(createStage).not.toHaveBeenCalled();
  });
  it('does not replace DOM or steal focus when leaving the theme or disabling a dragging shelf', async () => {
    const view=render(<Fixture mode="overview"/>); await show(); const button=view.getByRole('button'); button.focus();
    const title=view.container.querySelector('.library-book-title');
    appearance='liquid-glass'; view.rerender(<Fixture mode="overview"/>);
    expect(view.getByRole('button')).toBe(button); expect(document.activeElement).toBe(button);
    appearance='atelier'; view.rerender(<Fixture enabled={false}/>);
    expect(view.container.querySelector('.library-book-title')).toBe(title);
    expect(createStage).not.toHaveBeenCalled();
  });
  it('suspends the live pose on window blur and resumes only on interaction', async () => {
    const view=render(<Fixture mode="overview"/>); await show();
    const host=view.container.querySelector<HTMLElement>('.library-book')!;
    fireEvent.pointerEnter(view.getByRole('button')); act(()=>motionFrame?.(16));
    fireEvent(window,new Event('blur')); expect(host.style.getPropertyValue('--book-tilt-y')).toBe('');
    await act(async()=>fireEvent(window,new Event('focus')));
    expect(createStage).not.toHaveBeenCalled();
  });
  it('keeps readable live text and opening without using WebGL for covers', async () => {
    createStage.mockImplementation(()=>{throw new Error('WebGL unavailable');});
    const onOpen=vi.fn(); const view=render(<Fixture mode="overview" onOpen={onOpen}/>); await show();
    expect(view.container.querySelector('canvas, img')).toBeNull();
    expect(view.container.querySelector('.library-book-title')?.textContent).toBe('长标题与中文');
    fireEvent.click(view.getByRole('button')); expect(onOpen).toHaveBeenCalledOnce();
    expect(createStage).not.toHaveBeenCalled();
  });
  it('cancels an import result when unmounted before it resolves', async () => {
    const view=render(<Fixture mode="overview"/>);
    act(()=>{ visibility([{isIntersecting:true}] as IntersectionObserverEntry[],{} as IntersectionObserver); view.unmount(); });
    await act(async()=>{}); expect(createStage).not.toHaveBeenCalled();
  });
});
