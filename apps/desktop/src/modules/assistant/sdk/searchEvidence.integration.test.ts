import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invokeAssistantTool, type ScopeSnapshot } from '@/shared/ipc/assistantApi';
import type { SearchHit, SearchResults } from '@/shared/ipc/workspaceApi';

import { executeTool, normalizeToolInput } from './toolSupport';

vi.mock('@/shared/ipc/assistantApi', async original => ({
  ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  invokeAssistantTool: vi.fn()
}));

const scope = { entry_ids: ['paper-a', 'paper-b'], entry_titles: ['Paper A', 'Paper B'] } as unknown as ScopeSnapshot;

type HitSpec = {
  entry: string;
  segment: string;
  score: number;
  text: string;
  sectionId?: string | null;
  sectionPath?: string | null;
  kind?: 'segment' | 'note';
};

function hit(spec: HitSpec): SearchHit {
  return {
    entry_id: spec.entry,
    entry_title: spec.entry,
    matched_terms: [],
    score: spec.score,
    snippet: spec.text,
    title: spec.text,
    source: {
      kind: 'segment',
      label: spec.text,
      field_name: null,
      tag_id: null,
      note_id: null,
      segment_uid: spec.segment,
      page_idx: 0,
      section_id: spec.sectionId ?? null,
      section_path: spec.sectionPath ?? null
    },
    target: { kind: 'segment', entry_id: spec.entry, segment_uid: spec.segment, page_idx: 0 } as SearchHit['target']
  } as SearchHit;
}

/** Groups hits by Entry, as the backend returns them. */
function results(hits: HitSpec[], warnings?: string[], mode = 'keyword'): SearchResults {
  const groups = new Map<string, SearchHit[]>();
  for (const spec of hits) {
    groups.set(spec.entry, [...(groups.get(spec.entry) ?? []), hit(spec)]);
  }
  return {
    query: 'q',
    mode,
    index_generation: 1,
    total_hit_count: hits.length,
    warnings,
    entries: [...groups].map(([entry, entryHits]) => ({
      entry_id: entry,
      entry_title: entry,
      hit_count: entryHits.length,
      max_score: Math.max(...entryHits.map((item) => item.score)),
      hits: entryHits
    }))
  };
}

/** Runs the same normalize → invoke → format path that the assistant uses for a model tool call. */
async function runSearch(args: Record<string, unknown>, backend: SearchResults) {
  vi.mocked(invokeAssistantTool).mockResolvedValueOnce(backend);
  let markers = 0;
  const normalized = normalizeToolInput('search_segments', { query: 'q', ...args }, { root: 'root', scope });
  const output = await executeTool('search_segments', normalized as never, {
    addSource: () => ++markers,
    contextBudget: 10_000
  });
  const invokedArgs = vi.mocked(invokeAssistantTool).mock.lastCall?.[1] as Record<string, unknown>;
  const evidence = (output.modelOutput as { evidence: Array<{ entry_id: string; segment_uid: string; score: number; snippet: string }> }).evidence;
  return { output, evidence, invokedArgs };
}

const segmentsOf = (evidence: Array<{ segment_uid: string }>) => evidence.map((item) => item.segment_uid);

describe('search_segments evidence path (invoke → format → select)', () => {
  beforeEach(() => {
    vi.mocked(invokeAssistantTool).mockReset();
  });

  it('forwards an explicit section_filter to the backend and disables the crowding penalty', async () => {
    const methods: HitSpec[] = [
      { entry: 'paper-a', segment: 'm1', score: 1, text: 'alphaone betaone', sectionId: 'methods', sectionPath: 'Methods' },
      { entry: 'paper-a', segment: 'm2', score: 0.95, text: 'gammatwo deltatwo', sectionId: 'methods', sectionPath: 'Methods' },
      { entry: 'paper-a', segment: 'm3', score: 0.9, text: 'epsilonthree zetathree', sectionId: 'methods', sectionPath: 'Methods' },
      { entry: 'paper-a', segment: 'r1', score: 0.85, text: 'etafour thetafour', sectionId: 'results', sectionPath: 'Results' }
    ];

    const filtered = await runSearch({ section_filter: 'Methods' }, results(methods));
    expect(filtered.invokedArgs.section_filter).toBe('Methods');
    expect(segmentsOf(filtered.evidence)).toEqual(['m1', 'm2', 'm3', 'r1']);

    const unfiltered = await runSearch({}, results(methods));
    expect(unfiltered.invokedArgs).not.toHaveProperty('section_filter');
    // Without the filter the third Methods hit is penalized below the Results hit.
    expect(segmentsOf(unfiltered.evidence)).toEqual(['m1', 'm2', 'r1', 'm3']);
  });

  it('does not let the same section name in another paper suppress evidence', async () => {
    const hits: HitSpec[] = [
      { entry: 'paper-a', segment: 'a1', score: 1, text: 'alphaone betaone', sectionId: 'intro', sectionPath: 'Introduction' },
      { entry: 'paper-a', segment: 'a2', score: 0.95, text: 'gammatwo deltatwo', sectionId: 'intro', sectionPath: 'Introduction' },
      { entry: 'paper-a', segment: 'a3', score: 0.9, text: 'epsilonthree zetathree', sectionId: 'intro', sectionPath: 'Introduction' },
      { entry: 'paper-b', segment: 'b1', score: 0.85, text: 'etafour thetafour', sectionId: 'intro', sectionPath: 'Introduction' }
    ];
    const { evidence } = await runSearch({}, results(hits));
    // Paper B's Introduction must not inherit paper A's count of 2, so b1 ranks ahead of a3.
    expect(segmentsOf(evidence)).toEqual(['a1', 'a2', 'b1', 'a3']);
  });

  it('qualifies path-only sections by Entry so identical paths do not collide', async () => {
    const hits: HitSpec[] = [
      { entry: 'paper-a', segment: 'a1', score: 1, text: 'alphaone betaone', sectionPath: 'Introduction' },
      { entry: 'paper-a', segment: 'a2', score: 0.95, text: 'gammatwo deltatwo', sectionPath: 'Introduction' },
      { entry: 'paper-a', segment: 'a3', score: 0.9, text: 'epsilonthree zetathree', sectionPath: 'Introduction' },
      { entry: 'paper-b', segment: 'b1', score: 0.85, text: 'etafour thetafour', sectionPath: 'Introduction' }
    ];
    const { evidence } = await runSearch({}, results(hits));
    expect(segmentsOf(evidence)).toEqual(['a1', 'a2', 'b1', 'a3']);
  });

  it('applies no chapter penalty to hits that carry neither section_id nor section_path', async () => {
    const hits: HitSpec[] = [
      { entry: 'paper-a', segment: 'n1', score: 1, text: 'alphaone betaone' },
      { entry: 'paper-a', segment: 'n2', score: 0.95, text: 'gammatwo deltatwo' },
      { entry: 'paper-a', segment: 'n3', score: 0.9, text: 'epsilonthree zetathree' },
      { entry: 'paper-a', segment: 'r1', score: 0.85, text: 'etafour thetafour', sectionId: 'results' }
    ];
    const { evidence } = await runSearch({}, results(hits));
    expect(segmentsOf(evidence)).toEqual(['n1', 'n2', 'n3', 'r1']);
  });

  it('treats an empty section_id as absent instead of collapsing every section onto one key', async () => {
    const hits: HitSpec[] = [
      { entry: 'paper-a', segment: 'x1', score: 1, text: 'alphaone betaone', sectionId: '', sectionPath: null },
      { entry: 'paper-a', segment: 'x2', score: 0.95, text: 'gammatwo deltatwo', sectionId: '', sectionPath: null },
      { entry: 'paper-a', segment: 'x3', score: 0.9, text: 'epsilonthree zetathree', sectionId: '', sectionPath: null }
    ];
    const { evidence } = await runSearch({}, results(hits));
    expect(segmentsOf(evidence)).toEqual(['x1', 'x2', 'x3']);
  });

  it('collapses a note and an annotation that cite the same segment into one evidence item', async () => {
    const hits: HitSpec[] = [
      { entry: 'paper-a', segment: 's1', score: 0.4, text: 'alphaone betaone' },
      { entry: 'paper-a', segment: 's1', score: 0.8, text: 'gammatwo deltatwo' },
      { entry: 'paper-a', segment: 's2', score: 0.6, text: 'epsilonthree zetathree' }
    ];
    const { evidence } = await runSearch({}, results(hits));
    expect(segmentsOf(evidence)).toEqual(['s1', 's2']);
    expect(evidence[0].score).toBe(0.8);
  });

  it('keeps warnings and the keyword-fallback notice through the formatted output', async () => {
    const leaky = 'Embedding unavailable at C:\\Private\\models\\secret.onnx; Authorization: Bearer secret-token';
    const hits: HitSpec[] = [{ entry: 'paper-a', segment: 's1', score: 1, text: 'alphaone betaone' }];
    const { output } = await runSearch({}, results(hits, [leaky], 'hybrid_fallback_keyword'));
    const modelOutput = output.modelOutput as { warnings: string[] };
    expect(modelOutput.warnings).toEqual([
      'Semantic search is unavailable. These are keyword fallback results, not semantic matches.',
      'Search reported a limitation. Use only the returned evidence; completeness is not guaranteed.'
    ]);
    expect(output.summary).toContain('keyword fallback results');
    expect(JSON.stringify(output)).not.toMatch(/Private|secret|Authorization|secret-token/);
  });

  it('returns the same order for equal scores on every run and keeps backend order on ties', async () => {
    const hits: HitSpec[] = [
      { entry: 'paper-a', segment: 't1', score: 0.5, text: 'alphaone betaone' },
      { entry: 'paper-b', segment: 't2', score: 0.5, text: 'gammatwo deltatwo' },
      { entry: 'paper-a', segment: 't3', score: 0.5, text: 'epsilonthree zetathree' }
    ];
    const first = await runSearch({}, results(hits));
    const second = await runSearch({}, results(hits));
    expect(segmentsOf(first.evidence)).toEqual(segmentsOf(second.evidence));
    // Entry grouping puts paper-a (t1, t3) before paper-b (t2); equal scores keep that backend order.
    expect(segmentsOf(first.evidence)).toEqual(['t1', 't3', 't2']);
  });

  it('treats non-finite backend scores as 0 without changing the other scores', async () => {
    const hits: HitSpec[] = [
      { entry: 'paper-a', segment: 'bad', score: Number.NaN, text: 'alphaone betaone' },
      { entry: 'paper-a', segment: 'good', score: 0.7, text: 'gammatwo deltatwo' }
    ];
    const { evidence } = await runSearch({}, results(hits));
    expect(segmentsOf(evidence)).toEqual(['good', 'bad']);
  });
});
