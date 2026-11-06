import { beforeEach, expect, it, vi } from 'vitest';
import type { FoldRecord } from '@/shared/ipc/foldingApi';
const m = vi.hoisted(() => ({ settings: vi.fn(), routing: vi.fn(), save: vi.fn(), translate: vi.fn(), notify: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', () => ({ getLlmSettings: m.settings }));
vi.mock('@/shared/ipc/translationRoutingApi', () => ({ getTranslationRouting: m.routing }));
vi.mock('@/shared/ipc/foldingApi', () => ({ saveFoldTranslation: m.save }));
vi.mock('@/shared/lib/localBackgroundJobs', () => ({ runLocalBackgroundJob: (_: unknown, run: () => Promise<void>) => run() }));
vi.mock('../translation/modelSelectionTranslation', () => ({ translateSelectionWithProfile: m.translate }));
vi.mock('../translation/translationSource', () => ({ translationSourceProfile: () => ({ model: 'translator' }) }));
vi.mock('./foldTasks', () => ({ notifyFoldUpdated: m.notify }));
import { translateFoldLevel } from './translateFoldLevel';

const record: FoldRecord = { segment_uid: 'p', source: 'Source.', evidence: [0], brief: ['Source.'],
  key: 'A result. A reason.', takeaway: 'A result.', topic: 'result', model: 'm', generated_at: '2026' };
beforeEach(() => { vi.clearAllMocks(); m.settings.mockResolvedValue({}); m.routing.mockResolvedValue({ paragraph: { kind: 'default_model' } });
  m.save.mockResolvedValue(undefined); m.translate.mockResolvedValue('结果。'); });

it('translates the selected level and writes its exact source before notifying readers', async () => {
  await translateFoldLevel('root', 'entry', 'Title', record, 'takeaway');
  expect(m.translate).toHaveBeenCalledWith(expect.anything(), { sourceText: 'A result.', entryTitle: 'Title' }, { signal: expect.any(AbortSignal) });
  expect(m.save).toHaveBeenCalledWith('root', 'entry', 'p', 'takeaway', expect.objectContaining({ source_text: 'A result.', translated_text: '结果。' }));
  expect(m.notify).toHaveBeenCalledWith('root', 'entry');
});

it('shares a request while allowing one visible reader to leave', async () => {
  let finish!: (value: string) => void;
  m.translate.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
  const first = new AbortController();
  const a = translateFoldLevel('root', 'shared', 'Title', record, 'key', first.signal);
  const canceled = expect(a).rejects.toMatchObject({ name: 'AbortError' });
  const b = translateFoldLevel('root', 'shared', 'Title', record, 'key');
  await vi.waitFor(() => expect(m.translate).toHaveBeenCalledTimes(1));
  first.abort();
  await canceled;
  expect((m.translate.mock.calls[0][2] as { signal: AbortSignal }).signal.aborted).toBe(false);
  finish('结果及原因。'); await b;
  expect(m.save).toHaveBeenCalledTimes(1);
});

it('limits visible translation work and removes an abandoned queued request', async () => {
  const finishers: Array<(value: string) => void> = [];
  m.translate.mockImplementation(() => new Promise<string>(resolve => finishers.push(resolve)));
  const abort = new AbortController();
  const promises = [0, 1, 2, 3].map(index => translateFoldLevel('root', `queue-${index}`, 'Title', record, 'key', index === 3 ? abort.signal : undefined));
  const canceled = expect(promises[3]).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(m.translate).toHaveBeenCalledTimes(3));
  abort.abort(); await canceled;
  finishers.forEach(resolve => resolve('结果。'));
  await Promise.all(promises.slice(0, 3));
  expect(m.translate).toHaveBeenCalledTimes(3);
  expect(m.save).toHaveBeenCalledTimes(3);
});

it('does not save a response after the last reader leaves', async () => {
  let finish!: (value: string) => void;
  m.translate.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
  const abort = new AbortController();
  const promise = translateFoldLevel('root', 'left', 'Title', record, 'key', abort.signal);
  const canceled = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(m.translate).toHaveBeenCalledTimes(1));
  const taskSignal = (m.translate.mock.calls[0][2] as { signal: AbortSignal }).signal;
  abort.abort(); await canceled;
  expect(taskSignal.aborted).toBe(true);
  finish('迟到的译文。');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(m.save).not.toHaveBeenCalled();
});
