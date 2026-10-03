// @vitest-environment jsdom
import { useEffect, useRef } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBrowserViewport } from '@/modules/browser/useBrowserViewport';
import { browserCommand, listenBrowser, nativeBrowserAvailable } from '@/shared/ipc/browserApi';
import { JobStatusDock } from './JobStatusDock';

vi.mock('@/shared/ipc/browserApi', () => ({ nativeBrowserAvailable: vi.fn(), browserCommand: vi.fn(), listenBrowser: vi.fn() }));

beforeEach(() => {
  vi.mocked(nativeBrowserAvailable).mockReturnValue(true);
  vi.mocked(browserCommand).mockResolvedValue(undefined);
  vi.mocked(listenBrowser).mockResolvedValue(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  const originalBounds = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.nativeBrowserOverlay === 'task-dock') return { x: 300, y: 420, width: 360, height: 240 } as DOMRect;
    if (this.dataset.testid === 'native-page') return { x: 20, y: 80, width: 500, height: 600 } as DOMRect;
    return originalBounds.call(this);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function Shell() {
  const viewport = useRef<HTMLDivElement>(null);
  const browser = useBrowserViewport('fixture', viewport, true, () => {});
  useEffect(() => { void browser.navigate('https://example.org/'); }, []);
  return <div>
    <div ref={viewport} data-testid="native-page" />
    <JobStatusDock jobs={[]}
      assistantTasks={[{ id: 'fixture', title: '示例对话', question: '示例问题', status: 'running', canOpen: true, canStop: true }]} />
  </div>;
}

it('keeps native bounds unchanged and only clips the intersecting task panel; never hides, reloads or recreates the page', async () => {
  const ui = render(<Shell />);
  const expectLayout = async (open: boolean) => waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('fixture', 'layout', {
    visible: true, bounds: { x: 20, y: 80, width: 500, height: 600, pixel_ratio: 1 },
    ...(open ? { occlusions: [{ x: 300, y: 420, width: 220, height: 240 }] } : {}),
  }));
  await expectLayout(false);
  fireEvent.click(ui.getByRole('button', { name: '实时任务：1 个未完成任务' }));
  await expectLayout(true);
  expect(ui.getByRole('group', { name: '助手对话：示例对话' })).toBeTruthy();
  fireEvent.click(ui.getByRole('button', { name: '收起任务面板' }));
  await expectLayout(false);
  expect(vi.mocked(browserCommand).mock.calls.filter(call => call[1] === 'create')).toHaveLength(1);
  expect(vi.mocked(browserCommand).mock.calls.some(call => ['close', 'navigate', 'reload'].includes(call[1]))).toBe(false);
  expect(vi.mocked(browserCommand).mock.calls.some(call => call[1] === 'layout' && !call[2]?.visible)).toBe(false);
});
