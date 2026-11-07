import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ScenarioResult } from './types';

export function formatScorecard(results: ScenarioResult[]) {
  const total = results.length;
  const passed = results.filter(result => result.passed).length;
  const lines = [
    '',
    `Assistant tool-use evaluation — ${passed}/${total} scenarios passed`,
    '='.repeat(72)
  ];
  const categories = new Map<string, { passed: number; total: number }>();
  for (const result of results) {
    const category = categories.get(result.scenario.category) ?? { passed: 0, total: 0 };
    category.total += 1;
    if (result.passed) category.passed += 1;
    categories.set(result.scenario.category, category);
    lines.push(
      `${result.passed ? '[PASS]' : '[FAIL]'} ${result.scenario.id} (${result.scenario.category}, ` +
        `${result.run.calls.length} call(s), ${(result.durationMs / 1000).toFixed(1)}s)`
    );
    if (!result.passed) {
      for (const check of result.checks.filter(item => !item.ok)) {
        lines.push(`   ✗ ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
      }
      const calls = result.run.calls
        .map(call => `${call.phase}:${call.name} (${call.status})`)
        .join(', ');
      if (calls) lines.push(`   calls: ${calls}`);
      if (result.run.error) lines.push(`   error: ${result.run.error}`);
    }
  }
  lines.push('-'.repeat(72));
  for (const [category, value] of [...categories.entries()].sort()) {
    lines.push(`${category}: ${value.passed}/${value.total}`);
  }
  lines.push('');
  return lines.join('\n');
}

type ReportMetadata = {
  plannedTotal?: number; model?: string; protocol?: string | null;
  maxOutputTokens?: number | null; temperature?: number | null; topP?: number | null;
};

export function reportData(results: ScenarioResult[], metadata: ReportMetadata = {}) {
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    configuration: metadata,
    complete: results.length === (metadata.plannedTotal ?? results.length),
    passed: results.filter(result => result.passed).length,
    total: results.length,
    scenarios: results.map(result => ({
      id: result.scenario.id,
      attempt: result.attempt ?? 1,
      title: result.scenario.title,
      category: result.scenario.category,
      passed: result.passed,
      durationMs: result.durationMs,
      error: result.run.error ?? null,
      answer: result.run.answer,
      calls: result.run.calls.map(call => ({
        id: call.id,
        name: call.name,
        status: call.status,
        phase: call.phase,
        turn: call.turn,
        input: call.input,
        error: call.error ?? null,
        errorCode: call.errorCode ?? null,
        output: call.output
      })),
      turns: result.run.turns,
      toolEvents: result.run.toolEvents,
      sourceLedgers: result.run.sourceLedgers ?? [],
      proposals: result.run.noteProposals.map(proposal => ({
        action: proposal.action,
        id: proposal.id,
        markdown: proposal.markdown,
        sources: proposal.sources.length
      })),
      entryMetaProposals: result.run.entryMetaProposals.map(proposal => ({
        entryId: proposal.entryId,
        fields: proposal.fields,
        sources: proposal.sources.length
      })),
      tagProposals: result.run.tagProposals.map(proposal => ({
        action: proposal.action,
        entryIds: proposal.entryIds,
        name: proposal.name ?? null
      })),
      checks: result.checks
    }))
  };
}

export async function writeReport(results: ScenarioResult[], path: string, metadata: ReportMetadata = {}) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(reportData(results, metadata), null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}
