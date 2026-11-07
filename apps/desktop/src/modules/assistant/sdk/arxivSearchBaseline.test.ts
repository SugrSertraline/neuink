import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { isResearchTool, researchPapersFromResult, runResearchTool } from '@/shared/ipc/researchApi';
import { normalizeToolInput, executeTool } from './toolSupport';
import { researchOutput } from './researchOutput';
import { paperPresentationError, paperRecords } from '../research/paperPresentation';
import { returnedExternalCitationUrls } from './citationContract';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const scope = { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] };
const paper = (index: number) => ({
  id: `arxiv:2401.${String(index).padStart(5, '0')}v2`, title: `Fixture ${index}`,
  authors: Array.from({ length: 14 }, (_, i) => `Author ${i + 1}`), year: '2024',
  abstract_text: 'x'.repeat(6000), doi: '', url: `https://arxiv.org/abs/2401.${String(index).padStart(5, '0')}v2`,
  pdf_url: `https://arxiv.org/pdf/2401.${String(index).padStart(5, '0')}v2`,
  provider: 'arxiv', evidence_level: 'abstract', categories: ['cs.LG'],
  primary_category: 'cs.LG', published: '2024-01-01T00:00:00Z', updated: '2024-01-02T00:00:00Z'
});
function evidence(caseId: string, actual: unknown) {
  console.log(`BASELINE_JSON ${JSON.stringify({ case_id: caseId, actual })}`);
}
beforeEach(() => vi.clearAllMocks());

it('B-P2-01 existing normalizer preserves query and overrides model workspace', () => {
  const input = { root: 'model-workspace', query: 'ti:"A & B" OR abs:"中文 \\ test"', source: 'arxiv', limit: 10 };
  const actual = normalizeToolInput('search_papers', input, { root: 'host-workspace', scope });
  evidence('B-P2-01', { input, output: actual });
  expect(actual).toEqual({ ...input, root: 'host-workspace' });
  expect(input.root).toBe('model-workspace');
});

it('B-P2-02 real IPC wrapper transports structured fields without validating them', async () => {
  const args = { mode: 'structured', keywords: ['LLM', 'large language model'], categories: ['cs.AI', 'cs.LG'],
    sort_by: 'lastUpdatedDate', sort_order: 'ascending', start: 20, page_size: 20, max_results: 40, days_back: 7 };
  vi.mocked(invoke).mockResolvedValue({ papers: [] });
  await runResearchTool('search_papers', { root: 'fixture-workspace', ...args });
  const actual = vi.mocked(invoke).mock.calls[0];
  evidence('B-P2-02', { command: actual[0], request: actual[1], native_backend: 'mocked' });
  expect(actual).toEqual(['run_research_tool', { request: {
    root: 'fixture-workspace', name: 'search_papers', args, call_id: expect.any(String), approval_id: undefined
  } }]);
});

it('T-STEP5-A1 arxiv_search is registered as a research tool', () => {
  const actual = { search_papers: isResearchTool('search_papers'), arxiv_search: isResearchTool('arxiv_search') };
  evidence('B-A1-01', actual);
  expect(actual).toEqual({ search_papers: true, arxiv_search: true });
});

it.each([0, 1, 20, 21, 30, 31, 100, 1000])('T-STEP1-P10-01 preserves %i fixture papers', async count => {
  const started = performance.now();
  const before = process.memoryUsage();
  const papers = Array.from({ length: count }, (_, i) => paper(i + 1));
  vi.mocked(invoke).mockResolvedValue({ papers, retrieved_at: '2026-10-19T00:00:00Z' });
  const output = await executeTool('search_papers', { root: 'fixture-workspace', query: 'fixture' }, {
    addSource: () => 1, contextBudget: 8000
  });
  const model = output.modelOutput as { papers: Array<ReturnType<typeof paper> & { paper_ref: string; truncated: boolean }> };
  const ui = 'researchPapers' in output ? output.researchPapers ?? [] : [];
  const finalRef = count ? `research:${papers[papers.length - 1].id}` : null;
  const block = count ? '```neuink-papers\n' + JSON.stringify({ items: [{ ref: finalRef, reason: 'Fixture' }] }) + '\n```' : '';
  const presentationError = paperPresentationError(block, paperRecords(ui, []));
  const serialized = JSON.stringify(ui);
  const after = process.memoryUsage();
  evidence(`T-STEP1-P10-01-${count}`, { input_count: count, model_count: model.papers.length, record_count: ui.length,
    model_ids: model.papers.map(p => p.id), record_ids: ui.map(p => p.id),
    final_ref: finalRef, final_ref_error: presentationError ?? null, raw_native_bridge: 'mocked',
    model_first_abstract_length: model.papers[0]?.abstract_text.length ?? null, model_first_truncated: model.papers[0]?.truncated ?? null,
    serialized_bytes: Buffer.byteLength(serialized), elapsed_ms: performance.now() - started,
    heap_delta_bytes: after.heapUsed - before.heapUsed, rss_before: before.rss, rss_after: after.rss,
    memory_scope: 'Vitest worker observations; GC and shared process affect deltas; not a product limit' });
  expect(model.papers.map(p => p.id)).toEqual(papers.map(p => p.id));
  expect(ui).toEqual(papers);
  expect(JSON.parse(serialized)).toEqual(papers);
  expect(presentationError).toBeUndefined();
});

it('T-STEP1-P10-02 extraction preserves metadata and full fields', () => {
  const source = paper(1);
  const actual = researchPapersFromResult({ papers: [source] })[0];
  evidence('T-STEP1-P10-02', { input_keys: Object.keys(source), record_keys: Object.keys(actual),
    input_abstract_length: source.abstract_text.length, record_abstract_length: actual.abstract_text.length,
    input_authors: source.authors.length, record_authors: actual.authors.length,
    missing_keys: Object.keys(source).filter(key => !(key in actual)), truncation_flag_present: 'truncated' in actual });
  expect(actual).toEqual(source);
  expect(actual.abstract_text).toHaveLength(6000);
  expect(actual.authors).toHaveLength(14);
  expect(actual).toHaveProperty('categories', ['cs.LG']);
  expect(actual).toHaveProperty('published', source.published);
  expect(actual).not.toHaveProperty('truncated');
});

it('B-P10-03 model formatter allowance is not a serialized total-output cap', () => {
  const output = researchOutput({ papers: Array.from({ length: 21 }, (_, i) => paper(i + 1)) }, 2000);
  const actual = { budget: 2000, serialized_chars: JSON.stringify(output).length };
  evidence('B-P10-03', actual);
  expect(actual.serialized_chars).toBeGreaterThan(actual.budget);
});

it('T-STEP5-CITATIONS identical paper URLs are collected for both paper-search tools', () => {
  const output = { papers: [paper(1)] };
  const existing = [...returnedExternalCitationUrls([{ toolName: 'search_papers', output }])];
  const proposed = [...returnedExternalCitationUrls([{ toolName: 'arxiv_search', output }])];
  evidence('B-P10-04', { search_papers_urls: existing, arxiv_search_urls: proposed });
  expect(existing).toEqual([paper(1).url, paper(1).pdf_url]);
  expect(proposed).toEqual(existing);
});

it('B-P10-05 partial result with top-level error is rejected before record extraction', async () => {
  const response = { status: 'partial', papers: [paper(1)], error: { code: 'UPSTREAM_TIMEOUT' } };
  vi.mocked(invoke).mockResolvedValue(response);
  let actual: unknown;
  try {
    actual = await executeTool('search_papers', { root: 'fixture-workspace', query: 'fixture' }, {
      addSource: () => 1, contextBudget: 8000
    });
  } catch (error) { actual = { threw: true, message: error instanceof Error ? error.message : String(error) }; }
  evidence('B-P10-05', { input_count: 1, actual });
  expect(actual).toMatchObject({ threw: true });
});

it('B-P10-08 presentation format accepts thirty items but rejects thirty-one', () => {
  const records = paperRecords(Array.from({ length: 31 }, (_, i) => paper(i + 1)), []);
  const actual = [30, 31].map(count => {
    const items = Array.from({ length: count }, (_, i) => ({ ref: `research:${paper(i + 1).id}`, reason: 'Fixture' }));
    const block = '```neuink-papers\n' + JSON.stringify({ items }) + '\n```';
    return { count, error: paperPresentationError(block, records) ?? null };
  });
  evidence('B-P10-08', { records_supplied_directly: 31, observations: actual, render_executed: false });
  expect(actual[0].error).toBeNull();
  expect(actual[1].error).toContain('Invalid neuink-papers block');
});
