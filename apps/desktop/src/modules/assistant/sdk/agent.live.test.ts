// @vitest-environment node
// Opt-in only. Credentials are read in memory; never copied into fixtures or output.
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { jsonSchema, tool, type ToolSet } from 'ai';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { Agent, RunBudget } from '../agent-core';
import { agentExecutors, createAgentDriver } from './agentDriver';
import { runJsonModelTask } from './modelTasks';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: globalThis.fetch }));
const settingsPath = process.env.NEUINK_LIVE_SETTINGS;

it.skipIf(!settingsPath)('live provider: parent delegates, child reads, both preserve citations; fixed task has no tools', async () => {
  const saved = JSON.parse(await readFile(settingsPath!, 'utf8')) as { llm_profiles: LlmProfile[]; assistant_llm_profile_id: string };
  const profile = saved.llm_profiles.find((item) => item.id === saved.assistant_llm_profile_id);
  if (!profile?.api_key) throw new Error('No configured assistant profile credential available');
  const settings = { ...profile, max_output_tokens: 2048, temperature: 0, top_p: null };
  const budget = new RunBudget(8, 4);
  const signal = AbortSignal.timeout(120_000);
  let reads = 0;
  let children = 0;
  const childTools: ToolSet = {
    read_evidence: tool({
      description: 'Read the fixture paper evidence.',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => { reads++; return { marker: '[S1]', text: 'The fictional trial enrolled 42 participants.' }; }
    })
  };
  const parentTools: ToolSet = {
    delegate: tool({
      description: 'Delegate the evidence question to the read-only child.',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => {
        children++;
        return new Agent({
          driver: createAgentDriver({ settings, tools: childTools, system: 'Call read_evidence once, then answer the question in one short sentence with the exact citation marker.' }),
          tools: agentExecutors(childTools), messages: [{ role: 'user', content: 'How many participants enrolled?' }], budget, signal,
          maxTurns: 3, verify: () => reads ? undefined : 'Call read_evidence first.'
        }).run();
      }
    })
  };
  try {
    const answer = await new Agent({
      driver: createAgentDriver({ settings, tools: parentTools, system: 'Call delegate once to get evidence. Then report the participant count in one sentence, preserving its [S1] citation.' }),
      tools: agentExecutors(parentTools), messages: [{ role: 'user', content: 'Delegate and tell me how many participants enrolled.' }], budget, signal,
      maxTurns: 3, verify: () => children ? undefined : 'Call delegate first.'
    }).run();
    expect(children).toBe(1);
    expect(reads).toBe(1);
    expect(answer).toContain('42');
    expect(answer).toContain('[S1]');
    const output = await runJsonModelTask({
      settings, name: 'translation_test', description: 'Translate one sentence, preserving its marker.',
      system: 'Return JSON only: {"translation":"Chinese translation including [S1]"}.',
      prompt: 'The trial enrolled 42 participants. [S1]', abortSignal: signal
    }) as { translation: string };
    expect(output.translation).toContain('42');
    expect(output.translation).toContain('[S1]');
  } catch {
    // SDK errors can carry request headers; intentionally do not print the cause.
    throw new Error('Live agent/structured-task verification failed (provider details redacted).');
  }
}, 150_000);
