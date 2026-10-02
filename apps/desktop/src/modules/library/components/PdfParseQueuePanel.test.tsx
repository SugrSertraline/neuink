// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PdfParseQueuePanel } from './PdfParseQueuePanel';
import type { usePdfParseQueue } from '@/shared/hooks/usePdfParseQueue';
import type { EntryMeta } from '@/shared/types/domain';
afterEach(cleanup);
const entry = (id: string, status: string) => ({ id, title: id, pdf: { parse: { status, message: '测试状态' } } } as EntryMeta);
const controller = (): ReturnType<typeof usePdfParseQueue> => ({ queue: { active: [entry('运行中', 'parsing')], waiting: [entry('甲', 'queued'), entry('乙', 'queued')], failed: [] }, busy: false, loading: false, configured: true, error: '', move: vi.fn(), refresh: vi.fn() });

it('separates active and waiting jobs and exposes accessible ordering buttons', () => {
  const c = controller(); const open = vi.fn();
  render(<PdfParseQueuePanel controller={c} onOpen={open} onRetry={vi.fn()} />);
  expect(screen.getByText('解析队列 · 1 进行中 / 2 等待')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '上移：运行中' })).toBeNull();
  expect(screen.getByRole('button', { name: '上移：甲' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '置顶：乙' }));
  expect(c.move).toHaveBeenCalledWith('乙', 'first');
  fireEvent.click(screen.getByRole('button', { name: '移出队列：甲' }));
  expect(c.move).toHaveBeenCalledWith('甲', 'remove');
  fireEvent.click(screen.getByRole('button', { name: '1. 甲' })); expect(open).toHaveBeenCalledWith('甲');
});

it('shows unconfigured, loading, read-error, and empty states truthfully', () => {
  const c = controller(); c.queue = { active: [], waiting: [], failed: [] }; c.configured = false; c.loading = true;
  const view = render(<PdfParseQueuePanel controller={c} onOpen={vi.fn()} onRetry={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toContain('正在读取');
  expect(screen.getByText(/请先在设置中/)).toBeTruthy();
  view.rerender(<PdfParseQueuePanel controller={{ ...c, loading: false, error: '存储读取失败' }} onOpen={vi.fn()} onRetry={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toBe('存储读取失败');
  expect(screen.queryByText('没有等待或正在解析的任务')).toBeNull();
});

it('retains failed jobs and displays a retry failure instead of an unhandled rejection', async () => {
  const c = controller(); c.queue.failed = [entry('失败论文', 'failed')];
  render(<PdfParseQueuePanel controller={c} onOpen={vi.fn()} onRetry={vi.fn().mockRejectedValue(new Error('无法入队'))} />);
  fireEvent.click(screen.getByText('解析失败 · 1'));
  fireEvent.click(screen.getByRole('button', { name: '重新加入队列' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法入队'));
  expect(screen.getByRole('button', { name: '重新加入队列' }).hasAttribute('disabled')).toBe(false);
});
