import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { initialWorkspaceSurfaceLayout, noteSurface, surfaceKey, workspaceSurfaceOpenActions, workspaceSurfaceReducer, type WorkspaceSurfaceLayout } from './workspaceSurface';
import { sameTagEntries, startTagReadingActions, tagNoteOpenPane, tagReadingSurface } from './tagReadingNavigation';

const tags = [{ id: 'parent', name: '软件工程', parent_id: null, created_at: '', updated_at: '' }, { id: 'child', name: '需求', parent_id: 'parent', created_at: '', updated_at: '' }];
const paper = (id: string, tagIds = ['parent']): LibraryEntry => ({ id, title: id, tagIds, tags: [], contents: [], fields: {}, createdAt: '', updatedAt: '', pdfFileName: `${id}.pdf`, status: 'Parsed', progress: 100, parseMessage: null, parseEndpoint: null });
const start = (entries: LibraryEntry[], layout: WorkspaceSurfaceLayout = initialWorkspaceSurfaceLayout) => startTagReadingActions(layout, entries, 'parent').reduce(workspaceSurfaceReducer, layout);

describe('tag reading in the existing workspace split', () => {
  it('opens tag notes opposite the focused paper and reuses existing editors in place', () => {
    const target = { owner: { kind: 'tag_reading' as const, tag_id: 'parent' }, note_id: 'draft' };
    const original = start([paper('one'), paper('two')]);
    expect(tagNoteOpenPane(original, target, true)).toBe('right');
    expect(tagNoteOpenPane({ ...original, focusedPane: 'right' }, target, true)).toBe('left');
    const opened = workspaceSurfaceOpenActions(original, noteSurface(target), tagNoteOpenPane(original, target, true)).reduce(workspaceSurfaceReducer, original);
    expect(opened.left).toEqual(original.left);
    expect(tagNoteOpenPane(opened, { ...target, note_id: 'second-note' })).toBe('right');
    const withPaperFocused = workspaceSurfaceReducer(opened, { type: 'open', pane: 'right', surface: tagReadingSurface(paper('two')) });
    const actions = workspaceSurfaceOpenActions(withPaperFocused, noteSurface(target), tagNoteOpenPane(withPaperFocused, target));
    expect(actions.some(action => action.type === 'move')).toBe(false);
    expect(actions.reduce(workspaceSurfaceReducer, withPaperFocused).rightTabs.filter(surface => surfaceKey(surface) === surfaceKey(noteSurface(target)))).toHaveLength(1);
  });
  it('opens normally in the active pane without creating a split, and splits only on an explicit request', () => {
    const target = { owner: { kind: 'tag_reading' as const, tag_id: 'parent' }, note_id: 'draft' };
    const single = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', surface: tagReadingSurface(paper('one')) });
    const direct = workspaceSurfaceOpenActions(single, noteSurface(target), tagNoteOpenPane(single, target)).reduce(workspaceSurfaceReducer, single);
    expect(direct.left.kind).toBe('owned-note');
    expect(direct.right).toBeNull();
    expect(direct.leftTabs.some(surface => surfaceKey(surface) === 'pdf:one')).toBe(true);
    const split = workspaceSurfaceOpenActions(single, noteSurface(target), tagNoteOpenPane(single, target, true)).reduce(workspaceSurfaceReducer, single);
    expect(split.left).toEqual(single.left);
    expect(split.right?.kind).toBe('owned-note');
    expect(tagNoteOpenPane({ ...split, focusedPane: 'right' }, { ...target, note_id: 'another' })).toBe('right');
  });
  it('starts two ordinary readers without creating a tag-reading surface', () => {
    const layout = start([paper('one'), paper('two')]);
    expect(layout.left).toEqual({ kind: 'pdf', entryId: 'one', contextTagId: 'parent' });
    expect(layout.right).toEqual({ kind: 'pdf', entryId: 'two', contextTagId: 'parent' });
    expect(layout.focusedPane).toBe('left');
    expect(layout.leftTabs[0]).toEqual({ kind: 'library' });
  });
  it('preserves an existing right note and unrelated tabs', () => {
    const layout = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', pane: 'right', surface: { kind: 'owned-note', target: { owner: { kind: 'tag_reading', tag_id: 'parent' }, note_id: 'draft' } } });
    expect(start([paper('one'), paper('two')], layout).right).toBe(layout.right);
  });
  it('moves an existing paper through normal placement actions and never duplicates an editor', () => {
    const layout = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', pane: 'right', surface: tagReadingSurface(paper('one'), 'parent') });
    const result = start([paper('one'), paper('two')], layout);
    expect(result.left.kind).toBe('pdf');
    const keys = [...result.leftTabs, ...result.rightTabs].map(surfaceKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(startTagReadingActions(layout, [paper('one'), paper('two')], 'parent').some(action => action.type === 'move')).toBe(true);
  });
  it('supports a single paper, parsed-only content and metadata-only entries', () => {
    expect(start([paper('one')]).right?.kind).toBe('entry-overview');
    expect(tagReadingSurface({ ...paper('one'), pdfFileName: null }, 'parent').kind).toBe('reflow');
    const metadata = { ...paper('one'), pdfFileName: null, status: 'No PDF' as const };
    expect(start([metadata]).left.kind).toBe('entry-overview');
    expect(start([metadata]).right?.kind).toBe('library');
    expect(start([])).toBe(initialWorkspaceSurfaceLayout);
  });
  it('uses live membership, explicit descendants and excludes deleted tags without duplicate papers', () => {
    const entries = [paper('direct'), paper('child', ['child']), paper('both', ['parent', 'child']), paper('none', [])];
    expect(sameTagEntries(entries, tags, 'parent', false).map(entry => entry.id)).toEqual(['direct', 'both']);
    expect(sameTagEntries(entries, tags, 'parent', true).map(entry => entry.id)).toEqual(['direct', 'child', 'both']);
    expect(sameTagEntries(entries.slice(1), tags, 'parent', true).map(entry => entry.id)).toEqual(['child', 'both']);
    expect(sameTagEntries(entries, [], 'parent', true)).toEqual([]);
  });
});
