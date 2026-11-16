import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import { conversationSourceKey } from '@/shared/ipc/assistantApi';
import { AgentStoppedError } from '../agent-core/agent';
import {
  type DegradationReason,
  type PlanResolution,
  type PlanningOutput,
  type QuestionType,
  type RetrievalTask,
  type ScopeKind
} from './retrievalPlanning';
import {
  resolveSearchScope,
  type FrozenScope,
  type LibraryEntryRef,
  type ScopeRequest
} from './searchScope';

/**
 * Unified retrieval orchestration (`search_library`). The planner decides how to
 * split the question. This module binds each task to its papers, sends every
 * task in one batch, and reports per-task status. It never widens the frozen
 * scope and never claims semantic sufficiency, which is not evaluated here.
 */

export type TaskEvidence = {
  entry_id: string;
  entry_title: string;
  segment_uid: string;
  page: number;
  score?: number;
  snippet?: string;
  marker: string;
};

export type TaskSearchRequest = {
  task_id: string;
  query: string;
  english_query: string | null;
  sub_queries: string[];
  section_filter: string | null;
  segment_types: string[];
  /** Backend filter. An empty list means the whole library, bounded by `allowed_entry_ids`. */
  scope_entry_ids: string[];
  /** Entries this task may report evidence for. Results outside this set are dropped before formatting. */
  allowed_entry_ids: string[];
  top_k: number;
};

export type TaskSearchOutcome =
  | {
      status: 'ok';
      mode: string;
      evidence: TaskEvidence[];
      sources: ConversationSourceLink[];
      warnings: string[];
    }
  | { status: 'error'; code: string; message: string };

export type TaskSearchItem = { task_id: string; outcome: TaskSearchOutcome };

export type SearchOptions = {
  english_query?: string;
  sub_queries?: string[];
  section_filter?: string;
  segment_types?: string[];
};

export type TaskStatus = 'retrieved' | 'empty' | 'failed';

export type TaskResult = {
  task_id: string;
  question: string;
  status: TaskStatus;
  target_entry_ids: string[];
  mode?: string;
  evidence: TaskEvidence[];
  warnings: string[];
  error?: { code: string; message: string };
};

export type SearchLibraryOutput = {
  kind: 'search_library';
  /** `needs_clarification` means nothing was searched; `empty_scope` means the scope had no entries. */
  status: 'searched' | 'empty_scope' | 'needs_clarification';
  /** Shown to the model and user when the request must be clarified before any search runs. */
  clarification?: string;
  scope_kind: ScopeKind | 'full_library';
  original_question: string;
  planning: {
    status: 'planned' | 'degraded' | 'disabled';
    reason?: DegradationReason;
    attempts?: number;
    question_types: QuestionType[];
  };
  task_results: TaskResult[];
  summary: {
    retrieved_tasks: string[];
    empty_tasks: string[];
    failed_tasks: string[];
    /** Host does not judge whether retrieved evidence answers the question. */
    semantic_sufficiency: 'not_evaluated';
  };
  warnings: string[];
};

export type SearchLibraryResult = {
  modelOutput: SearchLibraryOutput;
  sources: ConversationSourceLink[];
  summary: string;
};

export type PlanInput = {
  question: string;
  scopeHint: string;
  papers: LibraryEntryRef[];
  libraryScope: boolean;
  /** Cancellation for the planner model call: the model-call signal and the run signal combined. */
  abortSignal?: AbortSignal;
};

/** Planning was not requested (`use_planning` false). This is not a degradation. */
type DisabledResolution = { status: 'disabled'; plan: PlanningOutput; attempts: 0 };

const BATCH_UNAVAILABLE_OUTCOME: TaskSearchOutcome = {
  status: 'error',
  code: 'batch_failed',
  message: '检索服务暂不可用，本次未返回证据。'
};

const TARGET_OUT_OF_SCOPE: { code: string; message: string } = {
  code: 'target_out_of_scope',
  message: '指定论文不在本次检索范围内，该子问题未检索。'
};

const TASK_MISSING_RESULT: { code: string; message: string } = {
  code: 'missing_result',
  message: '检索服务未返回该子问题的结果。'
};

/** Cancellation and stop errors (including quota and budget stops) must never become task failures. */
function isStopError(error: unknown) {
  return error instanceof AgentStoppedError || (error instanceof Error && error.name === 'AbortError');
}

function sourceEntryId(source: ConversationSourceLink): string | undefined {
  return 'entry_id' in source && typeof source.entry_id === 'string' ? source.entry_id : undefined;
}

function scopeHintFor(scope: { libraryScope: boolean; scopeKind: ScopeKind; count: number }): string {
  if (scope.libraryScope) return 'full library';
  return `${scope.scopeKind}: ${scope.count} entr${scope.count === 1 ? 'y' : 'ies'}`;
}

/**
 * Dependent chains are not executed. A plan that marks dependent_multihop, or
 * carries any `depends_on`, runs the original question once and drops its tasks.
 */
function tasksToRun(plan: PlanningOutput, trimmed: string, options: SearchOptions): RetrievalTask[] {
  const directTask: RetrievalTask = {
    id: 'direct',
    question: trimmed,
    constraints: [],
    depends_on: [],
    english_query: options.english_query?.trim() || undefined,
    target_entry_ids: []
  };
  const hasDependency = plan.question_types.includes('dependent_multihop') ||
    plan.retrieval_tasks.some((task) => task.depends_on.length > 0);
  const singleOnly = plan.question_types.every((type) => type === 'single');
  if (singleOnly || hasDependency || plan.retrieval_tasks.length === 0) return [directTask];
  return plan.retrieval_tasks;
}

export async function runSearchLibrary({
  question,
  scopeRequest,
  usePlanning,
  topK,
  options = {},
  frozenScope,
  libraryEntries,
  plan,
  searchBatch,
  abortSignal
}: {
  question: string;
  scopeRequest: ScopeRequest;
  usePlanning: boolean;
  topK: number;
  options?: SearchOptions;
  frozenScope: FrozenScope;
  libraryEntries: LibraryEntryRef[];
  plan: (input: PlanInput) => Promise<PlanResolution>;
  searchBatch: (requests: TaskSearchRequest[]) => Promise<TaskSearchItem[]>;
  abortSignal?: AbortSignal;
}): Promise<SearchLibraryResult> {
  const trimmed = question.trim();
  const scope = resolveSearchScope(scopeRequest, frozenScope, libraryEntries);
  abortSignal?.throwIfAborted();

  const basePlanning = {
    status: 'disabled' as const,
    question_types: ['single'] as QuestionType[]
  };
  // Each stop carries its own status, so a model or user can tell a clarification from an empty scope.
  const stopped = (
    status: 'empty_scope' | 'needs_clarification',
    scopeKind: SearchLibraryOutput['scope_kind'],
    message: string
  ): SearchLibraryResult => ({
    modelOutput: {
      kind: 'search_library',
      status,
      ...(status === 'needs_clarification' ? { clarification: message } : {}),
      scope_kind: scopeKind,
      original_question: trimmed,
      planning: basePlanning,
      task_results: [],
      summary: { retrieved_tasks: [], empty_tasks: [], failed_tasks: [], semantic_sufficiency: 'not_evaluated' },
      warnings: [message]
    },
    sources: [],
    summary: message
  });

  if (scope.status === 'invalid') return stopped('needs_clarification', 'unspecified', scope.message);
  if (scope.status === 'unresolved') {
    return stopped('needs_clarification', 'unspecified', '检索范围包含已不存在的标签或条目，请先明确要检索的论文。');
  }
  if (scope.status === 'empty') return stopped('empty_scope', scope.scope_kind, '范围内没有可检索条目。');
  if (scope.status === 'library' && libraryEntries.length === 0) {
    return stopped('empty_scope', 'full_library', '资料库中没有可检索条目。');
  }

  const libraryScope = scope.status === 'library';
  const scopeKind: ScopeKind | 'full_library' = scope.status === 'resolved' ? scope.scope_kind : 'full_library';
  const allowedIds = scope.status === 'resolved' ? scope.entry_ids : libraryEntries.map((entry) => entry.id);
  const titleById = new Map(libraryEntries.map((entry) => [entry.id, entry.title]));
  const papers: LibraryEntryRef[] = libraryScope
    ? []
    : allowedIds.map((id) => ({ id, title: titleById.get(id) ?? id }));
  const scopeHint = scopeHintFor({ libraryScope, scopeKind: scopeKind === 'full_library' ? 'explicit_multi' : scopeKind, count: allowedIds.length });

  const resolution: PlanResolution | DisabledResolution = usePlanning
    ? await plan({ question: trimmed, scopeHint, papers, libraryScope, abortSignal })
    : {
        status: 'disabled',
        plan: {
          question_types: ['single'],
          scope_kind: 'unspecified',
          original_question: trimmed,
          retrieval_tasks: [],
          unresolved_targets: [],
          synthesis_task: undefined
        },
        attempts: 0
      };
  abortSignal?.throwIfAborted();

  const warnings: string[] = [];
  if (resolution.status === 'degraded') {
    warnings.push(`检索规划未生效，已按原问题直接检索（${resolution.reason}）。`);
  }
  const planQuestions = resolution.plan.question_types;
  if (planQuestions.includes('dependent_multihop') || resolution.plan.retrieval_tasks.some((task) => task.depends_on.length > 0)) {
    warnings.push('依赖型多跳问题本次未执行完整依赖链，仅按原问题检索。');
  }
  if (planQuestions.includes('global')) {
    warnings.push('全局聚合问题只返回检索到的片段，结果不代表穷尽覆盖，可能不完整。');
  }
  const planningSummary: SearchLibraryOutput['planning'] = {
    status: resolution.status,
    reason: resolution.status === 'degraded' ? resolution.reason : undefined,
    attempts: resolution.attempts,
    question_types: planQuestions
  };

  // A named paper the planner could not bind is not searched by a fallback. The whole run stops
  // for clarification, so no direct batch searches the library in its place.
  if (resolution.plan.unresolved_targets.length > 0) {
    const message = `以下论文未在当前范围内找到，未检索：${resolution.plan.unresolved_targets.join('、')}。请明确要检索的论文后再试。`;
    return {
      modelOutput: {
        kind: 'search_library',
        status: 'needs_clarification',
        clarification: message,
        scope_kind: scopeKind,
        original_question: trimmed,
        planning: planningSummary,
        task_results: [],
        summary: { retrieved_tasks: [], empty_tasks: [], failed_tasks: [], semantic_sufficiency: 'not_evaluated' },
        warnings: [...warnings, message]
      },
      sources: [],
      summary: message
    };
  }

  const tasks = tasksToRun(resolution.plan, trimmed, options);
  const allowedSet = new Set(allowedIds);
  const results = new Map<string, TaskResult>();
  const pending: Array<{ task: RetrievalTask; targets: string[]; allowed: string[] }> = [];
  const requests: TaskSearchRequest[] = [];

  for (const task of tasks) {
    const targets = [...new Set(task.target_entry_ids)];
    const base = { task_id: task.id, question: task.question, target_entry_ids: targets, evidence: [], warnings: [] };
    if (targets.some((id) => !allowedSet.has(id))) {
      results.set(task.id, { ...base, status: 'failed', error: TARGET_OUT_OF_SCOPE });
      continue;
    }
    // The task's allowed set is the frozen scope (or its named targets). Results outside it never reach formatting.
    const allowed = targets.length > 0 ? targets : allowedIds;
    // Library scope sends [] so the backend searches the whole library. The allowed set still bounds the results.
    const scopeIds = targets.length > 0 ? targets : libraryScope ? [] : allowedIds;
    pending.push({ task, targets, allowed });
    requests.push({
      task_id: task.id,
      query: task.question,
      english_query: task.english_query ?? null,
      sub_queries: options.sub_queries ?? [],
      section_filter: options.section_filter ?? null,
      segment_types: options.segment_types ?? [],
      scope_entry_ids: scopeIds,
      allowed_entry_ids: allowed,
      top_k: topK
    });
  }

  const sources: ConversationSourceLink[] = [];
  const seenSources = new Set<string>();
  if (requests.length > 0) {
    abortSignal?.throwIfAborted();
    let items: TaskSearchItem[] | null;
    try {
      items = await searchBatch(requests);
    } catch (error) {
      abortSignal?.throwIfAborted();
      if (isStopError(error)) throw error;
      items = null;
    }
    abortSignal?.throwIfAborted();
    const outcomeByTask = new Map((items ?? []).map((item) => [item.task_id, item.outcome]));

    for (const { task, targets, allowed } of pending) {
      const base = { task_id: task.id, question: task.question, target_entry_ids: targets, evidence: [], warnings: [] };
      const outcome = items === null
        ? BATCH_UNAVAILABLE_OUTCOME
        : outcomeByTask.get(task.id) ?? { status: 'error' as const, ...TASK_MISSING_RESULT };
      if (outcome.status === 'error') {
        results.set(task.id, { ...base, status: 'failed', error: { code: outcome.code, message: outcome.message } });
        continue;
      }
      // Second line of defense: the batch adapter already filtered raw hits. Anything else is dropped here too.
      const taskAllowed = new Set(allowed);
      const evidence = outcome.evidence.filter((item) => taskAllowed.has(item.entry_id));
      const taskWarnings = [...outcome.warnings];
      if (evidence.length < outcome.evidence.length) taskWarnings.push('部分结果超出本子问题的范围，已忽略。');
      for (const source of outcome.sources) {
        const entryId = sourceEntryId(source);
        if (!entryId || !taskAllowed.has(entryId)) continue;
        const key = conversationSourceKey(source);
        if (!seenSources.has(key)) {
          seenSources.add(key);
          sources.push(source);
        }
      }
      results.set(task.id, {
        ...base,
        status: evidence.length > 0 ? 'retrieved' : 'empty',
        mode: outcome.mode,
        evidence,
        warnings: taskWarnings
      });
    }
  }

  const taskResults = tasks.map((task) => results.get(task.id)!);
  const idsWithStatus = (status: TaskStatus) => taskResults.filter((task) => task.status === status).map((task) => task.task_id);
  const evidenceCount = taskResults.reduce((total, task) => total + task.evidence.length, 0);

  const modelOutput: SearchLibraryOutput = {
    kind: 'search_library',
    status: 'searched',
    scope_kind: scopeKind,
    original_question: trimmed,
    planning: planningSummary,
    task_results: taskResults,
    summary: {
      retrieved_tasks: idsWithStatus('retrieved'),
      empty_tasks: idsWithStatus('empty'),
      failed_tasks: idsWithStatus('failed'),
      semantic_sufficiency: 'not_evaluated'
    },
    warnings
  };

  const summary = `Retrieved ${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'} across ${taskResults.length} task${taskResults.length === 1 ? '' : 's'}: ${idsWithStatus('retrieved').length} with evidence, ${idsWithStatus('empty').length} empty, ${idsWithStatus('failed').length} failed.`;

  return { modelOutput, sources, summary };
}
