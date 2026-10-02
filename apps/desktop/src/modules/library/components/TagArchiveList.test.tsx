// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listTagArchives, purgeTagArchive } from '@/shared/ipc/tagReadingApi';
import { TagArchiveList } from './TagArchiveList';

vi.mock('@/shared/ipc/tagReadingApi', () => ({
  listTagArchives: vi.fn(), purgeTagArchive: vi.fn(), notifyTagArchivesChanged: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(listTagArchives).mockResolvedValue([{
    archive_id: 'archive-1',
    root_tag: { id: 'tag-1', name: '研究主题', parent_id: null, description: '标签说明', created_at: '', updated_at: '' },
    tags: [{ id: 'tag-1', name: '研究主题', parent_id: null, description: '标签说明', created_at: '', updated_at: '' }],
    deleted_at: '2026-09-28T00:00:00Z',
  }]);
  vi.mocked(purgeTagArchive).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows deleted tags in the trash table and purges only after confirmation', async () => {
  const view = render(<TagArchiveList root="workspace" refreshKey="1" onRestore={vi.fn()} />);
  await waitFor(() => expect(view.getByText('研究主题')).toBeTruthy());
  expect(view.getByText('标签')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: '彻底删除标签 研究主题' }));
  expect(purgeTagArchive).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '取消' }));
  expect(purgeTagArchive).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '彻底删除标签 研究主题' }));
  fireEvent.click(view.getByRole('button', { name: '彻底删除' }));
  await waitFor(() => expect(purgeTagArchive).toHaveBeenCalledWith('workspace', 'archive-1'));
  await waitFor(() => expect(view.queryByText('研究主题')).toBeNull());
});

it('keeps the confirmation open when permanent deletion fails', async () => {
  vi.mocked(purgeTagArchive).mockRejectedValueOnce(new Error('写入失败'));
  const view = render(<TagArchiveList root="workspace" refreshKey="1" onRestore={vi.fn()} />);
  await waitFor(() => expect(view.getByText('研究主题')).toBeTruthy());
  fireEvent.click(view.getByRole('button', { name: '彻底删除标签 研究主题' }));
  fireEvent.click(view.getByRole('button', { name: '彻底删除' }));
  await waitFor(() => expect(view.getByRole('dialog').textContent).toContain('写入失败'));
  expect(view.getByText('研究主题')).toBeTruthy();
});
