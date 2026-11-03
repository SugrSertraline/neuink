import { expect, it, vi } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';
import type { FoldGenerationProgress } from './generateEntryFolds';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), report: vi.fn() }));
vi.mock('./generateEntryFolds', () => ({ generateEntryFolds: mocks.generate }));
vi.mock('@/shared/lib/localBackgroundJobs', () => ({ runLocalBackgroundJob: (_: unknown, execute: (report: typeof mocks.report) => Promise<void>) => execute(mocks.report) }));
import { cancelFoldSegments, cancelFoldTask, getFoldTaskSnapshot, startFoldTask, subscribeFoldTasks } from './foldTasks';

const segment: SourceSegment = { uid: 'a', segment_type: 'paragraph', page_idx: 0, bbox: null, text: Array(40).fill('finding').join(' '), markdown: null };
const progress: FoldGenerationProgress = { phase: 'generating', total: 1, completed: 0, failed: 0,
  activeSegmentUids: ['a'], completedSegmentUids: [], failedSegmentUids: [], cachedSegmentUids: [], canceledSegmentUids: [] };

it('shares a task, publishes live progress and retains its failed snapshot for another reader', async () => {
  let reject!: (error: Error) => void;
  mocks.generate.mockImplementation(({ onProgress }: { onProgress: (value: FoldGenerationProgress) => void }) => {
    onProgress(progress);
    return new Promise((_, fail) => { reject = fail; });
  });
  const listener = vi.fn();
  const unsubscribe = subscribeFoldTasks(listener);
  const promise = startFoldTask('root', 'shared', 'Paper', [segment]);
  expect(startFoldTask('root', 'shared', 'Paper', [segment])).toBe(promise);
  expect(getFoldTaskSnapshot('root', 'shared')?.progress.activeSegmentUids).toEqual(['a']);
  expect(mocks.report).toHaveBeenCalledWith({ current: 0, total: 1, percent: 0 }, { status: 'processing', message: '正在生成阅读详略：Paper' });
  reject(new Error('network'));
  await expect(promise).rejects.toThrow('network');
  expect(getFoldTaskSnapshot('root', 'shared')).toMatchObject({ status: 'failed', progress: { failed: 1, failedSegmentUids: ['a'] } });
  expect(getFoldTaskSnapshot('root', 'shared')?.error).toContain('无法连接');
  expect(listener).toHaveBeenCalled();
  unsubscribe();
});

it('reports stopping before cancellation and does not mark canceled paragraphs as failed', async () => {
  mocks.generate.mockImplementation(({ onProgress, signal }: { onProgress: (value: FoldGenerationProgress) => void; signal: AbortSignal }) => {
    onProgress(progress);
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError'))));
  });
  const promise = startFoldTask('root', 'cancel', 'Paper', [segment]);
  cancelFoldTask('root', 'cancel');
  expect(getFoldTaskSnapshot('root', 'cancel')?.status).toBe('stopping');
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  expect(getFoldTaskSnapshot('root', 'cancel')).toMatchObject({ status: 'canceled', progress: { failed: 0, failedSegmentUids: [] } });
});

it('cancels selected generating and waiting items but never a saving item', async () => {
  let emit!: (value: FoldGenerationProgress) => void;
  let resolve!: (value: { failedSegmentUids: string[] }) => void;
  const second = { ...segment, uid: 'b' };
  mocks.generate.mockImplementation(({ onProgress }: { onProgress: (value: FoldGenerationProgress) => void }) => {
    emit = onProgress;
    onProgress({ ...progress, total: 2 });
    return new Promise(done => { resolve = done; });
  });
  const promise = startFoldTask('root', 'selective', 'Paper', [segment, second]);
  cancelFoldSegments('root', 'selective', ['a']);
  expect(getFoldTaskSnapshot('root', 'selective')?.progress.canceledSegmentUids).toEqual(['a']);
  emit({ ...progress, phase: 'saving', total: 2, activeSegmentUids: ['b'], canceledSegmentUids: ['a'] });
  cancelFoldSegments('root', 'selective', ['b']);
  expect(getFoldTaskSnapshot('root', 'selective')?.progress.canceledSegmentUids).toEqual(['a']);
  resolve({ failedSegmentUids: [] });
  await promise;
});

it('retains the actual paragraph failure category after later paragraphs finish', async () => {
  mocks.generate.mockResolvedValue({ failedSegmentUids: ['a'], skipped: [], failureCode: 'truncated' });
  await expect(startFoldTask('root', 'truncated', 'Paper', [segment])).rejects.toMatchObject({ code: 'truncated' });
  expect(getFoldTaskSnapshot('root', 'truncated')?.error).toContain('长度上限');
});

it('allows canceling a generating item while another active item is saving', async () => {
  let resolve!: (value: { failedSegmentUids: string[] }) => void;
  const second = { ...segment, uid: 'b' };
  mocks.generate.mockImplementation(({ onProgress }: { onProgress: (value: FoldGenerationProgress) => void }) => {
    onProgress({ ...progress, total: 2, activeSegmentUids: ['a', 'b'], savingSegmentUids: ['b'] });
    return new Promise(done => { resolve = done; });
  });
  const promise = startFoldTask('root', 'parallel-cancel', 'Paper', [segment, second]);
  cancelFoldSegments('root', 'parallel-cancel', ['a', 'b']);
  expect(getFoldTaskSnapshot('root', 'parallel-cancel')?.progress.canceledSegmentUids).toEqual(['a']);
  resolve({ failedSegmentUids: [] });
  await promise;
});
