/** @vitest-environment jsdom */
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceSnapshotImage } from './SourceSnapshotImage';

let width = 800;
let height = 400;
let resize: () => void;
let captured: Set<number>;
const release = vi.fn((id: number) => captured.delete(id));
const disconnect = vi.fn();

beforeEach(() => {
  width = 800; height = 400; captured = new Set();
  release.mockClear(); disconnect.mockClear();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('role') === 'region' ? width : 1024; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('role') === 'region' ? height : 768; });
  // Exercise CSS zoom: a 100 CSS-pixel move travels 125 screen pixels.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(100, 80, width * 1.25, height * 1.25));
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn((id: number) => captured.add(id)) },
    hasPointerCapture: { configurable: true, value: (id: number) => captured.has(id) },
    releasePointerCapture: { configurable: true, value: release }
  });
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number; isPrimary: boolean;
    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props); this.pointerId = props.pointerId ?? 1; this.isPrimary = props.isPrimary ?? true;
    }
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect = disconnect;
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const key of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'] as const) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
});

function openImage(load = true, naturalWidth = 1600, naturalHeight = 800) {
  const renderResult = render(<SourceSnapshotImage detailEnabled alt="研究图" src="https://example.com/figure.png" />);
  const trigger = screen.getByRole('button', { name: '查看研究图详情' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog');
  const viewport = within(dialog).getByRole('region');
  const img = within(dialog).getByAltText('研究图') as HTMLImageElement;
  Object.defineProperties(img, { naturalWidth: { value: naturalWidth }, naturalHeight: { value: naturalHeight } });
  if (load) fireEvent.load(img);
  return { ...renderResult, trigger, dialog, viewport, img };
}
function offset(img: HTMLImageElement) {
  const result = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(img.style.transform)!;
  return { x: Number(result[1]), y: Number(result[2]) };
}
function dragFromCenter(viewport: HTMLElement, dx: number, dy: number) {
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 7, clientX: 600, clientY: 330 });
  fireEvent.pointerMove(viewport, { pointerId: 7, clientX: 600 + dx * 1.25, clientY: 330 + dy * 1.25 });
}

describe('image detail interactions', () => {
  it('fits the full image, focuses the canvas and refits on resize', () => {
    const { viewport, img } = openImage();
    expect(img.style.width).toBe('800px');
    expect(img.style.height).toBe('400px');
    expect(offset(img)).toEqual({ x: 0, y: 0 });
    expect(document.activeElement).toBe(viewport);
    act(() => { width = 400; height = 300; resize(); });
    expect(img.style.width).toBe('400px');
    expect(img.style.height).toBe('200px');
    expect(offset(img)).toEqual({ x: 0, y: 0 });
  });

  it('zooms at the pointer without scrolling the page, including CSS zoom', () => {
    const { viewport, img } = openImage();
    const wheel = createEvent.wheel(viewport, { deltaY: -100, clientX: 850, clientY: 330, cancelable: true });
    fireEvent(viewport, wheel);
    const ratio = Math.exp(0.2);
    expect(wheel.defaultPrevented).toBe(true);
    expect(parseFloat(img.style.width)).toBeCloseTo(800 * ratio);
    expect(offset(img).x).toBeCloseTo(200 * (1 - ratio));
    expect(offset(img).y).toBe(0);
    fireEvent.wheel(viewport, { deltaY: 100, clientX: 850, clientY: 330 });
    expect(parseFloat(img.style.width)).toBeCloseTo(800);
    expect(offset(img).x).toBeCloseTo(0);
  });

  it('pans with primary-button capture, commits once, and clamps image edges', () => {
    const { viewport, img } = openImage();
    fireEvent.click(screen.getByRole('button', { name: '原始大小' }));
    dragFromCenter(viewport, 2, 1);
    expect(offset(img)).toEqual({ x: 0, y: 0 });
    fireEvent.pointerMove(viewport, { pointerId: 8, clientX: 725, clientY: 392.5 });
    expect(offset(img)).toEqual({ x: 0, y: 0 });
    fireEvent.pointerMove(viewport, { pointerId: 7, clientX: 725, clientY: 392.5 });
    expect(offset(img)).toEqual({ x: 100, y: 50 });
    fireEvent.pointerUp(viewport, { pointerId: 7 });
    fireEvent.lostPointerCapture(viewport, { pointerId: 7 });
    expect(offset(img)).toEqual({ x: 100, y: 50 });
    expect(release).toHaveBeenCalledTimes(1);
    dragFromCenter(viewport, 10000, -10000);
    fireEvent.pointerUp(viewport, { pointerId: 7 });
    expect(offset(img)).toEqual({ x: 400, y: -200 });
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
    expect(offset(img)).toEqual({ x: 0, y: 0 });
    expect(img.style.width).toBe('800px');
  });

  it.each(['pointerCancel', 'lostPointerCapture', 'blur', 'Escape'] as const)('rolls back a drag on %s without closing the viewer', reason => {
    const { viewport, img } = openImage();
    fireEvent.click(screen.getByRole('button', { name: '原始大小' }));
    dragFromCenter(viewport, 100, 50);
    if (reason === 'blur') fireEvent.blur(window);
    else if (reason === 'Escape') fireEvent.keyDown(viewport, { key: 'Escape' });
    else fireEvent[reason](viewport, { pointerId: 7 });
    expect(offset(img)).toEqual({ x: 0, y: 0 });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(captured.size).toBe(0);
  });

  it('supports keyboard zoom, pan and reset, Escape restores trigger focus', async () => {
    const { viewport, img, trigger } = openImage();
    fireEvent.keyDown(viewport, { key: '+' });
    expect(img.style.width).toBe('1000px');
    fireEvent.keyDown(viewport, { key: 'ArrowRight' });
    expect(offset(img).x).toBe(-40);
    fireEvent.keyDown(viewport, { key: '0' });
    expect(img.style.width).toBe('800px');
    expect(offset(img)).toEqual({ x: 0, y: 0 });
    fireEvent.keyDown(viewport, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('keeps very tall images fully visible at fit and bounds repeated wheel zoom', () => {
    const { viewport, img } = openImage(true, 200, 10000);
    expect(img.style.height).toBe('400px');
    for (let i = 0; i < 20; i++) fireEvent.wheel(viewport, { deltaY: -240, clientX: 600, clientY: 330 });
    expect(img.style.width).toBe('800px');
    expect((screen.getByRole('button', { name: '放大图片' }) as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 30; i++) fireEvent.wheel(viewport, { deltaY: 240, clientX: 600, clientY: 330 });
    expect(img.style.height).toBe('400px');
    expect(offset(img)).toEqual({ x: 0, y: 0 });
  });

  it('provides loading and recoverable detail errors without losing the thumbnail', () => {
    const { dialog, img } = openImage(false);
    expect(within(dialog).getByRole('status').textContent).toContain('正在加载');
    expect((screen.getByRole('button', { name: '放大图片' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.error(img);
    expect(within(dialog).getByRole('status').textContent).toContain('图片无法读取');
    fireEvent.click(within(dialog).getByRole('button', { name: '重试图片' }));
    const retry = within(dialog).getByAltText('研究图');
    expect(retry).not.toBe(img);
    Object.defineProperties(retry, { naturalWidth: { value: 800 }, naturalHeight: { value: 400 } });
    fireEvent.load(retry);
    expect(within(dialog).queryByRole('status')).toBeNull();
  });

  it('releases capture and size observation when closed during a drag', () => {
    const { viewport, unmount } = openImage();
    fireEvent.click(screen.getByRole('button', { name: '原始大小' }));
    dragFromCenter(viewport, 100, 50);
    unmount();
    expect(captured.size).toBe(0);
    expect(disconnect).toHaveBeenCalled();
  });

  it('keeps small images centered and ignores secondary-button dragging', () => {
    const { viewport, img } = openImage(true, 200, 100);
    dragFromCenter(viewport, 100, 50);
    expect(captured.size).toBe(0);
    expect(offset(img)).toEqual({ x: 0, y: 0 });
    for (let i = 0; i < 4; i++) fireEvent.wheel(viewport, { deltaY: -240, clientX: 600, clientY: 330 });
    fireEvent.pointerDown(viewport, { button: 2, pointerId: 7, clientX: 600, clientY: 330 });
    fireEvent.pointerMove(viewport, { pointerId: 7, clientX: 800, clientY: 430 });
    expect(captured.size).toBe(0);
    expect(offset(img)).toEqual({ x: 0, y: 0 });
  });

  it('does not trigger the underlying segment preview, context menu or navigation through the portal', () => {
    const hover = vi.fn(); const menu = vi.fn(); const navigate = vi.fn();
    render(<div onMouseMove={hover} onContextMenu={menu} onClick={navigate}>
      <SourceSnapshotImage detailEnabled alt="图表" src="https://example.com/figure.png" />
    </div>);
    fireEvent.click(screen.getByRole('button', { name: '查看图表详情' }));
    const viewport = screen.getByRole('region', { name: '图片详情内容' });
    fireEvent.mouseMove(viewport);
    fireEvent.contextMenu(viewport);
    fireEvent.click(viewport);
    expect(hover).not.toHaveBeenCalled();
    expect(menu).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
