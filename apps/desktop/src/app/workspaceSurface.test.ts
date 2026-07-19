import { describe, expect, it } from 'vitest';

import {
  surfaceKey,
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
  it('keeps an entry trash surface distinct per entry', () => {
    expect(surfaceKey({ kind: 'entry-trash', entryId: 'a' })).toBe('entry-trash:a');
  });

  it('treats the legacy annotation surface and segment records as one workspace', () => {
    expect(surfaceKey({ kind: 'annotations', entryId: 'a' })).toBe(
      surfaceKey({ kind: 'segment-notes', entryId: 'a' })
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
});
