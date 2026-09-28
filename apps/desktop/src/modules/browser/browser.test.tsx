// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { normalizeBrowserUrl, BROWSER_OPEN_EVENT } from './browserUrl';
import { BrowserSurface } from './BrowserSurface';
import { WorkspaceWebLink } from '@/shared/components/WorkspaceWebLink';
import { initialWorkspaceSurfaceLayout, surfaceKey, workspaceSurfaceReducer } from '@/app/workspaceSurface';
vi.mock('@/shared/ipc/browserApi', () => ({ nativeBrowserAvailable: () => false, browserCommand: vi.fn(), listenBrowser: vi.fn() }));
afterEach(cleanup);
it('accepts a typed domain and rejects executable, local and credential-bearing URLs', () => {
  expect(normalizeBrowserUrl('arxiv.org/abs/2603.05085')).toBe('https://arxiv.org/abs/2603.05085');
  for (const url of ['javascript:alert(1)', 'file:///C:/a', 'data:text/html,a', 'https://user:pass@example.org', 'http://localhost:1420', 'http://127.1', 'https://asset.localhost/a', 'http://[::1]', 'C:\\file.pdf', '', 'not a url']) expect(() => normalizeBrowserUrl(url)).toThrow();
});
it('uses stable tab identity through navigation, split movement, background updates and close', () => {
  let state = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', surface: { kind: 'browser', id: 'one' } });
  state = workspaceSurfaceReducer(state, { type: 'open', surface: { kind: 'browser', id: 'two' }, pane: 'right' });
  state = workspaceSurfaceReducer(state, { type: 'updateBrowser', id: 'one', url: 'https://example.org/', title: 'Example' });
  expect(state.focusedPane).toBe('right'); expect(surfaceKey(state.left)).toBe('browser:one');
  state = workspaceSurfaceReducer(state, { type: 'move', key: 'browser:one', pane: 'right' });
  expect(state.rightTabs.filter(s => surfaceKey(s) === 'browser:one')).toHaveLength(1);
  state = workspaceSurfaceReducer(state, { type: 'close', pane: 'right', key: 'browser:one' });
  state = workspaceSurfaceReducer(state, { type: 'updateBrowser', id: 'one', url: 'https://late.example/', title: 'Late' });
  expect([...state.leftTabs, ...state.rightTabs].some(s => surfaceKey(s) === 'browser:one')).toBe(false);
});
it('reports browser-preview limitations instead of showing a blocked or fake iframe', async () => {
  const change = vi.fn(); render(<BrowserSurface id="one" active onChange={change} />);
  fireEvent.keyDown(screen.getByRole('region', { name: '网页浏览器' }), { key: 'l', ctrlKey: true });
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '网页地址' }));
  fireEvent.change(screen.getByRole('textbox', { name: '网页地址' }), { target: { value: 'example.org' } });
  fireEvent.click(screen.getByRole('button', { name: '访问' }));
  await waitFor(() => expect(screen.getByRole('link', { name: '在外部浏览器打开' }).getAttribute('href')).toBe('https://example.org/'));
  expect(change).toHaveBeenCalledWith('https://example.org/', 'example.org');
  fireEvent.change(screen.getByRole('textbox', { name: '网页地址' }), { target: { value: 'file:///C:/secret' } });
  fireEvent.click(screen.getByRole('button', { name: '访问' }));
  expect(screen.getByRole('alert').textContent).toContain('HTTP(S)');
});
it('routes normal assistant link clicks into a browser tab and never routes unsafe URLs', () => {
  const event = vi.fn(); window.addEventListener(BROWSER_OPEN_EVENT, event);
  const ui = render(<WorkspaceWebLink href="https://arxiv.org">论文网站</WorkspaceWebLink>);
  fireEvent.click(screen.getByRole('link')); expect(event).toHaveBeenCalledOnce();
  ui.rerender(<WorkspaceWebLink href="javascript:alert(1)">坏链接</WorkspaceWebLink>);
  expect(screen.queryByRole('link')).toBeNull(); window.removeEventListener(BROWSER_OPEN_EVENT, event);
});
