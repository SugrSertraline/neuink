import { z } from 'zod';
import { AgentStoppedError } from '../agent-core/agent';

/**
 * Retrieval planning for the unified `search_library` tool.
 *
 * This module implements the planning-output contract from
 * docs/development/retrieval-tool-completion-plan.md, section 4. The planner
 * decides how to split and bind the frozen question; the host resolves scope
 * separately and remains authoritative over it. The host question is immutable:
 * a plan that rewrites it is invalid.
 */

export const QUESTION_TYPES = [
  'single',
  'multi_target',
  'cross_paper',
  'dependent_multihop',
  'global'
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const SCOPE_KINDS = [
  'explicit_single',
  'explicit_multi',
  'explicit_tag',
  'unspecified'
] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const DEGRADATION_REASONS = [
  'plan_invalid',
  'model_unavailable',
  'scope_irresolvable',
  'no_model_configured'
] as const;
export type DegradationReason = (typeof DEGRADATION_REASONS)[number];

/** Provisional cap until the decomposition limit is measured (plan section 5.2). */
export const MAX_RETRIEVAL_TASKS = 12;

/** Above this many selected papers the planner sees only a count, so the prompt stays bounded. */
export const MAX_PLANNER_PAPERS = 40;

const retrievalTaskSchema = z.object({
  id: z.string().trim().min(1),
  question: z.string().trim().min(1),
  // Entities, times, and other restrictions the original question implies and
  // every retrieval against this task must preserve.
  constraints: z.array(z.string()).default([]),
  // First version does not execute dependency chains; recorded for downgrade.
  depends_on: z.array(z.string()).default([]),
  // Optional English academic rendering of this sub-question. Produced in the same
  // planner call, so no separate translation request is needed.
  english_query: z.string().trim().min(1).optional(),
  // Entry ids this sub-question is about. Must come from the listed selected papers.
  target_entry_ids: z.array(z.string().trim().min(1)).default([])
});

export type RetrievalTask = z.infer<typeof retrievalTaskSchema>;

export const planningOutputSchema = z.object({
  question_types: z.array(z.enum(QUESTION_TYPES)).min(1),
  // The model's best-effort guess. The merge stage overwrites this with the
  // host-resolved scope; a model must never be able to widen the frozen scope.
  scope_kind: z.enum(SCOPE_KINDS).default('unspecified'),
  original_question: z.string().trim().min(1),
  // Optional English academic query for top-level single Chinese questions (where
  // retrieval_tasks is empty).
  english_query: z.string().trim().min(1).optional(),
  retrieval_tasks: z.array(retrievalTaskSchema).max(MAX_RETRIEVAL_TASKS).default([]),
  // Named papers the question refers to that are not among the listed selected papers.
  unresolved_targets: z.array(z.string().trim().min(1).max(120)).max(MAX_RETRIEVAL_TASKS).default([]),
  synthesis_task: z.string().trim().optional()
});

export type PlanningOutput = z.infer<typeof planningOutputSchema>;

/**
 * Splits a dependent plan into strictly 2 hops (`hop1` with empty `depends_on`,
 * `hop2` depending only on `hop1`). Returns `null` for empty, cyclic, or >2-hop plans.
 */
export function splitTwoHopTasks(
  plan: Pick<PlanningOutput, 'retrieval_tasks'>
): { hop1: RetrievalTask[]; hop2: RetrievalTask[] } | null {
  if (plan.retrieval_tasks.length < 2) return null;
  const hop1 = plan.retrieval_tasks.filter((task) => task.depends_on.length === 0);
  if (hop1.length === 0) return null;
  const hop1Ids = new Set(hop1.map((task) => task.id));
  const hop2 = plan.retrieval_tasks.filter(
    (task) => task.depends_on.length > 0 && task.depends_on.every((dep) => hop1Ids.has(dep))
  );
  if (hop2.length === 0 || hop1.length + hop2.length !== plan.retrieval_tasks.length) {
    return null;
  }
  return { hop1, hop2 };
}

export type PlanningValidation =
  | { ok: true; plan: PlanningOutput }
  | { ok: false; issues: string[] };

export type PlanResolution =
  | { status: 'planned'; plan: PlanningOutput; attempts: number }
  | { status: 'degraded'; plan: PlanningOutput; reason: DegradationReason; attempts: number };

export type DegradedResolution = Extract<PlanResolution, { status: 'degraded' }>;

const DECOMPOSITION_TYPES: ReadonlySet<QuestionType> = new Set([
  'multi_target',
  'cross_paper',
  'global'
]);

/**
 * Schema plus business rules that a generic JSON schema cannot express. When
 * `hostQuestion` is given, the returned plan carries that host text as its
 * `original_question`, whatever the model wrote.
 */
export function validatePlanningOutput(value: unknown, hostQuestion?: string): PlanningValidation {
  const parsed = planningOutputSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'plan'}: ${issue.message}`)
    };
  }
  const parsedPlan = parsed.data;
  const issues: string[] = [];

  const ids = new Set<string>();
  for (const task of parsedPlan.retrieval_tasks) {
    if (ids.has(task.id)) issues.push(`duplicate retrieval task id: ${task.id}`);
    ids.add(task.id);
  }
  for (const task of parsedPlan.retrieval_tasks) {
    for (const dependency of task.depends_on) {
      if (dependency === task.id) issues.push(`task ${task.id} depends on itself`);
      else if (!ids.has(dependency)) issues.push(`task ${task.id} depends on unknown task ${dependency}`);
    }
  }

  const types = new Set(parsedPlan.question_types);
  const decomposes = [...types].some((type) => DECOMPOSITION_TYPES.has(type));
  const hasDependency = types.has('dependent_multihop') ||
    parsedPlan.retrieval_tasks.some((task) => task.depends_on.length > 0);
  if (types.size === 1 && types.has('single') && parsedPlan.retrieval_tasks.length > 0) {
    issues.push('single-question plans must reuse the original question without decomposition');
  }
  if (decomposes && !types.has('single') && parsedPlan.retrieval_tasks.length === 0) {
    issues.push('decomposition plans require at least one retrieval task');
  }
  if (hasDependency && !splitTwoHopTasks(parsedPlan)) {
    issues.push(
      'dependent_multihop plans require a valid 2-hop DAG: at least one hop-1 task with empty depends_on and at least one hop-2 task depending only on hop-1 tasks (no cycles or >2 hops)'
    );
  }
  if (hostQuestion !== undefined && parsedPlan.original_question !== hostQuestion.trim()) {
    issues.push('original_question must repeat the frozen user question exactly');
  }

  if (issues.length > 0) return { ok: false, issues };
  const plan = hostQuestion === undefined
    ? parsedPlan
    : { ...parsedPlan, original_question: hostQuestion.trim() };
  return { ok: true, plan };
}

/** Direct-retrieval plan that preserves the frozen question (plan section 4). */
export function fallbackDirectPlan(question: string, reason: DegradationReason): DegradedResolution {
  return {
    status: 'degraded',
    plan: {
      question_types: ['single'],
      scope_kind: 'unspecified',
      original_question: question.trim(),
      retrieval_tasks: [],
      unresolved_targets: [],
      synthesis_task: undefined
    },
    reason,
    attempts: 0
  };
}

export const PLANNER_TASK_NAME = 'retrieval_plan';

export const PLANNER_TASK_DESCRIPTION =
  'A validated retrieval plan: question types, scope kind, original question, retrieval tasks, and optional synthesis.';

export const PLANNER_SYSTEM_PROMPT = [
  'You plan library retrieval for a research assistant that searches parsed academic papers.',
  'Classify the frozen question and, only when needed, decompose it into independently retrievable sub-questions.',
  'Question types:',
  '- single: one direct question; do not decompose.',
  '- multi_target: several independent information needs in one question; one task per need.',
  '- cross_paper: comparison or synthesis across papers; keep one task per paper-and-dimension and bind evidence to its paper.',
  '- dependent_multihop: the next query needs an earlier answer (at most 2 hops); put hop-1 tasks with empty depends_on and hop-2 tasks referencing hop-1 ids in depends_on.',
  '- global: exhaustive aggregation over a whole set; only claim the coverage you can actually retrieve.',
  'Preserve entities, times, and other restrictions from the original question inside the question text of every task they apply to. Retrieval searches only the question text, so a constraint left out of it is lost.',
  'original_question must copy the frozen user question exactly. Never rewrite it.',
  'When a task concerns one listed selected paper, set target_entry_ids to that paper id. Use only ids from the selected paper list; never invent ids.',
  'If the question names a paper that is not in the selected list, put its name in unresolved_targets and do not create a task for it.',
  'Optionally give the top-level plan (for single questions) and each task an English english_query for an academic search when the question is in Chinese.',
  'Return JSON only: question_types, scope_kind, original_question, optional english_query, retrieval_tasks (id, question, constraints, depends_on, english_query, target_entry_ids), unresolved_targets, and optional synthesis_task.'
].join('\n');

export function buildPlannerPrompt(input: {
  question: string;
  scopeHint?: string;
  papers?: ReadonlyArray<{ id: string; title: string }>;
  libraryScope?: boolean;
}) {
  const scopeLine = input.scopeHint
    ? `Resolved scope hint (authoritative): ${input.scopeHint}`
    : 'No explicit scope was provided; scope is resolved by the host separately.';
  return [
    scopeLine,
    paperBindingBlock(input),
    `Frozen user question:\n${input.question}`,
    'Produce a retrieval plan for this question. Do not widen the scope hint.'
  ].filter(Boolean).join('\n\n');
}

function paperBindingBlock(input: {
  papers?: ReadonlyArray<{ id: string; title: string }>;
  libraryScope?: boolean;
}) {
  const papers = input.papers ?? [];
  if (input.libraryScope) {
    return [
      'Scope is the whole library. Do not list or invent paper ids; leave target_entry_ids empty.',
      'If the question names a specific paper that you cannot bind to a real library paper, put its name in unresolved_targets and do not create a task for it.'
    ].join('\n');
  }
  if (papers.length === 0) return '';
  if (papers.length > MAX_PLANNER_PAPERS) {
    return `${papers.length} papers are in scope. Their list is withheld; leave target_entry_ids empty.`;
  }
  return [
    'Selected papers (authoritative; the only valid target_entry_ids):',
    ...papers.map((paper) => `- ${paper.id}: ${paper.title}`)
  ].join('\n');
}

function isAbortLike(error: unknown, signal?: AbortSignal) {
  return signal?.aborted === true ||
    error instanceof AgentStoppedError ||
    (error instanceof Error && error.name === 'AbortError');
}

/**
 * Run the planner with bounded retries and a deterministic fallback. The model
 * is injected so this stays pure and testable; the caller wires `runJsonModelTask`.
 *
 * Validation problems get feedback and one retry. Provider failures degrade at once
 * as `model_unavailable`, and their raw messages never reach the model or the user.
 * Abort errors propagate unchanged.
 */
export async function planRetrieval({
  question,
  scopeHint,
  papers,
  libraryScope,
  runModel,
  maxAttempts = 2,
  abortSignal
}: {
  question: string;
  scopeHint?: string;
  papers?: ReadonlyArray<{ id: string; title: string }>;
  libraryScope?: boolean;
  runModel: (system: string, prompt: string) => Promise<unknown>;
  maxAttempts?: number;
  abortSignal?: AbortSignal;
}): Promise<PlanResolution> {
  const prompt = buildPlannerPrompt({ question, scopeHint, papers, libraryScope });
  let feedback = '';
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let output: unknown;
    try {
      output = await runModel(
        PLANNER_SYSTEM_PROMPT,
        feedback ? `${prompt}\n\nThe previous plan was invalid: ${feedback}\nReturn corrected JSON only.` : prompt
      );
    } catch (error) {
      if (isAbortLike(error, abortSignal)) throw error;
      return { status: 'degraded', plan: fallbackDirectPlan(question, 'model_unavailable').plan, reason: 'model_unavailable', attempts: attempt + 1 };
    }
    const result = validatePlanningOutput(output, question);
    if (result.ok) return { status: 'planned', plan: result.plan, attempts: attempt + 1 };
    feedback = result.issues.join('; ').slice(0, 1_000);
  }
  return { status: 'degraded', plan: fallbackDirectPlan(question, 'plan_invalid').plan, reason: 'plan_invalid', attempts: maxAttempts };
}

export const HOP2_RESOLVE_TASK_NAME = 'retrieval_hop2_resolve';

export const HOP2_RESOLVE_TASK_DESCRIPTION =
  'Rewrite a dependent hop-2 retrieval sub-question using concrete entities found in hop-1 evidence.';

const dependentTaskResolutionSchema = z.object({
  question: z.string().trim().min(1).max(500),
  english_query: z.string().trim().min(1).max(500).optional()
});

export type DependentTaskResolution = z.infer<typeof dependentTaskResolutionSchema>;

export type DependencyEvidenceItem = {
  task_id: string;
  entry_title: string;
  snippet: string;
  surrounding_context?: string;
};

const HOP2_RESOLVE_SYSTEM_PROMPT = [
  'You instantiate a dependent hop-2 academic paper search query using concrete facts retrieved in hop-1.',
  'Replace vague placeholders (such as "that dataset", "the method proposed in Paper A") with the exact named entities, benchmarks, metrics, or authors found in the hop-1 evidence.',
  'Never invent entities not supported by the hop-1 evidence, and never widen the question scope.',
  'Optionally provide a concise English academic english_query when question is in Chinese.',
  'Return JSON only with keys: question (string) and optional english_query (string).'
].join('\n');

export function buildHop2ResolvePrompt(input: {
  originalQuestion: string;
  task: RetrievalTask;
  dependencyEvidence: ReadonlyArray<DependencyEvidenceItem>;
}) {
  const evidenceLines = input.dependencyEvidence
    .slice(0, 5)
    .map((item, idx) => {
      const ctx = item.surrounding_context ? ` | Context: ${item.surrounding_context.slice(0, 240)}` : '';
      return `${idx + 1}. [${item.task_id} | ${item.entry_title}] ${item.snippet.slice(0, 320)}${ctx}`;
    })
    .join('\n');
  return [
    `Original user question:\n${input.originalQuestion}`,
    `Dependent hop-2 task (${input.task.id}):\n${input.task.question}`,
    input.task.constraints.length > 0 ? `Constraints: ${input.task.constraints.join('; ')}` : '',
    `Hop-1 retrieved evidence:\n${evidenceLines}`,
    'Return JSON with the instantiated hop-2 search question.'
  ].filter(Boolean).join('\n\n');
}

/**
 * Instantiates a single hop-2 dependent retrieval task using hop-1 evidence.
 * Fails closed (`null`) on provider error or schema violation; abort errors propagate.
 */
export async function resolveDependentTaskQuery({
  originalQuestion,
  task,
  dependencyEvidence,
  runModel,
  abortSignal
}: {
  originalQuestion: string;
  task: RetrievalTask;
  dependencyEvidence: ReadonlyArray<DependencyEvidenceItem>;
  runModel: (system: string, prompt: string) => Promise<unknown>;
  abortSignal?: AbortSignal;
}): Promise<DependentTaskResolution | null> {
  if (dependencyEvidence.length === 0) return null;
  let output: unknown;
  try {
    output = await runModel(
      HOP2_RESOLVE_SYSTEM_PROMPT,
      buildHop2ResolvePrompt({ originalQuestion, task, dependencyEvidence })
    );
  } catch (error) {
    if (isAbortLike(error, abortSignal)) throw error;
    return null;
  }
  const parsed = dependentTaskResolutionSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}
