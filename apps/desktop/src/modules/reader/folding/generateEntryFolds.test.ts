import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), settings: vi.fn(), generate: vi.fn() }));
vi.mock('@/shared/ipc/foldingApi', () => ({ readEntryFolds: mocks.read, upsertEntryFolds: mocks.save }));
vi.mock('@/shared/ipc/assistantApi', () => ({ getLlmSettings: mocks.settings }));
vi.mock('./translateFoldLevel', () => ({ translateFoldLevel: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./foldGeneration', () => ({ generateFoldBatch: mocks.generate }));

import { translateFoldLevel } from './translateFoldLevel';
import { generateEntryFolds } from './generateEntryFolds';
import { FoldGenerationError } from './foldErrors';

const source: SourceSegment = { uid: 'a', segment_type: 'paragraph', page_idx: 0, bbox: null, text: `A finding. ${Array(38).fill('Context').join(' ')}.`, markdown: null };
const result = { segmentUid: 'a', source: source.text, evidence: [0], brief: ['A finding.'],
  key: 'A finding. A reason.', takeaway: 'A finding.', topic: 'finding', translations: Object.fromEntries(Object.entries({ brief: 'A finding.', key: 'A finding. A reason.', takeaway: 'A finding.', topic: 'finding' }).map(([level, text]) => [level, { source_text: text, translated_text: '译文', model: 'test', generated_at: '2026' }])) };

describe('entry folding generation', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.mocked(translateFoldLevel).mockResolvedValue(undefined);
    mocks.read.mockResolvedValue({});
    mocks.save.mockResolvedValue(undefined);
    mocks.settings.mockResolvedValue({ assistant_profile: { model: 'test-model' } });
    mocks.generate.mockImplementation(async ({ batch }: { batch: Array<{ segmentUid: string; source: string }> }) => ({
      results: batch.map(item => ({ ...result, segmentUid: item.segmentUid, source: item.source })), failedSegmentUids: [],
    }));
  });

  it('saves each validated paragraph and reports progress', async () => {
    const onProgress = vi.fn();
    expect(await generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source], onProgress }))
      .toEqual({ failedSegmentUids: [], skipped: [] });
    expect(mocks.save).toHaveBeenCalledWith('root', 'entry', [expect.objectContaining({
      segment_uid: 'a', source: source.text, brief: ['A finding.'], model: 'test-model'
    })]);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'generating', activeSegmentUids: ['a'] }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'saving', activeSegmentUids: ['a'] }));
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 1, failed: 0, total: 1, completedSegmentUids: ['a'] }));
    expect(vi.mocked(translateFoldLevel).mock.calls.map(call => call[4])).toEqual(['brief', 'key', 'takeaway', 'topic']);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ translatingSegmentUids: ['a'], completed: 0 }));
  });

  it('passes paper and section context without generating unselected paragraphs', async () => {
    const abstract = { ...source, uid: 'abstract', text: 'A synthetic abstract.' };
    const heading: SourceSegment = { ...source, uid: 'h', segment_type: 'heading', text: 'Results' };
    const document = [{ ...heading, uid: 'abstract-heading', text: 'Abstract' }, abstract, heading, source, { ...source, uid: 'other' }];
    await generateEntryFolds({ root: 'root', entryId: 'entry', title: 'Paper', segments: [source], documentSegments: document });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      batch: [expect.objectContaining({ segmentUid: 'a' })],
      context: { title: 'Paper', abstract: 'A synthetic abstract.', outline: 'Abstract\nResults', section: 'Results' }
    }));
  });

  it('reuses matching saved results without requesting a model', async () => {
    mocks.read.mockResolvedValue({ a: { segment_uid: 'a', ...result, model: 'test', generated_at: '2026-01-01' } });
    const onProgress = vi.fn();
    await generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source], onProgress });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ total: 0, cachedSegmentUids: ['a'] }));
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('regenerates a cached segment only when explicitly requested', async () => {
    mocks.read.mockResolvedValue({ a: { segment_uid: 'a', ...result, model: 'test', generated_at: '2026-01-01' } });
    await generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source], force: true });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('only fills missing or stale Chinese levels without requiring an assistant or overwriting source results', async () => {
    const translations = { ...result.translations, topic: { ...result.translations.topic, source_text: 'outdated' } };
    mocks.read.mockResolvedValue({ a: { ...result, translations, segment_uid: 'a', model: 'test', generated_at: '2026' } });
    await generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source] });
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(vi.mocked(translateFoldLevel).mock.calls.map(call => call[4])).toEqual(['topic']);
  });

  it('retains source results and continues other paragraphs after a Chinese translation failure', async () => {
    vi.mocked(translateFoldLevel).mockRejectedValueOnce(new Error('provider secret'));
    const onProgress = vi.fn();
    const outcome = await generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source, { ...source, uid: 'b' }], concurrency: 1, onProgress });
    expect(outcome).toMatchObject({ failedSegmentUids: ['a'], failureCode: 'translation' });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completedSegmentUids: ['b'], failedSegmentUids: ['a'],
      segmentErrors: { a: expect.stringContaining('中文详略尚未补齐') } }));
    expect(JSON.stringify(onProgress.mock.calls)).not.toContain('provider secret');
  });

  it('does not dispatch further levels after stopping during translation', async () => {
    const controller = new AbortController();
    vi.mocked(translateFoldLevel).mockImplementationOnce(async () => { controller.abort(); });
    const onProgress = vi.fn();
    await expect(generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source], signal: controller.signal, onProgress }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(translateFoldLevel).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 0 }));
  });

  it('cancels an active Chinese request independently and continues the next paragraph', async () => {
    const canceledSegments = new Set<string>();
    const translationControllers = new Map<string, AbortController>();
    vi.mocked(translateFoldLevel).mockImplementationOnce(async (_root, _entry, _title, record, _level, signal) => {
      canceledSegments.add(record.segment_uid);
      translationControllers.get(record.segment_uid)?.abort();
      expect(signal?.aborted).toBe(true);
      throw new DOMException('Canceled', 'AbortError');
    });
    const onProgress = vi.fn();
    const result = await generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source, { ...source, uid: 'b' }],
      concurrency: 1, canceledSegments, translationControllers, onProgress });
    expect(result.failedSegmentUids).toEqual([]);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completedSegmentUids: ['b'], canceledSegmentUids: ['a'] }));
    expect(translationControllers.size).toBe(0);
  });

  it('does not save a result after cancellation', async () => {
    const controller = new AbortController();
    mocks.generate.mockImplementation(async () => {
      controller.abort();
      return { results: [result], failedSegmentUids: [] };
    });
    await expect(generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source], signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('discards canceled in-flight outputs and never requests canceled waiting paragraphs', async () => {
    const segments = Array.from({ length: 9 }, (_, index) => ({ ...source, uid: `s${index}`, text: `Finding ${index}. ${Array(38).fill('context').join(' ')}.` }));
    const canceledSegments = new Set<string>();
    let started!: () => void;
    let finish!: (value: unknown) => void;
    const inFlight = new Promise<void>(resolve => { started = resolve; });
    let requests = 0;
    mocks.generate.mockImplementation(async ({ batch }: { batch: Array<{ segmentUid: string; source: string }> }) => {
      if (requests++ === 0) { started(); await new Promise(resolve => { finish = resolve; }); }
      return { results: batch.map(item => ({ ...result, segmentUid: item.segmentUid, source: item.source })), failedSegmentUids: [] };
    });
    const onProgress = vi.fn();
    const operation = generateEntryFolds({ root: 'root', entryId: 'entry', segments, canceledSegments, onProgress, concurrency: 1 });
    await inFlight;
    canceledSegments.add('s0'); canceledSegments.add('s8');
    finish(undefined);
    await operation;
    expect(mocks.generate).toHaveBeenCalledTimes(8);
    expect(mocks.generate.mock.calls.every(([request]) => request.batch.length === 1)).toBe(true);
    const saved = mocks.save.mock.calls.flatMap(call => call[2]) as Array<{ segment_uid: string }>;
    expect(saved.map(item => item.segment_uid)).toEqual(segments.slice(1, 8).map(item => item.uid));
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 7, canceledSegmentUids: ['s0', 's8'] }));
  });

  it('does not invoke the model when every item is canceled during preparation', async () => {
    let finish!: (value: unknown) => void;
    let started!: () => void;
    const preparing = new Promise<void>(resolve => { started = resolve; });
    mocks.settings.mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const canceledSegments = new Set<string>();
    const operation = generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source], canceledSegments });
    await preparing;
    canceledSegments.add(source.uid);
    finish({ assistant_profile: null });
    await expect(operation).resolves.toEqual({ failedSegmentUids: [], skipped: [] });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('skips short paragraphs even when forced and does not request a model', async () => {
    const short = { ...source, text: 'A short paragraph.' };
    await expect(generateEntryFolds({ root: 'root', entryId: 'entry', segments: [short], force: true }))
      .resolves.toEqual({ failedSegmentUids: [], skipped: [{ segmentUid: 'a', reason: 'too_short' }] });
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('preserves the source write but does not complete bilingual work when stopped during saving', async () => {
    let finish!: () => void;
    let started!: () => void;
    const saving = new Promise<void>(resolve => { started = resolve; });
    mocks.save.mockImplementation(() => { started(); return new Promise<void>(resolve => { finish = resolve; }); });
    const controller = new AbortController();
    const onProgress = vi.fn();
    const operation = generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source, { ...source, uid: 'b' }], signal: controller.signal, onProgress, concurrency: 1 });
    await saving;
    controller.abort(); finish();
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 0, completedSegmentUids: [] }));
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it('distinguishes write failures and never reports unsaved results as completed', async () => {
    mocks.save.mockRejectedValueOnce(new Error('private storage path'));
    const onProgress = vi.fn();
    await expect(generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source], onProgress }))
      .rejects.toMatchObject({ code: 'save', message: expect.stringContaining('保存失败') });
    expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({ completed: 1 }));
  });

  it('reports a write failure even when stopping was requested during the write', async () => {
    let rejectSave!: (error: Error) => void;
    let started!: () => void;
    const saving = new Promise<void>(resolve => { started = resolve; });
    mocks.save.mockImplementation(() => { started(); return new Promise<void>((_resolve, reject) => { rejectSave = reject; }); });
    const controller = new AbortController();
    const onProgress = vi.fn();
    const operation = generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source], signal: controller.signal, onProgress });
    const failure = expect(operation).rejects.toMatchObject({ code: 'save' });
    await saving;
    controller.abort(); rejectSave(new Error('storage failure'));
    await failure;
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 0, failed: 1, failedSegmentUids: ['a'] }));
  });

  it('supports serial operation when the concurrency limit is one', async () => {
    const segments = Array.from({ length: 9 }, (_, index) => ({ ...source, uid: `p${index}` }));
    const events: string[] = [];
    let saved!: () => void, release!: () => void;
    const saving = new Promise<void>(resolve => { saved = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    mocks.generate.mockImplementation(async ({ batch }: { batch: Array<{ segmentUid: string; source: string }> }) => {
      expect(batch).toHaveLength(1); events.push(`generate:${batch[0].segmentUid}`);
      return { results: [{ ...result, segmentUid: batch[0].segmentUid, source: batch[0].source }], failedSegmentUids: [] };
    });
    mocks.save.mockImplementation(async (_root, _entryId, records) => {
      expect(records).toHaveLength(1); events.push(`save:${records[0].segment_uid}`);
      if (records[0].segment_uid === 'p0') { saved(); await gate; }
    });
    const onProgress = vi.fn();
    const work = generateEntryFolds({ root: 'root', entryId: 'entry', segments, onProgress, concurrency: 1 });
    await saving;
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({ completed: 1 }));
    release(); await work;
    expect(events).toEqual(segments.flatMap(segment => [`generate:${segment.uid}`, `save:${segment.uid}`]));
    expect(onProgress.mock.calls.every(([progress]) => progress.activeSegmentUids.length <= 1)).toBe(true);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 9, total: 9 }));
  });

  it('runs up to three independent paragraphs and starts the next only after a slot finishes saving', async () => {
    const segments = Array.from({ length: 5 }, (_, index) => ({ ...source, uid: `p${index}` }));
    const gates = new Map<string, () => void>();
    let releaseSave!: () => void;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    mocks.generate.mockImplementation(({ batch }: { batch: Array<{ segmentUid: string; source: string }> }) => {
      expect(batch).toHaveLength(1);
      const item = batch[0];
      return new Promise(resolve => gates.set(item.segmentUid, () => resolve({ results: [{ ...result, segmentUid: item.segmentUid, source: item.source }], failedSegmentUids: [] })));
    });
    mocks.save.mockImplementation(async (_root, _entryId, records) => { if (records[0].segment_uid === 'p1') await saveGate; });
    const onProgress = vi.fn();
    const work = generateEntryFolds({ root: 'root', entryId: 'entry', segments, onProgress });
    await vi.waitFor(() => expect(gates.size).toBe(3));
    expect([...gates.keys()]).toEqual(['p0', 'p1', 'p2']);
    gates.get('p1')!();
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(gates.size).toBe(3);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      activeSegmentUids: expect.arrayContaining(['p0', 'p1', 'p2']), savingSegmentUids: ['p1'], completed: 0
    }));
    releaseSave();
    await vi.waitFor(() => expect(gates.has('p3')).toBe(true));
    gates.get('p0')!();
    await vi.waitFor(() => expect(gates.has('p4')).toBe(true));
    for (const uid of ['p2', 'p3', 'p4']) gates.get(uid)!();
    await expect(work).resolves.toEqual({ failedSegmentUids: [], skipped: [] });
    expect(mocks.save).toHaveBeenCalledTimes(5);
    expect(onProgress.mock.calls.every(([value]) => value.activeSegmentUids.length <= 3)).toBe(true);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 5, total: 5, activeSegmentUids: [] }));
  });

  it('stops dispatch on a shared failure, waits for saves, and ignores late model responses', async () => {
    const segments = Array.from({ length: 5 }, (_, index) => ({ ...source, uid: `p${index}` }));
    const gates = new Map<string, { resolve: () => void; reject: (error: Error) => void; signal: AbortSignal }>();
    let releaseSave!: () => void;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    mocks.generate.mockImplementation(({ batch, signal }: { batch: Array<{ segmentUid: string; source: string }>; signal: AbortSignal }) => {
      const item = batch[0];
      return new Promise((resolve, reject) => gates.set(item.segmentUid, {
        signal, reject, resolve: () => resolve({ results: [{ ...result, segmentUid: item.segmentUid, source: item.source }], failedSegmentUids: [] })
      }));
    });
    mocks.save.mockImplementation(async () => { await saveGate; });
    const onProgress = vi.fn();
    const work = generateEntryFolds({ root: 'root', entryId: 'entry', segments, onProgress });
    const failure = expect(work).rejects.toMatchObject({ statusCode: 401 });
    await vi.waitFor(() => expect(gates.size).toBe(3));
    gates.get('p1')!.resolve();
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    gates.get('p0')!.reject(Object.assign(new Error('private provider body'), { statusCode: 401 }));
    await vi.waitFor(() => expect(gates.get('p2')!.signal.aborted).toBe(true));
    gates.get('p2')!.resolve(); releaseSave();
    await failure;
    expect(gates.size).toBe(3);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 0, failed: 1,
      completedSegmentUids: [], failedSegmentUids: ['p0'], activeSegmentUids: [] }));
  });

  it('cancels individual in-flight and queued paragraphs without affecting parallel neighbors', async () => {
    const segments = Array.from({ length: 4 }, (_, index) => ({ ...source, uid: `p${index}` }));
    const gates = new Map<string, () => void>();
    mocks.generate.mockImplementation(({ batch }: { batch: Array<{ segmentUid: string; source: string }> }) => {
      const item = batch[0];
      return new Promise(resolve => gates.set(item.segmentUid, () => resolve({ results: [{ ...result, segmentUid: item.segmentUid, source: item.source }], failedSegmentUids: [] })));
    });
    const canceledSegments = new Set<string>();
    const onProgress = vi.fn();
    const work = generateEntryFolds({ root: 'root', entryId: 'entry', segments, canceledSegments, onProgress });
    await vi.waitFor(() => expect(gates.size).toBe(3));
    canceledSegments.add('p0'); canceledSegments.add('p3');
    for (const uid of ['p0', 'p1', 'p2']) gates.get(uid)!();
    await work;
    expect(gates.has('p3')).toBe(false);
    const saved = mocks.save.mock.calls.flatMap(call => call[2]) as Array<{ segment_uid: string }>;
    expect(saved.map(item => item.segment_uid).sort()).toEqual(['p1', 'p2']);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 2, canceledSegmentUids: ['p0', 'p3'] }));
  });

  it('stops parallel requests but lets an already-started write finish', async () => {
    const segments = Array.from({ length: 4 }, (_, index) => ({ ...source, uid: `p${index}` }));
    const gates = new Map<string, { resolve: () => void; signal: AbortSignal }>();
    let finishSave!: () => void;
    const saveGate = new Promise<void>(resolve => { finishSave = resolve; });
    mocks.generate.mockImplementation(({ batch, signal }: { batch: Array<{ segmentUid: string; source: string }>; signal: AbortSignal }) => {
      const item = batch[0];
      return new Promise(resolve => gates.set(item.segmentUid, { signal, resolve: () => resolve({ results: [{ ...result, segmentUid: item.segmentUid, source: item.source }], failedSegmentUids: [] }) }));
    });
    mocks.save.mockImplementation(async () => { await saveGate; });
    const controller = new AbortController();
    const onProgress = vi.fn();
    const work = generateEntryFolds({ root: 'root', entryId: 'entry', segments, signal: controller.signal, onProgress });
    const stopped = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(gates.size).toBe(3));
    gates.get('p0')!.resolve();
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(gates.get('p1')!.signal.aborted).toBe(true);
    gates.get('p1')!.resolve(); gates.get('p2')!.resolve(); finishSave();
    await stopped;
    expect(gates.has('p3')).toBe(false);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 0, completedSegmentUids: [], activeSegmentUids: [] }));
  });

  it.each(['truncated', 'format', 'empty'] as const)('continues after a paragraph has %s output and preserves its failure reason', async code => {
    mocks.generate.mockRejectedValueOnce(new FoldGenerationError(code));
    const onProgress = vi.fn();
    const outcome = await generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source, { ...source, uid: 'b' }], onProgress });
    expect(outcome).toMatchObject({ failedSegmentUids: ['a'], failureCode: code });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith('root', 'entry', [expect.objectContaining({ segment_uid: 'b' })]);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 1, failed: 1, total: 2,
      segmentErrors: { a: new FoldGenerationError(code).message }, completedSegmentUids: ['b'] }));
  });

  it('continues after an invalid result, but stops on a shared credential failure', async () => {
    mocks.generate.mockResolvedValueOnce({ results: [], failedSegmentUids: ['a'] });
    const segments = [source, { ...source, uid: 'b' }];
    expect(await generateEntryFolds({ root: 'root', entryId: 'entry', segments })).toMatchObject({ failedSegmentUids: ['a'], failureCode: 'validation' });
    mocks.generate.mockClear(); mocks.save.mockClear();
    mocks.generate.mockRejectedValueOnce(Object.assign(new Error('private provider body'), { statusCode: 401 }));
    await expect(generateEntryFolds({ root: 'root', entryId: 'entry', segments, concurrency: 1 })).rejects.toMatchObject({ statusCode: 401 });
    expect(mocks.generate).toHaveBeenCalledTimes(1); expect(mocks.save).not.toHaveBeenCalled();
  });

  it('resumes from saved paragraphs instead of generating them again', async () => {
    mocks.read.mockResolvedValue({ a: { ...result, segment_uid: 'a', model: 'test', generated_at: '2026-01-01' } });
    await generateEntryFolds({ root: 'root', entryId: 'entry', segments: [source, { ...source, uid: 'b' }] });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.generate.mock.calls[0][0].batch.map((item: { segmentUid: string }) => item.segmentUid)).toEqual(['b']);
  });
});
