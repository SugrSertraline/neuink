// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TrashItem } from '@/shared/types/domain';
import { listTrashItems } from '@/shared/ipc/workspaceApi';
import { readNoteCatalog } from '@/shared/ipc/noteCatalogApi';
import { listTagArchives, purgeTagArchive } from '@/shared/ipc/tagReadingApi';
import { purgeTagNote } from '@/shared/ipc/noteOwnerApi';
import { EmptyWorkspaceTrashButton } from './EmptyWorkspaceTrashButton';
import { planEmptyTrash, runTrashPurge } from './emptyWorkspaceTrash';
import { setMarkdownNoteDirty } from '@/modules/notes/editor/noteDirtyRegistry';

vi.mock('@/shared/ipc/workspaceApi', () => ({ listTrashItems: vi.fn() }));
vi.mock('@/shared/ipc/noteCatalogApi', () => ({ readNoteCatalog: vi.fn(), notifyNotesChanged: vi.fn() }));
vi.mock('@/shared/ipc/tagReadingApi', () => ({ listTagArchives: vi.fn(), purgeTagArchive: vi.fn(), notifyTagArchivesChanged: vi.fn() }));
vi.mock('@/shared/ipc/noteOwnerApi', () => ({ purgeTagNote: vi.fn() }));
const record = (id: string, kind: TrashItem['kind'] = 'entry', parent = id): TrashItem => ({
  trash_id: id, entry_id: parent, entry_title: id, item_id: id, title: id, preview: '', deleted_at: '',
  kind, parent_entry_trashed: false, restorable: true, stored_trash_item: kind !== 'entry'
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listTrashItems).mockResolvedValue([record('local')]);
  vi.mocked(listTagArchives).mockResolvedValue([]);
  vi.mocked(readNoteCatalog).mockResolvedValue({ notes: [], errors: [] });
});
afterEach(cleanup);
const setup = () => {
  const purgeEntry = vi.fn(), purgeItem = vi.fn();
  render(<EmptyWorkspaceTrashButton root="test" externalIds={new Set()} onPurgeEntry={purgeEntry} onPurgeItem={purgeItem} />);
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  return { purgeEntry, purgeItem };
};

it('loads a confirmation snapshot and cancel performs no mutations', async () => {
  const { purgeEntry } = setup();
  await screen.findByRole('button', { name: '确认清空' });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(purgeEntry).not.toHaveBeenCalled();
  expect(purgeTagArchive).not.toHaveBeenCalled();
  expect(purgeTagNote).not.toHaveBeenCalled();
});

it('protects source entries and avoids double-deleting child records', () => {
  const plan = planEmptyTrash([record('local'), record('child', 'markdown_note', 'local'),
    { ...record('source'), source_managed: true }, record('protected-child', 'annotation', 'source'),
    record('independent', 'annotation', 'active')], [], [], new Set());
  expect(plan.entries.map(item => item.entry_id)).toEqual(['local']);
  expect(plan.records.map(item => item.trash_id)).toEqual(['independent']);
  expect(plan.protectedCount).toBe(1);
});

it('clears all categories and does not purge archived tag notes twice', async () => {
  const tag = { id: 'archived', name: 'Archived', parent_id: null, description: '', created_at: '', updated_at: '' };
  vi.mocked(listTagArchives).mockResolvedValue([{ archive_id: 'archive', root_tag: tag, tags: [tag], deleted_at: 'now' }]);
  vi.mocked(readNoteCatalog).mockResolvedValue({ errors: [], notes: ['archived', 'active'].map(id => ({
    target: { owner: { kind: 'tag_reading', tag_id: id }, note_id: 'note' },
    title: id, owner_title: id, updated_at: '', deleted_at: 'now', revision: 'v1', links: [], error: null
  })) });
  const { purgeEntry } = setup();
  fireEvent.click(await screen.findByRole('button', { name: '确认清空' }));
  await screen.findByText('已清理 3 项，清理完成。');
  expect(purgeEntry).toHaveBeenCalledExactlyOnceWith('local');
  expect(purgeTagNote).toHaveBeenCalledExactlyOnceWith('test', 'active', 'note', 'v1');
  expect(purgeTagArchive).toHaveBeenCalledExactlyOnceWith('test', 'archive');
});

it('continues past a failure and reports remaining items', async () => {
  const next = vi.fn();
  const result = await runTrashPurge([{ label: 'first', run: () => { throw new Error('locked'); } },
    { label: 'second', run: next }], () => true, vi.fn());
  expect(next).toHaveBeenCalledOnce();
  expect(result).toEqual({ succeeded: 1, failures: ['first：locked'] });
});

it('does not continue mutations after the workspace changes', async () => {
  let current = true;
  const next = vi.fn();
  await runTrashPurge([{ label: 'first', run: () => { current = false; } }, { label: 'second', run: next }], () => current, vi.fn());
  expect(next).not.toHaveBeenCalled();
});

it('blocks confirmation on read failure and allows retry', async () => {
  vi.mocked(listTrashItems).mockRejectedValueOnce(new Error('cannot read'));
  setup();
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '确认清空' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '刷新列表' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '确认清空' }).hasAttribute('disabled')).toBe(false));
});

it('disables confirmation when empty', async () => {
  vi.mocked(listTrashItems).mockResolvedValue([]);
  setup();
  await screen.findByText('没有可清空的内容。');
  expect(screen.getByRole('button', { name: '确认清空' }).hasAttribute('disabled')).toBe(true);
});

it('prevents duplicate submission and closing during deletion', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const { purgeEntry } = setup();
  purgeEntry.mockReturnValue(pending);
  fireEvent.click(await screen.findByRole('button', { name: '确认清空' }));
  expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '正在清空…' }));
  expect(purgeEntry).toHaveBeenCalledOnce();
  finish();
  await screen.findByText('已清理 1 项，清理完成。');
});

it('keeps unsaved notes safe', async () => {
  setMarkdownNoteDirty('entry', 'note', 'editor', true);
  try {
    const { purgeEntry } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '确认清空' }));
    await screen.findByRole('alert');
    expect(purgeEntry).not.toHaveBeenCalled();
  } finally { setMarkdownNoteDirty('entry', 'note', 'editor', false); }
});
