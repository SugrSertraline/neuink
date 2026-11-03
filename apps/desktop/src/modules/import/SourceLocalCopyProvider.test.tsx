// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SourceLocalCopyControl, SourceLocalCopyProvider } from './SourceLocalCopyProvider';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

const mocks = vi.hoisted(() => ({ copy: vi.fn(), zoteroCopy: vi.fn(), listNotes: vi.fn(), importNotes: vi.fn(), notify: vi.fn() }));
vi.mock('@/shared/ipc/workspaceApi', () => ({ copySourceToLocal: mocks.copy }));
vi.mock('@/shared/ipc/zoteroApi', () => ({ importZoteroLocalCopy: mocks.zoteroCopy, listZoteroNoteImports: mocks.listNotes, importZoteroNotes: mocks.importNotes }));
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify: mocks.notify }) }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.copy.mockReset(); mocks.copy.mockResolvedValue({ entry_id: 'local-copy', created: true }); });

const source = { id: 'source', title: 'Source paper', sourceInfo: { kinds: ['zotero'], local_copy_ids: [] } } as unknown as LibraryEntry;
function setup(entry = source) {
  const refreshEntries = vi.fn(async () => undefined), setHidden = vi.fn(async () => undefined);
  const beforeCopy = vi.fn(async () => undefined), onOpenEntry = vi.fn();
  render(<SourceLocalCopyProvider root="library" {...{ refreshEntries, setHidden, beforeCopy, onOpenEntry }}><SourceLocalCopyControl entry={entry} /></SourceLocalCopyProvider>);
  return { refreshEntries, setHidden, beforeCopy, onOpenEntry };
}

it('saves before copying, and retains source visibility unless the completed copy is explicitly confirmed', async () => {
  const { setHidden, beforeCopy, refreshEntries } = setup();
  fireEvent.click(screen.getByRole('button', { name: '导入到本地' }));
  await screen.findByRole('dialog');
  expect(beforeCopy).toHaveBeenCalledExactlyOnceWith('source');
  expect(mocks.copy).toHaveBeenCalledExactlyOnceWith('library', 'source', false);
  expect(beforeCopy.mock.invocationCallOrder[0]).toBeLessThan(mocks.copy.mock.invocationCallOrder[0]);
  expect(refreshEntries).toHaveBeenCalledOnce();
  expect(setHidden).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保留来源显示' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(setHidden).not.toHaveBeenCalled();
});

it('keeps the completed copy on hide failure and retries only hiding', async () => {
  const { setHidden } = setup();
  setHidden.mockRejectedValueOnce(new Error('无法保存隐藏状态'));
  fireEvent.click(screen.getByRole('button', { name: '导入到本地' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: '隐藏来源条目' }));
  expect((await screen.findByRole('alert')).textContent).toContain('本地副本已保存');
  fireEvent.click(screen.getByRole('button', { name: '隐藏来源条目' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(setHidden).toHaveBeenCalledTimes(2);
  expect(setHidden).toHaveBeenLastCalledWith('source', true);
  expect(mocks.copy).toHaveBeenCalledOnce();
});

it.each(['save', 'copy'])('does not offer hiding when %s fails', async failure => {
  const { beforeCopy, setHidden } = setup();
  if (failure === 'save') beforeCopy.mockRejectedValueOnce(new Error('笔记未保存'));
  else mocks.copy.mockRejectedValueOnce(new Error('复制失败'));
  fireEvent.click(screen.getByRole('button', { name: '导入到本地' }));
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' })));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(setHidden).not.toHaveBeenCalled();
  if (failure === 'save') expect(mocks.copy).not.toHaveBeenCalled();
});

it('opens a previously imported copy and creates another only through the explicit second action', async () => {
  mocks.copy.mockResolvedValueOnce({ entry_id: 'existing-copy', created: false });
  const { onOpenEntry, setHidden } = setup({ ...source, sourceInfo: { ...source.sourceInfo!, local_copy_ids: ['existing-copy'] } });
  fireEvent.click(screen.getByRole('button', { name: '打开本地副本' }));
  await waitFor(() => expect(onOpenEntry).toHaveBeenCalledWith('existing-copy'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(setHidden).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '另建一份' }));
  await screen.findByRole('dialog');
  expect(mocks.copy).toHaveBeenLastCalledWith('library', 'source', true);
});

it('uses the refreshed entry navigator when opening the new copy from its persistent toast', async () => {
  const props = { root: 'library', beforeCopy: vi.fn(async () => undefined), refreshEntries: vi.fn(async () => undefined), setHidden: vi.fn(async () => undefined) };
  const staleNavigator = vi.fn(), refreshedNavigator = vi.fn();
  const view = (onOpenEntry: (id: string) => void) => <SourceLocalCopyProvider {...props} onOpenEntry={onOpenEntry}><SourceLocalCopyControl entry={source} /></SourceLocalCopyProvider>;
  const { rerender } = render(view(staleNavigator));
  fireEvent.click(screen.getByRole('button', { name: '导入到本地' }));
  await screen.findByRole('dialog');
  const toast = mocks.notify.mock.calls.find(([options]) => options.tone === 'success')![0];
  fireEvent.click(screen.getByRole('button', { name: '保留来源显示' }));
  rerender(view(refreshedNavigator));
  render(toast.action);
  fireEvent.click(screen.getByRole('button', { name: '打开本地条目' }));
  expect(staleNavigator).not.toHaveBeenCalled();
  expect(refreshedNavigator).toHaveBeenCalledExactlyOnceWith('local-copy');
});

it('uses the source-aware PDF importer and exposes separate note imports into an existing local entry', async () => {
  mocks.zoteroCopy.mockResolvedValue({ entry_id: 'existing-copy', created: false });
  mocks.listNotes.mockResolvedValue({ notes: [], source_title: 'Source paper' });
  const entry = { ...source, sourceInfo: { ...source.sourceInfo!, local_copy_ids: ['existing-copy'] } };
  const local = { id: 'existing-copy', title: 'My paper', sourceInfo: { kinds: [] } } as unknown as LibraryEntry;
  const onOpenEntry = vi.fn();
  render(<SourceLocalCopyProvider root="library" entries={[entry, local]} beforeCopy={async () => undefined} refreshEntries={async () => undefined} setHidden={async () => undefined} onOpenEntry={onOpenEntry}><SourceLocalCopyControl entry={entry} /></SourceLocalCopyProvider>);
  fireEvent.click(screen.getByRole('button', { name: '打开本地副本' }));
  await waitFor(() => expect(onOpenEntry).toHaveBeenCalledWith('existing-copy'));
  expect(mocks.zoteroCopy).toHaveBeenCalledExactlyOnceWith('library', 'source', false);
  expect(mocks.copy).not.toHaveBeenCalled();
  expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: '本地已存在对应条目' }));
  fireEvent.click(screen.getByRole('button', { name: '导入 Zotero 笔记' }));
  await screen.findByText('来源论文没有可导入的笔记。');
  expect(mocks.listNotes).toHaveBeenCalledExactlyOnceWith('library', 'source', 'existing-copy');
});
