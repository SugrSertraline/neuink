import { describe, expect, it } from 'vitest';

import {
  defaultEntryContentId,
  entryContentSurface,
  entryContentId,
  initialWorkspaceSurfaceLayout,
  surfaceNoteTarget,
  workspaceSurfaceLabel,
  surfaceKey,
  sourceLinkSurfaceActions,
  workspaceSurfaceOpenActions,
  workspaceSurfaceReducer,
  type WorkspaceSurface,
  type WorkspaceSurfaceAction,
  type WorkspaceSurfaceLayout
} from './workspaceSurface';

const library: WorkspaceSurface = { kind: 'library' };
const pdfA: WorkspaceSurface = { kind: 'pdf', entryId: 'a' };
const reflowA: WorkspaceSurface = { kind: 'reflow', entryId: 'a' };
const noteA: WorkspaceSurface = { kind: 'note', entryId: 'a', noteId: 'n1' };
const pdfB: WorkspaceSurface = { kind: 'pdf', entryId: 'b' };

it('opens a reply as a separate reusable read-only tab, movable between panes and released on close', () => {
  const reply: WorkspaceSurface = { kind: 'assistant-reply', message: { message_id: 'answer', role: 'assistant', content: '回答', source_links: [], created_at: '' } };
  const initial = layout({ focusedPane: 'right' });
  const opened = workspaceSurfaceReducer(initial, { type: 'open', surface: reply });
  expect(opened.rightTabs).toContain(noteA);
  expect(opened.rightTabs).toContain(reply);
  expect(workspaceSurfaceReducer(opened, { type: 'open', surface: reply }).rightTabs).toHaveLength(opened.rightTabs.length);
  const moved = workspaceSurfaceReducer(opened, { type: 'move', key: surfaceKey(reply), pane: 'left' });
  expect(moved.left).toBe(reply);
  expect(surfaceNoteTarget(reply)).toBeNull();
  expect(workspaceSurfaceLabel(reply, [])).toBe('完整回复');
  const closed = workspaceSurfaceReducer(moved, { type: 'close', pane: 'left', key: surfaceKey(reply) });
  expect([...closed.leftTabs, ...closed.rightTabs]).not.toContain(reply);
});

it('opens review separately from the editable note while retaining its context and stable tab identity', () => {
  const review: WorkspaceSurface = { kind: 'note-review', entryId: 'a', noteId: 'n1', proposalId: 'p', label: 'Reading note' };
  const opened = workspaceSurfaceReducer(layout(), { type: 'open', surface: review });
  expect(opened.rightTabs).toContain(noteA);
  expect(opened.left.kind).toBe('note-review');
  expect(surfaceKey(review)).toBe('note-review:p');
  expect(entryContentId(review)).toBe('note:n1');
  expect(surfaceNoteTarget(review)).toBeNull(); // A review must never claim a second editing lease.
  expect(workspaceSurfaceLabel(review, [])).toBe('Reading note · 修改审阅');
  expect(workspaceSurfaceReducer(opened, { type: 'open', surface: review }).leftTabs).toHaveLength(opened.leftTabs.length);
});

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

function expectValidLayout(state: WorkspaceSurfaceLayout) {
  const keys = [...state.leftTabs, ...state.rightTabs].map(surfaceKey);
  expect(new Set(keys).size).toBe(keys.length);
  expect(state.leftTabs).toContainEqual(state.left);
  if (state.right) {
    expect(state.rightTabs).toContainEqual(state.right);
  } else {
    expect(state.rightTabs).toEqual([]);
    expect(state.focusedPane).toBe('left');
  }
  if (state.focusedPane === 'right') expect(state.right).not.toBeNull();
  const pinned = state.pinnedTabKeys ?? [];
  expect(new Set(pinned).size).toBe(pinned.length);
  for (const key of pinned) expect(keys).toContain(key);
}

describe('workspaceSurfaceReducer', () => {
  it('duplicates a view without duplicating its document and closes only that view', () => {
    const copied = workspaceSurfaceReducer(layout(), { type: 'duplicate', key: 'pdf:a', pane: 'right', viewId: 'copy-1' });
    expect(copied.left).toEqual(pdfA);
    expect(copied.right).toMatchObject({ kind: 'pdf', entryId: 'a', viewId: 'copy-1' });
    expect(surfaceKey(copied.right!)).toBe('pdf:a:view:copy-1');
    const switched = workspaceSurfaceReducer(copied, { type: 'switchEntryView', pane: 'right', key: surfaceKey(copied.right!), view: 'reflow' });
    expect(switched.right).toMatchObject({ kind: 'reflow', entryId: 'a', viewId: 'copy-1' });
    expect(switched.left).toEqual(pdfA);
    const closed = workspaceSurfaceReducer(copied, { type: 'close', pane: 'right', key: surfaceKey(copied.right!) });
    expect(closed.leftTabs).toContain(pdfA);
    expect(closed.rightTabs.some(tab => tab.viewId === 'copy-1')).toBe(false);
  });
  it('keeps note ownership identical across copied views and does not copy settings', () => {
    const copied = workspaceSurfaceReducer(layout(), { type: 'duplicate', key: surfaceKey(noteA), pane: 'left', viewId: 'note-copy' });
    expect(surfaceNoteTarget(copied.left)).toEqual(surfaceNoteTarget(noteA));
    const state = layout({ left: { kind: 'settings' }, leftTabs: [{ kind: 'settings' }] });
    expect(workspaceSurfaceReducer(state, { type: 'duplicate', key: 'settings', pane: 'right', viewId: 'copy' })).toBe(state);
  });
  it('applies the PDF preference only to default entry opening, with an overview fallback', () => {
    const withPdf = { pdfFileName: 'paper.pdf' };
    expect(defaultEntryContentId(withPdf, true)).toBe('pdf');
    expect(defaultEntryContentId(withPdf, false)).toBe('overview');
    expect(defaultEntryContentId({ pdfFileName: null }, true)).toBe('overview');
    expect(defaultEntryContentId({ pdfFileName: null }, false)).toBe('overview');
    const initial = layout();
    const surface = entryContentSurface('a', defaultEntryContentId(withPdf, true), 'research');
    const opened = workspaceSurfaceOpenActions(initial, surface, 'right').reduce(workspaceSurfaceReducer, initial);
    expect(opened.right).toEqual({ kind: 'pdf', entryId: 'a', contextTagId: 'research' });
    expect([...opened.leftTabs, ...opened.rightTabs].filter(tab => surfaceKey(tab) === 'pdf:a')).toHaveLength(1);
    for (const content of ['overview', 'note:n1', 'reflow']) {
      const explicit = entryContentSurface('a', content);
      const result = workspaceSurfaceOpenActions(opened, explicit).reduce(workspaceSurfaceReducer, opened);
      expect(result[result.focusedPane]).toEqual(explicit);
    }
  });
  it('reuses settings across panes and delivers repeated navigation requests to the existing tab', () => {
    const settings: WorkspaceSurface = { kind: 'settings', target: { id: 'reader-preview-size', nonce: 1 } };
    const initial = layout({ right: settings, rightTabs: [noteA, settings] });
    const nextTarget: WorkspaceSurface = { kind: 'settings', target: { id: 'reader-preview-size', nonce: 2 } };
    const next = workspaceSurfaceOpenActions(initial, nextTarget).reduce(workspaceSurfaceReducer, initial);
    expect(next.focusedPane).toBe('right');
    expect(next.right).toEqual(nextTarget);
    expect(next.leftTabs).toEqual(initial.leftTabs);
    expect([...next.leftTabs, ...next.rightTabs].filter(tab => tab.kind === 'settings')).toEqual([nextTarget]);
  });
  it('opens one relations page and returns to it across panes without moving or duplicating it', () => {
    const initial = layout({ right: null, rightTabs: [] });
    const relations: WorkspaceSurface = { kind: 'relations' };
    const opened = workspaceSurfaceOpenActions(initial, relations).reduce(workspaceSurfaceReducer, initial);
    expect(opened.right).toBeNull();
    const reading = workspaceSurfaceOpenActions(opened, pdfB, 'right').reduce(workspaceSurfaceReducer, opened);
    const returned = workspaceSurfaceOpenActions(reading, relations).reduce(workspaceSurfaceReducer, reading);
    expect(returned.focusedPane).toBe('left'); expect(returned.left).toEqual(relations);
    expect([...returned.leftTabs, ...returned.rightTabs].filter(tab => tab.kind === 'relations')).toHaveLength(1);
    expect(workspaceSurfaceReducer(returned, { type: 'removeEntry', entryId: 'b' }).leftTabs).toContainEqual(relations);
  });
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
      rightTabs: [],
      pinnedTabKeys: []
    });
  });

  it('pins tabs before unpinned tabs, constrains drag order, and unpins into the ordinary group', () => {
    const pinned = workspaceSurfaceReducer(layout(), { type: 'setPinned', key: surfaceKey(reflowA), pinned: true });
    expect(pinned.leftTabs).toEqual([reflowA, library, pdfA]);
    expect(pinned.pinnedTabKeys).toEqual([surfaceKey(reflowA)]);
    const dragged = workspaceSurfaceReducer(pinned, { type: 'move', key: surfaceKey(pdfA), pane: 'left', targetIndex: 0 });
    expect(dragged.leftTabs[0]).toBe(reflowA);
    const unpinned = workspaceSurfaceReducer(dragged, { type: 'setPinned', key: surfaceKey(reflowA), pinned: false });
    expect(unpinned.pinnedTabKeys).toEqual([]);
    expect(unpinned.leftTabs).toEqual([reflowA, pdfA, library]);
  });

  it('keeps pinned tabs and the library when closing other tabs, then clears closed pins', () => {
    const pinned = workspaceSurfaceReducer(layout({ leftTabs: [library, pdfA, reflowA, pdfB], right: noteA, rightTabs: [noteA] }), { type: 'setPinned', key: surfaceKey(reflowA), pinned: true });
    const closed = workspaceSurfaceReducer(pinned, { type: 'closeOthers', pane: 'left', key: surfaceKey(pdfA) });
    expect(closed.leftTabs).toEqual([reflowA, library, pdfA]);
    const removed = workspaceSurfaceReducer(closed, { type: 'close', pane: 'left', key: surfaceKey(reflowA) });
    expect(removed.pinnedTabKeys).toEqual([]);
  });

  it('switches a reading tab in place and transfers its pin without duplicating an existing view', () => {
    const initial = layout({ leftTabs: [library, pdfA], right: noteA, rightTabs: [noteA] });
    const pinned = workspaceSurfaceReducer(initial, { type: 'setPinned', key: surfaceKey(pdfA), pinned: true });
    const switched = workspaceSurfaceReducer(pinned, { type: 'switchEntryView', pane: 'left', key: surfaceKey(pdfA), view: 'reflow' });
    expect(switched.leftTabs).toEqual([reflowA, library]);
    expect(switched.left).toEqual(reflowA);
    expect(switched.pinnedTabKeys).toEqual([surfaceKey(reflowA)]);
    const existing = workspaceSurfaceReducer(layout(), { type: 'switchEntryView', pane: 'left', key: surfaceKey(pdfA), view: 'reflow' });
    expect(existing.leftTabs).toEqual([library, pdfA, reflowA]);
    expect(existing.left).toEqual(reflowA);
    expect(existing.leftTabs.filter((tab) => surfaceKey(tab) === surfaceKey(reflowA))).toHaveLength(1);
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

  it('merges the remaining pane when moving the final left tab after swapping the library right', () => {
    const opened = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', pane: 'right', surface: pdfA });
    const pinnedLibrary = workspaceSurfaceReducer(opened, { type: 'setPinned', key: 'library', pinned: true });
    const pinnedPdf = workspaceSurfaceReducer(pinnedLibrary, { type: 'setPinned', key: surfaceKey(pdfA), pinned: true });
    const swapped = workspaceSurfaceReducer(pinnedPdf, { type: 'swap' });
    expect(swapped.leftTabs).toEqual([pdfA]);
    expect(swapped.rightTabs).toEqual([library]);

    const moved = workspaceSurfaceReducer(swapped, { type: 'move', key: surfaceKey(pdfA), pane: 'right' });
    expectValidLayout(moved);
    expect(moved.leftTabs).toEqual([library, pdfA]);
    expect(moved.left).toBe(pdfA);
    expect(moved.right).toBeNull();
    expect(moved.focusedPane).toBe('left');
    expect(moved.pinnedTabKeys).toEqual(['library', surfaceKey(pdfA)]);
  });

  it('keeps a single library when its only tab is moved to the right', () => {
    const moved = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'move', key: 'library', pane: 'right' });
    expectValidLayout(moved);
    expect(moved).toEqual(initialWorkspaceSurfaceLayout);
  });

  it('closes a queued tab by its identity after an earlier close promotes its original pane', () => {
    const noteB: WorkspaceSurface = { kind: 'note', entryId: 'b', noteId: 'n2' };
    const initial = layout({ left: noteB, leftTabs: [library, noteB], right: pdfA, rightTabs: [pdfA] });
    const swapped = workspaceSurfaceReducer(initial, { type: 'swap' });
    const promoted = workspaceSurfaceReducer(swapped, { type: 'close', pane: 'left', key: surfaceKey(pdfA) });
    expectValidLayout(promoted);
    expect(promoted.leftTabs).toEqual([library, noteB]);
    expect(promoted.right).toBeNull();

    const closed = workspaceSurfaceReducer(promoted, { type: 'close', pane: 'right', key: surfaceKey(noteB) });
    expectValidLayout(closed);
    expect(closed.leftTabs).toEqual([library]);
    expect(closed.left).toEqual(library);
    expect(closed.right).toBeNull();
  });

  it.each<WorkspaceSurfaceAction>([
    { type: 'close', pane: 'left', key: surfaceKey(noteA) },
    { type: 'closePane', pane: 'left' },
    { type: 'removeEntry', entryId: 'a' },
    { type: 'removeNote', entryId: 'a', noteId: 'n1' }
  ])('preserves the right pane and its active tab when $type empties the left pane after swapping', (action) => {
    const initial = layout({
      left: library,
      leftTabs: [library, pdfB],
      right: noteA,
      rightTabs: [noteA],
      focusedPane: 'right',
      pinnedTabKeys: ['library', surfaceKey(pdfB), surfaceKey(noteA)]
    });
    const swapped = workspaceSurfaceReducer(initial, { type: 'swap' });
    const closed = workspaceSurfaceReducer(swapped, action);
    expectValidLayout(closed);
    expect(closed.leftTabs).toEqual([library, pdfB]);
    expect(closed.left).toBe(library);
    expect(closed.right).toBeNull();
    expect(closed.focusedPane).toBe('left');
    expect(closed.pinnedTabKeys).toEqual(['library', surfaceKey(pdfB)]);
  });

  it('reorders tabs after swapping while preserving the selected copied view and its original', () => {
    const copied = workspaceSurfaceReducer(layout(), { type: 'duplicate', key: surfaceKey(pdfA), pane: 'right', viewId: 'swapped-copy' });
    const activeCopy = copied.right;
    const swapped = workspaceSurfaceReducer(copied, { type: 'swap' });
    const reordered = workspaceSurfaceReducer(swapped, { type: 'move', key: surfaceKey(pdfB), pane: 'left', targetIndex: 0 });
    expectValidLayout(reordered);
    expect(reordered.leftTabs).toEqual([pdfB, noteA, activeCopy]);
    expect(reordered.left).toBe(activeCopy);
    expect(reordered.right).toBe(pdfA);
    expect(reordered.focusedPane).toBe(swapped.focusedPane);
    expect(reordered.rightTabs).toEqual(copied.leftTabs);
    expect(surfaceKey(reordered.left)).toBe('pdf:a:view:swapped-copy');
  });

  it('preserves distinct view identities when a copied last-left tab moves back after a swap', () => {
    const opened = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', surface: pdfA });
    const copied = workspaceSurfaceReducer(opened, { type: 'duplicate', key: surfaceKey(pdfA), pane: 'right', viewId: 'returning-copy' });
    const activeCopy = copied.right!;
    const pinned = workspaceSurfaceReducer(copied, { type: 'setPinned', key: surfaceKey(activeCopy), pinned: true });
    const swapped = workspaceSurfaceReducer(pinned, { type: 'swap' });
    const moved = workspaceSurfaceReducer(swapped, { type: 'move', key: surfaceKey(activeCopy), pane: 'right' });
    expectValidLayout(moved);
    expect(moved.leftTabs).toEqual([activeCopy, library, pdfA]);
    expect(moved.left).toBe(activeCopy);
    expect(moved.right).toBeNull();
    expect(moved.pinnedTabKeys).toEqual(['pdf:a:view:returning-copy']);
    expect(moved.leftTabs.filter(tab => tab.kind === 'pdf')).toHaveLength(2);
  });

  it('ignores unknown tab identities without changing a swapped layout', () => {
    const swapped = workspaceSurfaceReducer(layout({ pinnedTabKeys: [] }), { type: 'swap' });
    const actions: WorkspaceSurfaceAction[] = [
      { type: 'move', key: 'missing', pane: 'left' },
      { type: 'move', key: 'missing', pane: 'right' },
      { type: 'close', key: 'missing', pane: 'left' },
      { type: 'close', key: 'missing', pane: 'right' },
      { type: 'closeOthers', key: 'missing', pane: 'left' },
      { type: 'setPinned', key: 'missing', pinned: true },
      { type: 'switchEntryView', key: 'missing', pane: 'right', view: 'reflow' },
      { type: 'duplicate', key: 'missing', pane: 'right', viewId: 'unused' }
    ];
    for (const action of actions) {
      const next = workspaceSurfaceReducer(swapped, action);
      expectValidLayout(next);
      expect(next).toEqual(swapped);
    }
  });

  it('restores tab order, active views, focus and pins after swapping twice', () => {
    const copied = workspaceSurfaceReducer(layout({ focusedPane: 'right', pinnedTabKeys: [] }), { type: 'duplicate', key: surfaceKey(pdfA), pane: 'right', viewId: 'round-trip-copy' });
    const pinned = workspaceSurfaceReducer(copied, { type: 'setPinned', key: surfaceKey(copied.right!), pinned: true });
    const swapped = workspaceSurfaceReducer(pinned, { type: 'swap' });
    expectValidLayout(swapped);
    const restored = workspaceSurfaceReducer(swapped, { type: 'swap' });
    expectValidLayout(restored);
    expect(restored).toEqual(pinned);
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
