// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudStorageCleanup } from './CloudStorageCleanup';
import { CloudRebaseline } from './CloudRebaseline';
import { CloudDeletionGroup } from './CloudDeletionGroup';
import { WorkspaceRecoverySettings } from './WorkspaceRecoverySettings';
const call = vi.hoisted(() => vi.fn());
vi.mock('@/shared/ipc/cloudAccountApi', () => ({ cloudAccount: call }));
afterEach(cleanup); beforeEach(() => { call.mockReset(); });
it('does not clear history until the displayed preview is explicitly confirmed', async () => {
  call.mockResolvedValue({ token: 'reviewed', versions: 2, metadata_bytes: 100, grace_days: 7, history_days: 30 });
  render(<CloudStorageCleanup />);
  fireEvent.click(screen.getByRole('button', { name: '清理云端旧版本' }));
  await screen.findByText(/可清理 2 个旧版本/);
  expect(call).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '确认清理这些旧版本' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith({ action: 'storage_cleanup', token: 'reviewed' }));
  await screen.findByText(/已清理预览中的云端旧版本/);
});
it('invalidates the rebaseline preview after a stale confirmation and retains the error', async () => {
  call.mockImplementation(({ token }) => token ? Promise.reject('本地或云端内容已变化，请重新核对') : Promise.resolve({ token: 'old', remote_objects: 2, conflicts: 1, local_retained: 1, remote_applied: 0, epoch_changed: true }));
  const changed = vi.fn(); render(<CloudRebaseline root="library" disabled={false} onChanged={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '重新核对云端内容' }));
  await screen.findByText(/服务器已恢复或重建/);
  fireEvent.click(screen.getByRole('button', { name: '确认这次核对' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '确认这次核对' })).toHaveProperty('disabled', true);
  expect(changed).not.toHaveBeenCalled();
});

it('requires a reviewed group and explicit choice before resolving a deletion', async () => {
  call.mockResolvedValue({ token: 'group', entry_id: 'entry', local_deleted: true, remote_deleted: false, members: [{ id: 'entry:entry', local: null, remote: {} }, { id: 'note:n', local: null, remote: {} }] });
  const changed=vi.fn();render(<CloudDeletionGroup root="library" id="note:n" disabled={false} onResolved={changed} />);
  fireEvent.click(screen.getByRole('button',{name:'核对整组删除冲突'}));
  await screen.findByText(/此选择同时处理论文目录/);
  fireEvent.click(screen.getByRole('button',{name:'整组采用云端'}));expect(call).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'确认整组处理'}));
  await waitFor(()=>expect(call).toHaveBeenCalledWith({action:'sync_resolve_deletion_group',root:'library',id:'note:n',token:'group',keep_local:false}));
  await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));
});
it('recovery archive requires confirmation and clears a stale choice', async () => {
  call.mockImplementation(({action})=>action==='recovery_inspect'?Promise.resolve([{name:'sync-apply.journal.json',token:'record',bytes:99,cache_files:1}]):Promise.reject('恢复记录已变化，请重新读取'));
  render(<WorkspaceRecoverySettings />);fireEvent.click(screen.getByRole('button',{name:'检查未完成的保存与同步'}));
  await screen.findByText('sync-apply.journal.json');fireEvent.click(screen.getByRole('button',{name:'选择保留当前文件'}));expect(call).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'确认归档并保留当前文件'}));
  await screen.findByText('恢复记录已变化，请重新读取');
  expect(screen.queryByRole('button',{name:'确认归档并保留当前文件'})).toBeNull();
});
