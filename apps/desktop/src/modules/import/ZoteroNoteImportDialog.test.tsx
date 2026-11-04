// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ZoteroNoteImportDialog } from './ZoteroNoteImportDialog';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

const api = vi.hoisted(() => ({ listZoteroNoteImports: vi.fn(), importZoteroNotes: vi.fn(), notify: vi.fn() }));
vi.mock('@/shared/ipc/zoteroApi', () => api);
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify: api.notify }) }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); api.listZoteroNoteImports.mockResolvedValue({ source_title: 'Source', notes: [
  { key: 'old', title: '已有笔记', text: 'Saved source version', content_hash: 'old-hash', imported: true },
  { key: 'new', title: '来源新版本', text: 'New version', content_hash: 'new-hash', imported: false },
] }); api.importZoteroNotes.mockResolvedValue({ imported: 1, skipped: 0, entry_id: 'local' }); });
function setup() {
  const props = { root: 'library', source: { id: 'source', title: 'Source paper' } as LibraryEntry, targets: [{ id: 'local', title: 'My paper' } as LibraryEntry], onClose: vi.fn(), beforeSave: vi.fn(async () => undefined), refreshEntries: vi.fn(async () => undefined) };
  render(<ZoteroNoteImportDialog {...props} />); return props;
}
it('selects only new note versions, saves drafts first and imports reviewed content hashes', async () => {
  const props = setup();
  await screen.findByText('本版本已导入');
  expect(screen.getByRole('checkbox', { name: /已有笔记/ })).toHaveProperty('disabled', true);
  expect(api.importZoteroNotes).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '导入所选 1 篇' }));
  await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
  expect(props.beforeSave).toHaveBeenCalledExactlyOnceWith('local');
  expect(api.importZoteroNotes).toHaveBeenCalledExactlyOnceWith('library', 'source', 'local', [{ key: 'new', content_hash: 'new-hash' }]);
  expect(props.refreshEntries).toHaveBeenCalledOnce();
});
it('keeps the selection on failure and retries without overwriting the local note', async () => {
  api.importZoteroNotes.mockRejectedValueOnce(new Error('来源笔记已更新，请重新读取'));
  const props = setup(); await screen.findByText('本版本已导入');
  fireEvent.click(screen.getByRole('button', { name: '导入所选 1 篇' }));
  await screen.findByRole('alert'); expect(props.onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  await waitFor(() => expect(api.listZoteroNoteImports).toHaveBeenCalledTimes(2));
  await screen.findByRole('button', { name: '导入所选 1 篇' });
  fireEvent.click(screen.getByRole('button', { name: '导入所选 1 篇' }));
  await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
});
