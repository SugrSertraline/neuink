import { describe, expect, it } from 'vitest';

import {
  surfaceKey,
  sourceLinkSurfaceActions,
  workspaceSurfaceOpenActions,
  workspaceSurfaceReducer,
  type WorkspaceSurface,
  type WorkspaceSurfaceLayout
} from './workspaceSurface';

const library: WorkspaceSurface = { kind: 'library' };
const pdfA: WorkspaceSurface = { kind: 'pdf', entryId: 'a' };
const reflowA: WorkspaceSurface = { kind: 'reflow', entryId: 'a' };
const noteA: WorkspaceSurface = { kind: 'note', entryId: 'a', noteId: 'n1' };
const pdfB: WorkspaceSurface = { kind: 'pdf', entryId: 'b' };

function layout(overrides: Partial<WorkspaceSurfaceLayout> = {}): WorkspaceSurfaceLayout {
  return {
    focusedPane: 'left',
    left: pdfA,
    leftTabs: [library, pdfA, reflowA],
    right: noteA,
    rightTabs: [noteA, pdfB],
    ...overrides
  };
}

describe('workspaceSurfaceReducer', () => {
  it('opens a tag detail tab without splitting and reuses its stable id after renaming', () => {
    const initial = layout({ right: null, rightTabs: [] });
    const detail: WorkspaceSurface = { kind: 'tag-details', tagId: 'research', label: '研究' };
    const opened = workspaceSurfaceOpenActions(initial, detail).reduce(workspaceSurfaceReducer, initial);
    expect(opened.right).toBeNull();
    expect(opened.leftTabs).toEqual([...initial.leftTabs, detail]);
    const renamed = { ...detail, label: '新研究主题' };
    const reopened = workspaceSurfaceOpenActions(opened, renamed).reduce(workspaceSurfaceReducer, opened);
    expect(reopened.leftTabs).toEqual([...initial.leftTabs, renamed]);
    expect(reopened.left).toEqual(renamed);
  });

  it('focuses an existing tag detail tab in the other pane without moving its editor', () => {
    const detail: WorkspaceSurface = { kind: 'tag-details', tagId: 'research' };
    const initial = layout({ right: detail, rightTabs: [noteA, detail] });
    const actions = workspaceSurfaceOpenActions(initial, detail);
    expect(actions.some(action => action.type === 'move')).toBe(false);
    const next = actions.reduce(workspaceSurfaceReducer, initial);
    expect(next.focusedPane).toBe('right');
    expect(next.leftTabs).toEqual(initial.leftTabs);
    expect(next.rightTabs).toEqual(initial.rightTabs);
  });

  it('uses the citation origin instead of stale focus when locating through the keyboard', () => {
    const state = layout({ focusedPane: 'left' });
    const next = sourceLinkSurfaceActions(state, 'b', 'right').reduce(workspaceSurfaceReducer, state);
    expect(next.right).toBe(noteA);
    expect(next.left).toEqual(pdfB);
    expect(next.focusedPane).toBe('right');
  });
  it('locates a citation in the left PDF without replacing the right note or its focus', () => {
    const state = layout({ focusedPane: 'right' });
    const next = sourceLinkSurfaceActions(state, 'a').reduce(workspaceSurfaceReducer, state);
    expect(next.right).toBe(noteA);
    expect(next.rightTabs).toBe(state.rightTabs);
    expect(next.left).toEqual(pdfA);
    expect(next.focusedPane).toBe('right');
  });

  it('moves an inactive source PDF to the opposite pane, not the edited note', () => {
    const state = layout({ focusedPane: 'right' });
    const next = sourceLinkSurfaceActions(state, 'b').reduce(workspaceSurfaceReducer, state);
    expect(next.right).toBe(noteA);
    expect(next.left).toEqual(pdfB);
    expect(next.leftTabs).toContainEqual(pdfA);
    expect(next.rightTabs).not.toContainEqual(pdfB);
    expect(next.focusedPane).toBe('right');
  });

  it('opens a cited PDF beside a single-pane note and retains the note', () => {
    const state = layout({ left: noteA, leftTabs: [noteA], right: null, rightTabs: [] });
    const next = sourceLinkSurfaceActions(state, 'b').reduce(workspaceSurfaceReducer, state);
    expect(next.left).toBe(noteA);
    expect(next.leftTabs).toBe(state.leftTabs);
    expect(next.right).toEqual(pdfB);
    expect(next.focusedPane).toBe('left');
  });
  it.each(['left', 'right'] as const)('refreshes existing record payloads in the %s pane without duplicating tabs', (pane) => {
    const old: WorkspaceSurface = { kind: 'segment-notes', entryId: 'a', segmentUid: 'old', mode: 'note' };
    const updated: WorkspaceSurface = { ...old, segmentUid: 'new', mode: 'annotation' };
    const initial = layout({ [pane]: old, [`${pane}Tabs`]: [old] });
    const next = workspaceSurfaceReducer(initial, { type: 'open', pane: 'left', surface: updated });
    expect(next[pane]).toEqual(updated);
    expect(next[`${pane}Tabs`]).toEqual([updated]);
    expect(next.focusedPane).toBe(pane);
  });
  it('keeps an entry trash surface distinct per entry', () => {
    expect(surfaceKey({ kind: 'entry-trash', entryId: 'a' })).toBe('entry-trash:a');
  });

  it('uses one canonical surface for segment notes and annotations', () => {
    expect(surfaceKey({ kind: 'segment-notes', entryId: 'a', mode: 'annotation' })).toBe(
      'segment-records:a'
    );
  });

  it('resets all entry surfaces when the workspace changes', () => {
    expect(workspaceSurfaceReducer(layout(), { type: 'reset' })).toEqual({
      focusedPane: 'left',
      left: library,
      leftTabs: [library],
      right: null,
      rightTabs: []
    });
  });

  it('reorders a tab without changing the active surface', () => {
    const next = workspaceSurfaceReducer(layout(), {
      type: 'move', key: surfaceKey(pdfA), pane: 'left', targetIndex: 0
    });

    expect(next.leftTabs).toEqual([pdfA, library, reflowA]);
    expect(next.left).toEqual(pdfA);
  });

  it('moves the active left tab to the right and selects a left fallback', () => {
    const next = workspaceSurfaceReducer(layout(), {
      type: 'move', key: surfaceKey(pdfA), pane: 'right', targetIndex: 1
    });

    expect(next.left).toEqual(reflowA);
    expect(next.leftTabs).toEqual([library, reflowA]);
    expect(next.right).toEqual(pdfA);
    expect(next.rightTabs).toEqual([noteA, pdfA, pdfB]);
    expect(next.focusedPane).toBe('right');
  });

  it('keeps the left pane valid when its final tab moves right', () => {
    const next = workspaceSurfaceReducer(layout({ left: pdfA, leftTabs: [pdfA] }), {
      type: 'move', key: surfaceKey(pdfA), pane: 'right'
    });

    expect(next.left).toEqual(library);
    expect(next.leftTabs).toEqual([library]);
    expect(next.right).toEqual(pdfA);
  });

  it('collapses the split after closing the final right tab', () => {
    const next = workspaceSurfaceReducer(layout({ right: noteA, rightTabs: [noteA] }), {
      type: 'close', pane: 'right', key: surfaceKey(noteA)
    });

    expect(next.right).toBeNull();
    expect(next.rightTabs).toEqual([]);
    expect(next.focusedPane).toBe('left');
  });

  it('focuses an existing surface instead of duplicating it across panes', () => {
    const next = workspaceSurfaceReducer(layout(), {
      type: 'open', pane: 'left', surface: noteA
    });

    expect(next.right).toEqual(noteA);
    expect(next.focusedPane).toBe('right');
    expect(next.leftTabs).not.toContainEqual(noteA);
  });

  it('moves an existing surface when a click explicitly requests the other pane', () => {
    const initial = layout({ right: null, rightTabs: [] });
    const next = workspaceSurfaceOpenActions(initial, pdfA, 'right')
      .reduce(workspaceSurfaceReducer, initial);

    expect(next.leftTabs).toEqual([library, reflowA]);
    expect(next.right).toEqual(pdfA);
    expect(next.rightTabs).toEqual([pdfA]);
    expect(next.focusedPane).toBe('right');
  });

  it('removes only surfaces belonging to a deleted entry', () => {
    const next = workspaceSurfaceReducer(layout({
      left: reflowA,
      right: pdfB,
      rightTabs: [noteA, pdfB]
    }), { type: 'removeEntry', entryId: 'a' });

    expect(next.leftTabs).toEqual([library]);
    expect(next.left).toEqual(library);
    expect(next.rightTabs).toEqual([pdfB]);
    expect(next.right).toEqual(pdfB);
  });

  it('closes every tab for a deleted note while preserving its entry surfaces', () => {
    const next = workspaceSurfaceReducer(layout({
      left: noteA,
      leftTabs: [library, pdfA, noteA],
      right: noteA,
      rightTabs: [noteA, pdfB]
    }), { type: 'removeNote', entryId: 'a', noteId: 'n1' });

    expect(next.leftTabs).toEqual([library, pdfA]);
    expect(next.left).toEqual(pdfA);
    expect(next.rightTabs).toEqual([pdfB]);
    expect(next.right).toEqual(pdfB);
  });
});
