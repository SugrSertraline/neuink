import { beforeEach, expect, it, vi } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), settings: vi.fn(), generate: vi.fn() }));
vi.mock('@/shared/ipc/foldingApi', () => ({ readEntryFolds: mocks.read, upsertEntryFolds: mocks.save }));
vi.mock('@/shared/ipc/assistantApi', () => ({ getLlmSettings: mocks.settings }));
vi.mock('./translateFoldLevel', () => ({ translateFoldLevel: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./foldGeneration', () => ({ generateFoldBatch: mocks.generate }));
import { translateFoldLevel } from './translateFoldLevel';
import { cancelFoldSegments, cancelFoldTask, foldTaskRunning, getFoldTaskSnapshot, pauseFoldTask, resumeFoldTask, startFoldTask } from './foldTasks';
import { getLocalBackgroundJobs } from '@/shared/lib/localBackgroundJobs';

const segments: SourceSegment[] = Array.from({ length: 7 }, (_, index) => ({ uid: `p${index}`, segment_type: 'paragraph',
  page_idx: 0, bbox: null, text: `Finding ${index}. ${Array(40).fill('context').join(' ')}.`, markdown: null }));
const gates = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(translateFoldLevel).mockResolvedValue(undefined); gates.clear();
  mocks.read.mockResolvedValue({}); mocks.save.mockResolvedValue(undefined);
  mocks.settings.mockResolvedValue({ assistant_profile: { model: 'test' } });
  mocks.generate.mockImplementation(({ batch, signal }: { batch: Array<{ segmentUid: string; source: string }>; signal: AbortSignal }) => {
    const item = batch[0];
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Stopped', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      gates.set(item.segmentUid, {
        resolve: () => { signal.removeEventListener('abort', abort); resolve({ results: [{ ...item,
          evidence: [0], brief: [item.source.split('. ')[0] + '.'], key: 'A finding.', takeaway: 'A finding.', topic: 'Finding' }], failedSegmentUids: [] }); },
        reject: error => { signal.removeEventListener('abort', abort); reject(error); }
      });
    });
  });
});

it('drains in-flight saves before pausing and resumes the exact shared queue without repeating requests', async () => {
  const save = deferred();
  mocks.save.mockImplementation(async (_root, _entryId, records) => { if (records[0].segment_uid === 'p0') await save.promise; });
  const work = startFoldTask('test', 'pause-resume', 'Paper', segments);
  await vi.waitFor(() => expect(gates.size).toBe(3));
  pauseFoldTask('test', 'pause-resume');
  expect(getFoldTaskSnapshot('test', 'pause-resume')?.status).toBe('pausing');
  for (const uid of ['p0', 'p1', 'p2']) gates.get(uid)!.resolve();
  await vi.waitFor(() => expect(getFoldTaskSnapshot('test', 'pause-resume')?.progress.completed).toBe(2));
  expect(gates.size).toBe(3);
  expect(getFoldTaskSnapshot('test', 'pause-resume')?.status).toBe('pausing');
  save.resolve();
  await vi.waitFor(() => expect(getFoldTaskSnapshot('test', 'pause-resume')?.status).toBe('paused'));
  expect(foldTaskRunning('test', 'pause-resume')).toBe(true);
  const job = getLocalBackgroundJobs().find(job => job.scope?.kind === 'entry' && job.scope.entry_id === 'pause-resume');
  expect(job).toMatchObject({ status: 'paused', progress: { current: 3, total: 7 } });
  // A second reader must get the retained operation, not replace its scope or resume it.
  expect(startFoldTask('test', 'pause-resume', 'Paper', [segments[6]], { force: true })).toBe(work);
  cancelFoldSegments('test', 'pause-resume', ['p4', 'p0']);
  expect(getFoldTaskSnapshot('test', 'pause-resume')?.progress.canceledSegmentUids).toEqual(['p4']);
  expect(gates.size).toBe(3);
  resumeFoldTask('test', 'pause-resume');
  await vi.waitFor(() => expect(gates.size).toBe(6));
  expect([...gates.keys()]).toEqual(['p0', 'p1', 'p2', 'p3', 'p5', 'p6']);
  for (const uid of ['p3', 'p5', 'p6']) gates.get(uid)!.resolve();
  await work;
  expect(mocks.generate).toHaveBeenCalledTimes(6);
  expect(mocks.save).toHaveBeenCalledTimes(6);
  expect(getFoldTaskSnapshot('test', 'pause-resume')).toMatchObject({ status: 'succeeded', progress: { completed: 6, total: 7, canceledSegmentUids: ['p4'] } });
});

it('can pause during preparation and stop a paused queue without dispatching any requests', async () => {
  const read = deferred();
  mocks.read.mockImplementation(async () => { await read.promise; return {}; });
  const work = startFoldTask('test', 'pause-prepare', 'Paper', segments);
  pauseFoldTask('test', 'pause-prepare');
  expect(getFoldTaskSnapshot('test', 'pause-prepare')?.status).toBe('paused');
  read.resolve();
  await vi.waitFor(() => expect(mocks.settings).toHaveBeenCalledOnce());
  expect(mocks.generate).not.toHaveBeenCalled();
  cancelFoldTask('test', 'pause-prepare');
  expect(getFoldTaskSnapshot('test', 'pause-prepare')?.status).toBe('stopping');
  await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  expect(getFoldTaskSnapshot('test', 'pause-prepare')?.status).toBe('canceled');
  resumeFoldTask('test', 'pause-prepare');
  expect(foldTaskRunning('test', 'pause-prepare')).toBe(false);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it('stops a paused queue after work completed, preserving its saved progress', async () => {
  const work = startFoldTask('test', 'pause-stop', 'Paper', segments);
  await vi.waitFor(() => expect(gates.size).toBe(3));
  pauseFoldTask('test', 'pause-stop');
  for (const gate of gates.values()) gate.resolve();
  await vi.waitFor(() => expect(getFoldTaskSnapshot('test', 'pause-stop')?.status).toBe('paused'));
  cancelFoldTask('test', 'pause-stop');
  await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  expect(getFoldTaskSnapshot('test', 'pause-stop')).toMatchObject({ status: 'canceled', progress: { completed: 3, total: 7, failed: 0 } });
  expect(mocks.generate).toHaveBeenCalledTimes(3);
});

it('settles when every remaining paragraph is canceled while paused', async () => {
  const work = startFoldTask('test', 'pause-cancel-all', 'Paper', segments);
  await vi.waitFor(() => expect(gates.size).toBe(3));
  pauseFoldTask('test', 'pause-cancel-all');
  for (const gate of gates.values()) gate.resolve();
  await vi.waitFor(() => expect(getFoldTaskSnapshot('test', 'pause-cancel-all')?.status).toBe('paused'));
  cancelFoldSegments('test', 'pause-cancel-all', segments.slice(3).map(segment => segment.uid));
  await work;
  expect(getFoldTaskSnapshot('test', 'pause-cancel-all')).toMatchObject({ status: 'succeeded', progress: { completed: 3, canceledSegmentUids: ['p3', 'p4', 'p5', 'p6'] } });
});

it('wakes paused workers on a fatal save failure instead of leaving a hanging task', async () => {
  const work = startFoldTask('test', 'pause-failure', 'Paper', segments);
  const failure = expect(work).rejects.toMatchObject({ code: 'save' });
  await vi.waitFor(() => expect(gates.size).toBe(3));
  pauseFoldTask('test', 'pause-failure');
  gates.get('p0')!.resolve();
  await vi.waitFor(() => expect(getFoldTaskSnapshot('test', 'pause-failure')?.progress.completed).toBe(1));
  mocks.save.mockRejectedValueOnce(new Error('disk unavailable'));
  gates.get('p1')!.resolve();
  await failure;
  expect(getFoldTaskSnapshot('test', 'pause-failure')).toMatchObject({ status: 'failed', progress: { completed: 1, failed: 1 } });
  expect(mocks.generate).toHaveBeenCalledTimes(3);
});

it('finishes naturally if pausing the last in-flight paragraphs leaves no pending queue', async () => {
  const work = startFoldTask('test', 'pause-last', 'Paper', segments.slice(0, 2));
  await vi.waitFor(() => expect(gates.size).toBe(2));
  pauseFoldTask('test', 'pause-last');
  for (const gate of gates.values()) gate.resolve();
  await work;
  expect(getFoldTaskSnapshot('test', 'pause-last')?.status).toBe('succeeded');
});
