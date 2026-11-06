// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ZoteroNoteSaveDialog } from './ZoteroNoteSaveDialog';

const api = vi.hoisted(() => ({ previewZoteroNote: vi.fn(), overwriteZoteroNote: vi.fn(), notify: vi.fn() }));
vi.mock('@/shared/ipc/zoteroApi', () => api);
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify: api.notify }) }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); api.previewZoteroNote.mockReset(); api.overwriteZoteroNote.mockResolvedValue({ written: true }); });
function setup() {
  const props = { root: 'workspace', entryId: 'paper', noteId: 'note', open: true, onOpenChange: vi.fn(), origin: { note_key: 'NOTE0001', source_html: '<p>Known source original</p>' }, getHtml: vi.fn(() => '<p>My local draft</p>'), onSaveLocal: vi.fn(async () => true) };
  const view = render(<ZoteroNoteSaveDialog {...props} />);
  return { props, rerender: (open: boolean) => view.rerender(<ZoteroNoteSaveDialog {...props} open={open} />) };
}

it('immediately compares the retained original, loads live content automatically, and writes only after confirmation', async () => {
  let finish!: (value: unknown) => void;
  api.previewZoteroNote.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { props } = setup();
  expect(screen.getByRole('region', { name: 'Zotero 原笔记' }).textContent).toContain('Known source original');
  expect(screen.getByRole('region', { name: '逐行变化' }).textContent).toContain('My local draft');
  expect(api.previewZoteroNote).toHaveBeenCalledExactlyOnceWith('workspace', 'paper', 'note');
  expect(screen.getByRole('button', { name: '确认替换 Zotero 笔记' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: '保存到本地' })).toHaveProperty('disabled', false);
  const live = { server_id: 'server', version: 6, html: '<p>Latest Zotero original</p>' };
  await act(async () => finish(live));
  expect(screen.getByRole('region', { name: 'Zotero 原笔记' }).textContent).toContain('Latest Zotero original');
  expect(api.overwriteZoteroNote).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认替换 Zotero 笔记' }));
  await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  expect(props.onSaveLocal).toHaveBeenCalledOnce();
  expect(api.overwriteZoteroNote).toHaveBeenCalledExactlyOnceWith('workspace', 'paper', 'note', '<p>My local draft</p>', live);
});

it('preserves the offline comparison and allows saving locally without a running Zotero', async () => {
  api.previewZoteroNote.mockRejectedValue(new Error('无法连接 Zotero'));
  const { props } = setup();
  expect((await screen.findByRole('status', { name: 'Zotero 原文读取状态' })).textContent).toContain('不影响保存到本地');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(/当前比较使用 NeuInk 上次保留/)).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Zotero 原笔记' }).textContent).toContain('Known source original');
  expect(screen.getByRole('button', { name: '确认替换 Zotero 笔记' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '保存到本地' }));
  await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  expect(props.onSaveLocal).toHaveBeenCalledOnce();
  expect(api.overwriteZoteroNote).not.toHaveBeenCalled();
  expect(api.notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success', title: '已保存到 NeuInk 本地' }));
});

it('saves locally while the source connection is pending and ignores its late failure', async () => {
  let fail!: (error: Error) => void;
  api.previewZoteroNote.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
  const { props } = setup();
  fireEvent.click(screen.getByRole('button', { name: '保存到本地' }));
  await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  await act(async () => fail(new Error('无法连接 Zotero')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status', { name: 'Zotero 原文读取状态' })).toBeNull();
  expect(api.notify).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tone: 'success', title: '已保存到 NeuInk 本地' }));
  expect(api.overwriteZoteroNote).not.toHaveBeenCalled();
});

it('shows a real local save failure separately from a source connection problem', async () => {
  api.previewZoteroNote.mockRejectedValue(new Error('无法连接 Zotero'));
  const { props } = setup();
  props.onSaveLocal.mockResolvedValue(false);
  await screen.findByRole('status', { name: 'Zotero 原文读取状态' });
  fireEvent.click(screen.getByRole('button', { name: '保存到本地' }));
  expect((await screen.findByRole('alert')).textContent).toContain('NeuInk 本地保存失败');
  expect(props.onOpenChange).not.toHaveBeenCalled();
  expect(api.notify).not.toHaveBeenCalled();
  expect(api.overwriteZoteroNote).not.toHaveBeenCalled();
});

it('discards old responses after reopening and rejects a draft changed after review', async () => {
  let finishOld!: (value: unknown) => void;
  api.previewZoteroNote.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; })).mockResolvedValue({ server_id: 'server', version: 8, html: '<p>Current original</p>' });
  const { props, rerender } = setup();
  rerender(false); rerender(true);
  await waitFor(() => expect(screen.getByRole('region', { name: 'Zotero 原笔记' }).textContent).toContain('Current original'));
  await act(async () => finishOld({ server_id: 'server', version: 7, html: '<p>Stale original</p>' }));
  expect(screen.getByRole('region', { name: 'Zotero 原笔记' }).textContent).toContain('Current original');
  props.getHtml.mockReturnValue('<p>Newer draft</p>');
  fireEvent.click(screen.getByRole('button', { name: '确认替换 Zotero 笔记' }));
  await screen.findByRole('alert');
  expect(props.onSaveLocal).not.toHaveBeenCalled();
  expect(api.overwriteZoteroNote).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '确认替换 Zotero 笔记' })).toHaveProperty('disabled', true);
});

it('stops source writes if saving locally fails', async () => {
  api.previewZoteroNote.mockResolvedValue({ server_id: 'server', version: 8, html: '<p>Current original</p>' });
  const { props } = setup();
  props.onSaveLocal.mockResolvedValue(false);
  await waitFor(() => expect(screen.getByRole('button', { name: '确认替换 Zotero 笔记' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '确认替换 Zotero 笔记' }));
  expect((await screen.findByRole('alert')).textContent).toContain('本地保存失败');
  expect(api.overwriteZoteroNote).not.toHaveBeenCalled();
  expect(props.onOpenChange).not.toHaveBeenCalled();
});

it('reports that local saving succeeded if Zotero disconnects during the confirmed write', async () => {
  api.previewZoteroNote.mockResolvedValue({ server_id: 'server', version: 8, html: '<p>Current original</p>' });
  api.overwriteZoteroNote.mockRejectedValueOnce(new Error('无法连接 Zotero'));
  const { props } = setup();
  await waitFor(() => expect(screen.getByRole('button', { name: '确认替换 Zotero 笔记' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '确认替换 Zotero 笔记' }));
  expect((await screen.findByRole('alert')).textContent).toContain('NeuInk 本地保存已完成，Zotero 写回未完成');
  expect(props.onSaveLocal).toHaveBeenCalledOnce();
  expect(props.onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '确认替换 Zotero 笔记' })).toHaveProperty('disabled', true);
});
