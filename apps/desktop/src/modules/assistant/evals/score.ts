import type { EvalCheck, EvalRun, Scenario } from './types';
import { toolFingerprint } from '../agent-core/cycleGuard';

function callSucceeded(call: EvalRun['calls'][number]) {
  return call.status === 'succeeded' && call.error === undefined;
}

function regexTest(pattern: RegExp, value: string) {
  const flags = pattern.flags.replace('g', '').replace('y', '');
  return new RegExp(pattern.source, flags).test(value);
}

function preview(value: unknown, limit = 180) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Deterministic behavioural scoring. No model or tool implementation is invoked here. */
export function scoreRun(scenario: Scenario, run: EvalRun): EvalCheck[] {
  const checks: EvalCheck[] = [];
  const expect = scenario.expect;
  const successfulCalls = run.calls.filter(callSucceeded);
  const attempted = new Set(run.calls.map(call => call.name));
  const successfulNames = new Set(successfulCalls.map(call => call.name));

  const add = (name: string, ok: boolean, detail?: string) =>
    checks.push(ok ? { name, ok } : { name, ok, detail });

  add(
    'agent run completed without a host exception',
    run.error === undefined,
    run.error ? `host error: ${run.error}` : undefined
  );

  for (const tool of expect.required ?? []) {
    add(
      `calls ${tool}`,
      successfulNames.has(tool),
      attempted.has(tool) && !successfulNames.has(tool)
        ? `${tool} was attempted but did not succeed`
        : `attempted: ${[...attempted].join(', ') || '(none)'}`
    );
  }

  for (const tool of expect.attempted ?? []) {
    add(`attempts ${tool}`, attempted.has(tool), `attempted: ${[...attempted].join(', ') || '(none)'}`);
  }

  for (const group of expect.anyOf ?? []) {
    add(
      `calls one of ${group.join(' | ')}`,
      group.some(tool => successfulNames.has(tool)),
      `attempted: ${[...attempted].join(', ') || '(none)'}`
    );
  }

  for (const tool of expect.forbidden ?? []) {
    add(
      `does not call ${tool}`,
      !attempted.has(tool),
      attempted.has(tool) ? `${tool} was attempted` : undefined
    );
  }

  for (const tool of expect.forbiddenDeclared ?? []) {
    const leaked = run.turns.some(turn => turn.phase === 'main' && turn.declaredTools.includes(tool));
    add(`does not expose ${tool} to the model`, !leaked, leaked ? `${tool} was declared` : undefined);
  }

  if (expect.ordered?.length) {
    let cursor = 0;
    for (const tool of expect.ordered) {
      const index = successfulCalls.findIndex(
        (call, position) => position >= cursor && call.name === tool
      );
      if (index < 0) {
        add(`orders ${expect.ordered.join(' → ')}`, false, `missing ${tool} after position ${cursor}`);
        cursor = -1;
        break;
      }
      cursor = index + 1;
    }
    if (cursor >= 0) add(`orders ${expect.ordered.join(' → ')}`, true);
  }

  if (expect.maxToolCalls !== undefined) {
    add(
      `uses at most ${expect.maxToolCalls} tool calls`,
      run.calls.length <= expect.maxToolCalls,
      `${run.calls.length} call(s): ${run.calls.map(call => call.name).join(', ') || '(none)'}`
    );
  }

  if (expect.noDuplicateCalls) {
    const seen = new Map<string, number>();
    for (const call of run.calls) {
      const key = toolFingerprint(call.name, call.input);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
    add('does not repeat an identical call', duplicates.length === 0, duplicates.join('; '));
  }

  for (const rule of expect.arguments ?? []) {
    const matching = run.calls.filter(call => call.name === rule.tool);
    if (matching.length === 0) {
      add(`argument check (${rule.tool}): ${rule.description}`, true, 'tool not called; check not applicable');
      continue;
    }
    const failures = matching.filter(call => {
      const input =
        call.input && typeof call.input === 'object' && !Array.isArray(call.input)
          ? (call.input as Record<string, unknown>)
          : {};
      try {
        return !rule.check(input);
      } catch {
        return true;
      }
    });
    const ok = rule.match === 'any' ? failures.length < matching.length : failures.length === 0;
    add(
      `argument check (${rule.tool}): ${rule.description}`,
      ok,
      ok ? undefined : failures.map(call => preview(call.input)).join(' | ')
    );
  }

  for (const text of expect.answerIncludes ?? []) {
    add(`answer includes ${JSON.stringify(text)}`, run.answer.includes(text), preview(run.answer));
  }

  for (const text of expect.answerExcludes ?? []) {
    add(
      `answer does not include ${JSON.stringify(text)}`,
      !run.answer.includes(text),
      preview(run.answer)
    );
  }

  if (expect.answerMatches) {
    add(
      `answer matches ${expect.answerMatches}`,
      regexTest(expect.answerMatches, run.answer),
      preview(run.answer)
    );
  }

  if (expect.answerNotMatches) {
    add(
      `answer does not match ${expect.answerNotMatches}`,
      !regexTest(expect.answerNotMatches, run.answer),
      preview(run.answer)
    );
  }

  if (expect.proposal) {
    const rules = expect.proposal;
    const found = run.noteProposals;
    if (rules.min !== undefined) {
      add(`creates at least ${rules.min} note proposal(s)`, found.length >= rules.min, `${found.length} proposal(s)`);
    }
    if (rules.max !== undefined) {
      add(`creates at most ${rules.max} note proposal(s)`, found.length <= rules.max, `${found.length} proposal(s)`);
    }
    if (rules.action) {
      add(
        `proposal action is ${rules.action}`,
        found.every(proposal => proposal.action === rules.action),
        found.map(proposal => proposal.action).join(', ')
      );
    }
    for (const text of rules.markdownIncludes ?? []) {
      add(
        `proposal markdown includes ${JSON.stringify(text)}`,
        found.length > 0 && found.every(proposal => proposal.markdown.includes(text)),
        found.map(proposal => preview(proposal.markdown)).join(' | ')
      );
    }
  }

  for (const rule of expect.extra ?? []) {
    let ok = false;
    let detail: string | undefined;
    try {
      ok = rule.check(run);
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    add(rule.description, ok, detail);
  }

  return checks;
}

export function passed(checks: EvalCheck[]) {
  return checks.every(check => check.ok);
}
