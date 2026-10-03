// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { BrowserEvent } from '@/shared/ipc/browserApi';
import { BrowserSurface } from './BrowserSurface';
import { BROWSER_OPEN_EVENT } from './browserUrl';

const native = vi.hoisted(() => ({ navigate: vi.fn(), action: vi.fn(), zoom: vi.fn(), available: true,
  event: null as ((event: BrowserEvent) => void) | null,
  events: new Map<string, (event: BrowserEvent) => void>() }));
vi.mock('./useBrowserViewport', () => ({ useBrowserViewport: (id: string, _viewport: unknown, _active: boolean,
  onEvent: (event: BrowserEvent) => void) => {
  native.event = onEvent;
  native.events.set(id, onEvent);
  return { native: native.available, error: null, navigate: native.navigate, action: native.action, zoom: native.zoom };
} }));
beforeEach(() => {
  native.navigate.mockReset().mockResolvedValue(undefined);
  native.action.mockReset().mockResolvedValue(undefined);
  native.zoom.mockReset().mockResolvedValue(undefined);
  native.available = true; native.event = null; native.events.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
function emit(patch: Partial<BrowserEvent>, id = 'web') {
  act(() => native.events.get(id)?.({ id, url: null, title: null, loading: null, error: null, ...patch }));
}
function openPage() {
  fireEvent.change(screen.getByRole('textbox', { name: '网页地址' }), { target: { value: 'example.org' } });
  fireEvent.click(screen.getByRole('button', { name: '访问' }));
}

it('invalidates the previous document before navigating and preserves native completion metadata', async () => {
  let finish!: () => void;
  native.navigate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const change = vi.fn();
  render(<BrowserSurface id="web" active onChange={change} />);
  openPage();
  expect(change).toHaveBeenLastCalledWith('https://example.org/', 'example.org', { navigationId: undefined, loading: true });
  emit({ url: 'https://example.org/', title: 'Loaded page', navigation_id: 'document-one', loading: false });
  await act(async () => finish());
  expect(change).toHaveBeenLastCalledWith('https://example.org/', 'Loaded page', { navigationId: 'document-one', loading: false });
  emit({ title: 'New title' });
  expect(change).toHaveBeenLastCalledWith('https://example.org/', 'New title', { navigationId: 'document-one', loading: false });
  fireEvent.click(screen.getByRole('button', { name: '刷新网页' }));
  expect(change).toHaveBeenLastCalledWith('https://example.org/', 'New title', { navigationId: undefined, loading: true });
  expect(native.action).toHaveBeenCalledWith('reload');
  emit({ url: 'https://example.org/', title: 'Reloaded', navigation_id: 'document-two', loading: false });
  expect(change).toHaveBeenLastCalledWith('https://example.org/', 'Reloaded', { navigationId: 'document-two', loading: false });
});

it('uses native loading and error states without keeping an earlier readable document', () => {
  const change = vi.fn();
  render(<BrowserSurface id="web" active onChange={change} />);
  emit({ url: 'https://example.org/', title: 'Page', navigation_id: 'old', loading: false });
  emit({ url: 'https://example.org/next', loading: true, navigation_id: 'pending' });
  expect(change).toHaveBeenLastCalledWith('https://example.org/next', 'example.org', { navigationId: 'pending', loading: true });
  expect(screen.getByRole('status').textContent).toContain('正在加载');
  emit({ loading: false, navigation_id: 'pending', error: '网页加载失败' });
  expect(change).toHaveBeenLastCalledWith('https://example.org/next', 'example.org', { navigationId: undefined, loading: false });
  expect(screen.getByRole('alert').textContent).toBe('网页加载失败');
});

it('keeps a synchronous native redirect when React batches navigation state and rerenders', async () => {
  const change = vi.fn();
  native.navigate.mockImplementation(async () => {
    native.event?.({ id: 'web', url: 'https://example.org/redirected', title: 'Redirected',
      navigation_id: 'redirected-document', loading: false, error: null });
  });
  const ui = render(<BrowserSurface id="web" active onChange={change} />);
  await act(async () => openPage());
  ui.rerender(<BrowserSurface id="web" active={false} onChange={change} />);
  emit({ title: 'Final title' });
  expect(change).toHaveBeenLastCalledWith('https://example.org/redirected', 'Final title',
    { navigationId: 'redirected-document', loading: false });
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText('Final title')).toBeNull();
});

it('invalidates a timed-out load and retains a usable refresh action', () => {
  vi.useFakeTimers();
  const change = vi.fn();
  render(<BrowserSurface id="web" active onChange={change} />);
  emit({ url: 'https://example.org/', navigation_id: 'pending', loading: true });
  act(() => vi.advanceTimersByTime(30_000));
  expect(change).toHaveBeenLastCalledWith('https://example.org/', 'example.org', { navigationId: undefined, loading: false });
  expect(screen.getByRole('alert').textContent).toContain('网页加载较久');
  expect((screen.getByRole('button', { name: '刷新网页' }) as HTMLButtonElement).disabled).toBe(false);
});

it('lets internal native focus select the visible pane and ignores focus from a hidden tab', () => {
  const onFocus = vi.fn(), onChange = vi.fn();
  const ui = render(<BrowserSurface id="web" active onFocus={onFocus} onChange={onChange} />);
  emit({ focused: true });
  expect(onFocus).toHaveBeenCalledOnce();
  expect(onChange).not.toHaveBeenCalled();
  ui.rerender(<BrowserSurface id="web" active={false} onFocus={onFocus} onChange={onChange} />);
  emit({ focused: true });
  expect(onFocus).toHaveBeenCalledOnce();
});

it('opens popup links as new tab requests without changing or reloading the source document', () => {
  const receive = vi.fn(), change = vi.fn();
  window.addEventListener(BROWSER_OPEN_EVENT, receive);
  try {
    const ui = render(<BrowserSurface id="web" active onChange={change} />);
    emit({ url: 'https://example.org/original', title: 'Original', navigation_id: 'source-document', loading: false });
    change.mockClear();
    emit({ openTab: { requestId: 'popup-one', url: 'https://example.org/new' } });
    expect(receive).toHaveBeenCalledOnce();
    expect((receive.mock.calls[0][0] as CustomEvent).detail).toEqual({
      url: 'https://example.org/new', sourceId: 'web', requestId: 'popup-one'
    });
    expect(change).not.toHaveBeenCalled();
    expect(native.navigate).not.toHaveBeenCalled();
    expect(native.action).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: '网页地址' }) as HTMLInputElement).value).toBe('https://example.org/original');
    ui.rerender(<BrowserSurface id="web" active={false} onChange={change} />);
    emit({ openTab: { requestId: 'popup-hidden', url: 'https://example.org/background' } });
    expect(receive).toHaveBeenCalledOnce();
  } finally { window.removeEventListener(BROWSER_OPEN_EVENT, receive); }
});

it.each([{ requestId: 'bad-url', url: 'file:///C:/private' },
  { requestId: 'limited', error: '网页打开新标签过于频繁，请稍后重试。' }])('keeps source reading identity after a rejected popup %j', openTab => {
  const change = vi.fn(), receive = vi.fn();
  window.addEventListener(BROWSER_OPEN_EVENT, receive);
  try {
    render(<BrowserSurface id="web" active onChange={change} />);
    emit({ url: 'https://example.org/original', title: 'Original', navigation_id: 'source-document', loading: false });
    change.mockClear();
    emit({ openTab });
    expect(screen.getByRole('alert').textContent).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
    emit({ title: 'Still readable' });
    expect(change).toHaveBeenLastCalledWith('https://example.org/original', 'Still readable', {
      navigationId: 'source-document', loading: false
    });
  } finally { window.removeEventListener(BROWSER_OPEN_EVENT, receive); }
});

it('keeps loading accessible inside the address toolbar without a second title row', () => {
  render(<BrowserSurface id="web" active />);
  emit({ url: 'https://example.org/', title: 'Document title', loading: true });
  expect(screen.getByRole('textbox', { name: '网页地址' }).getAttribute('aria-busy')).toBe('true');
  expect(screen.getByRole('status').classList.contains('sr-only')).toBe(true);
  expect(screen.queryByText('Document title')).toBeNull();
  emit({ loading: false, navigation_id: 'ready' });
  expect(screen.getByRole('textbox', { name: '网页地址' }).getAttribute('aria-busy')).toBe('false');
  expect(screen.queryByRole('status')).toBeNull();
});

it('uses actual native zoom and never invalidates the readable document when zooming', async () => {
  const change = vi.fn();
  render(<BrowserSurface id="web" active onChange={change} />);
  emit({ url: 'https://example.org/', title: 'Original title', loading: false, navigation_id: 'readable' });
  change.mockClear();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '放大网页' })));
  expect(native.zoom).toHaveBeenLastCalledWith(1.1);
  expect(screen.getByRole('button', { name: '网页缩放 100%，恢复为 100%' })).toBeTruthy();
  // Dedicated zoom events may include unrelated state fields; they are not navigation events.
  emit({ zoom: 1.25, url: 'https://ignored.invalid/', title: 'Ignored', navigation_id: 'ignored', loading: true });
  expect(screen.getByRole('button', { name: '网页缩放 125%，恢复为 100%' })).toBeTruthy();
  expect((screen.getByRole('textbox', { name: '网页地址' }) as HTMLInputElement).value).toBe('https://example.org/');
  expect(change).not.toHaveBeenCalled();
  expect(native.navigate).not.toHaveBeenCalled();
  expect(native.action).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '缩小网页' })));
  expect(native.zoom).toHaveBeenLastCalledWith(1.1);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '网页缩放 125%，恢复为 100%' })));
  expect(native.zoom).toHaveBeenLastCalledWith(1);
  emit({ title: 'Still readable' });
  expect(change).toHaveBeenLastCalledWith('https://example.org/', 'Still readable', { navigationId: 'readable', loading: false });
});

it('keeps separate ratios per tab across hide, activation, and navigation', () => {
  const ui = render(<><BrowserSurface id="left" active /><BrowserSurface id="right" active /></>);
  emit({ url: 'https://left.example/', loading: false }, 'left');
  emit({ url: 'https://right.example/', loading: false }, 'right');
  emit({ zoom: 1.5 }, 'left');
  emit({ zoom: 0.75 }, 'right');
  const panes = screen.getAllByRole('region', { name: '网页浏览器' });
  expect(within(panes[0]).getByRole('button', { name: '网页缩放 150%，恢复为 100%' })).toBeTruthy();
  expect(within(panes[1]).getByRole('button', { name: '网页缩放 75%，恢复为 100%' })).toBeTruthy();
  ui.rerender(<><BrowserSurface id="left" active={false} /><BrowserSurface id="right" active /></>);
  emit({ url: 'https://left.example/next', navigation_id: 'next', loading: false }, 'left');
  expect((within(panes[0]).getByRole('button', { name: '网页缩放 150%，恢复为 100%' }) as HTMLButtonElement).disabled).toBe(true);
  ui.rerender(<><BrowserSurface id="left" active /><BrowserSurface id="right" active /></>);
  expect((within(panes[0]).getByRole('button', { name: '网页缩放 150%，恢复为 100%' }) as HTMLButtonElement).disabled).toBe(false);
  expect(within(panes[1]).getByRole('button', { name: '网页缩放 75%，恢复为 100%' })).toBeTruthy();
  expect(native.zoom).not.toHaveBeenCalled();
});

it.each([NaN, Infinity, -Infinity, 0, -1])('ignores invalid native zoom %s', zoom => {
  render(<BrowserSurface id="web" active />);
  emit({ zoom: 1.25 });
  emit({ zoom });
  expect(screen.getByRole('button', { name: '网页缩放 125%，恢复为 100%' })).toBeTruthy();
});

it.each(['empty', 'preview', 'loading', 'hidden'] as const)('disables zoom when the page is %s', state => {
  native.available = state !== 'preview';
  render(<BrowserSurface id="web" active={state !== 'hidden'} />);
  if (state !== 'empty') emit({ url: 'https://example.org/', loading: state === 'loading' });
  for (const button of within(screen.getByRole('group', { name: '网页缩放' })).getAllByRole('button')) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(native.zoom).not.toHaveBeenCalled();
});

it('disables only the direction that exceeds the zoom range', () => {
  render(<BrowserSurface id="web" active />);
  emit({ url: 'https://example.org/', loading: false });
  emit({ zoom: 0.5 });
  expect((screen.getByRole('button', { name: '缩小网页' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '放大网页' }) as HTMLButtonElement).disabled).toBe(false);
  emit({ zoom: 3 });
  expect((screen.getByRole('button', { name: '放大网页' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '缩小网页' }) as HTMLButtonElement).disabled).toBe(false);
});

it('serializes zoom requests and keeps reading identity after a rejected operation', async () => {
  let reject!: (reason: Error) => void;
  native.zoom.mockImplementation(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  const change = vi.fn();
  render(<BrowserSurface id="web" active onChange={change} />);
  emit({ url: 'https://example.org/', title: 'Page', navigation_id: 'stable', loading: false });
  change.mockClear();
  act(() => {
    fireEvent.keyDown(screen.getByRole('textbox', { name: '网页地址' }), { key: '+', ctrlKey: true });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '网页地址' }), { key: '+', ctrlKey: true });
  });
  expect(native.zoom).toHaveBeenCalledOnce();
  expect(screen.getByRole('group', { name: '网页缩放' }).getAttribute('aria-busy')).toBe('true');
  expect((screen.getByRole('button', { name: '放大网页' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(new Error('Zoom rejected')));
  expect(screen.getByRole('alert').textContent).toBe('网页缩放失败，请再次点击缩放按钮重试。');
  expect(screen.getByRole('group', { name: '网页缩放' }).getAttribute('aria-busy')).toBe('false');
  expect((screen.getByRole('button', { name: '放大网页' }) as HTMLButtonElement).disabled).toBe(false);
  expect(change).not.toHaveBeenCalled();
  emit({ title: 'Still readable' });
  expect(change).toHaveBeenLastCalledWith('https://example.org/', 'Still readable', { navigationId: 'stable', loading: false });
});

it('clears a failed zoom when retrying and preserves its recovered native ratio', async () => {
  native.zoom.mockRejectedValueOnce(new Error('First zoom failed'));
  render(<BrowserSurface id="web" active />);
  emit({ url: 'https://example.org/', loading: false });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '放大网页' })));
  expect(screen.getByRole('alert').textContent).toContain('网页缩放失败');
  let finish!: () => void;
  native.zoom.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '放大网页' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('group', { name: '网页缩放' }).getAttribute('aria-busy')).toBe('true');
  emit({ zoom: 1.1 });
  await act(async () => finish());
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: '网页缩放 110%，恢复为 100%' })).toBeTruthy();
});

it('clears only zoom failures when native keyboard or wheel zoom succeeds', async () => {
  native.zoom.mockRejectedValueOnce(new Error('Zoom failed'));
  render(<BrowserSurface id="web" active />);
  emit({ url: 'https://example.org/', loading: false });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '放大网页' })));
  expect(screen.getByRole('alert').textContent).toContain('网页缩放失败');
  emit({ zoom: 1.25 });
  expect(screen.queryByRole('alert')).toBeNull();
  emit({ loading: false, error: '网页加载失败，请刷新重试。' });
  emit({ zoom: 1.5 });
  expect(screen.getByRole('alert').textContent).toBe('网页加载失败，请刷新重试。');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '缩小网页' })));
  expect(screen.getByRole('alert').textContent).toBe('网页加载失败，请刷新重试。');
});

it.each([
  { key: '+', ctrlKey: true, expected: 1.1 },
  { key: '=', metaKey: true, expected: 1.1 },
  { key: '-', ctrlKey: true, expected: 0.9 },
  { key: '0', metaKey: true, expected: 1 }
])('handles the local zoom shortcut $key without bubbling into application scaling', async shortcut => {
  const parentKey = vi.fn();
  render(<div onKeyDown={parentKey}><BrowserSurface id="web" active /></div>);
  emit({ url: 'https://example.org/', loading: false });
  let notPrevented = true;
  await act(async () => { notPrevented = fireEvent.keyDown(screen.getByRole('textbox', { name: '网页地址' }), shortcut); });
  expect(notPrevented).toBe(false);
  expect(parentKey).not.toHaveBeenCalled();
  expect(native.zoom).toHaveBeenLastCalledWith(shortcut.expected);
});

it.each([{ key: '+' }, { key: '+', ctrlKey: true, altKey: true }, { key: '+', ctrlKey: true, isComposing: true }])('ignores non-zoom or composing shortcuts %j', shortcut => {
  render(<BrowserSurface id="web" active />);
  emit({ url: 'https://example.org/', loading: false });
  fireEvent.keyDown(screen.getByRole('textbox', { name: '网页地址' }), shortcut);
  expect(native.zoom).not.toHaveBeenCalled();
});

it('does not publish or start more work when an outstanding zoom fails after unmount', async () => {
  let reject!: (reason: Error) => void;
  native.zoom.mockImplementation(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  const change = vi.fn();
  const ui = render(<BrowserSurface id="web" active onChange={change} />);
  emit({ url: 'https://example.org/', navigation_id: 'stable', loading: false });
  change.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '放大网页' }));
  ui.unmount();
  await act(async () => reject(new Error('Closed')));
  expect(change).not.toHaveBeenCalled();
  expect(native.zoom).toHaveBeenCalledOnce();
  expect(native.navigate).not.toHaveBeenCalled();
  expect(native.action).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
});
