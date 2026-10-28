// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { EntryMeta } from '@/shared/types/domain';
import { emptyWorkspaceSurfaceLayout, initialWorkspaceSurfaceLayout, surfaceKey, workspaceSurfaceReducer, type WorkspaceSurfaceLayout } from './workspaceSurface';
import { readWorkspaceSession, saveWorkspaceSession } from './workspaceSession';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
const catalog = { entries: [{ id: 'paper', pdf: {} as EntryMeta['pdf'], contents: [{ kind: 'note' as const, note_id: 'note', title: 'Note' }] }], tags: [{ id: 'tag' }] };
it('restores the deliberately empty workspace without reopening the library', () => {
  saveWorkspaceSession('a', emptyWorkspaceSurfaceLayout);
  expect(readWorkspaceSession('a', catalog)).toEqual(emptyWorkspaceSurfaceLayout);
  expect(readWorkspaceSession('b', catalog)).toEqual(initialWorkspaceSurfaceLayout);
});
it('does not recreate a closed library when the remaining tabs are unavailable after restart', () => {
  const paper = workspaceSurfaceReducer(emptyWorkspaceSurfaceLayout, { type: 'open', surface: { kind: 'pdf', entryId: 'paper' } });
  saveWorkspaceSession('a', paper);
  expect(readWorkspaceSession('a', { entries: [], tags: [] })).toEqual(emptyWorkspaceSurfaceLayout);
  const form = workspaceSurfaceReducer(emptyWorkspaceSurfaceLayout, { type: 'open', surface: { kind: 'create-entry' } });
  saveWorkspaceSession('a', form);
  expect(readWorkspaceSession('a', catalog)).toEqual(emptyWorkspaceSurfaceLayout);
});
it('restores a pinned dashboard with its reading companion and no closed library', () => {
  let value = workspaceSurfaceReducer(emptyWorkspaceSurfaceLayout, { type: 'open', surface: { kind: 'daily-dashboard' } });
  value = workspaceSurfaceReducer(value, { type: 'setPinned', key: 'daily-dashboard', pinned: true });
  value = workspaceSurfaceReducer(value, { type: 'open', pane: 'right', surface: { kind: 'pdf', entryId: 'paper' } });
  saveWorkspaceSession('a', value);
  expect(readWorkspaceSession('a', catalog)).toEqual(value);
});
function layout() {
  let value = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', surface: { kind: 'pdf', entryId: 'paper' } });
  value = workspaceSurfaceReducer(value, { type: 'duplicate', pane: 'right', key: 'pdf:paper', viewId: 'copy' });
  return workspaceSurfaceReducer(value, { type: 'setPinned', key: 'pdf:paper', pinned: true });
}
it('reopens tab identities, active panes, order and pinning without creating copies of files', () => {
  const value = layout();
  expect(saveWorkspaceSession('a', value)).toBe(true);
  expect(readWorkspaceSession('a', catalog)).toEqual(value);
  expect(readWorkspaceSession('b', catalog)).toEqual(initialWorkspaceSurfaceLayout);
});
it('drops deleted entries, missing PDFs and deleted notes, and collapses an empty pane', () => {
  const value = workspaceSurfaceReducer(layout(), { type: 'open', surface: { kind: 'note', entryId: 'paper', noteId: 'deleted' } });
  saveWorkspaceSession('a', value);
  const loaded = readWorkspaceSession('a', catalog);
  expect(loaded.right?.kind).toBe('pdf');
  expect([...loaded.leftTabs, ...loaded.rightTabs].some(tab => tab.kind === 'note')).toBe(false);
  expect(readWorkspaceSession('a', { entries: [], tags: [] })).toEqual(initialWorkspaceSurfaceLayout);
  expect(readWorkspaceSession('a', { ...catalog, entries: [{ ...catalog.entries[0], pdf: null }] })).toEqual(initialWorkspaceSurfaceLayout);
});
it('keeps a surviving right-side library singleton when every left tab disappears', () => {
  const value = workspaceSurfaceReducer(layout(), { type: 'swap' });
  saveWorkspaceSession('a', value);
  const loaded = readWorkspaceSession('a', { entries: [], tags: [] });
  expect(loaded).toEqual(initialWorkspaceSurfaceLayout);
});
it('only stores stable identities, excluding assistant replies, review state and unsaved forms', () => {
  let value = layout();
  for (const surface of [{ kind: 'create-entry' as const }, { kind: 'note-review' as const, proposalId: 'private-proposal', label: 'draft', entryId: 'paper' },
    { kind: 'assistant-reply' as const, message: { message_id: 'private-message', content: 'private answer' } as never }]) {
    value = workspaceSurfaceReducer(value, { type: 'open', surface });
  }
  saveWorkspaceSession('a', value);
  const raw = localStorage.getItem('neuink.workspace.session:a')!;
  expect(raw).not.toMatch(/private|draft|create-entry|note-review/);
  expect(readWorkspaceSession('a', catalog).right?.kind).toBe('pdf');
});
it('handles malformed/old snapshots and unavailable storage without breaking startup', () => {
  for (const raw of ['{', 'null', '{"version":99}', '{"version":1,"leftTabs":[null,{"kind":"pdf"}]}']) {
    localStorage.setItem('neuink.workspace.session:a', raw);
    expect(readWorkspaceSession('a', catalog)).toEqual(initialWorkspaceSurfaceLayout);
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
  expect(readWorkspaceSession('a', catalog)).toEqual(initialWorkspaceSurfaceLayout);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  expect(saveWorkspaceSession('a', layout())).toBe(false);
});
it('deduplicates and bounds snapshots, preserving valid pinned keys only', () => {
  localStorage.setItem('neuink.workspace.session:a', JSON.stringify({ version: 1,
    leftTabs: Array.from({ length: 200 }, (_, n) => ({ kind: 'pdf', entryId: 'paper', viewId: `v${n}` })),
    rightTabs: [{ kind: 'pdf', entryId: 'paper', viewId: 'v0' }], pinnedTabKeys: ['pdf:paper:view:v0', 'missing'], focusedPane: 'right' }));
  const value = readWorkspaceSession('a', catalog);
  expect(value.leftTabs).toHaveLength(80);
  expect(value.right).toBeNull();
  expect(value.focusedPane).toBe('left');
  expect(value.pinnedTabKeys).toEqual(['pdf:paper:view:v0']);
  expect(new Set(value.leftTabs.map(surfaceKey)).size).toBe(80);
});
it('restores entry and tag note owners while rejecting a deleted tag owner', () => {
  const value: WorkspaceSurfaceLayout = workspaceSurfaceReducer(layout(), { type: 'open', surface: {
    kind: 'owned-note', target: { owner: { kind: 'tag_reading', tag_id: 'tag' }, note_id: 'tag-note' }, label: 'Reading note' } });
  saveWorkspaceSession('a', value);
  expect(readWorkspaceSession('a', catalog).right?.kind).toBe('owned-note');
  expect(readWorkspaceSession('a', { ...catalog, tags: [] }).right?.kind).toBe('pdf');
});
it('restores tag reading and tag detail tabs only while their tags still exist', () => {
  let value = layout();
  for (const kind of ['tag-reading', 'tag-details'] as const) {
    value = workspaceSurfaceReducer(value, { type: 'open', surface: { kind, tagId: 'tag', label: 'Research' } });
  }
  saveWorkspaceSession('a', value);
  expect(readWorkspaceSession('a', catalog)).toEqual(value);
  expect(readWorkspaceSession('a', { ...catalog, tags: [] })).toEqual(layout());
});
