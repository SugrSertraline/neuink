// @vitest-environment node
// Opt-in: only synthetic text is sent; credentials and provider responses stay in memory.
import { readFile } from 'node:fs/promises';
import { it, vi } from 'vitest';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { generateFoldBatch } from './foldGeneration';
const diagnostic = vi.hoisted(() => ({ phase: 'start', status: 0, maxTokens: 0, structured: false, rows: [] as unknown[] }));
vi.mock('@/modules/assistant/sdk/modelTasks', async importOriginal => {
  const actual = await importOriginal<typeof import('@/modules/assistant/sdk/modelTasks')>();
  return { ...actual, runJsonModelTask: async (options: Parameters<typeof actual.runJsonModelTask>[0]) => {
    const output = await actual.runJsonModelTask(options) as { units?: Array<Record<string, unknown>> };
    diagnostic.rows = Array.isArray(output?.units) ? output.units.map(row => ({
      idValid: typeof row.id === 'string' && /^U\d+$/.test(row.id),
      takeaway: typeof row.takeaway === 'string' && Boolean(row.takeaway.trim()),
      topic: typeof row.topic === 'string' && Boolean(row.topic.trim()),
      topicIsSpan: typeof row.takeaway === 'string' && typeof row.topic === 'string' && row.takeaway.includes(row.topic),
      topicCaseSpan: typeof row.takeaway === 'string' && typeof row.topic === 'string' && row.takeaway.toLowerCase().includes(row.topic.toLowerCase()),
      evidence: Array.isArray(row.evidence) ? row.evidence.filter(value => typeof value === 'number') : null,
    })) : [];
    return output;
  } };
});
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: async (url: string, init: RequestInit) => {
  diagnostic.phase = 'request';
  const body = JSON.parse(String(init.body));
  diagnostic.maxTokens = body.max_tokens ?? 0;
  diagnostic.structured = body.response_format?.type === 'json_object';
  const response = await globalThis.fetch(url, init);
  diagnostic.phase = 'response'; diagnostic.status = response.status;
  return response;
} }));
const settingsPath = process.env.NEUINK_LIVE_SETTINGS;
it.skipIf(!settingsPath)('generates validated reading levels with the configured assistant model', async () => {
  const settings = JSON.parse(await readFile(settingsPath!, 'utf8')) as { llm_profiles: LlmProfile[]; assistant_llm_profile_id: string };
  const profile = settings.llm_profiles.find(item => item.id === settings.assistant_llm_profile_id);
  if (!profile) throw new Error('No assistant profile configured');
  const sentences = [
    'The fictional experiment compared two scheduling methods using the same simulated factory.',
    'The adaptive method reduced the average waiting time from twenty minutes to fifteen minutes.',
    'Both methods processed the same number of jobs and used the same machine capacity.',
    'The improvement was observed only when the simulated workload varied over time.',
    'These synthetic results do not establish performance in a real manufacturing facility.',
  ];
  try {
    const output = await generateFoldBatch({ profile, signal: AbortSignal.timeout(110_000), batch: [
      { segmentUid: 'synthetic-a', pageIndex: 0, source: sentences.join(' '), sentences },
    ] });
    if (output.results.length !== 1 || output.failedSegmentUids.length) throw new Error('FOLD_VALIDATION_FAILED');
  } catch (error) {
    const e = error as { name?: string; statusCode?: number; message?: string };
    const kind = typeof e.name === 'string' && /^[A-Za-z_]{1,64}$/.test(e.name) ? e.name : 'unknown';
    const category = e.message === 'FOLD_VALIDATION_FAILED' ? 'validation' : /可解析|JSON/.test(e.message ?? '') ? 'json' : 'request';
    throw new Error(`Live folding failed: category=${category}, kind=${kind}, HTTP=${typeof e.statusCode === 'number' ? e.statusCode : diagnostic.status}, phase=${diagnostic.phase}, maxTokens=${diagnostic.maxTokens}, structured=${diagnostic.structured}, validation=${JSON.stringify(diagnostic.rows)} (details redacted).`);
  }
}, 115_000);
