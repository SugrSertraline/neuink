/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animatePdfPageTurn } from './pdfPageTurn';

const frames = new Map<number, FrameRequestCallback>();
let nextId = 0;
beforeEach(() => {
  frames.clear(); nextId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextId; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({matches:false}));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage:vi.fn(),fillRect:vi.fn()} as unknown as CanvasRenderingContext2D);
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function fixture() {
  const root = document.createElement('div');
  root.innerHTML = [0, 1, 2, 3].map(index => `<section data-pdf-page-index="${index}"><div data-pdf-page-surface><canvas data-pdf-rendered="true"></canvas><span class="textLayer">Selectable original</span></div></section>`).join('');
  document.body.append(root);
  vi.spyOn(root,'getBoundingClientRect').mockReturnValue({x:0,y:0,top:0,left:0,right:600,bottom:600,width:600,height:600,toJSON:()=>({})});
  vi.spyOn(root.querySelector('[data-pdf-page-surface]')!,'getBoundingClientRect').mockReturnValue({x:100,y:50,top:50,left:100,right:400,bottom:550,width:300,height:500,toJSON:()=>({})});
  return root;
}
function tick(time: number) { const queue = [...frames.values()]; frames.clear(); queue.forEach(callback => callback(time)); }

describe('temporary paper turn', () => {
  it('releases all temporary bitmaps and frames on cancel, leaving live PDF layers intact', () => {
    const root = fixture();
    const source = root.querySelector('canvas'), text = root.querySelector('.textLayer');
    const cancel = animatePdfPageTurn(root, { pageIdx: 0, direction: 1, underPageIdx: 1 });
    const snapshots = Array.from(root.querySelectorAll<HTMLCanvasElement>('.pdf-turn-strip canvas'));
    expect(snapshots.length).toBeGreaterThan(0);
    cancel!(); cancel!();
    expect(root.querySelector('.pdf-turn-viewport')).toBeNull();
    expect(frames.size).toBe(0);
    expect(snapshots.every(canvas=>canvas.width===0 && canvas.height===0)).toBe(true);
    expect(root.querySelector('canvas')).toBe(source);
    expect(root.querySelector('.textLayer')).toBe(text);
  });
  it('stops rendering after a completed turn', () => {
    const root = fixture(); animatePdfPageTurn(root, { pageIdx: 0, direction: -1, underPageIdx: 1 });
    tick(0); tick(200); tick(500);
    expect(frames.size).toBe(0);
    expect(root.querySelector('.pdf-turn-viewport')).toBeNull();
  });
  it.each([1, -1] as const)('moves the entire sheet in direction %s without a stationary live copy', direction => {
    const root = fixture();
    const surface = root.querySelector<HTMLElement>('[data-pdf-page-surface]')!;
    const source = surface.querySelector('canvas')!;
    surface.style.opacity = '0.95';
    const complete = vi.fn();
    const cancel = animatePdfPageTurn(root, { pageIdx: 0, direction, underPageIdx: 1, onComplete: complete })!;
    const drawImage = vi.mocked(source.getContext('2d')!.drawImage);
    const crops = drawImage.mock.calls.filter(call => call.length === 9);
    expect(crops[0].slice(1, 5)).toEqual([0, 0, source.width / 20, source.height]);
    expect(crops[crops.length - 1].slice(1, 5)).toEqual([source.width * 19 / 20, 0, source.width / 20, source.height]);
    const strips = Array.from(root.querySelectorAll<HTMLElement>('.pdf-turn-strip'));
    expect(strips).toHaveLength(20);
    expect(strips.every(strip => strip.style.transform !== '')).toBe(true); // No stacked strips on the first frame.
    expect(surface.style.opacity).toBe('0');
    expect(surface.style.pointerEvents).toBe('none');
    tick(0); tick(195);
    expect(surface.style.opacity).toBe('0');
    expect(complete).not.toHaveBeenCalled();
    tick(500);
    expect(complete).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    expect(surface.style.opacity).toBe('0'); // Wait for the destination DOM commit.
    cancel();
    expect(surface.style.opacity).toBe('0.95');
    expect(surface.style.pointerEvents).toBe('');
    expect(root.querySelector('.pdf-turn-viewport')).toBeNull();
  });
  it('restores all live layers on cancellation without completing navigation', () => {
    const root = fixture(), complete = vi.fn();
    const cancel = animatePdfPageTurn(root, { pageIdx: 0, direction: 1, underPageIdx: 1, onComplete: complete })!;
    tick(0); tick(150); cancel(); tick(500);
    expect(complete).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLElement>('[data-pdf-page-surface]')!.style.opacity).toBe('');
  });
  it('keeps reduced-motion and unrendered pages static', () => {
    const root = fixture();
    vi.stubGlobal('matchMedia', () => ({matches:true}));
    expect(animatePdfPageTurn(root, { pageIdx: 0, direction: 1, underPageIdx: 1 })).toBeNull();
    expect(root.querySelector('.pdf-turn-viewport')).toBeNull();
    vi.stubGlobal('matchMedia', () => ({matches:false}));
    root.querySelector('canvas')!.removeAttribute('data-pdf-rendered');
    expect(animatePdfPageTurn(root, { pageIdx: 0, direction: 1, underPageIdx: 1 })).toBeNull();
    expect(frames.size).toBe(0);
  });
  it('reveals the destination beneath the sheet with a moving shadow and releases both', () => {
    const root = fixture(), complete = vi.fn();
    const cancel = animatePdfPageTurn(root, { pageIdx: 0, direction: 1, underPageIdx: 1, onComplete: complete })!;
    const preview = root.querySelector<HTMLElement>('.pdf-turn-underlay')!;
    const bitmap = preview.querySelector('canvas')!;
    const shadow = preview.querySelector<HTMLElement>('.pdf-turn-shadow')!;
    expect(preview.dataset.pagePreview).toBe('1');
    expect(bitmap.width).toBeGreaterThan(0);
    expect(preview.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(shadow.style.opacity).toBe('0');
    tick(0); tick(150);
    const firstPosition = shadow.style.left;
    expect(Number(shadow.style.opacity)).toBeGreaterThan(0);
    tick(260);
    expect(shadow.style.left).not.toBe(firstPosition);
    expect(complete).not.toHaveBeenCalled();
    tick(500);
    expect(Number(shadow.style.opacity)).toBeCloseTo(0);
    expect(preview.isConnected).toBe(true); // Keeps next page visible until the live row commits.
    cancel();
    expect(bitmap.width).toBe(0);
    expect(preview.isConnected).toBe(false);
  });
  it('prints the correct reverse-side strips for a two-page spread', () => {
    const root = fixture();
    const cancel = animatePdfPageTurn(root, { pageIdx: 0, direction: 1, underPageIdx: 3, backPageIdx: 2 })!;
    expect(root.querySelectorAll('.pdf-turn-back canvas')).toHaveLength(20);
    const calls = vi.mocked(root.querySelector('canvas')!.getContext('2d')!.drawImage).mock.calls.filter(call => call.length === 9);
    expect(calls[0][1]).toBe(0);
    expect(calls[1][1]).toBe(285); // Opposite face reverses column order, not text.
    expect(calls[calls.length - 1][1]).toBe(0);
    cancel();
  });
  it('falls back without hiding the source when the next PDF bitmap is not ready', () => {
    const root = fixture();
    root.querySelector('[data-pdf-page-index="1"] canvas')!.removeAttribute('data-pdf-rendered');
    expect(animatePdfPageTurn(root, { pageIdx: 0, direction: 1, underPageIdx: 1 })).toBeNull();
    expect(root.querySelector('.pdf-turn-viewport')).toBeNull();
    expect(root.querySelector<HTMLElement>('[data-pdf-page-surface]')!.style.opacity).toBe('');
  });
});
