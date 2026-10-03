import { describe, expect, it } from 'vitest';
import { MAX_BROWSER_OPEN_REQUESTS, browserTabActionFromEvent, planWorkspaceBrowserTab, type BrowserTabOpenAction } from './workspaceBrowserTabs';
import { initialWorkspaceSurfaceLayout, workspaceSurfaceReducer, type WorkspaceSurface, type WorkspaceSurfaceLayout } from './workspaceSurface';

const browser = (id: string): WorkspaceSurface => ({ kind: 'browser', id, url: `https://example.org/${id}`,
  title: id, navigationId: `document-${id}`, loading: false });
const request = (id = 'child', requestId = 'request-one'): BrowserTabOpenAction => ({ type: 'openBrowser', id,
  url: 'https://example.org/new', source: { sourceId: 'source', requestId } });
function split(): WorkspaceSurfaceLayout {
  const left = browser('source'), right = browser('other');
  return { focusedPane: 'right', left, right, leftTabs: [left], rightTabs: [right], pinnedTabKeys: ['browser:source'] };
}

describe('workspace browser popup routing', () => {
  it('opens a new tab beside its visible source despite focus moving to the other pane', () => {
    const before = split();
    const result = workspaceSurfaceReducer(before, request());
    expect(result.focusedPane).toBe('left');
    expect(result.left).toMatchObject({ kind: 'browser', id: 'child', url: 'https://example.org/new' });
    expect(result.leftTabs[0]).toMatchObject({ ...before.left, openRequestIds: ['request-one'] });
    expect(result.leftTabs.map(tab => tab.kind === 'browser' && tab.id)).toEqual(['source', 'child']);
    expect(result.right).toBe(before.right);
    expect(result.rightTabs).toBe(before.rightTabs);
    expect(result.pinnedTabKeys).toBe(before.pinnedTabKeys);
  });

  it('follows a source moved into the other pane before the request is handled', () => {
    const moved = workspaceSurfaceReducer(split(), { type: 'move', key: 'browser:source', pane: 'right' });
    const result = workspaceSurfaceReducer(moved, request());
    expect(result.right).toMatchObject({ kind: 'browser', id: 'child' });
    expect(result.rightTabs.some(tab => tab.kind === 'browser' && tab.id === 'source')).toBe(true);
    expect(result.left).toBe(moved.left);
  });

  it('drops requests from closed or hidden sources and keeps unrelated layout unchanged', () => {
    for (const before of [
      workspaceSurfaceReducer(split(), { type: 'close', pane: 'left', key: 'browser:source' }),
      workspaceSurfaceReducer(split(), { type: 'open', pane: 'left', surface: { kind: 'settings' } })
    ]) {
      expect(planWorkspaceBrowserTab(before, request()).status).toBe('ignored');
      expect(workspaceSurfaceReducer(before, request())).toBe(before);
    }
  });

  it('deduplicates a request after its child closes and allows another real request to the same URL', () => {
    let state = workspaceSurfaceReducer(split(), request());
    state = workspaceSurfaceReducer(state, { type: 'close', pane: 'left', key: 'browser:child' });
    expect(state.left).toMatchObject({ id: 'source' });
    expect(workspaceSurfaceReducer(state, request('duplicate'))).toBe(state);
    const next = workspaceSurfaceReducer(state, request('next-child', 'request-two'));
    expect(next.left).toMatchObject({ id: 'next-child' });
    expect(next.leftTabs[0]).toMatchObject({ id: 'source', openRequestIds: ['request-one', 'request-two'] });
  });

  it('caps new tabs at eight and never creates a failed empty placeholder', () => {
    let state = split();
    for (let index = 0; index < 6; index++) state = workspaceSurfaceReducer(state,
      { type: 'openBrowser', id: `extra-${index}`, url: 'https://example.org/' });
    const action: BrowserTabOpenAction = { type: 'openBrowser', id: 'overflow', url: 'https://example.org/' };
    expect(planWorkspaceBrowserTab(state, action).status).toBe('limit');
    expect(workspaceSurfaceReducer(state, action)).toBe(state);
    expect(workspaceSurfaceReducer(state, { type: 'openBrowser', id: 'empty' })).toBe(state);
    state = workspaceSurfaceReducer(state, { type: 'close', pane: 'right', key: 'browser:extra-0' });
    expect(workspaceSurfaceReducer(state, action).right).toMatchObject({ id: 'overflow' });
  });

  it('bounds request history for a source kept open through many child tabs', () => {
    let state = split();
    for (let index = 0; index < MAX_BROWSER_OPEN_REQUESTS + 2; index++) {
      state = workspaceSurfaceReducer(state, request('child', `request-${index}`));
      state = workspaceSurfaceReducer(state, { type: 'close', pane: 'left', key: 'browser:child' });
    }
    expect(state.left.kind).toBe('browser');
    if (state.left.kind !== 'browser') throw new Error('Source browser must remain active');
    expect(state.left.openRequestIds).toHaveLength(MAX_BROWSER_OPEN_REQUESTS);
    expect(state.left.openRequestIds?.[0]).toBe('request-2');
    expect(workspaceSurfaceReducer(state, request('duplicate', `request-${MAX_BROWSER_OPEN_REQUESTS + 1}`))).toBe(state);
  });

  it('normalizes legacy requests, rejects unsafe links and validates structured event identities', () => {
    expect(browserTabActionFromEvent('https://example.org/', 'legacy')).toEqual({ type: 'openBrowser', id: 'legacy', url: 'https://example.org/' });
    expect(browserTabActionFromEvent({ url: 'https://example.org/', sourceId: 'source', requestId: 'one' }, 'child'))
      .toMatchObject({ source: { sourceId: 'source', requestId: 'one' } });
    for (const detail of [null, {}, { url: 'https://example.org/', sourceId: 'source' }, { url: 'https://example.org/', sourceId: '', requestId: 'one' }]) {
      expect(browserTabActionFromEvent(detail, 'invalid')).toBeNull();
    }
    for (const url of ['javascript:alert(1)', 'about:blank', 'file:///C:/secret', 'https://user:password@example.org/']) {
      expect(workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'openBrowser', id: 'invalid', url })).toBe(initialWorkspaceSurfaceLayout);
    }
  });
});
