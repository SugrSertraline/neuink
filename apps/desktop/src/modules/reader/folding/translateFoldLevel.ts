import { getLlmSettings } from '@/shared/ipc/assistantApi';
import { translateSelectionService } from '@/shared/ipc/selectionTranslationApi';
import { getTranslationRouting, resolvedTranslationSource } from '@/shared/ipc/translationRoutingApi';
import { saveFoldTranslation, type FoldRecord } from '@/shared/ipc/foldingApi';
import { runLocalBackgroundJob } from '@/shared/lib/localBackgroundJobs';
import { translateSelectionWithProfile } from '../translation/modelSelectionTranslation';
import { translationSourceProfile } from '../translation/translationSource';
import { notifyFoldUpdated } from './foldTasks';

type Level = 'brief' | 'key' | 'takeaway' | 'topic';
type TranslationTask = {
  key: string; controller: AbortController; consumers: number; state: 'queued' | 'running' | 'finished';
  execute: (signal: AbortSignal) => Promise<void>; promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void;
};
const MAX_CONCURRENT = 3;
const active = new Map<string, TranslationTask>();
const queue: TranslationTask[] = [];
let running = 0;
const abortError = () => new DOMException('已取消详略译文生成', 'AbortError');

function drain() {
  while (running < MAX_CONCURRENT && queue.length) {
    const task = queue.shift()!;
    if (task.controller.signal.aborted || task.consumers === 0) continue;
    task.state = 'running'; running++;
    const finish = () => {
      task.state = 'finished'; running--;
      if (active.get(task.key) === task) active.delete(task.key);
      drain();
    };
    void task.execute(task.controller.signal).then(() => { finish(); task.resolve(); }, error => { finish(); task.reject(error); });
  }
}

/** Each subscriber can leave independently; the last one cancels queued or in-flight work. */
export function translateFoldLevel(root: string, entryId: string, title: string, record: FoldRecord, level: Level, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  const source = level === 'brief' ? record.brief.join(' ') : record[level];
  const key = JSON.stringify([root, entryId, record.segment_uid, level, source]);
  let task = active.get(key);
  if (!task) {
    let resolve!: () => void, reject!: (error: unknown) => void;
    const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
    // All subscribers may leave before the provider settles; keep rejection observed.
    void promise.catch(() => undefined);
    task = { key, consumers: 0, state: 'queued', controller: new AbortController(), promise, resolve, reject,
      execute: taskSignal => runLocalBackgroundJob({ kind: 'folding', scope: { kind: 'entry', root, entry_id: entryId },
        idPrefix: 'fold-translation', message: `正在翻译阅读详略：${title}`, successMessage: `阅读详略译文已保存：${title}`,
        failureMessage: '阅读详略译文未完成。' }, async () => {
        const routing = await getTranslationRouting();
        if (taskSignal.aborted) throw abortError();
        const origin = resolvedTranslationSource(routing, 'paragraph');
        let translated: string | null = null, model = '';
        if (origin.kind === 'service' || origin.kind === 'selection_service') {
          translated = await translateSelectionService(source, origin.kind === 'service' ? origin.provider : undefined, taskSignal);
          model = origin.kind === 'service' ? origin.provider : 'translation-service';
          if (origin.kind === 'service' && translated === null) throw new Error('翻译服务未返回译文。');
        }
        if (translated === null) {
          const settings = await getLlmSettings();
          const profile = translationSourceProfile(settings, origin.kind === 'selection_service' ? { kind: 'default_model' } : origin);
          model = profile.model;
          translated = await translateSelectionWithProfile(profile, { sourceText: source, entryTitle: title }, { signal: taskSignal });
        }
        if (taskSignal.aborted) throw abortError();
        await saveFoldTranslation(root, entryId, record.segment_uid, level, {
          source_text: source, translated_text: translated, model, generated_at: new Date().toISOString()
        });
        notifyFoldUpdated(root, entryId);
      }) };
    active.set(key, task); queue.push(task);
  }
  const subscribed = task;
  subscribed.consumers++;
  const result = new Promise<void>((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return false;
      finished = true; signal?.removeEventListener('abort', cancel);
      subscribed.consumers--;
      if (!subscribed.consumers && subscribed.state !== 'finished') {
        subscribed.controller.abort();
        if (active.get(key) === subscribed) active.delete(key);
        if (subscribed.state === 'queued') {
          const index = queue.indexOf(subscribed);
          if (index >= 0) queue.splice(index, 1);
          subscribed.state = 'finished'; subscribed.reject(abortError());
        }
      }
      return true;
    };
    const cancel = () => { if (release()) reject(abortError()); };
    signal?.addEventListener('abort', cancel, { once: true });
    subscribed.promise.then(() => { if (release()) resolve(); }, error => { if (release()) reject(error); });
  });
  drain();
  return result;
}
