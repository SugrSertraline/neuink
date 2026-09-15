// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { notifyNotesChanged, readNoteCatalog, type NoteCatalog } from '@/shared/ipc/noteCatalogApi';
import { WorkspaceNotesProvider, useWorkspaceNotes } from './WorkspaceNotesContext';

vi.mock('@/shared/ipc/noteCatalogApi', async (original) => ({ ...await original<typeof import('@/shared/ipc/noteCatalogApi')>(), readNoteCatalog: vi.fn() }));
const catalog = (title: string): NoteCatalog => ({ notes: [{ title, target: { owner: { kind: 'tag_reading', tag_id: 'tag' }, note_id: title },
  owner_title: '研究', updated_at: '', deleted_at: null, revision: '1', links: [], error: null }], errors: [] });
function Consumer({ name }: { name: string }) {
  const model = useWorkspaceNotes()!;
  return <div aria-label={name}><span>{model.catalog.notes.map(note => note.title).join(',')}</span><button onClick={model.refresh}>刷新{name}</button></div>;
}
const tree = (root: string) => <WorkspaceNotesProvider root={root} refreshKey="1"><Consumer name="侧栏" /><Consumer name="阅读区" /></WorkspaceNotesProvider>;
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('shares one catalog between sidebar and readers, including refreshes after note mutations', async () => {
  vi.mocked(readNoteCatalog).mockResolvedValue(catalog('原笔记'));
  const view = render(tree('A'));
  await act(() => vi.advanceTimersByTimeAsync(120));
  expect(readNoteCatalog).toHaveBeenCalledTimes(1);
  expect(view.getAllByText('原笔记')).toHaveLength(2);
  vi.mocked(readNoteCatalog).mockResolvedValue(catalog('新标题'));
  act(() => notifyNotesChanged('other-workspace'));
  await act(() => vi.advanceTimersByTimeAsync(120));
  expect(readNoteCatalog).toHaveBeenCalledTimes(1);
  act(() => notifyNotesChanged('A'));
  fireEvent.click(view.getByRole('button', { name: '刷新侧栏' }));
  await act(() => vi.advanceTimersByTimeAsync(120));
  expect(readNoteCatalog).toHaveBeenCalledTimes(2);
  expect(view.getAllByText('新标题')).toHaveLength(2);
});

it('hides the old workspace immediately and ignores its late catalog response', async () => {
  let resolveOld!: (value: NoteCatalog) => void;
  vi.mocked(readNoteCatalog).mockImplementation(root => root === 'A' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(catalog('B 的笔记')));
  const view = render(tree('A'));
  await act(() => vi.advanceTimersByTimeAsync(120));
  view.rerender(tree('B'));
  await act(() => vi.advanceTimersByTimeAsync(120));
  await act(async () => resolveOld(catalog('旧工作区')));
  expect(view.queryByText('旧工作区')).toBeNull();
  expect(view.getAllByText('B 的笔记')).toHaveLength(2);
});
