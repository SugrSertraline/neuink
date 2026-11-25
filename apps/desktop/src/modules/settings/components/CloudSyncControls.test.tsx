// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudSyncControls } from './CloudSyncControls';
const call = vi.hoisted(() => vi.fn());
vi.mock('@/shared/ipc/cloudAccountApi', () => ({ cloudAccount: call }));
afterEach(cleanup);
const empty = () => ({ root: 'test-root', binding: null, task: { running: false, cancelled: false, error: null, result: null } });
beforeEach(() => { call.mockReset(); call.mockResolvedValue(empty()); });

it('requires preview and explicit binding before any transfer', async () => {
  call.mockImplementation(async ({ action }) => {
    if (action === 'default_library') return { id: 'library', name: '我的资料库', revision: 3 };
    if (action === 'sync_cloud_preview') return { token: 'preview-token', entities: 4, new_attachment_bytes: 1024, existing_attachment_bytes: 0, metadata_estimate_bytes: 100, overlapping_objects: 0, available_bytes: 10000, issues: [], omitted_scope: [] };
    if (action === 'sync_preview') return { validated_entities: 4, validated_attachment_bytes: 1024, entries: [] };
    return empty();
  });
  render(<CloudSyncControls active />);
  await screen.findByText('test-root');
  expect(call.mock.calls.every(([request]) => request.action === 'sync_status')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '开启同步' }));
  await screen.findByRole('button', { name: '确认并开启同步' });
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(call.mock.calls.some(([request]) => request.action === 'sync_bind')).toBe(false);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByText('云端资料库：我的资料库（默认，不可改名）')).toBeTruthy();
  await screen.findByText(/4 个可同步对象/);
  fireEvent.click(screen.getByRole('button', { name: '确认并开启同步' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith({ action: 'sync_bind', root: 'test-root', library_id: 'library', token: 'preview-token' }));
  expect(call.mock.calls.some(([request]) => request.action === 'sync_run')).toBe(false);
});

it('keeps cancellation usable while a transfer request is pending', async () => {
  const state = { ...empty(), binding: { library_id: 'library' }, task: { ...empty().task, running: true } };
  call.mockResolvedValue(state);
  render(<CloudSyncControls active />);
  const cancel = await screen.findByRole('button', { name: '取消本次' });
  fireEvent.click(cancel);
  await waitFor(() => expect(call).toHaveBeenCalledWith({ action: 'sync_cancel', root: 'test-root' }));
});

it('shows conflicts and partial failures without claiming all data is synced', async () => {
  call.mockResolvedValue({ ...empty(), binding: { library_id: 'library' }, task: {
    ...empty().task, result: { published: 2, received: 3, applied: 1, conflicts: 2, failures: [['entry:a', '附件暂不可用']] },
  } });
  render(<CloudSyncControls active />);
  expect(await screen.findByText(/冲突 2，失败 1/)).toBeTruthy();
  expect(screen.getByText(/附件暂不可用/)).toBeTruthy();
});

it('closing settings does not cancel an active sync request', async () => {
  let finish!: (value: unknown) => void;
  const transfer = new Promise(resolve => { finish = resolve; });
  call.mockImplementation(({ action }) => action === 'sync_run' ? transfer : Promise.resolve({
    ...empty(), binding: { library_id: 'library' },
  }));
  const view = render(<CloudSyncControls active />);
  fireEvent.click(await screen.findByRole('button', { name: '立即同步' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith({ action: 'sync_run', root: 'test-root' }));
  view.unmount();
  expect(call.mock.calls.some(([request]) => request.action === 'sync_cancel')).toBe(false);
  finish({ ...empty().task, result: { published: 1, received: 0, applied: 0, conflicts: 0, failures: [] } });
});
it('persistent pause disables manual transfer and can be resumed', async () => {
  call.mockResolvedValue({ ...empty(), binding: { library_id: 'library' }, control: { paused: true } });
  render(<CloudSyncControls active />);
  expect(await screen.findByRole('button', { name: '立即同步' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('switch', { name: '自动同步' }).getAttribute('aria-checked')).toBe('false');
  fireEvent.click(screen.getByRole('switch', { name: '自动同步' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith({ action: 'sync_pause', root: 'test-root', paused: false }));
});

it('keeps quota-paused uploads visible after a successful download-only round', async () => {
  call.mockResolvedValue({ ...empty(), binding: { library_id: 'library' }, task: {
    ...empty().task, result: { uploads_blocked: true, published: 0, received: 3, applied: 3, conflicts: 0, failures: [] },
  } });
  render(<CloudSyncControls active />);
  expect(await screen.findByText(/自动上传已暂停，云端下载继续/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '重试同步' })).toHaveProperty('disabled', false);
});

it('reports the queued deletion phase instead of implying the whole operation completed', async () => {
  call.mockResolvedValue({ ...empty(), binding: { library_id: 'library' }, task: {
    ...empty().task, result: { pending: 2, published: 2, received: 0, applied: 0, conflicts: 0, failures: [] },
  } });
  render(<CloudSyncControls active />);
  expect(await screen.findByText(/仍有 2 项等待后续同步/)).toBeTruthy();
});

it('keeps repair tools out of daily actions and only reads repair preview on request', async () => {
  call.mockResolvedValue({ ...empty(), binding: { library_id: 'library' }, conflict_count: 0 });
  render(<CloudSyncControls active />);
  await screen.findByRole('button', { name: '立即同步' });
  expect(screen.queryByRole('button', { name: '查看及处理冲突' })).toBeNull();
  expect(screen.queryByRole('button', { name: '重新核对云端内容' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '同步维护' }));
  await screen.findByRole('button', { name: '重新核对云端内容' });
  expect(call.mock.calls.some(([r]) => r.action === 'sync_rebaseline')).toBe(false);
});

it('shows persisted conflicts after restart and hides resolved conflicts despite an old task result', async () => {
  call.mockResolvedValue({ ...empty(), binding: { library_id: 'library' }, conflict_count: 2 });
  const view = render(<CloudSyncControls active />);
  await screen.findByText(/当前有 2 项同步冲突待处理/);
  expect(screen.getByRole('button', { name: '查看及处理冲突' })).toBeTruthy();
  view.unmount();
  call.mockResolvedValue({ ...empty(), binding: { library_id: 'library' }, conflict_count: 0,
    task: { ...empty().task, result: { published: 0, received: 0, applied: 0, conflicts: 2, failures: [] } } });
  render(<CloudSyncControls active />);
  await screen.findByRole('button', { name: '立即同步' });
  expect(screen.queryByRole('button', { name: '查看及处理冲突' })).toBeNull();
});

it('keeps controls accessible when conflict status is unavailable', async () => {
  call.mockResolvedValue({ ...empty(), binding: { library_id: 'library' }, conflict_count: null, conflict_error: '读取失败' });
  render(<CloudSyncControls active />);
  await screen.findByText('冲突状态读取失败：读取失败');
  expect(screen.getByRole('button', { name: '同步维护' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '查看及处理冲突' })).toBeTruthy();
});
