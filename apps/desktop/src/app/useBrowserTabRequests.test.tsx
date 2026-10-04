// @vitest-environment jsdom
import { useReducer } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BROWSER_OPEN_EVENT, requestBrowserTab } from '@/modules/browser/browserUrl';
import { useBrowserTabRequests } from './useBrowserTabRequests';
import { initialWorkspaceSurfaceLayout, workspaceSurfaceReducer } from './workspaceSurface';

afterEach(cleanup);

it('reserves capacity across batched events and reports the limit without invalid extra tabs', () => {
  const error = vi.fn();
  const { result } = renderHook(() => {
    const [layout, dispatch] = useReducer(workspaceSurfaceReducer, initialWorkspaceSurfaceLayout);
    const openNew = useBrowserTabRequests(layout, dispatch, error);
    return { layout, dispatch, openNew };
  });
  act(() => {
    for (let index = 0; index < 8; index++) requestBrowserTab(`https://example.org/${index}`);
    result.current.openNew();
  });
  expect(result.current.layout.leftTabs.filter(tab => tab.kind === 'browser')).toHaveLength(8);
  expect(error).toHaveBeenCalledExactlyOnceWith('limit');
  expect(result.current.layout.leftTabs.filter(tab => tab.kind === 'browser').every(tab => Boolean(tab.url))).toBe(true);
});

it('uses the latest source pane, deduplicates native requests and cleans up the event listener', () => {
  const error = vi.fn();
  const source = { kind: 'browser' as const, id: 'source', url: 'https://example.org/' };
  const initial = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', pane: 'right', surface: source });
  const { result, unmount } = renderHook(() => {
    const [layout, dispatch] = useReducer(workspaceSurfaceReducer, initial);
    useBrowserTabRequests(layout, dispatch, error);
    return { layout, dispatch };
  });
  act(() => result.current.dispatch({ type: 'focus', pane: 'left' }));
  act(() => {
    requestBrowserTab('https://example.org/child', { sourceId: 'source', requestId: 'one' });
    requestBrowserTab('https://example.org/child', { sourceId: 'source', requestId: 'one' });
  });
  expect(result.current.layout.rightTabs).toHaveLength(2);
  expect(result.current.layout.focusedPane).toBe('right');
  expect(result.current.layout.rightTabs[0]).toMatchObject(source);
  expect(error).not.toHaveBeenCalled();
  unmount();
  window.dispatchEvent(new CustomEvent(BROWSER_OPEN_EVENT, { detail: {} }));
  expect(error).not.toHaveBeenCalled();
});
