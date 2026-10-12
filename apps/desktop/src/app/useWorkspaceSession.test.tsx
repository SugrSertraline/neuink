// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { EntryMeta } from '@/shared/types/domain';
import { initialWorkspaceSurfaceLayout, workspaceSurfaceReducer } from './workspaceSurface';
import { saveWorkspaceSession, readWorkspaceSession } from './workspaceSession';
import { useWorkspaceSession } from './useWorkspaceSession';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const entries = [{ id: 'paper', pdf: {}, contents: [] }] as unknown as EntryMeta[];
const error = vi.fn();
function Fixture({ root, status = 'ready' }: { root: string | null; status?: 'loading' | 'ready' | 'error' }) {
  const [layout, dispatch] = useWorkspaceSession({ root, status, entries, tags: [], onSaveError: error });
  return <><span>{root}:{layout.left.kind}</span>
    <button onClick={() => dispatch({ type: 'open', surface: { kind: 'reflow', entryId: 'paper' } })}>reflow</button>
    <button onClick={() => dispatch({ type: 'close', pane: 'left', key: 'reflow:paper' })}>close</button></>;
}
it('waits for the catalog, restores before saving and preserves each workspace across switches and restarts', () => {
  saveWorkspaceSession('a', workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', surface: { kind: 'pdf', entryId: 'paper' } }));
  const raw = localStorage.getItem('neuink.workspace.session:a');
  const ui = render(<Fixture root={null} status="loading" />);
  ui.rerender(<Fixture root="a" status="loading" />);
  expect(localStorage.getItem('neuink.workspace.session:a')).toBe(raw);
  ui.rerender(<Fixture root="a" />);
  expect(screen.getByText('a:pdf')).toBeTruthy();
  ui.rerender(<Fixture root="b" />);
  expect(screen.getByText('b:library')).toBeTruthy();
  fireEvent.click(screen.getByText('reflow'));
  expect(readWorkspaceSession('b', { entries, tags: [] }).left.kind).toBe('reflow');
  ui.rerender(<Fixture root="a" />);
  expect(screen.getByText('a:pdf')).toBeTruthy();
  ui.unmount();
  render(<Fixture root="b" />);
  expect(screen.getByText('b:reflow')).toBeTruthy();
  fireEvent.click(screen.getByText('close'));
  cleanup();
  render(<Fixture root="b" />);
  expect(screen.getByText('b:library')).toBeTruthy();
});
it('does not overwrite a saved session when workspace loading fails', () => {
  saveWorkspaceSession('a', workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', surface: { kind: 'pdf', entryId: 'paper' } }));
  const raw = localStorage.getItem('neuink.workspace.session:a');
  render(<Fixture root="a" status="error" />);
  fireEvent.click(screen.getByText('reflow'));
  expect(localStorage.getItem('neuink.workspace.session:a')).toBe(raw);
});
