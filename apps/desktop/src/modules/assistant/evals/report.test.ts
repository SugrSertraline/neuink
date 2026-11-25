// @vitest-environment node
import { mkdtemp, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { writeReport } from './report';
import type { ScenarioResult } from './types';

it('keeps a valid partial report and replaces it after each completed scenario', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'neuink-eval-report-'));
  const path = join(directory, 'report.json');
  try {
    await writeReport([], path, { plannedTotal: 1, model: 'scripted' });
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ complete: false, total: 0 });
    const result: ScenarioResult = {
      scenario: { id: 'example', title: 'Example', category: 'test', prompt: '', expect: {} },
      run: { answer: '', calls: [], turns: [], noteProposals: [], entryMetaProposals: [], tagProposals: [], toolEvents: [] },
      passed: true, durationMs: 1, checks: [], attempt: 2
    };
    await writeReport([result], path, { plannedTotal: 1, model: 'scripted' });
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ complete: true, passed: 1,
      scenarios: [{ id: 'example', attempt: 2 }] });
    expect(await readdir(directory)).toEqual(['report.json']);
  } finally {
    await unlink(path).catch(() => undefined);
    await rmdir(directory);
  }
});
