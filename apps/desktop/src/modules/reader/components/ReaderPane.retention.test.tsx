// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReaderPane } from './ReaderPane';
import { workspaceSurfaceReducer, type WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import type { ReadingNoteBinding } from '../parallel-reading/ReadingSessionContext';
import { noteTargetKey } from '@/shared/lib/noteOwner';

const binding = vi.hoisted(() => ({ set: null as null | ((key: string, value: ReadingNoteBinding | null) => void) }));
vi.mock('./EntryWorkspaceView', () => ({ EntryWorkspaceView: () => <div data-testid="reader"><input defaultValue="草稿" /></div> }));
vi.mock('@/modules/notes/components/OwnedNoteSurfaceView', () => ({ OwnedNoteSurfaceView: ({ onBinding }: { onBinding: typeof binding.set }) => { binding.set = onBinding; return <div>笔记</div>; } }));
vi.mock('./useSourceBacklinks', () => ({ useSourceBacklinks: () => ({}) }));
afterEach(cleanup);

it('never recreates the reader when a paired note binding arrives, changes or disappears', () => {
  let layout: WorkspaceSurfaceLayout = { focusedPane: 'left', left: { kind: 'pdf', entryId: 'e' }, leftTabs: [{ kind: 'pdf', entryId: 'e' }], right: null, rightTabs: [] };
  const props = { entries: [{ id: 'e', title: '论文', contents: [] }], tags: [], trashItems: [], workspaceRoot: null,
    markdownNoteRefreshById: {}, pdfJumpByEntryId: {}, pdfReaderReloadByEntryId: {}, sidePane: { target: null },
    onFocusSurface: vi.fn(), onOpenSurface: vi.fn() } as unknown as ComponentProps<typeof ReaderPane>;
  const ui = render(<ReaderPane {...props} surfaceLayout={layout} />);
  const original = ui.getByTestId('reader'); original.scrollTop = 2500;
  const target = { owner: { kind: 'entry' as const, entry_id: 'e' }, note_id: 'n' };
  layout = workspaceSurfaceReducer(layout, { type: 'open', pane: 'right', surface: { kind: 'owned-note', target } });
  ui.rerender(<ReaderPane {...props} surfaceLayout={layout} />);
  const key = noteTargetKey(target);
  act(() => binding.set?.(key, { title: '阅读笔记', onAddSource: async () => {} }));
  expect(ui.getByTestId('reader')).toBe(original); expect(original.scrollTop).toBe(2500);
  act(() => binding.set?.(key, null));
  expect(ui.getByTestId('reader')).toBe(original);
  layout = workspaceSurfaceReducer(layout, { type: 'swap' }); ui.rerender(<ReaderPane {...props} surfaceLayout={layout} />);
  expect(ui.getByTestId('reader')).toBe(original); expect(original.scrollTop).toBe(2500);
});
