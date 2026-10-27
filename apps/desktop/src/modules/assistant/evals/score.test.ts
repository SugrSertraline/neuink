import { describe, expect, it } from 'vitest';
import { passed, scoreRun } from './score';
import type { EvalRun, EvalToolCall, Scenario } from './types';

function scenario(expectations: Scenario['expect']): Scenario {
  return {
    id: 'fixture',
    title: 'Fixture',
    category: 'test',
    prompt: 'Question',
    expect: expectations
  };
}

function run(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    answer: '',
    calls: [],
    turns: [],
    noteProposals: [],
    entryMetaProposals: [],
    tagProposals: [],
    toolEvents: [],
    ...overrides
  };
}

function call(name: string, input: unknown = {}, extra: Partial<EvalToolCall> = {}): EvalToolCall {
  return {
    id: `${name}-${JSON.stringify(input)}`,
    name,
    input,
    status: 'succeeded',
    phase: 'main' as const,
    turn: 1,
    declaredTools: [],
    ...extra
  };
}

describe('tool-use scoring', () => {
  it.each(['attempted', 'failed', 'rejected'] as const)('does not count a %s call as successful execution', status => {
    const checks = scoreRun(scenario({ required: ['import_papers'], attempted: ['import_papers'] }), run({
      calls: [call('import_papers', {}, { status })]
    }));
    expect(checks.find(check => check.name === 'calls import_papers')?.ok).toBe(false);
    expect(checks.find(check => check.name === 'attempts import_papers')?.ok).toBe(true);
  });

  it('does not treat rejected calls as a successful chain', () => {
    const checks = scoreRun(scenario({ ordered: ['search_segments', 'read_segment_content'] }), run({
      calls: [call('search_segments'), call('read_segment_content', {}, { status: 'rejected' })]
    }));
    expect(checks.find(check => check.name.startsWith('orders'))?.ok).toBe(false);
  });

  it('recognizes duplicate arguments independent of object property order', () => {
    const checks = scoreRun(scenario({ noDuplicateCalls: true }), run({ calls: [
      call('search_segments', { query: 'BLEU', top_k: 5 }),
      call('search_segments', { top_k: 5, query: 'BLEU' })
    ] }));
    expect(checks.find(check => check.name === 'does not repeat an identical call')?.ok).toBe(false);
  });
  it('requires successful calls and rejects driver-rejected calls', () => {
    const checks = scoreRun(scenario({ required: ['search_segments'] }), run({
      calls: [call('search_segments', {}, { error: 'TOOL_NOT_AVAILABLE' })]
    }));
    expect(checks.find(check => check.name === 'calls search_segments')?.ok).toBe(false);
  });

  it('fails forbidden tools even when the driver rejected the call', () => {
    const checks = scoreRun(scenario({ forbidden: ['search_web'] }), run({
      calls: [call('search_web', {}, { error: 'TOOL_NOT_AVAILABLE' })]
    }));
    expect(checks.find(check => check.name === 'does not call search_web')?.ok).toBe(false);
  });

  it('checks every call against argument rules', () => {
    const checks = scoreRun(
      scenario({
        arguments: [
          {
            tool: 'read_segment_content',
            description: 'reads the requested segment',
            check: input => input.segment_uid === 'attn-ablation'
          }
        ]
      }),
      run({
        calls: [
          call('read_segment_content', { segment_uid: 'attn-ablation' }),
          call('read_segment_content', { segment_uid: 'attn-method' })
        ]
      })
    );
    expect(checks.find(check => check.name.includes('reads the requested segment'))?.ok).toBe(false);
  });

  it('supports any-match argument rules for exploratory reads', () => {
    const checks = scoreRun(
      scenario({
        arguments: [
          {
            tool: 'read_segment_content',
            description: 'reads the target segment at least once',
            match: 'any',
            check: input => input.segment_uid === 'attn-ablation'
          }
        ]
      }),
      run({
        calls: [
          call('read_segment_content', { segment_uid: 'attn-ablation' }),
          call('read_segment_content', { segment_uid: 'attn-results' })
        ]
      })
    );
    expect(checks.find(check => check.name.includes('at least once'))?.ok).toBe(true);
  });

  it('enforces ordering, duplicate suppression, and answer constraints', () => {
    const checks = scoreRun(
      scenario({
        ordered: ['search_segments', 'read_segment_content'],
        noDuplicateCalls: true,
        answerIncludes: ['28.4'],
        answerExcludes: ['fabricated'],
        answerMatches: /\[S\d+]/
      }),
      run({
        answer: 'The result is 28.4 BLEU [S1].',
        calls: [
          call('search_segments', { query: 'bleu' }),
          call('search_segments', { query: 'bleu' }),
          call('read_segment_content', { segment_uid: 'attn-results' })
        ]
      })
    );
    expect(checks.find(check => check.name.startsWith('orders'))?.ok).toBe(true);
    expect(checks.find(check => check.name === 'does not repeat an identical call')?.ok).toBe(false);
    expect(checks.find(check => check.name.includes('28.4'))?.ok).toBe(true);
    expect(checks.find(check => check.name.includes('fabricated'))?.ok).toBe(true);
    expect(checks.find(check => check.name.startsWith('answer matches'))?.ok).toBe(true);
    expect(passed(checks)).toBe(false);
  });

  it('validates proposal count, action, markdown, and inline markers', () => {
    const checks = scoreRun(
      scenario({
        proposal: { min: 1, max: 1, action: 'create', markdownIncludes: ['28.4'] },
        extra: [
          {
            description: 'cites inline',
            check: value => value.noteProposals.every(proposal => /\[S\d+]/.test(proposal.markdown))
          }
        ]
      }),
      run({
        noteProposals: [
          {
            action: 'create',
            createdAt: '2026-01-01T00:00:00.000Z',
            entryId: 'paper-attn',
            entryTitle: 'Attention',
            id: 'proposal-1',
            markdown: 'The big model reached 28.4 BLEU [S1].',
            sources: [],
            status: 'pending',
            title: 'Note'
          }
        ]
      })
    );
    expect(passed(checks)).toBe(true);
  });

  it('reports a host exception as a failed run', () => {
    const checks = scoreRun(scenario({}), run({ error: 'agent stopped' }));
    expect(checks.find(check => check.name.includes('host exception'))?.ok).toBe(false);
  });

  it('rejects tools the main agent should not declare', () => {
    const checks = scoreRun(scenario({ forbiddenDeclared: ['read_webpage'] }), run({
      turns: [{ phase: 'main', turn: 1, declaredTools: ['search_segments', 'read_webpage'], callCount: 0 }]
    }));
    expect(checks.find(check => check.name.includes('read_webpage'))?.ok).toBe(false);
  });
});
