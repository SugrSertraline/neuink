// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useSameTagContext } from './useSameTagContext';
import { initialWorkspaceSurfaceLayout, type WorkspaceSurfaceLayout } from './workspaceSurface';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

afterEach(cleanup);
const tags = ['source', 'own', 'other'].map(id => ({ id, name: id, parent_id: id === 'own' ? 'source' : null, created_at: '', updated_at: '' }));
const entries = [{ id: 'a', tagIds: ['own'] }, { id: 'b', tagIds: ['other'] }, { id: 'none', tagIds: [] }] as LibraryEntry[];
const layout = (id: string, origin?: string): WorkspaceSurfaceLayout => ({ ...initialWorkspaceSurfaceLayout, left: { kind: 'entry-overview', entryId: id, contextTagId: origin } });
const render = (initial = layout('a', 'source')) => renderHook(({ value, root, currentTags }) => useSameTagContext(root, value, entries, currentTags, 'source'), { initialProps: { value: initial, root: 'workspace', currentTags: tags } });

it('captures the origin once and preserves manual scope and descendants across tabs and origins', () => {
  const view = render();
  expect(view.result.current).toMatchObject({ tagId: 'source', reason: '进入来源' });
  const key = view.result.current.contextKey;
  act(() => view.result.current.selectTag('own'));
  act(() => view.result.current.setDescendants(false));
  for (const value of [layout('b'), layout('a', 'other'), initialWorkspaceSurfaceLayout]) {
    view.rerender({ value, root: 'workspace', currentTags: tags });
    expect(view.result.current).toMatchObject({ tagId: 'own', descendants: false, reason: '手动选择', contextKey: key });
  }
});
it('keeps even the initial automatic scope fixed when switching papers', () => {
  const view = render();
  view.rerender({ value: layout('b'), root: 'workspace', currentTags: tags });
  expect(view.result.current).toMatchObject({ tagId: 'source', entryId: 'b' });
});
it('ignores the last library tag for directly opened and untagged papers', () => {
  expect(render(layout('a')).result.current.tagId).toBe('own');
  expect(render(layout('none')).result.current.tagId).toBeNull();
});
it('keeps explicit all-tags scope across tab switches', () => {
  const view = render();
  act(() => view.result.current.selectTag(null));
  view.rerender({ value: layout('b'), root: 'workspace', currentTags: tags });
  expect(view.result.current).toMatchObject({ tagId: null, reason: '全部标签', entryId: 'b' });
});

it('explicitly locating a note tag clears stale searches through the context key and preserves descendant preference', () => {
  const view = render();
  act(() => view.result.current.setDescendants(false));
  const key = view.result.current.contextKey;
  act(() => view.result.current.locateTag('source'));
  expect(view.result.current).toMatchObject({ tagId: 'source', descendants: false, reason: '定位所属标签' });
  expect(view.result.current.contextKey).not.toBe(key);
});
it('follows pane focus and paired tag-note paper context without changing browsing scope', () => {
  const value: WorkspaceSurfaceLayout = { ...layout('a', 'source'), right: { kind: 'pdf', entryId: 'b' }, focusedPane: 'right' };
  const view = render(value);
  expect(view.result.current).toMatchObject({ tagId: 'other', entryId: 'b' });
  view.rerender({ value: { ...value, focusedPane: 'left' }, root: 'workspace', currentTags: tags });
  expect(view.result.current).toMatchObject({ tagId: 'other', entryId: 'a' });
  view.rerender({ value: { ...value, right: { kind: 'owned-note', target: { owner: { kind: 'tag_reading', tag_id: 'other' }, note_id: 'note' } } }, root: 'workspace', currentTags: tags });
  expect(view.result.current).toMatchObject({ tagId: 'other', entryId: 'a' });
});
it('preserves an unavailable selected tag for the deleted-tag state, including after restore', () => {
  const view = render();
  view.rerender({ value: layout('b'), root: 'workspace', currentTags: tags.filter(tag => tag.id !== 'source') });
  expect(view.result.current.tagId).toBe('source');
  view.rerender({ value: layout('b'), root: 'workspace', currentTags: tags });
  expect(view.result.current.tagId).toBe('source');
});
it('explicitly starting parallel reading resets scope and filters even for the same tag', () => {
  const view = render();
  const key = view.result.current.contextKey;
  act(() => view.result.current.setDescendants(false));
  act(() => view.result.current.startReading('source'));
  view.rerender({ value: layout('b'), root: 'workspace', currentTags: tags });
  expect(view.result.current).toMatchObject({ tagId: 'source', descendants: true, reason: '进入来源' });
  expect(view.result.current.contextKey).not.toBe(key);
});
it('locates explicitly, handling ancestors, stale origins and untagged papers', () => {
  const view = render();
  act(() => view.result.current.selectTag('other'));
  act(() => view.result.current.locateEntry());
  expect(view.result.current).toMatchObject({ tagId: 'source', descendants: true });
  view.rerender({ value: layout('b', 'source'), root: 'workspace', currentTags: tags });
  act(() => view.result.current.locateEntry());
  expect(view.result.current.tagId).toBe('other');
  view.rerender({ value: layout('none'), root: 'workspace', currentTags: tags });
  act(() => view.result.current.locateEntry());
  expect(view.result.current.tagId).toBeNull();
});
it('resets across workspaces but preserves scope during PDF/overview switches', () => {
  const view = render();
  act(() => view.result.current.selectTag('other'));
  view.rerender({ value: { ...layout('a', 'source'), left: { kind: 'pdf', entryId: 'a', contextTagId: 'source' } }, root: 'workspace', currentTags: tags });
  expect(view.result.current.tagId).toBe('other');
  view.rerender({ value: layout('a', 'source'), root: 'new-workspace', currentTags: tags });
  expect(view.result.current.tagId).toBe('source');
});
it('waits for visible loaded content before initializing and retains scope while hidden', () => {
  const view = renderHook(({ enabled, value, currentEntries, currentTags }) => useSameTagContext('workspace', value, currentEntries, currentTags, null, enabled), {
    initialProps: { enabled: false, value: initialWorkspaceSurfaceLayout, currentEntries: [] as LibraryEntry[], currentTags: [] as typeof tags }
  });
  view.rerender({ enabled: true, value: layout('a', 'source'), currentEntries: entries, currentTags: tags });
  expect(view.result.current.tagId).toBe('source');
  view.rerender({ enabled: false, value: layout('b'), currentEntries: entries, currentTags: tags });
  view.rerender({ enabled: true, value: layout('b'), currentEntries: entries, currentTags: tags });
  expect(view.result.current).toMatchObject({ tagId: 'source', entryId: 'b' });
});
it('does not change browsing scope when the current paper disappears', () => {
  const view = renderHook(({ currentEntries }) => useSameTagContext('workspace', layout('a', 'source'), currentEntries, tags, null), { initialProps: { currentEntries: entries } });
  view.rerender({ currentEntries: entries.filter(entry => entry.id !== 'a') });
  act(() => view.result.current.locateEntry());
  expect(view.result.current).toMatchObject({ entryId: null, tagId: 'source' });
});
