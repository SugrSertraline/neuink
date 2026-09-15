import { describe, expect, it } from 'vitest';
import { resolveEntrySidebarContext, resolveTagNoteSidebarContext } from './entrySidebarContext';
import { initialWorkspaceSurfaceLayout, noteSurface, workspaceSurfaceReducer, type WorkspaceSurface } from './workspaceSurface';

const paper: WorkspaceSurface = { kind: 'pdf', entryId: 'paper-a', contextTagId: 'software' };
const note = noteSurface({ owner: { kind: 'tag_reading', tag_id: 'software' }, note_id: 'comparison' });
const open = (left: WorkspaceSurface, right?: WorkspaceSurface) => {
  const layout = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', surface: left });
  return right ? workspaceSurfaceReducer(layout, { type: 'open', surface: right, pane: 'right' }) : layout;
};

describe('entry sidebar follows the paper during tag-note reading', () => {
  it('keeps the paper and its tag when focus moves to its note, including swapped panes', () => {
    const layout = open(paper, note);
    expect(resolveEntrySidebarContext(layout)).toMatchObject({ entryId: 'paper-a', contentId: 'pdf', contextTagId: 'software', pane: 'left' });
    expect(resolveEntrySidebarContext(workspaceSurfaceReducer(layout, { type: 'swap' }))).toMatchObject({ entryId: 'paper-a', contextTagId: 'software', pane: 'right' });
  });

  it('uses the current paper after switching papers instead of retaining the old tag', () => {
    const layout = workspaceSurfaceReducer(open(paper, note), { type: 'open', pane: 'left', surface: { kind: 'entry-overview', entryId: 'paper-b' } });
    expect(resolveEntrySidebarContext({ ...layout, focusedPane: 'right' })).toMatchObject({ entryId: 'paper-b', contentId: 'overview', contextTagId: undefined });
  });

  it('clears the companion paper context when it is closed or deleted', () => {
    const layout = open(paper, note);
    expect(resolveEntrySidebarContext(workspaceSurfaceReducer(layout, { type: 'close', pane: 'left', key: 'pdf:paper-a' }))).toBeNull();
    expect(resolveEntrySidebarContext(workspaceSurfaceReducer(layout, { type: 'removeEntry', entryId: 'paper-a' }))).toBeNull();
  });

  it.each<WorkspaceSurface>([{ kind: 'library' }, { kind: 'settings' }, { kind: 'tag-reading', tagId: 'software' }])('does not override the focused $kind with the other paper', (surface) => {
    expect(resolveEntrySidebarContext(open(paper, surface))).toBeNull();
  });

  it('prefers the focused entry note, and only borrows a tag from the same paper', () => {
    expect(resolveEntrySidebarContext(open(paper, { kind: 'note', entryId: 'paper-a', noteId: 'draft' }))).toMatchObject({ entryId: 'paper-a', contextTagId: 'software', pane: 'right' });
    expect(resolveEntrySidebarContext(open(paper, { kind: 'note', entryId: 'paper-b', noteId: 'draft' }))).toMatchObject({ entryId: 'paper-b', contextTagId: undefined, pane: 'right' });
  });

  it('keeps a directly opened reader independent of another reader’s tag context', () => {
    expect(resolveEntrySidebarContext(open(paper, { kind: 'entry-overview', entryId: 'paper-a' }))).toMatchObject({ entryId: 'paper-a', contextTagId: undefined, pane: 'right' });
  });
});

describe('tag note detail selection', () => {
  it('shows tag note details both alone and beside a paper, and follows pane focus', () => {
    expect(resolveTagNoteSidebarContext(open(note))).toEqual(note);
    const split = open(paper, note);
    expect(resolveTagNoteSidebarContext(split)).toEqual(note);
    expect(resolveTagNoteSidebarContext({ ...split, focusedPane: 'left' })).toBeNull();
    expect(resolveTagNoteSidebarContext(workspaceSurfaceReducer(split, { type: 'removeEntry', entryId: 'paper-a' }))).toEqual(note);
    expect(resolveTagNoteSidebarContext(open(paper, { kind: 'note', entryId: 'paper-a', noteId: 'draft' }))).toBeNull();
  });
});
