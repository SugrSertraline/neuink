// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePdfParseQueue } from './usePdfParseQueue';
import { movePdfParseQueue, processPdfParseQueue, readPdfParseQueue, type PdfParseQueue } from '@/shared/ipc/pdfParseQueueApi';
import type { EntryMeta, PdfParseStatus } from '@/shared/types/domain';

vi.mock('@/shared/ipc/pdfParseQueueApi', () => ({ readPdfParseQueue: vi.fn(), processPdfParseQueue: vi.fn(), movePdfParseQueue: vi.fn() }));
const blank: PdfParseQueue = { waiting: [], active: [], failed: [] };
const entry = (id: string, status: PdfParseStatus, task_id: string | null = null) => ({ id, title: id, pdf: { parse: { status, task_id } } } as EntryMeta);
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); vi.mocked(readPdfParseQueue).mockResolvedValue(blank); vi.mocked(processPdfParseQueue).mockResolvedValue(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('does not dispatch an empty queue or leave idle timers', async () => {
  renderHook(() => usePdfParseQueue('A', 'http://parser', '', '', vi.fn())); await flush();
  expect(processPdfParseQueue).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it('displays waiting tasks without submitting when the parser is unconfigured', async () => {
  vi.mocked(readPdfParseQueue).mockResolvedValue({ ...blank, waiting: [entry('one', 'queued')] });
  const view = renderHook(() => usePdfParseQueue('A', '', '', '', vi.fn())); await flush();
  expect(view.result.current.queue.waiting).toHaveLength(1);
  expect(processPdfParseQueue).not.toHaveBeenCalled(); view.unmount(); expect(vi.getTimerCount()).toBe(0);
});

it('does not overlap a slow upload and releases timers on unmount', async () => {
  let finish!: () => void;
  vi.mocked(processPdfParseQueue).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(readPdfParseQueue).mockResolvedValue({ ...blank, waiting: [entry('one', 'queued')] });
  const changed = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(() => usePdfParseQueue('A', 'http://parser', '', '', changed)); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(processPdfParseQueue).toHaveBeenCalledTimes(1);
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
  finish(); await flush(); expect(changed).not.toHaveBeenCalled();
});

it('waits for the active remote task before dispatching another', async () => {
  vi.mocked(readPdfParseQueue).mockResolvedValue({ ...blank, waiting: [entry('two', 'queued')], active: [entry('one', 'parsing', 'remote')] });
  renderHook(() => usePdfParseQueue('A', 'http://parser', '', '', vi.fn())); await flush();
  expect(processPdfParseQueue).not.toHaveBeenCalled();
  vi.mocked(readPdfParseQueue).mockResolvedValue({ ...blank, waiting: [entry('two', 'queued')] });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(processPdfParseQueue).toHaveBeenCalledOnce();
});

it('keeps a failed submission visible and continues checking the queue', async () => {
  vi.mocked(readPdfParseQueue).mockResolvedValue({ ...blank, waiting: [entry('one', 'queued')] });
  vi.mocked(processPdfParseQueue).mockRejectedValueOnce(new Error('disk error'));
  const view = renderHook(() => usePdfParseQueue('A', 'http://parser', '', '', vi.fn())); await flush();
  expect(view.result.current.error).toContain('disk error');
  vi.mocked(readPdfParseQueue).mockResolvedValue({ ...blank, waiting: [entry('two', 'queued')], failed: [entry('one', 'failed')] });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(processPdfParseQueue).toHaveBeenCalledTimes(2);
  expect(view.result.current.queue.failed).toHaveLength(1);
});

it('ignores late snapshots when switching workspace and late mutation results', async () => {
  let finish!: (q: PdfParseQueue) => void;
  vi.mocked(readPdfParseQueue).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const changed = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(({ root }) => usePdfParseQueue(root, 'http://parser', '', '', changed), { initialProps: { root: 'A' } });
  view.rerender({ root: 'B' }); await flush();
  finish({ ...blank, waiting: [entry('old', 'queued')] }); await flush();
  expect(view.result.current.queue.waiting).toHaveLength(0); expect(processPdfParseQueue).not.toHaveBeenCalled();
  let moved!: (q: PdfParseQueue) => void;
  vi.mocked(movePdfParseQueue).mockImplementation(() => new Promise(resolve => { moved = resolve; }));
  act(() => { void view.result.current.move('old', 'first'); });
  view.rerender({ root: 'C' }); await flush();
  moved({ ...blank, waiting: [entry('old', 'queued')] }); await flush();
  expect(changed).not.toHaveBeenCalled(); expect(view.result.current.queue.waiting).toHaveLength(0);
});

it('shows a queue read error, allows retry, and never dispatches after a failed read', async () => {
  vi.mocked(readPdfParseQueue).mockRejectedValueOnce(new Error('unreadable'));
  const view = renderHook(() => usePdfParseQueue('A', 'http://parser', '', '', vi.fn())); await flush();
  expect(view.result.current.error).toContain('unreadable'); expect(processPdfParseQueue).not.toHaveBeenCalled();
  act(() => view.result.current.refresh()); await flush();
  expect(view.result.current.error).toBe('');
});

it('never exposes the previous library queue when the next library fails to load', async () => {
  vi.mocked(readPdfParseQueue).mockResolvedValueOnce({ ...blank, waiting: [entry('private-old', 'queued')] });
  const view = renderHook(({ root }) => usePdfParseQueue(root, '', '', '', vi.fn()), { initialProps: { root: 'A' } }); await flush();
  expect(view.result.current.queue.waiting).toHaveLength(1);
  vi.mocked(readPdfParseQueue).mockRejectedValueOnce(new Error('new library unreadable'));
  view.rerender({ root: 'B' }); await flush();
  expect(view.result.current.queue.waiting).toHaveLength(0);
  expect(view.result.current.error).toContain('new library unreadable');
});

it('keeps an ordering failure visible after refreshing the authoritative queue', async () => {
  vi.mocked(movePdfParseQueue).mockRejectedValueOnce(new Error('任务已经开始'));
  const view = renderHook(() => usePdfParseQueue('A', '', '', '', vi.fn())); await flush();
  await act(async () => { await view.result.current.move('one', 'first'); }); await flush();
  expect(view.result.current.error).toContain('任务已经开始');
  act(() => view.result.current.refresh()); await flush(); expect(view.result.current.error).toBe('');
});

it('does not refresh an unmounted workspace after an ordering request settles', async () => {
  let finish!: (value: PdfParseQueue) => void;
  vi.mocked(movePdfParseQueue).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const changed = vi.fn();
  const view = renderHook(() => usePdfParseQueue('A', '', '', '', changed)); await flush();
  act(() => { void view.result.current.move('one', 'up'); }); view.unmount();
  finish(blank); await flush(); expect(changed).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
