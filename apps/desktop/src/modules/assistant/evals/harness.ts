import { readFile } from 'node:fs/promises';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import type { AgentRuntimeSettings } from '@/shared/types/agentRuntime';
import { buildDirectExecution } from '../runtime/executionPolicy';
import { answerWithGroundedAgent } from '../sdk/qna';
import {
  ASSISTANT_TOOL_DESCRIPTORS,
  defaultInvokeHandlers,
  defaultResearchHandlers,
  defaultPdfFixtures,
  ENTRIES
} from './fixtures';
import { evalState, resetEvalState } from './evalState';
import { SCENARIOS } from './scenarios';
import { passed, scoreRun } from './score';
import { evalError } from './diagnostics';
import type { EvalRun, Scenario, ScenarioResult } from './types';

const PROMPTS_URL = new URL('../../../../../../crates/neuink-ipc/prompts/', import.meta.url);
const SCOPE = {
  entry_ids: [ENTRIES.attention.id, ENTRIES.diffusion.id, ENTRIES.scanned.id],
  entry_titles: [ENTRIES.attention.title, ENTRIES.diffusion.title, ENTRIES.scanned.title],
  tag_ids: [],
  tag_names: []
};

export async function ensurePromptFixtures() {
  if (evalState.prompts.size > 0) return;
  for (const name of ['qna_system', 'qna_context', 'qna_user']) {
    evalState.prompts.set(name, await readFile(new URL(`${name}.md`, PROMPTS_URL), 'utf8'));
  }
}

function installFixtures(scenario: Scenario) {
  resetEvalState();
  const fixtures = scenario.setup?.fixtures ?? {};
  evalState.descriptors = [...ASSISTANT_TOOL_DESCRIPTORS];
  for (const [name, handler] of Object.entries(defaultInvokeHandlers())) {
    evalState.invoke.set(name, handler);
  }
  for (const [name, handler] of Object.entries(defaultResearchHandlers())) {
    evalState.research.set(name, handler);
  }
  for (const [name, handler] of Object.entries(fixtures.invoke ?? {})) {
    evalState.invoke.set(name, handler);
  }
  for (const [name, handler] of Object.entries(fixtures.research ?? {})) {
    evalState.research.set(name, handler);
  }
  for (const [entryId, fixture] of Object.entries({ ...defaultPdfFixtures(), ...fixtures.pdf })) {
    evalState.pdf.set(entryId, fixture);
  }
  for (const [key, note] of Object.entries(fixtures.notes ?? {})) {
    evalState.notes.set(key, note);
  }
  evalState.browserTab = scenario.setup?.browserTab ?? null;
}

export async function runScenario(
  scenario: Scenario,
  settings: LlmProfile,
  options: { timeoutMs?: number } = {}
): Promise<ScenarioResult> {
  await ensurePromptFixtures();
  installFixtures(scenario);
  scenario.setup?.beforeRun?.();
  const runtimeSettings: AgentRuntimeSettings =
    scenario.setup?.runtimeSettings ?? structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
  const activeExecution = scenario.setup?.activeExecution ?? { agent: runtimeSettings.mainAssistant };
  const derived = buildDirectExecution(runtimeSettings, scenario.prompt);
  const plan = scenario.setup?.plan ?? derived.plan;
  const invocationPlan = scenario.setup?.invocationPlan ?? derived.invocationPlan;
  const started = Date.now();
  const approval = scenario.setup?.approval;
  const requestToolApproval =
    approval === 'approve'
      ? async () => true
      : approval === 'deny'
        ? async () => false
        : undefined;
  let run: EvalRun;

  try {
    const result = await answerWithGroundedAgent({
      root: 'eval-workspace',
      scope: scenario.setup?.scope ?? SCOPE,
      settings,
      profiles: [settings],
      runtimeSettings,
      activeExecution,
      plan,
      invocationPlan,
      applicationActions: scenario.setup?.applicationActions,
      requestToolApproval,
      browserTabTarget: scenario.setup?.browserTabTarget ?? null,
      assistantContext: scenario.setup?.assistantContext ?? null,
      contextSnapshot: scenario.setup?.contextSnapshot ?? null,
      currentNote: scenario.setup?.currentNote ?? null,
      currentEntry: scenario.setup?.currentEntry ?? null,
      availableEntries: scenario.setup?.availableEntries ?? [],
      harnessBrief: scenario.setup?.harnessBrief,
      question: scenario.prompt,
      abortSignal: AbortSignal.timeout(options.timeoutMs ?? (scenario.slow ? 300_000 : 180_000))
    });
    run = {
      answer: result.answer,
      calls: [...evalState.calls],
      turns: [...evalState.turns],
      noteProposals: result.noteProposals ?? [],
      entryMetaProposals: result.entryMetaProposals ?? [],
      tagProposals: result.tagProposals ?? [],
      toolEvents: result.toolEvents ?? []
    };
  } catch (error) {
    run = {
      answer: '',
      calls: [...evalState.calls],
      turns: [...evalState.turns],
      noteProposals: [...evalState.noteProposals],
      entryMetaProposals: [...evalState.entryMetaProposals],
      tagProposals: [...evalState.tagProposals],
      toolEvents: [...evalState.toolEvents.values()],
      error: evalError(error)
    };
  }

  run.sourceLedgers = evalState.ledgers.map(ledger => ({ actorId: ledger.actorId, sources: [...ledger.sources] }));

  if (evalState.fixtureErrors.length > 0) {
    run.error = [run.error, `fixture errors: ${evalState.fixtureErrors.join('; ')}`]
      .filter(Boolean)
      .join(' | ');
  }

  const checks = scoreRun(scenario, run);
  return {
    scenario,
    run,
    checks,
    passed: passed(checks),
    durationMs: Date.now() - started
  };
}

export function selectScenarios(environment = process.env): Scenario[] {
  const requested = (environment.NEUINK_EVAL_SCENARIOS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const includeSlow = environment.NEUINK_EVAL_INCLUDE_SLOW === '1';
  const unknown = requested.filter(id => !SCENARIOS.some(scenario => scenario.id === id));
  if (unknown.length) throw new Error(`Unknown evaluation scenario(s): ${unknown.join(', ')}`);
  const scenarios = SCENARIOS.filter(scenario => {
    if (requested.length > 0) return requested.includes(scenario.id);
    return includeSlow || !scenario.slow;
  });
  if (!scenarios.length) throw new Error('No evaluation scenarios selected');
  return scenarios;
}

export async function runSuite(
  settings: LlmProfile,
  scenarios = selectScenarios()
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario, settings));
  }
  return results;
}

export { SCENARIOS };
