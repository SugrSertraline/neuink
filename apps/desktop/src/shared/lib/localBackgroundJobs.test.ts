import { beforeEach, describe, expect, it, vi } from 'vitest';

const options = {
  idPrefix: 'selection-translation',
  kind: 'paragraph_translation' as const,
  scope: { kind: 'entry' as const, root: 'library', entry_id: 'paper' },
  message: '正在翻译选中文字：论文',
  successMessage: '选区翻译完成',
  failureMessage: '选区翻译未完成，请重试。'
};
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => vi.resetModules());

describe('window-local background task projection', () => {
  it('projects pause and resume without creating another job or losing progress', async () => {
    const registry = await import('./localBackgroundJobs');
    await registry.runLocalBackgroundJob(options, async report => {
      const id = registry.getLocalBackgroundJobs()[0].id;
      const progress = { current: 2, total: 5, percent: 40 };
      report(progress, { status: 'paused', message: '阅读详略已暂停' });
      expect(registry.getLocalBackgroundJobs()[0]).toMatchObject({ id, status: 'paused', progress });
      report(progress, { status: 'processing', message: '正在生成阅读详略' });
      expect(registry.getLocalBackgroundJobs()).toHaveLength(1);
      expect(registry.getLocalBackgroundJobs()[0]).toMatchObject({ id, status: 'processing', progress });
    });
    expect(registry.getLocalBackgroundJobs()[0].status).toBe('succeeded');
  });
  it('reports measured batch progress and distinguishes cancellation from failure', async () => {
    const registry = await import('./localBackgroundJobs');
    await expect(registry.runLocalBackgroundJob(options, async report => {
      report({ current: 1, total: 3, percent: 33 });
      expect(registry.getLocalBackgroundJobs()[0].progress.current).toBe(1);
      throw new DOMException('Canceled', 'AbortError');
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(registry.getLocalBackgroundJobs()[0]).toMatchObject({ status: 'canceled', error: null, progress: { current: 1, total: 3 } });
  });
  it('records a declined duplicate PDF as cancellation', async () => {
    const registry = await import('./localBackgroundJobs');
    const error = new Error('已取消添加重复的 PDF');
    error.name = 'PdfDuplicateCancelledError';
    await expect(registry.runLocalBackgroundJob(options, async () => { throw error; })).rejects.toBe(error);
    expect(registry.getLocalBackgroundJobs()[0]).toMatchObject({ status: 'canceled', error: null, message: '已取消添加重复的 PDF' });
  });
  it('tracks real lifetime with stable snapshots, scoped identity and no guessed percentage', async () => {
    const registry = await import('./localBackgroundJobs');
    const task = deferred<string>();
    const listener = vi.fn();
    const unsubscribe = registry.subscribeLocalBackgroundJobs(listener);
    const result = registry.runLocalBackgroundJob(options, () => task.promise);
    const running = registry.getLocalBackgroundJobs();
    expect(registry.getLocalBackgroundJobs()).toBe(running);
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ status: 'processing', scope: options.scope, progress: { total: 0, current: 0, percent: 0 } });
    expect(running[0].id).toMatch(/^selection-translation:/);
    unsubscribe();
    task.resolve('译文');
    await expect(result).resolves.toBe('译文');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.getLocalBackgroundJobs()[0]).toMatchObject({ status: 'succeeded', error: null });
    expect(running[0].status).toBe('processing');
  });

  it('ends sync and async failures, keeps only safe diagnostics and rethrows original error', async () => {
    const registry = await import('./localBackgroundJobs');
    const secretError = new Error('HTTP 403 provider body sk-secret C:\\private\\notes.txt');
    await expect(registry.runLocalBackgroundJob(options, () => { throw secretError; })).rejects.toBe(secretError);
    const task = deferred<void>();
    const result = registry.runLocalBackgroundJob(options, () => task.promise);
    const assertion = expect(result).rejects.toBe(secretError);
    task.reject(secretError);
    await assertion;
    expect(registry.getLocalBackgroundJobs()).toHaveLength(2);
    for (const row of registry.getLocalBackgroundJobs()) {
      expect(row.status).toBe('failed');
      expect(row.error).toContain('HTTP 403');
    }
    expect(JSON.stringify(registry.getLocalBackgroundJobs())).not.toMatch(/sk-secret|private|notes\.txt|provider body/);
  });

  it('keeps all unfinished jobs, bounds terminal history and isolates observers from execution', async () => {
    const registry = await import('./localBackgroundJobs');
    const observer = vi.fn(() => { throw new Error('disposed view'); });
    const unsubscribe = registry.subscribeLocalBackgroundJobs(observer);
    const pending = Array.from({ length: 30 }, () => deferred<string>());
    const requests = pending.map((task, index) => registry.runLocalBackgroundJob({ ...options,
      scope: { kind: 'entry', root: index % 2 ? 'second-library' : 'library', entry_id: 'paper' }
    }, () => task.promise));
    expect(registry.getLocalBackgroundJobs()).toHaveLength(30);
    expect(new Set(registry.getLocalBackgroundJobs().map(row => row.id)).size).toBe(30);
    await Promise.all(Array.from({ length: 40 }, () => registry.runLocalBackgroundJob(options, async () => 'done')));
    expect(registry.getLocalBackgroundJobs().filter(row => row.status === 'processing')).toHaveLength(30);
    expect(registry.getLocalBackgroundJobs().filter(row => row.status === 'succeeded')).toHaveLength(24);
    expect(registry.getLocalBackgroundJobs().filter(row => row.scope?.root === 'second-library')).toHaveLength(15);
    unsubscribe();
    pending.forEach(task => task.resolve('done'));
    await Promise.all(requests);
    expect(registry.getLocalBackgroundJobs()).toHaveLength(24);
    expect(registry.getLocalBackgroundJobs().every(row => row.status === 'succeeded')).toBe(true);
  });
});

 it('ignores a late progress callback after completion', async () => {
   const registry = await import('./localBackgroundJobs');
   let late!: import('./localBackgroundJobs').LocalJobReporter;
   await registry.runLocalBackgroundJob(options, async report => { late = report; });
   late({ current: 1, total: 2, percent: 50 }, { status: 'processing' });
   expect(registry.getLocalBackgroundJobs()[0].status).toBe('succeeded');
 });

it('coalesces progress bursts but publishes completion immediately', async () => {
  vi.useFakeTimers();
  try {
    const registry = await import('./localBackgroundJobs');
    const observer = vi.fn();
    const unsubscribe = registry.subscribeLocalBackgroundJobs(observer);
    await registry.runLocalBackgroundJob(options, async report => {
      for (let current = 1; current <= 200; current++) report({ current, total: 200, percent: current / 2 });
      expect(observer).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
      expect(observer).toHaveBeenCalledTimes(2);
    });
    expect(observer).toHaveBeenCalledTimes(3);
    expect(registry.getLocalBackgroundJobs()[0].status).toBe('succeeded');
    unsubscribe();
  } finally { vi.useRealTimers(); }
});
