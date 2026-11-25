// @vitest-environment node
// Opt-in live evaluation of the assistant agent's tool-use behaviour.
//
//   NEUINK_LIVE_SETTINGS=<path to app settings.json> \
//   npm --workspace apps/desktop run eval:assistant-tools
//
// This measures whether the agent can choose and call tools. Tool implementations are deterministic
// fixtures; credentials are read in memory and never printed or written to the report.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LlmProfile } from '@/shared/ipc/assistantApi';

vi.mock('@tauri-apps/plugin-http', async () => (await import('./mocks')).tauriHttpFactory());
vi.mock('@/shared/ipc/assistantApi', async importOriginal =>
  (await import('./mocks')).assistantApiFactory(importOriginal)
);
vi.mock('@/shared/ipc/researchApi', async importOriginal =>
  (await import('./mocks')).researchApiFactory(importOriginal)
);
vi.mock('@/shared/ipc/pdfTextApi', async importOriginal =>
  (await import('./mocks')).pdfTextApiFactory(importOriginal)
);
vi.mock('@/shared/ipc/workspaceApi', async importOriginal =>
  (await import('./mocks')).workspaceApiFactory(importOriginal)
);
vi.mock('@/shared/ipc/browserApi', async importOriginal =>
  (await import('./mocks')).browserApiFactory(importOriginal)
);
vi.mock('../sdk/agentDriver', async importOriginal =>
  (await import('./mocks')).agentDriverFactory(importOriginal)
);
vi.mock('../sdk/tools', async importOriginal =>
  (await import('./mocks')).toolRuntimeFactory(importOriginal)
);
vi.mock('../sdk/provider', async importOriginal =>
  (await import('./mocks')).providerFactory(importOriginal)
);

import { runScenario, selectScenarios } from './harness';
import { formatScorecard, writeReport } from './report';
import { evalState } from './evalState';
import { evaluationProfile, evaluationRepeats } from './liveSettings';
import type { ScenarioResult } from './types';

const settingsPath = process.env.NEUINK_LIVE_SETTINGS;

async function liveProfile(): Promise<LlmProfile> {
  if (!settingsPath) throw new Error('NEUINK_LIVE_SETTINGS is not set');
  const saved = JSON.parse(await readFile(settingsPath, 'utf8')) as {
    assistant_llm_profile_id?: string;
    llm_profiles: LlmProfile[];
  };
  const selectedId = process.env.NEUINK_LIVE_PROFILE_ID ?? saved.assistant_llm_profile_id;
  const profile = saved.llm_profiles.find(item => item.id === selectedId);
  if (!profile?.api_key) throw new Error('No configured assistant profile credential available');
  return evaluationProfile(profile);
}

describe.skipIf(!settingsPath)('assistant agent tool-use evaluation', () => {
  const cases = selectScenarios().flatMap(scenario => Array.from({ length: evaluationRepeats() },
    (_, index) => ({ scenario, attempt: index + 1, label: `${scenario.id} (attempt ${index + 1})` })));
  const results: ScenarioResult[] = [];
  const reportPath = process.env.NEUINK_EVAL_REPORT ?? fileURLToPath(
    new URL('../../../../../../target/assistant-evals/latest.json', import.meta.url));
  let settings: LlmProfile;

  beforeAll(async () => {
    settings = await liveProfile();
    console.log(`Model: ${settings.model}; output tokens: ${settings.max_output_tokens ?? 'provider default'}; ${cases.length} run(s)`);
    await writeReport([], reportPath, { plannedTotal: cases.length, model: settings.model,
      protocol: settings.api_protocol, maxOutputTokens: settings.max_output_tokens,
      temperature: settings.temperature, topP: settings.top_p });
  });
  afterAll(() => console.log(formatScorecard(results)));

  for (const { scenario, attempt, label } of cases) {
    it(label, async () => {
      console.log(`[START ${results.length + 1}/${cases.length}] ${label}`);
      const started = Date.now();
      const heartbeat = setInterval(() => {
        const turn = evalState.turns[evalState.turns.length - 1];
        const call = evalState.calls[evalState.calls.length - 1];
        console.log(`[RUNNING] ${label} ${Math.round((Date.now() - started) / 1000)}s; ` +
          `turn=${turn ? `${turn.phase}:${turn.turn}:${turn.status}` : 'initializing'}; ` +
          `last tool=${call ? `${call.name}:${call.status}` : 'none'}`);
      }, 15_000);
      try {
        const result = { ...await runScenario(scenario, settings), attempt };
        results.push(result);
        await writeReport(results, reportPath, { plannedTotal: cases.length, model: settings.model,
          protocol: settings.api_protocol, maxOutputTokens: settings.max_output_tokens,
          temperature: settings.temperature, topP: settings.top_p });
        console.log(formatScorecard([result]));
        expect(result.checks.filter(check => !check.ok)).toEqual([]);
      } finally {
        clearInterval(heartbeat);
      }
    }, (scenario.slow ? 300_000 : 180_000) + 15_000);
  }
});
