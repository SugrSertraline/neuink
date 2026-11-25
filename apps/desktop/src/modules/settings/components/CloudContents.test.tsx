// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudContents } from './CloudContents';
const call = vi.hoisted(() => vi.fn());
vi.mock('@/shared/ipc/cloudAccountApi', () => ({ cloudAccount: call }));
afterEach(cleanup);
const snapshot = { revision: 8, attachment_bytes: 100, attachment_count: 1, items: [
  { id: 'entry:a', kind: 'entry', title: 'Cloud paper', parent_title: 'Cloud paper', revision: 7, deleted: false, fields: { doi: '10/test' }, resources: [{ name: 'paper.pdf', hash: 'a', size: 100 }] },
  { id: 'entry:old', kind: 'entry', title: 'Deleted paper', parent_title: '', revision: 8, deleted: true, fields: {}, resources: [] },
] };
beforeEach(() => { call.mockReset(); call.mockResolvedValue(snapshot); });
it('only reads on demand and shows server metadata and files without starting sync', async () => {
  render(<CloudContents root="one" />);
  expect(call).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('查看云端内容'));
  await screen.findByText('Cloud paper');
  expect(screen.queryByText('Deleted paper')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看 Cloud paper' }));
  expect(screen.getByText('10/test')).toBeTruthy();
  expect(screen.getByText('paper.pdf · 100 B')).toBeTruthy();
  expect(call.mock.calls.every(([r]) => r.action === 'sync_cloud_contents')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索云端内容' }), { target: { value: 'absent' } });
  expect(screen.getByText('没有匹配的云端内容')).toBeTruthy();
});
it('clears stale server results when refresh fails and supports retry', async () => {
  render(<CloudContents root="one" />);
  fireEvent.click(screen.getByText('查看云端内容'));
  await screen.findByText('Cloud paper');
  call.mockRejectedValueOnce('网络不可用');
  fireEvent.click(screen.getByText('刷新云端清单'));
  await screen.findByRole('alert');
  expect(screen.queryByText('Cloud paper')).toBeNull();
  fireEvent.click(screen.getByText('刷新云端清单'));
  await screen.findByText('Cloud paper');
});
it('ignores late responses after closing or switching libraries', async () => {
  let finish!: (value: unknown) => void;
  call.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<CloudContents root="one" />);
  fireEvent.click(screen.getByText('查看云端内容'));
  expect(screen.getByRole('status')).toBeTruthy();
  view.rerender(<CloudContents root="two" />);
  finish(snapshot);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText('Cloud paper')).toBeNull();
});
