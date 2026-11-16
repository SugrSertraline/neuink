import { describe, expect, it, vi } from 'vitest';
import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import { fallbackDirectPlan, type PlanResolution, type PlanningOutput } from './retrievalPlanning';
import {
  runSearchLibrary,
  type TaskEvidence,
  type TaskSearchItem,
  type TaskSearchOutcome,
  type TaskSearchRequest
} from './searchLibrary';
import { frozenScopeFromSnapshot, type FrozenScope } from './searchScope';

const LIBRARY = [
  { id: 'a', title: 'Paper A' },
  { id: 'b', title: 'Paper B' }
];
const FULL_LIBRARY: FrozenScope = { intent: 'library', entry_ids: [] };
const QUESTION = '比较论文 A 和 B 的方法与数据集';

const planned = (plan: PlanningOutput): PlanResolution => ({ status: 'planned', plan, attempts: 1 });

function source(entryId: string, segmentUid: string): ConversationSourceLink {
  return { entry_id: entryId, entry_title: `title-${entryId}`, segment_uid: segmentUid, page_idx: 0, quote: `quote-${segmentUid}` };
}

function evidence(entryId: string, segmentUid: string): TaskEvidence {
  return { entry_id: entryId, entry_title: `title-${entryId}`, segment_uid: segmentUid, page: 1, score: 1, snippet: `snip-${segmentUid}`, marker: '[S1]' };
}

function okOutcome(entryId: string, segmentUid: string, mode = 'hybrid'): TaskSearchOutcome {
  return { status: 'ok', mode, evidence: [evidence(entryId, segmentUid)], sources: [source(entryId, segmentUid)], warnings: [] };
}

/** Answers each request with one hit from the first scoped entry, or from `fallbackEntry`. */
function batchReturning(outcomeFor: (request: TaskSearchRequest) => TaskSearchOutcome) {
  return vi.fn(async (requests: TaskSearchRequest[]): Promise<TaskSearchItem[]> =>
    requests.map((request) => ({ task_id: request.task_id, outcome: outcomeFor(request) })));
}

function multiTaskPlan(overrides: Partial<PlanningOutput> = {}): PlanningOutput {
  return {
    question_types: ['multi_target'],
    scope_kind: 'explicit_multi',
    original_question: QUESTION,
    retrieval_tasks: [
      { id: 'q1', question: '方法？', constraints: [], depends_on: [], target_entry_ids: [] },
      { id: 'q2', question: '数据集？', constraints: [], depends_on: [], target_entry_ids: [] }
    ],
    unresolved_targets: [],
    ...overrides
  };
}

function run(overrides: Partial<Parameters<typeof runSearchLibrary>[0]> & { searchBatch: ReturnType<typeof batchReturning> }) {
  return runSearchLibrary({
    question: QUESTION,
    scopeRequest: { kind: 'unspecified' },
    usePlanning: true,
    topK: 8,
    frozenScope: FULL_LIBRARY,
    libraryEntries: LIBRARY,
    plan: async () => planned(multiTaskPlan()),
    ...overrides
  });
}

describe('runSearchLibrary scope handling', () => {
  it('searches the whole library in one batch with no entry binding when the scope is library intent', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 'seg1'));
    const plan = vi.fn(async () => fallbackDirectPlan(QUESTION, 'no_model_configured'));
    const result = await run({ usePlanning: false, searchBatch, plan });

    expect(plan).not.toHaveBeenCalled();
    expect(searchBatch).toHaveBeenCalledTimes(1);
    expect(searchBatch.mock.calls[0][0]).toEqual([expect.objectContaining({ task_id: 'direct', query: QUESTION, scope_entry_ids: [] })]);
    expect(result.modelOutput.scope_kind).toBe('full_library');
    expect(result.modelOutput.planning.status).toBe('disabled');
    expect(result.modelOutput.warnings).toEqual([]);
  });

  it('gives the planner no paper list for a whole-library scope', async () => {
    const plan = vi.fn(async () => planned(multiTaskPlan({ retrieval_tasks: [] })));
    await run({ searchBatch: batchReturning(() => okOutcome('a', 's')), plan });
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({ papers: [], libraryScope: true }));
  });

  it('gives the planner the authoritative metadata of selected papers only', async () => {
    const plan = vi.fn(async () => planned(multiTaskPlan({ retrieval_tasks: [] })));
    await run({
      frozenScope: { intent: 'selection', entry_ids: ['a'] },
      searchBatch: batchReturning(() => okOutcome('a', 's')),
      plan
    });
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      papers: [{ id: 'a', title: 'Paper A' }],
      libraryScope: false,
      scopeHint: 'explicit_single: 1 entry'
    }));
  });

  it('searches nothing when the selected tag or explicit selection is empty', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 's'));
    const result = await run({ frozenScope: { intent: 'selection', entry_ids: [] }, searchBatch });
    expect(searchBatch).not.toHaveBeenCalled();
    expect(result.modelOutput.warnings).toContain('范围内没有可检索条目。');
  });

  it('searches nothing for an explicit empty request even under library intent', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 's'));
    const result = await run({ scopeRequest: { kind: 'explicit_multi', entry_ids: [] }, searchBatch });
    expect(searchBatch).not.toHaveBeenCalled();
    expect(result.modelOutput.warnings).toContain('范围内没有可检索条目。');
  });

  it('asks for clarification for unresolved scope and never searches', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 's'));
    const result = await run({ frozenScope: { intent: 'unresolved', entry_ids: ['a'] }, searchBatch });
    expect(searchBatch).not.toHaveBeenCalled();
    expect(result.modelOutput.warnings.join(' ')).toContain('请先明确');
  });

  it('rejects an ID outside the frozen selection instead of widening', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 's'));
    const result = await run({
      scopeRequest: { kind: 'explicit_single', entry_ids: ['b'] },
      frozenScope: { intent: 'selection', entry_ids: ['a'] },
      searchBatch
    });
    expect(searchBatch).not.toHaveBeenCalled();
    expect(result.modelOutput.warnings.join(' ')).toContain('超出冻结范围');
  });

  it('rejects an ID that does not exist in the host library', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 's'));
    const result = await run({
      scopeRequest: { kind: 'explicit_single', entry_ids: ['missing'] },
      searchBatch
    });
    expect(searchBatch).not.toHaveBeenCalled();
    expect(result.modelOutput.warnings.join(' ')).toContain('不在当前资料库');
  });

  it('narrows a library scope to a requested existing ID', async () => {
    const searchBatch = batchReturning(() => okOutcome('b', 's'));
    await run({ scopeRequest: { kind: 'explicit_single', entry_ids: ['b'] }, usePlanning: false, searchBatch });
    expect(searchBatch.mock.calls[0][0][0].scope_entry_ids).toEqual(['b']);
  });
});

describe('runSearchLibrary task binding and statuses', () => {
  it('binds each task to its target paper and filters evidence to that paper', async () => {
    const searchBatch = batchReturning((request) => request.scope_entry_ids[0] === 'a'
      ? okOutcome('a', 'seg-a')
      : okOutcome('b', 'seg-b'));
    const result = await run({
      frozenScope: { intent: 'selection', entry_ids: ['a', 'b'] },
      plan: async () => planned(multiTaskPlan({
        retrieval_tasks: [
          { id: 'q1', question: 'A 的方法？', constraints: [], depends_on: [], target_entry_ids: ['a'] },
          { id: 'q2', question: 'B 的数据集？', constraints: [], depends_on: [], target_entry_ids: ['b'] }
        ]
      })),
      searchBatch
    });
    const requests = searchBatch.mock.calls[0][0];
    expect(requests.map((request) => request.scope_entry_ids)).toEqual([['a'], ['b']]);
    expect(result.modelOutput.task_results.map((task) => task.evidence.map((item) => item.entry_id))).toEqual([['a'], ['b']]);
  });

  it('fails a task that targets a paper outside the frozen scope without sending it', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 's'));
    const result = await run({
      frozenScope: { intent: 'selection', entry_ids: ['a'] },
      plan: async () => planned(multiTaskPlan({
        retrieval_tasks: [{ id: 'q1', question: 'B 的方法？', constraints: [], depends_on: [], target_entry_ids: ['b'] }]
      })),
      searchBatch
    });
    expect(searchBatch).not.toHaveBeenCalled();
    const [task] = result.modelOutput.task_results;
    expect(task.status).toBe('failed');
    expect(task.error?.code).toBe('target_out_of_scope');
    expect(result.modelOutput.summary.failed_tasks).toEqual(['q1']);
  });

  it('reports planner-named papers missing from scope as unresolved warnings', async () => {
    const result = await run({
      frozenScope: { intent: 'selection', entry_ids: ['a'] },
      plan: async () => planned(multiTaskPlan({ retrieval_tasks: [], unresolved_targets: ['Paper C'] })),
      searchBatch: batchReturning(() => okOutcome('a', 's'))
    });
    expect(result.modelOutput.warnings.join(' ')).toContain('Paper C');
  });

  it('reports a nonempty result as retrieved without claiming the question is answered', async () => {
    const result = await run({
      frozenScope: { intent: 'selection', entry_ids: ['a', 'b'] },
      searchBatch: batchReturning((request) => request.task_id === 'q1' ? okOutcome('a', 's1') : { status: 'ok', mode: 'hybrid', evidence: [], sources: [], warnings: [] }),
      plan: async () => planned(multiTaskPlan())
    });
    expect(result.modelOutput.summary.retrieved_tasks).toEqual(['q1']);
    expect(result.modelOutput.summary.empty_tasks).toEqual(['q2']);
    expect(result.modelOutput.summary.failed_tasks).toEqual([]);
    expect(result.modelOutput.summary.semantic_sufficiency).toBe('not_evaluated');
    expect(result.modelOutput.task_results.map((task) => task.status)).toEqual(['retrieved', 'empty']);
  });

  it('keeps other tasks when one backend task fails, with a fixed safe message', async () => {
    const searchBatch = batchReturning((request) => request.task_id === 'q1'
      ? { status: 'error', code: 'search_failed', message: '该子问题检索失败，请稍后重试。' }
      : okOutcome('a', 'seg2'));
    const result = await run({ searchBatch, plan: async () => planned(multiTaskPlan()) });
    expect(result.modelOutput.summary.failed_tasks).toEqual(['q1']);
    expect(result.modelOutput.summary.retrieved_tasks).toEqual(['q2']);
    expect(result.modelOutput.task_results[0].error).toEqual({ code: 'search_failed', message: '该子问题检索失败，请稍后重试。' });
  });

  it('reports a missing batch item as a failed task', async () => {
    const searchBatch = vi.fn(async (requests: TaskSearchRequest[]) => requests.slice(0, 1).map((request) => ({
      task_id: request.task_id, outcome: okOutcome('a', 's')
    })));
    const result = await run({ searchBatch, plan: async () => planned(multiTaskPlan()) });
    expect(result.modelOutput.task_results[1].error?.code).toBe('missing_result');
  });

  it('fails every task with a generic message when the whole batch fails', async () => {
    const searchBatch = vi.fn(async (_requests: TaskSearchRequest[]): Promise<TaskSearchItem[]> => {
      throw new Error('C:\\Users\\secret\\workspace index failure');
    });
    const result = await run({ searchBatch, plan: async () => planned(multiTaskPlan()) });
    expect(searchBatch).toHaveBeenCalledTimes(1);
    expect(result.modelOutput.summary.failed_tasks).toEqual(['q1', 'q2']);
    expect(JSON.stringify(result.modelOutput)).not.toContain('secret');
    expect(result.modelOutput.task_results[0].error?.code).toBe('batch_failed');
  });

  it('keeps the backend mode and forwards backend warnings per task', async () => {
    const searchBatch = batchReturning(() => ({
      status: 'ok',
      mode: 'hybrid_fallback_keyword',
      evidence: [evidence('a', 's')],
      sources: [source('a', 's')],
      warnings: ['Semantic search is unavailable.']
    }));
    const result = await run({ usePlanning: false, searchBatch });
    expect(result.modelOutput.task_results[0].mode).toBe('hybrid_fallback_keyword');
    expect(result.modelOutput.task_results[0].warnings).toEqual(['Semantic search is unavailable.']);
  });

  it('drops evidence that falls outside a task scope and says so', async () => {
    const searchBatch = batchReturning(() => ({
      status: 'ok',
      mode: 'hybrid',
      evidence: [evidence('a', 'ok'), evidence('b', 'leak')],
      sources: [source('a', 'ok'), source('b', 'leak')],
      warnings: []
    }));
    const result = await run({ frozenScope: { intent: 'selection', entry_ids: ['a'] }, usePlanning: false, searchBatch });
    expect(result.modelOutput.task_results[0].evidence.map((item) => item.segment_uid)).toEqual(['ok']);
    expect(result.sources.map((item) => ('segment_uid' in item ? item.segment_uid : ''))).toEqual(['ok']);
    expect(result.modelOutput.task_results[0].warnings.join(' ')).toContain('已忽略');
  });
});

describe('runSearchLibrary batching, options and sources', () => {
  it('sends all planned tasks in one batch carrying the shared options and per-task English queries', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 's'));
    await run({
      options: { english_query: 'method of A', sub_queries: ['baseline'], section_filter: 'Experiments', segment_types: ['table'] },
      frozenScope: { intent: 'selection', entry_ids: ['a', 'b'] },
      plan: async () => planned(multiTaskPlan({
        retrieval_tasks: [
          { id: 'q1', question: '方法？', english_query: 'method', constraints: [], depends_on: [], target_entry_ids: [] },
          { id: 'q2', question: '数据集？', constraints: [], depends_on: [], target_entry_ids: [] }
        ]
      })),
      searchBatch
    });
    expect(searchBatch).toHaveBeenCalledTimes(1);
    const requests = searchBatch.mock.calls[0][0];
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ task_id: 'q1', english_query: 'method', sub_queries: ['baseline'], section_filter: 'Experiments', segment_types: ['table'] });
    expect(requests[1]).toMatchObject({ task_id: 'q2', english_query: null });
  });

  it('deduplicates the same source across tasks while keeping per-task evidence', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 'seg1'));
    const result = await run({ frozenScope: { intent: 'selection', entry_ids: ['a'] }, searchBatch, plan: async () => planned(multiTaskPlan()) });
    expect(result.sources).toHaveLength(1);
    expect(result.modelOutput.task_results.map((task) => task.evidence.length)).toEqual([1, 1]);
  });

  it('adds a global incompleteness warning', async () => {
    const result = await run({
      plan: async () => planned(multiTaskPlan({ question_types: ['global'], retrieval_tasks: [] })),
      searchBatch: batchReturning(() => okOutcome('a', 's'))
    });
    expect(result.modelOutput.warnings.join(' ')).toContain('不代表穷尽覆盖');
  });
});

describe('runSearchLibrary planning outcomes', () => {
  it('runs the original question once and ignores tasks for dependent plans', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 's'));
    const result = await run({
      plan: async () => planned({
        question_types: ['multi_target'],
        scope_kind: 'unspecified',
        original_question: QUESTION,
        retrieval_tasks: [
          { id: 'q1', question: '第一步？', constraints: [], depends_on: [], target_entry_ids: [] },
          { id: 'q2', question: '第二步？', constraints: [], depends_on: ['q1'], target_entry_ids: [] }
        ],
        unresolved_targets: []
      }),
      searchBatch
    });
    expect(searchBatch.mock.calls[0][0].map((request) => request.task_id)).toEqual(['direct']);
    expect(searchBatch.mock.calls[0][0][0].query).toBe(QUESTION);
    expect(result.modelOutput.warnings.join(' ')).toContain('依赖型多跳');
  });

  it('runs the original question once for a dependent_multihop type with no tasks', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 's'));
    await run({
      plan: async () => planned({
        question_types: ['dependent_multihop'],
        scope_kind: 'unspecified',
        original_question: QUESTION,
        retrieval_tasks: [],
        unresolved_targets: []
      }),
      searchBatch
    });
    expect(searchBatch.mock.calls[0][0]).toHaveLength(1);
  });

  it('retrieves the original question directly after a no-model degradation', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 's'));
    const result = await run({ plan: async () => fallbackDirectPlan(QUESTION, 'no_model_configured'), searchBatch });
    expect(searchBatch.mock.calls[0][0][0]).toMatchObject({ task_id: 'direct', query: QUESTION });
    expect(result.modelOutput.planning).toMatchObject({ status: 'degraded', reason: 'no_model_configured' });
  });

  it('retrieves the original question directly after an invalid plan', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 's'));
    const result = await run({ plan: async () => fallbackDirectPlan(QUESTION, 'plan_invalid'), searchBatch });
    expect(searchBatch.mock.calls[0][0][0].query).toBe(QUESTION);
    expect(result.modelOutput.planning.reason).toBe('plan_invalid');
  });

  it('uses the host question for the direct task even when the plan carries another one', async () => {
    const searchBatch = batchReturning(() => okOutcome('a', 's'));
    await run({
      question: `  ${QUESTION}  `,
      plan: async () => planned({
        question_types: ['single'],
        scope_kind: 'unspecified',
        original_question: 'rewritten by the model',
        retrieval_tasks: [],
        unresolved_targets: []
      }),
      searchBatch
    });
    expect(searchBatch.mock.calls[0][0][0].query).toBe(QUESTION);
  });
});

describe('runSearchLibrary abort handling', () => {
  it('aborts before searching when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const searchBatch = vi.fn();
    await expect(run({ usePlanning: false, searchBatch, abortSignal: controller.signal })).rejects.toThrow();
    expect(searchBatch).not.toHaveBeenCalled();
  });

  it('propagates an abort raised inside the batch instead of turning it into failed tasks', async () => {
    const searchBatch = vi.fn(async (_requests: TaskSearchRequest[]): Promise<TaskSearchItem[]> => {
      throw new DOMException('stopped', 'AbortError');
    });
    await expect(run({ searchBatch, plan: async () => planned(multiTaskPlan()) })).rejects.toMatchObject({ name: 'AbortError' });
    expect(searchBatch).toHaveBeenCalledTimes(1);
  });

  it('propagates an abort that happens while the batch is running', async () => {
    const controller = new AbortController();
    const searchBatch = vi.fn(async (requests: TaskSearchRequest[]) => {
      controller.abort();
      return requests.map((request) => ({ task_id: request.task_id, outcome: okOutcome('a', 's') }));
    });
    await expect(run({
      searchBatch,
      plan: async () => planned(multiTaskPlan()),
      abortSignal: controller.signal
    })).rejects.toThrow();
    expect(searchBatch).toHaveBeenCalledTimes(1);
  });
});

describe('frozenScopeFromSnapshot', () => {
  it('reads snapshots without an intent as before: empty means library, entries mean selection', () => {
    expect(frozenScopeFromSnapshot({ entry_ids: [] })).toEqual({ intent: 'library', entry_ids: [], tagged: false });
    expect(frozenScopeFromSnapshot({ entry_ids: ['a', 'a'] })).toEqual({ intent: 'selection', entry_ids: ['a'], tagged: false });
  });

  it('keeps an explicit intent and fails closed on an unknown one', () => {
    expect(frozenScopeFromSnapshot({ entry_ids: ['a'], scope_intent: 'library' })).toMatchObject({ intent: 'library', entry_ids: ['a'] });
    expect(frozenScopeFromSnapshot({ entry_ids: [], scope_intent: 'selection' })).toMatchObject({ intent: 'selection', entry_ids: [] });
    expect(frozenScopeFromSnapshot({ entry_ids: [], scope_intent: 'everything' as never })).toMatchObject({ intent: 'unresolved', entry_ids: [] });
  });
});
