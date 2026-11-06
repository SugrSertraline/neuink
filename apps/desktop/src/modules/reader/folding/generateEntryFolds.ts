import { getLlmSettings } from '@/shared/ipc/assistantApi';
import { readEntryFolds, upsertEntryFolds, type FoldRecord } from '@/shared/ipc/foldingApi';
import type { SourceSegment } from '@/shared/types/domain';

import { buildFoldInputs, type FoldSkipped } from './foldInput';
import { generateFoldBatch } from './foldGeneration';
import { foldViewsForSource } from './foldViews';
import { FoldGenerationError, foldErrorCode, foldErrorMessage, type FoldErrorCode } from './foldErrors';
import type { FoldPauseGate } from './foldPauseGate';
import { missingFoldTranslations } from './foldTranslations';
import { translateFoldLevel } from './translateFoldLevel';
import { buildFoldContexts } from './foldPrompt';

export type FoldGenerationProgress = {
  phase: 'preparing' | 'generating' | 'saving';
  completed: number; failed: number; total: number;
  activeSegmentUids: string[]; completedSegmentUids: string[]; failedSegmentUids: string[]; cachedSegmentUids: string[];
  savingSegmentUids?: string[];
  translatingSegmentUids?: string[];
  canceledSegmentUids: string[];
  segmentErrors?: Record<string, string>;
};

export const FOLD_CONCURRENCY = 3;

/** Each request owns one paragraph; a bounded worker pool saves completed results independently. */
export async function generateEntryFolds({
  entryId,
  root,
  segments,
  title = '',
  documentSegments = segments,
  signal,
  force = false,
  canceledSegments = new Set<string>(),
  translationControllers = new Map<string, AbortController>(),
  concurrency = FOLD_CONCURRENCY,
  pauseGate,
  onProgress
}: {
  entryId: string;
  root: string;
  segments: readonly SourceSegment[];
  title?: string;
  documentSegments?: readonly SourceSegment[];
  signal?: AbortSignal;
  force?: boolean;
  canceledSegments?: Set<string>;
  translationControllers?: Map<string, AbortController>;
  concurrency?: number;
  pauseGate?: FoldPauseGate;
  onProgress?: (progress: FoldGenerationProgress) => void;
}): Promise<{ failedSegmentUids: string[]; skipped: FoldSkipped[]; failureCode?: FoldErrorCode }> {
  const checkStopped = () => { if (signal?.aborted) throw new DOMException('已取消阅读详略生成', 'AbortError'); };
  const prepared = buildFoldInputs(segments);
  const existing = await readEntryFolds(root, entryId).catch(() => { throw new FoldGenerationError('read'); });
  checkStopped();
  const cachedSegmentUids: string[] = [];
  const pending = prepared.batches.flat().filter(item => {
    const record = existing[item.segmentUid];
    const needsGeneration = force || !record || !foldViewsForSource(record, item.source) || missingFoldTranslations(record).length > 0;
    if (!needsGeneration) cachedSegmentUids.push(item.segmentUid);
    return needsGeneration;
  });
  const total = pending.length;
  const completedSegmentUids: string[] = [];
  const failedSegmentUids: string[] = [];
  const segmentErrors: Record<string, string> = {};
  const generating = new Set<string>();
  const saving = new Set<string>();
  const translating = new Set<string>();
  let failureCode: FoldErrorCode | undefined;
  const fail = (uid: string, code: FoldErrorCode) => {
    failedSegmentUids.push(uid);
    segmentErrors[uid] = foldErrorMessage(new FoldGenerationError(code));
    failureCode ??= code;
  };
  const progress = () => onProgress?.({
    phase: generating.size ? 'generating' : saving.size ? 'saving' : 'preparing', completed: completedSegmentUids.length, failed: failedSegmentUids.length, total,
    activeSegmentUids: [...generating, ...saving], savingSegmentUids: [...saving], translatingSegmentUids: [...translating], completedSegmentUids: [...completedSegmentUids], failedSegmentUids: [...failedSegmentUids], cachedSegmentUids,
    canceledSegmentUids: [...canceledSegments],
    ...(failedSegmentUids.length ? { segmentErrors: { ...segmentErrors } } : {})
  });
  progress();
  if (!total) return { failedSegmentUids: [], skipped: prepared.skipped };
  const needsSource = pending.some(item => force || !existing[item.segmentUid] || !foldViewsForSource(existing[item.segmentUid], item.source));
  const settings = needsSource ? await getLlmSettings() : null;
  checkStopped();
  if (pending.every(item => canceledSegments.has(item.segmentUid))) {
    progress();
    return { failedSegmentUids: [], skipped: prepared.skipped };
  }
  const profile = settings?.assistant_profile;
  if (needsSource && !profile) throw new FoldGenerationError('configuration');
  const contexts = buildFoldContexts(title, documentSegments);
  const controller = new AbortController();
  const stopRequests = () => controller.abort();
  signal?.addEventListener('abort', stopRequests, { once: true });
  if (signal?.aborted) controller.abort();
  let cursor = 0;
  let fatalError: unknown;
  let halted = false;
  const hasNext = () => {
    while (cursor < pending.length && canceledSegments.has(pending[cursor].segmentUid)) cursor++;
    return cursor < pending.length;
  };
  const worker = async () => {
    while (!halted && !signal?.aborted && hasNext()) {
      if (pauseGate?.paused) {
        await pauseGate.wait(controller.signal);
        continue;
      }
      // No await between checking the gate and claiming a paragraph. Pausing
      // drains existing requests/saves but cannot dispatch another paragraph.
      const item = pending[cursor++];
      const uid = item.segmentUid;
      const translationController = new AbortController();
      const abortTranslation = () => translationController.abort();
      translationControllers.set(uid, translationController);
      controller.signal.addEventListener('abort', abortTranslation, { once: true });
      if (controller.signal.aborted) abortTranslation();
      generating.add(uid); progress();
      try {
        let record = existing[uid];
        if (force || !record || !foldViewsForSource(record, item.source)) {
          if (!profile) throw new FoldGenerationError('configuration');
          const output = await generateFoldBatch({ batch: [item], profile, context: contexts.get(uid), signal: controller.signal });
          if (signal?.aborted || halted || canceledSegments.has(uid)) { progress(); continue; }
          const results = output.results.filter(result => result.segmentUid === uid);
          if (results.length !== 1 || output.failedSegmentUids.includes(uid)) {
            fail(uid, 'validation'); progress(); continue;
          }
          const result = results[0];
          record = { segment_uid: uid, source: result.source, evidence: result.evidence,
            brief: result.brief, key: result.key, takeaway: result.takeaway, topic: result.topic,
            model: profile.model, generated_at: new Date().toISOString() };
          generating.delete(uid); saving.add(uid); progress();
          await upsertEntryFolds(root, entryId, [record]).catch(() => { throw new FoldGenerationError('save'); });
          saving.delete(uid);
        }
        generating.add(uid); translating.add(uid); progress();
        for (const level of missingFoldTranslations(record)) {
          if (signal?.aborted || halted || canceledSegments.has(uid)) break;
          // Use the same routed paragraph translator and de-duplicated queue as visible readers.
          await translateFoldLevel(root, entryId, title, record, level, translationController.signal)
            .catch(error => { if (translationController.signal.aborted) throw error; throw new FoldGenerationError('translation'); });
        }
        if (signal?.aborted || halted || canceledSegments.has(uid)) continue;
        completedSegmentUids.push(uid);
      } catch (error) {
        const failedWhileSaving = saving.has(uid);
        if ((failedWhileSaving || (!signal?.aborted && !halted)) && !canceledSegments.has(uid)) {
          const code = foldErrorCode(error);
          fail(uid, code);
          // Output-specific failures stay local. Shared service/storage failures stop dispatch.
          if (!halted && (failedWhileSaving || !['truncated', 'context', 'empty', 'format', 'validation', 'filtered', 'translation'].includes(code))) {
            fatalError = error;
            halted = true;
            controller.abort();
          }
        }
      } finally {
        controller.signal.removeEventListener('abort', abortTranslation);
        translationControllers.delete(uid);
        generating.delete(uid); saving.delete(uid); translating.delete(uid); progress();
      }
    }
  };
  try {
    const count = Number.isFinite(concurrency) ? Math.max(1, Math.min(FOLD_CONCURRENCY, Math.floor(concurrency))) : FOLD_CONCURRENCY;
    await Promise.all(Array.from({ length: Math.min(count, pending.length) }, () => worker()));
    if (halted) throw fatalError;
    checkStopped();
  } finally {
    signal?.removeEventListener('abort', stopRequests);
  }
  return { failedSegmentUids, skipped: prepared.skipped, ...(failureCode ? { failureCode } : {}) };
}
