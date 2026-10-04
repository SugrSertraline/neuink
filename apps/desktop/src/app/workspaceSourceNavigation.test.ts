import { describe, expect, it } from 'vitest';
import { resolveSourceLinkSurface } from './workspaceSourceNavigation';
import { sourceLinkSurfaceActions, surfaceKey, workspaceSurfaceReducer, type WorkspacePaneId, type WorkspaceSurface, type WorkspaceSurfaceLayout } from './workspaceSurface';

const note: WorkspaceSurface = { kind: 'note', entryId: 'notes', noteId: 'n' };
const pdf: WorkspaceSurface = { kind: 'pdf', entryId: 'paper' };
const reflow: WorkspaceSurface = { kind: 'reflow', entryId: 'paper', viewId: 'copy', contextTagId: 'topic' };
const layout = (left: WorkspaceSurface, right: WorkspaceSurface | null, focusedPane: WorkspacePaneId = 'left'): WorkspaceSurfaceLayout =>
  ({ left, right, focusedPane, leftTabs: [left], rightTabs: right ? [right] : [] });

describe('citation reader selection', () => {
  it.each(['pdf', 'reflow'] as const)('reuses a visible %s after a note click changes focus', kind => {
    const reader: WorkspaceSurface = { ...reflow, kind };
    const state = layout(reader, note, 'right');
    state.rightTabs.push(pdf);
    const target = resolveSourceLinkSurface(state, 'paper', 'right');
    expect(target).toEqual({ surface: reader, pane: 'left' });
    const next = sourceLinkSurfaceActions(state, 'paper', 'right').reduce(workspaceSurfaceReducer, state);
    expect(next.left).toBe(reader);
    expect(next.right).toBe(note);
    expect(next.focusedPane).toBe('right');
    expect(next.leftTabs).toHaveLength(1);
    expect(next.rightTabs).toHaveLength(2);
  });

  it.each(['left', 'right'] as const)('prefers the active source reader in the %s pane over another visible mode', pane => {
    const state = layout(pdf, reflow, pane);
    expect(resolveSourceLinkSurface(state, 'paper', pane === 'left' ? 'right' : 'left'))
      .toEqual({ surface: state[pane], pane });
    expect(sourceLinkSurfaceActions(state, 'paper').some(action => action.type === 'move')).toBe(false);
  });

  it('reuses a visible duplicate before a hidden canonical PDF', () => {
    const copy: WorkspaceSurface = { ...pdf, viewId: 'second' };
    const state = layout(note, copy);
    state.leftTabs.push(pdf);
    expect(surfaceKey(resolveSourceLinkSurface(state, 'paper').surface)).toBe('pdf:paper:view:second');
  });

  it('moves an inactive reflow beside the note without changing its identity or mode', () => {
    const state = layout(note, null);
    state.leftTabs.push(reflow);
    const next = sourceLinkSurfaceActions(state, 'paper').reduce(workspaceSurfaceReducer, state);
    expect(next.left).toBe(note);
    expect(next.right).toBe(reflow);
    expect(next.leftTabs).toEqual([note]);
    expect(next.rightTabs).toEqual([reflow]);
  });

  it('reuses a hidden reader in the opposite pane before one beside the note', () => {
    const state = layout(note, { kind: 'library' });
    state.leftTabs.push(pdf);
    state.rightTabs.push(reflow);
    expect(resolveSourceLinkSurface(state, 'paper').surface).toBe(reflow);
  });

  it('opens PDF by default when only an overview or another paper is open', () => {
    const state = layout(note, { kind: 'reflow', entryId: 'other' });
    state.rightTabs.push({ kind: 'entry-overview', entryId: 'paper' });
    const next = sourceLinkSurfaceActions(state, 'paper').reduce(workspaceSurfaceReducer, state);
    expect(next.left).toBe(note);
    expect(next.right).toEqual(pdf);
    expect(next.rightTabs).toHaveLength(3);
  });
});
