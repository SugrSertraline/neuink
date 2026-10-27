import type {
  AssistantContextSnapshot,
  AssistantToolDescriptor,
  AssistantToolTraceEvent,
  ConversationSourceLink,
  ScopeSnapshot
} from '@/shared/ipc/assistantApi';
import type { BrowserTabSnapshot, BrowserTabTarget } from '@/shared/ipc/browserApi';
import type { ApplicationActions } from '../runtime/applicationActions';
import type { ModelMessage } from 'ai';
import type { AgentExecutionSelection, AgentRuntimeSettings } from '@/shared/types/agentRuntime';
import type {
  AgentInvocationPlan,
  AssistantActiveNote,
  AssistantContext,
  AssistantEntryMetaProposal,
  AssistantEntryMetaTarget,
  AssistantNoteProposal,
  AssistantTagProposal,
  AssistantTaskPlan
} from '@/shared/types/assistant';

/** A model-visible tool call, recorded before execution. */
export type EvalToolCall = {
  id: string;
  name: string;
  input: unknown;
  status: 'attempted' | 'succeeded' | 'failed' | 'rejected';
  output?: unknown;
  /** Set by the driver when the call was unavailable or failed schema validation. */
  error?: string;
  errorCode?: string;
  phase: 'main' | 'subagent';
  turn: number;
  /** Tool names declared to the model for this turn. */
  declaredTools: string[];
};

export type EvalTurn = {
  phase: 'main' | 'subagent';
  turn: number;
  declaredTools: string[];
  callCount: number;
  status?: 'running' | 'completed' | 'failed';
  durationMs?: number;
  text?: string;
  reasoningChars?: number;
  messages?: ModelMessage[];
  modelPrompt?: unknown;
  rawText?: string;
  finishReason?: string;
  usage?: unknown;
  error?: string;
};

export type EvalRun = {
  answer: string;
  calls: EvalToolCall[];
  turns: EvalTurn[];
  noteProposals: AssistantNoteProposal[];
  entryMetaProposals: AssistantEntryMetaProposal[];
  tagProposals: AssistantTagProposal[];
  toolEvents: AssistantToolTraceEvent[];
  sourceLedgers?: Array<{ actorId: string; sources: Array<[number, ConversationSourceLink]> }>;
  error?: string;
};

export type EvalCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type ArgumentCheck = {
  tool: string;
  description: string;
  /** `all` (default) requires every call to satisfy the rule; `any` requires one. */
  match?: 'all' | 'any';
  check: (input: Record<string, unknown>) => boolean;
};

export type ScenarioExpectation = {
  /** Every named tool must execute successfully at least once. */
  required?: string[];
  /** Includes execution/approval failures; use for intentional recovery scenarios. */
  attempted?: string[];
  /** Each inner array requires at least one of its tools. */
  anyOf?: string[][];
  /** No call (including rejected calls) may use these tools. */
  forbidden?: string[];
  /** These tools must not appear in the main agent's declared tool list. */
  forbiddenDeclared?: string[];
  /** These tools must appear as a subsequence of successful calls. */
  ordered?: string[];
  maxToolCalls?: number;
  /** Reject byte-identical repeated calls. */
  noDuplicateCalls?: boolean;
  /** Every call to `tool` must satisfy `check`. */
  arguments?: ArgumentCheck[];
  answerIncludes?: string[];
  answerExcludes?: string[];
  answerMatches?: RegExp;
  answerNotMatches?: RegExp;
  proposal?: {
    min?: number;
    max?: number;
    action?: string;
    markdownIncludes?: string[];
  };
  /** Escape hatch for behaviour that is easier to express in code. */
  extra?: Array<{ description: string; check: (run: EvalRun) => boolean }>;
};

export type FixtureHandler = (input: Record<string, unknown>) => unknown | Promise<unknown>;

export type PdfFixture = {
  revision: string;
  pageCount: number;
  pages: Array<{ page_idx: number; text: string; truncated: boolean }>;
};

export type NoteFixture = {
  title: string;
  markdown: string;
  links: Array<{
    entry_id: string;
    entry_title: string;
    note_id: string;
    note_title: string;
  }>;
};

export type ScenarioFixtures = {
  /** Overrides for `invokeAssistantTool` handlers, keyed by tool id. */
  invoke?: Record<string, FixtureHandler>;
  /** Overrides for `runResearchTool` handlers, keyed by tool id. */
  research?: Record<string, FixtureHandler>;
  /** PDF text-layer fixtures, keyed by entry id. */
  pdf?: Record<string, PdfFixture>;
  /** Markdown notes, keyed by `${entryId}:${noteId}`. */
  notes?: Record<string, NoteFixture>;
};

export type ScenarioSetup = {
  scope?: ScopeSnapshot;
  runtimeSettings?: AgentRuntimeSettings;
  activeExecution?: AgentExecutionSelection;
  /** Explicit plan; otherwise `buildDirectExecution` derives one from the prompt. */
  plan?: AssistantTaskPlan;
  invocationPlan?: AgentInvocationPlan;
  assistantContext?: AssistantContext | null;
  contextSnapshot?: AssistantContextSnapshot | null;
  currentNote?: AssistantActiveNote | null;
  currentEntry?: { id: string; title: string } | null;
  availableEntries?: AssistantEntryMetaTarget[];
  harnessBrief?: string;
  /** Host approval answer for tools with `needsApproval`; omitted means unavailable. */
  approval?: 'approve' | 'deny';
  applicationActions?: ApplicationActions;
  browserTabTarget?: BrowserTabTarget;
  browserTab?: BrowserTabSnapshot;
  /** Reset fixture-side recorders before the scenario runs. */
  beforeRun?: () => void;
  fixtures?: ScenarioFixtures;
};

export type Scenario = {
  id: string;
  title: string;
  category: string;
  prompt: string;
  /** Slow scenarios make additional nested model calls. */
  slow?: boolean;
  setup?: ScenarioSetup;
  expect: ScenarioExpectation;
};

export type ScenarioResult = {
  scenario: Scenario;
  run: EvalRun;
  checks: EvalCheck[];
  passed: boolean;
  durationMs: number;
  attempt?: number;
};

export type EvalToolDescriptor = AssistantToolDescriptor;
