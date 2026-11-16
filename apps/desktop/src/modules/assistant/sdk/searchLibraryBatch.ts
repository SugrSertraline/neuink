import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import {
  searchSegmentsBatch,
  searchUnified,
  type SearchResults,
  type SearchSegmentsBatchItem,
  type UnifiedSearchResponse
} from '@/shared/ipc/workspaceApi';
import { formatSearchSegmentsOutput } from './toolSupport';
import type { TaskSearchItem, TaskSearchOutcome, TaskSearchRequest } from './searchLibrary';

/**
 * Host opt-in for composed retrieval (`search_unified`): document routing, named carrier
 * binding, the visual sidecar vote, and evidence inside the routed documents.
 * Absent keeps the batch path. One native call runs per task; the backend caches the
 * prepared index, so the repeated preparation stays a cache hit.
 */
export type UnifiedRetrievalConfig = {
  headUnits?: number;
  maxDocuments?: number;
  bindCarriers?: boolean;
};

/** Host-owned copy for fixed backend degradation codes. */
const UNIFIED_DEGRADATION_COPY: Record<string, string> = {
  visual_disabled: '视觉索引未启用，本次仅使用文本通道。',
  visual_unavailable: '视觉索引不可用，本次仅使用文本通道。',
  visual_no_allowed_entries: '本次没有冻结的检索范围，未执行视觉通道。',
  carrier_unnumbered: '问题提到的图表没有编号，未据此缩小检索范围。',
  carrier_multiple: '问题提到多个图表，未据此缩小检索范围。',
  carrier_empty_fallback: '按问题指定的图表检索为空，已退回该论文范围内的检索。',
  no_documents: '未路由到任何论文，本次未返回证据。'
};

/** Channel state that the structured `visual_status` reports separately. */
const UNIFIED_VISUAL_STATUS_COPY: Record<string, string> = {
  model_unavailable: '视觉编码模型不可用，本次仅使用文本通道。',
  index_missing: '视觉索引尚未构建，本次仅使用文本通道。'
};

/** Rerank ladder reason copy. The rung that ran is reported on the task itself. */
const UNIFIED_RERANK_COPY: Record<string, string> = {
  model_unavailable: '本地重排模型未安装，已退回字段覆盖排序。',
  provider_error: '重排模型调用失败，已退回字段覆盖排序。'
};

function hitIdentity(hit: SearchResults['entries'][number]['hits'][number]): string {
  const target = hit.target;
  if (target.kind === 'segment') return `s:${target.entry_id}:${target.segment_uid}`;
  if (target.kind === 'page') return `p:${target.entry_id}:${target.page_idx}`;
  if (target.kind === 'note') return `n:${target.entry_id}:${target.note_id}`;
  return `e:${target.entry_id}`;
}

/**
 * Combines the per-sub-question results into one list for formatting. A cited segment
 * reached by two sub-questions appears once, keeping its best score.
 */
function mergeUnifiedResults(
  response: UnifiedSearchResponse,
  question: string
): SearchResults | null {
  const groups = new Map<string, SearchResults['entries'][number]>();
  const seen = new Set<string>();
  let generation = 0;
  const mode = response.tasks[0]?.mode ?? 'unified';
  for (const task of response.tasks) {
    generation = Math.max(generation, task.results.index_generation);
    for (const group of task.results.entries) {
      const merged = groups.get(group.entry_id) ?? { ...group, hits: [], hit_count: 0 };
      for (const hit of group.hits) {
        const key = hitIdentity(hit);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.hits.push(hit);
        merged.hit_count += 1;
        merged.max_score = Math.max(merged.max_score, hit.score);
      }
      groups.set(group.entry_id, merged);
    }
  }
  if (groups.size === 0) return null;
  const entries = [...groups.values()]
    .map((group) => ({ ...group, hits: [...group.hits].sort((left, right) => right.score - left.score) }))
    .sort((left, right) => right.max_score - left.max_score || (left.entry_id < right.entry_id ? -1 : 1));
  return {
    query: question,
    mode,
    index_generation: generation,
    total_hit_count: entries.reduce((total, group) => total + group.hit_count, 0),
    entries,
    warnings: []
  };
}

function outcomeFromUnified(
  response: UnifiedSearchResponse,
  request: TaskSearchRequest,
  addSource: (source: ConversationSourceLink) => number,
  signal?: AbortSignal
): TaskSearchOutcome {
  signal?.throwIfAborted();
  const warnings = response.degradations.map(
    (code) => UNIFIED_DEGRADATION_COPY[code] ?? '本次检索有环节降级，结果可能不完整。'
  );
  const statusCopy = UNIFIED_VISUAL_STATUS_COPY[response.visual_status];
  if (statusCopy && !warnings.includes(statusCopy)) {
    warnings.push(statusCopy);
  }
  for (const task of response.tasks) {
    const rerankCopy = task.rerank_reason ? UNIFIED_RERANK_COPY[task.rerank_reason] : undefined;
    if (rerankCopy && !warnings.includes(rerankCopy)) {
      warnings.push(rerankCopy);
    }
  }
  const merged = mergeUnifiedResults(response, request.query);
  if (!merged) {
    return { status: 'ok', mode: 'unified_empty', evidence: [], sources: [], warnings };
  }
  try {
    const allowed = new Set(request.allowed_entry_ids);
    const restricted = restrictResults(merged, allowed);
    const formatted = formatSearchSegmentsOutput(restricted, addSource, request.section_filter);
    signal?.throwIfAborted();
    return {
      status: 'ok',
      mode: formatted.modelOutput.mode,
      evidence: formatted.modelOutput.evidence,
      sources: formatted.sources,
      warnings: [...warnings, ...formatted.modelOutput.warnings]
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return MALFORMED_RESULT;
  }
}

export function createSearchLibraryBatch({
  root,
  addSource,
  abortSignal,
  unifiedRetrieval
}: {
  root: string;
  addSource: (source: ConversationSourceLink) => number;
  abortSignal?: AbortSignal;
  unifiedRetrieval?: UnifiedRetrievalConfig | null;
}) {
  return async (requests: TaskSearchRequest[]): Promise<TaskSearchItem[]> => {
    if (requests.length === 0) return [];
    abortSignal?.throwIfAborted();
    if (unifiedRetrieval) {
      const pairs = await Promise.all(
        requests.map(async (request) => {
          const response = await raceWithAbort(
            searchUnified(root, {
              question: request.query,
              sub_questions: request.sub_queries ?? [],
              scope_entry_ids: request.scope_entry_ids ?? [],
              section_filter: request.section_filter,
              segment_types: request.segment_types ?? [],
              mode: 'hybrid',
              top_k: request.top_k,
              head_units: unifiedRetrieval.headUnits,
              max_documents: unifiedRetrieval.maxDocuments,
              bind_carriers: unifiedRetrieval.bindCarriers
            }),
            abortSignal
          );
          return { request, response };
        })
      );
      abortSignal?.throwIfAborted();
      return pairs.map(({ request, response }) => ({
        task_id: request.task_id,
        outcome: outcomeFromUnified(response, request, addSource, abortSignal)
      }));
    }
    const items = await raceWithAbort(
      searchSegmentsBatch(
        root,
        requests.map((request) => ({
          task_id: request.task_id,
          query: request.query,
          mode: 'hybrid',
          top_k: request.top_k,
          scope_entry_ids: request.scope_entry_ids,
          english_query: request.english_query,
          sub_queries: request.sub_queries,
          section_filter: request.section_filter,
          segment_types: request.segment_types
        }))
      ),
      abortSignal
    );
    abortSignal?.throwIfAborted();
    const itemByTask = new Map(items.map((item) => [item.task_id, item]));
    return requests.flatMap((request) => {
      const item = itemByTask.get(request.task_id);
      return item ? [{ task_id: request.task_id, outcome: outcomeFromItem(item, request, addSource, abortSignal) }] : [];
    });
  };
}

/**
 * Host adapter that sends every `search_library` task through one `search_segments_batch`
 * call. The backend prepares the index once for the batch. Per-task failures come back
 * as fixed codes, and their messages are replaced with host-owned copy here.
 *
 * Raw hits outside a task's allowed entries are removed before formatting, so no source
 * marker is registered for them. A cancelled run rejects at once, even when the native
 * invoke itself cannot be cancelled, and nothing is registered after cancellation.
 */

const BACKEND_ERROR_COPY: Record<string, string> = {
  invalid_query: '检索词为空，该子问题未检索。',
  search_failed: '该子问题检索失败，请稍后重试。'
};

const MALFORMED_RESULT: TaskSearchOutcome = {
  status: 'error',
  code: 'malformed_result',
  message: '检索结果格式异常，该子问题未返回证据。'
};

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError');
}

/** Rejects as soon as the signal aborts. The native call may still finish later, and its result is ignored. */
function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

/** Keeps only the groups and hits whose cited entry is in the allowed set. */
function restrictResults(
  results: NonNullable<SearchSegmentsBatchItem['results']>,
  allowedIds: ReadonlySet<string>
): NonNullable<SearchSegmentsBatchItem['results']> {
  const entries = results.entries.flatMap((group) => {
    if (!allowedIds.has(group.entry_id)) return [];
    const hits = group.hits.filter((hit) =>
      allowedIds.has(hit.entry_id) && allowedIds.has(hit.target.entry_id)
    );
    return hits.length > 0 ? [{ ...group, hits, hit_count: hits.length }] : [];
  });
  return { ...results, entries };
}

function outcomeFromItem(
  item: SearchSegmentsBatchItem,
  request: TaskSearchRequest,
  addSource: (source: ConversationSourceLink) => number,
  signal?: AbortSignal
): TaskSearchOutcome {
  if (item.error) {
    return {
      status: 'error',
      code: item.error.code,
      message: BACKEND_ERROR_COPY[item.error.code] ?? '该子问题检索失败。'
    };
  }
  if (!item.results) return MALFORMED_RESULT;
  signal?.throwIfAborted();
  try {
    const allowed = new Set(request.allowed_entry_ids);
    const restricted = restrictResults(item.results, allowed);
    const formatted = formatSearchSegmentsOutput(restricted, addSource, request.section_filter);
    return {
      status: 'ok',
      mode: formatted.modelOutput.mode,
      evidence: formatted.modelOutput.evidence,
      sources: formatted.sources,
      warnings: formatted.modelOutput.warnings
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return MALFORMED_RESULT;
  }
}

