import { describe, expect, it } from 'vitest';
import { assistantSurfaceContext } from './assistantSurfaceContext';
import { resolveAssistantReadingContext } from '@/modules/assistant/components/assistantReadingContext';
import { buildAssistantScope } from '@/modules/assistant/components/assistantScope';
import { scopedEntryIds } from '@/modules/assistant/sdk/toolSupport';
import { resolveActiveActivityPanel, resolveLibrarySidebarMode, type SidePanel } from './activityBarState';
import { resolveEntrySidebarContext, resolveTagNoteSidebarContext } from './entrySidebarContext';
import { surfaceKey, workspaceSurfaceReducer, type WorkspaceSurface, type WorkspaceSurfaceLayout } from './workspaceSurface';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

const entries = ['a', 'b'].map(id => ({ id, title: id, contents: [{ kind: 'note', note_id: `note-${id}`, title: `Note ${id}` }],
  tagIds: [], tags: [], fields: {}, createdAt: '', updatedAt: '', pdfFileName: `${id}.pdf`, status: 'Failed', progress: 0, parseEndpoint: null, parseMessage: null } as LibraryEntry));
const selection = { entryId: 'a', entryTitle: 'a', segmentUid: 'segment-a', text: 'Text A', pageIdx: 1 };
const surfaces: WorkspaceSurface[] = [{ kind: 'library' }, { kind: 'settings' }, { kind: 'relations' }, { kind: 'browser', id: 'web' },
  { kind: 'pdf', entryId: 'a' }, { kind: 'reflow', entryId: 'b' }, { kind: 'entry-overview', entryId: 'a' }, { kind: 'note', entryId: 'b', noteId: 'note-b' },
  { kind: 'owned-note', target: { owner: { kind: 'entry', entry_id: 'a' }, note_id: 'note-a' } },
  { kind: 'owned-note', target: { owner: { kind: 'tag_reading', tag_id: 'tag' }, note_id: 'tag-note' } },
  { kind: 'segment-notes', entryId: 'a', segmentUid: 'other' }, { kind: 'source-links', entryId: 'a' }, { kind: 'entry-trash', entryId: 'a' },
  { kind: 'note-review', entryId: 'a', noteId: 'note-a', proposalId: 'p', label: 'Note A' },
  { kind: 'create-entry' }, { kind: 'mineru-client-guide' }, { kind: 'tag-editor' },
  { kind: 'tag-reading', tagId: 'tag' }, { kind: 'tag-details', tagId: 'tag' }];
function layout(left: WorkspaceSurface, right: WorkspaceSurface | null, focusedPane: 'left' | 'right' = 'left'): WorkspaceSurfaceLayout {
  return { left, right, focusedPane, leftTabs: [left], rightTabs: right ? [right] : [] };
}
describe('side-tool × content × split-focus matrix', () => {
  it('captures only the focused ready browser document across split changes and navigation', () => {
    const web: WorkspaceSurface = { kind: 'browser', id: 'web', url: 'https://example.org/a', title: 'Page A', navigationId: 'navigation-a', loading: false };
    const webTwo: WorkspaceSurface = { kind: 'browser', id: 'web-two', url: 'https://example.org/b', title: 'Page B', navigationId: 'navigation-b', loading: false };
    let state = layout(web, webTwo, 'right');
    const frozen = assistantSurfaceContext(state, entries, selection);
    expect(frozen.surface.browserTab).toEqual({ id: 'web-two', url: 'https://example.org/b', title: 'Page B', navigationId: 'navigation-b' });
    expect(frozen.entry).toBeNull(); expect(frozen.note).toBeNull(); expect(frozen.segment).toBeNull();
    state = workspaceSurfaceReducer(state, { type: 'focus', pane: 'left' });
    expect(assistantSurfaceContext(state, entries, selection).surface.browserTab?.id).toBe('web');
    state = workspaceSurfaceReducer(state, { type: 'updateBrowser', id: 'web', url: 'https://example.org/next', title: 'Next',
      metadata: { navigationId: undefined, loading: true } });
    expect(assistantSurfaceContext(state, entries, selection).surface.browserTab).toBeUndefined();
    state = workspaceSurfaceReducer(state, { type: 'updateBrowser', id: 'web', url: 'https://example.org/next', title: 'Next',
      metadata: { navigationId: 'navigation-next', loading: false } });
    expect(assistantSurfaceContext(state, entries, selection).surface.browserTab?.navigationId).toBe('navigation-next');
    state = workspaceSurfaceReducer(state, { type: 'updateBrowser', id: 'web', url: 'https://example.org/unconfirmed', title: 'Unconfirmed' });
    expect(assistantSurfaceContext(state, entries, selection).surface.browserTab).toBeUndefined();
    expect(frozen.surface.browserTab?.navigationId).toBe('navigation-b');
    expect(assistantSurfaceContext(layout({ kind: 'pdf', entryId: 'a' }, web), entries, selection).surface.browserTab).toBeUndefined();
  });
  it('omits blank, unsafe, loading and non-native browser targets', () => {
    for (const overrides of [{ url: undefined }, { url: 'example.org' }, { url: 'about:blank' }, { url: 'file:///C:/secret' },
      { url: 'https://user:password@example.org/' }, { url: 'http://localhost:1420/' },
      { loading: true }, { navigationId: undefined }]) {
      const web: WorkspaceSurface = { kind: 'browser', id: 'web', url: 'https://example.org/', navigationId: 'navigation', loading: false, ...overrides };
      expect(assistantSurfaceContext(layout(web, null), entries, selection).surface.browserTab).toBeUndefined();
    }
  });
  it.each<SidePanel>(['assistant', 'library', 'details', 'search', 'same-tag'])('%s stays independent across every surface kind, companion choices and focus directions', sidePanel => {
    for (const left of surfaces) for (const right of surfaces.filter(s => surfaceKey(s) !== surfaceKey(left))) for (const focus of ['left', 'right'] as const) {
      const state = layout(left, right, focus); const current = state[focus]!;
      expect(resolveActiveActivityPanel({ sidePanel, sidebarOpen: true, focusedSurfaceKind: current.kind })).toBe(sidePanel);
      const resolved = assistantSurfaceContext(state, entries, selection);
      const solo = assistantSurfaceContext(layout(current, null), entries, selection);
      expect(resolved.entry).toEqual(solo.entry); expect(resolved.note).toEqual(solo.note); expect(resolved.segment).toEqual(solo.segment);
      const entry = resolveEntrySidebarContext(state), tagNote = resolveTagNoteSidebarContext(state);
      const mode = resolveLibrarySidebarMode(sidePanel, Boolean(entry), Boolean(tagNote));
      expect(mode).toBe(sidePanel === 'library' ? 'library' : sidePanel !== 'details' ? null : tagNote ? 'note-details' : entry ? 'entry-details' : 'empty-details');
    }
  });
  it('never reuses an old PDF selection in its note, overview, source list or other paper', () => {
    for (const current of surfaces.filter(s => s.kind !== 'pdf')) expect(assistantSurfaceContext(layout(current, null), entries, selection).segment).toBeNull();
  });
  it('resolves entry-owned notes and preserves tag-note neutrality after a pane swap', () => {
    const state = layout(surfaces[4], surfaces[8], 'right');
    expect(assistantSurfaceContext(state, entries, selection).note?.noteId).toBe('note-a');
    expect(assistantSurfaceContext(workspaceSurfaceReducer(state, { type: 'swap' }), entries, selection).note?.noteId).toBe('note-a');
    expect(assistantSurfaceContext(layout(surfaces[4], surfaces[9], 'right'), entries, selection).entry).toBeNull();
  });
  it('explicit target beats an attached selection; missing targets cannot silently fall back', () => {
    const active = assistantSurfaceContext(layout(surfaces[4], null), entries, selection);
    const base = { activeEntry: active.entry, activeNote: active.note, activeSegment: active.segment, activeSurface: active.surface, entries, items: [] };
    expect(resolveAssistantReadingContext({ ...base, choice: { entryId: 'b', noteId: 'note-b' } })).toMatchObject({ label: 'Note b', segment: null, unavailable: false });
    expect(resolveAssistantReadingContext({ ...base, choice: { entryId: 'deleted' } }).unavailable).toBe(true);
    expect(resolveAssistantReadingContext({ ...base, choice: null, activeEntry: null }).unavailable).toBe(true);
  });
  it('includes unparsed and metadata-only entries in library scope without broadening an empty selection', () => {
    expect(buildAssistantScope({ activeEntry: null, activeTag: null, selectedTagIds: [], entries, tags: [] }).entry_ids).toEqual(['a', 'b']);
    const empty = { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] };
    expect(() => scopedEntryIds([], empty)).toThrow('没有可检索条目');
    expect(() => scopedEntryIds(['b'], { ...empty, entry_ids: ['a'] })).toThrow('超出冻结范围');
    expect(scopedEntryIds([], { ...empty, entry_ids: ['a'] })).toEqual(['a']);
  });
  it('explicitly unbinds every tab and pane even with a selection, without changing attached items', () => {
    const items = [{ ...selection, id: 'selection:a', kind: 'segment' as const, label: 'Selected text', addedAt: '' }];
    for (const current of surfaces) for (const pane of ['left', 'right'] as const) {
      const active = assistantSurfaceContext(layout(surfaces[4], current, pane), entries, selection);
      const resolved = resolveAssistantReadingContext({ choice: 'none', entries, items,
        activeEntry: active.entry, activeNote: active.note, activeSegment: active.segment, activeSurface: active.surface });
      expect(resolved).toMatchObject({ entry: null, note: null, segment: null, bound: true, unavailable: false,
        label: '不关联内容', surface: { kind: 'library', surfaceKey: 'library', entryId: null, noteId: null, segmentUid: null } });
      expect(resolved.notice).toBeUndefined();
    }
    expect(items).toHaveLength(1);
    const active = assistantSurfaceContext(layout(surfaces[4], null), entries, selection);
    const base = { entries, items: [], activeEntry: active.entry, activeNote: active.note, activeSegment: active.segment, activeSurface: active.surface };
    expect(resolveAssistantReadingContext({ ...base, choice: null }).entry?.id).toBe('a');
    expect(resolveAssistantReadingContext({ ...base, choice: { entryId: 'b', noteId: 'note-b' } }).note?.noteId).toBe('note-b');
    expect(resolveAssistantReadingContext({ ...base, choice: 'none', activeEntry: null }).unavailable).toBe(false);
  });
});
