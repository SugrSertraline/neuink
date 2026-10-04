// @vitest-environment jsdom
import { useRef, useState, type CSSProperties } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSidebarResize } from '@/app/useSidebarResize';
import { browserCommand, listenBrowser, nativeBrowserAvailable } from '@/shared/ipc/browserApi';
import { useBrowserViewport } from './useBrowserViewport';

vi.mock('@/shared/ipc/browserApi', () => ({ nativeBrowserAvailable: vi.fn(), browserCommand: vi.fn(), listenBrowser: vi.fn() }));

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit) {
    super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true;
  }
}
const commit = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

function Fixture({ liveResize = true }: { liveResize?: boolean }) {
  const [width, setWidth] = useState(280);
  const shell = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const resize = useSidebarResize({ width, min: 220, max: 820, enabled: true, liveResize, containerRef: shell,
    onCommit: next => { commit(next); setWidth(next); } });
  const browser = useBrowserViewport('test', viewport, true, () => {});
  return <div data-testid="shell" ref={resize.observeContainer}
    style={{ '--app-activity-width': '48px', '--app-sidebar-width': `${resize.effectiveWidth}px` } as CSSProperties}>
    <button onClick={() => void browser.navigate('https://example.org/')}>Open</button>
    <div role="separator" aria-label="侧栏" onPointerDown={resize.onPointerDown} onKeyDown={resize.onKeyDown} />
    <div ref={resize.previewRef} data-testid="preview" hidden />
    <div ref={viewport} data-testid="viewport" />
  </div>;
}

beforeEach(() => {
  vi.resetAllMocks(); commit.mockReset(); frames.clear(); nextFrame = 0;
  vi.mocked(nativeBrowserAvailable).mockReturnValue(true);
  vi.mocked(browserCommand).mockResolvedValue(undefined);
  vi.mocked(listenBrowser).mockResolvedValue(vi.fn());
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame; frames.set(id, callback); return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid !== 'viewport') return { x: 0, y: 0, width: 1000, height: 800 } as DOMRect;
    const style = this.parentElement!.style;
    // jsdom has no CSS layout: emulate the real grid's live-width fallback only.
    // Pointer events, CSS writes, MutationObserver, scheduling and both hooks are real.
    const sidebarWidth = parseFloat(style.getPropertyValue('--app-sidebar-live-width') || style.getPropertyValue('--app-sidebar-width'));
    return { x: 48 + sidebarWidth, y: 80, width: 1000 - 48 - sidebarWidth, height: 600 } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.style.cssText = ''; });

async function flushFrames() {
  await act(async () => {
    // Deliver real MutationObserver records before the next visual frame.
    await Promise.resolve();
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));
  });
}
async function openPage(liveResize = true) {
  const view = render(<Fixture liveResize={liveResize} />);
  await act(async () => { fireEvent.click(screen.getByText('Open')); });
  await flushFrames();
  expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', {
    visible: true, bounds: { x: 328, y: 80, width: 672, height: 600, pixel_ratio: 1 }
  });
  vi.mocked(browserCommand).mockClear();
  return view;
}
function startResize() {
  fireEvent.pointerDown(screen.getByRole('separator'), { clientX: 328, pointerId: 1, button: 0 });
  fireEvent.pointerMove(window, { clientX: 428, pointerId: 1 });
}

it('updates the native viewport during sidebar drag before committing and rolls back on Escape', async () => {
  await openPage();
  startResize();
  await flushFrames();
  expect(screen.getByTestId('shell').style.getPropertyValue('--app-sidebar-live-width')).toBe('380px');
  expect(commit).not.toHaveBeenCalled();
  await flushFrames();
  expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', {
    visible: true, bounds: { x: 428, y: 80, width: 572, height: 600, pixel_ratio: 1 }
  });
  fireEvent.keyDown(window, { key: 'Escape' });
  await flushFrames();
  expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', {
    visible: true, bounds: { x: 328, y: 80, width: 672, height: 600, pixel_ratio: 1 }
  });
  expect(commit).not.toHaveBeenCalled();
  expect(vi.mocked(browserCommand).mock.calls.map(call => call[1])).toEqual(['layout', 'layout']);
});

it('keeps the final native size on pointer release without a stale-width layout or page reload', async () => {
  await openPage();
  startResize(); await flushFrames(); await flushFrames();
  expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', {
    visible: true, bounds: { x: 428, y: 80, width: 572, height: 600, pixel_ratio: 1 }
  });
  fireEvent.pointerUp(window, { pointerId: 1 });
  await flushFrames(); await flushFrames();
  expect(commit).toHaveBeenCalledExactlyOnceWith(380);
  expect(screen.getByTestId('shell').style.getPropertyValue('--app-sidebar-live-width')).toBe('');
  expect(screen.getByTestId('shell').style.getPropertyValue('--app-sidebar-width')).toBe('380px');
  expect(vi.mocked(browserCommand).mock.calls.map(call => call[1])).toEqual(['layout']);
});

it('leaves guide-only drag geometry unchanged until release when live resizing is disabled', async () => {
  await openPage(false);
  startResize(); await flushFrames(); await flushFrames();
  expect(screen.getByTestId('preview').style.getPropertyValue('--app-sidebar-preview-width')).toBe('380px');
  expect(screen.getByTestId('shell').style.getPropertyValue('--app-sidebar-live-width')).toBe('');
  expect(commit).not.toHaveBeenCalled();
  expect(browserCommand).not.toHaveBeenCalled();
  fireEvent.pointerUp(window, { pointerId: 1 }); await flushFrames();
  expect(commit).toHaveBeenCalledExactlyOnceWith(380);
  expect(browserCommand).toHaveBeenCalledExactlyOnceWith('test', 'layout', {
    visible: true, bounds: { x: 428, y: 80, width: 572, height: 600, pixel_ratio: 1 }
  });
});
