// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReaderPane } from './ReaderPane';
import { workspaceSurfaceReducer, type WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import type { ReadingNoteBinding } from '../parallel-reading/ReadingSessionContext';
import { noteTargetKey } from '@/shared/lib/noteOwner';

const binding = vi.hoisted(() => ({ set: null as null | ((key: string, value: ReadingNoteBinding | null) => void) }));
vi.mock('./EntryWorkspaceView', () => ({ EntryWorkspaceView: ({ editorScopeKey, pdfJumpRequest }: { editorScopeKey: string; pdfJumpRequest: { requestKey: number } | null }) => <div data-testid="reader" data-scope={editorScopeKey} data-jump={pdfJumpRequest?.requestKey}><input defaultValue="草稿" /></div> }));
vi.mock('@/modules/notes/components/OwnedNoteSurfaceView', () => ({ OwnedNoteSurfaceView: ({ onBinding }: { onBinding: typeof binding.set }) => { binding.set = onBinding; return <div>笔记</div>; } }));
vi.mock('./useSourceBacklinks', () => ({ useSourceBacklinks: () => ({}) }));
afterEach(cleanup);

it('delivers source navigation to exactly one retained reader copy', async () => {
  const original = { kind: 'pdf' as const, entryId: 'e' };
  const copy = { ...original, viewId: 'copy' };
  const reflow = { kind: 'reflow' as const, entryId: 'e' };
  const layout: WorkspaceSurfaceLayout = { focusedPane: 'right', left: original, leftTabs: [original, reflow], right: copy, rightTabs: [copy] };
  const props = { entries: [{ id: 'e', title: '论文', contents: [] }], tags: [], trashItems: [], workspaceRoot: null,
    markdownNoteRefreshById: {}, pdfJumpByEntryId: {}, pdfReaderReloadByEntryId: {}, sidePane: { target: null },
    onFocusSurface: vi.fn(), onOpenSurface: vi.fn() } as unknown as ComponentProps<typeof ReaderPane>;
  const ui = render(<ReaderPane {...props} surfaceLayout={layout} />);
  await ui.findAllByTestId('reader');
  const pdfJumpByEntryId = { e: { kind: 'page' as const, pageIdx: 3, requestKey: 7, targetSurfaceKey: 'pdf:e:view:copy' } };
  ui.rerender(<ReaderPane {...props} pdfJumpByEntryId={pdfJumpByEntryId} surfaceLayout={layout} />);
  const readers = ui.getAllByTestId('reader');
  expect(readers).toHaveLength(3);
  expect(readers.filter(reader => reader.dataset.jump)).toEqual([readers.find(reader => reader.dataset.scope === 'pdf:e:view:copy')]);
});

it('never recreates the reader when a paired note binding arrives, changes or disappears', async () => {
  let layout: WorkspaceSurfaceLayout = { focusedPane: 'left', left: { kind: 'pdf', entryId: 'e' }, leftTabs: [{ kind: 'pdf', entryId: 'e' }], right: null, rightTabs: [] };
  const props = { entries: [{ id: 'e', title: '论文', contents: [] }], tags: [], trashItems: [], workspaceRoot: null,
    markdownNoteRefreshById: {}, pdfJumpByEntryId: {}, pdfReaderReloadByEntryId: {}, sidePane: { target: null },
    onFocusSurface: vi.fn(), onOpenSurface: vi.fn() } as unknown as ComponentProps<typeof ReaderPane>;
  const ui = render(<ReaderPane {...props} surfaceLayout={layout} />);
  const original = await ui.findByTestId('reader'); original.scrollTop = 2500;
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
