import { describe, expect, it, vi } from 'vitest';
import { searchUnified, searchUnifiedBatch, type SearchResults, type UnifiedSearchResponse } from '@/shared/ipc/workspaceApi';
import { createSearchLibraryBatch } from './searchLibraryBatch';
import type { TaskSearchRequest } from './searchLibrary';

vi.mock('@/shared/ipc/workspaceApi', () => ({
  searchSegmentsBatch: vi.fn(),
  searchUnified: vi.fn(),
  searchUnifiedBatch: vi.fn()
}));

const request: TaskSearchRequest = {
  task_id: 'q1',
  query: '方法？',
  english_query: 'method',
  sub_queries: ['baseline'],
  section_filter: null,
  segment_types: [],
  scope_entry_ids: ['a'],
  allowed_entry_ids: ['a'],
  top_k: 5
};

function segmentHit(entryId: string) {
  return {
    entry_id: entryId,
    entry_title: `Paper ${entryId}`,
    source: { kind: 'segment', section_id: null },
    target: { kind: 'segment', entry_id: entryId, segment_uid: `${entryId}-seg`, page_idx: 0 },
    title: 'Method',
    snippet: 'The method uses a transformer.',
    score: 0.9,
    matched_terms: []
  };
}

function results(entryId = 'a'): SearchResults {
  return {
    query: '方法？',
    mode: 'hybrid',
    index_generation: 1,
    total_hit_count: 1,
    entries: [
      {
        entry_id: entryId,
        entry_title: `Paper ${entryId}`,
        hit_count: 1,
        max_score: 0.9,
        hits: [segmentHit(entryId)]
      }
    ],
    warnings: []
  } as unknown as SearchResults;
}

function unified(overrides: Partial<UnifiedSearchResponse> = {}): UnifiedSearchResponse {
  return {
    question: '方法？',
    routed_documents: ['a'],
    routing_skip: null,
    truncated: false,
    text_entries: 1,
    visual_entries: 0,
    visual_status: 'disabled',
    carriers: [],
    tasks: [
      { question: '方法？', carrier_applied: false, mode: 'hybrid', total_hit_count: 1, rerank_used: 'off', results: results() }
    ],
    degradations: [],
    ...overrides
  };
}

describe('unified retrieval batch', () => {
  it('sends the composed request and maps evidence with host-owned warnings', async () => {
    vi.mocked(searchUnified).mockReset().mockResolvedValue(unified({ degradations: ['visual_disabled'] }));
    const items = await createSearchLibraryBatch({
      root: 'root',
      addSource: () => 3,
      unifiedRetrieval: { headUnits: 12, maxDocuments: 8, bindCarriers: false }
    })([request]);

    expect(searchUnified).toHaveBeenCalledWith(
      'root',
      expect.objectContaining({
        question: '方法？',
        sub_questions: ['baseline'],
        scope_entry_ids: ['a'],
        top_k: 5,
        head_units: 12,
        max_documents: 8,
        bind_carriers: false
      })
    );
    const outcome = items[0].outcome;
    if (outcome.status !== 'ok') throw new Error('expected an ok outcome');
    expect(outcome.evidence).toHaveLength(1);
    expect(outcome.sources).toHaveLength(1);
    expect(outcome.warnings.join('\n')).toContain('视觉索引未启用');
  });

  it('reports a missing visual index as host-owned copy, not as evidence loss', async () => {
    vi.mocked(searchUnified).mockReset().mockResolvedValue(unified({ visual_status: 'index_missing' }));
    const items = await createSearchLibraryBatch({
      root: 'root',
      addSource: () => 1,
      unifiedRetrieval: {}
    })([request]);
    const outcome = items[0].outcome;
    if (outcome.status !== 'ok') throw new Error('expected an ok outcome');
    expect(outcome.evidence).toHaveLength(1);
    expect(outcome.warnings.join('\n')).toContain('视觉索引尚未构建');
  });

  it('keeps one cited segment when two sub-questions reach it', async () => {
    vi.mocked(searchUnified).mockReset().mockResolvedValue(
      unified({
        tasks: [
          { question: '方法？', carrier_applied: false, mode: 'hybrid', total_hit_count: 1, rerank_used: 'off', results: results() },
          { question: 'baseline？', carrier_applied: true, mode: 'hybrid', total_hit_count: 1, rerank_used: 'off', results: results() }
        ]
      })
    );
    const items = await createSearchLibraryBatch({
      root: 'root',
      addSource: () => 1,
      unifiedRetrieval: {}
    })([request]);
    const outcome = items[0].outcome;
    if (outcome.status !== 'ok') throw new Error('expected an ok outcome');
    expect(outcome.evidence).toHaveLength(1);
    expect(outcome.sources).toHaveLength(1);
  });

  it('returns no evidence when nothing was routed', async () => {
    vi.mocked(searchUnified).mockReset().mockResolvedValue(
      unified({ routed_documents: [], tasks: [], degradations: ['no_documents'] })
    );
    const items = await createSearchLibraryBatch({
      root: 'root',
      addSource: () => 1,
      unifiedRetrieval: {}
    })([request]);
    const outcome = items[0].outcome;
    if (outcome.status !== 'ok') throw new Error('expected an ok outcome');
    expect(outcome.mode).toBe('unified_empty');
    expect(outcome.evidence).toEqual([]);
    expect(outcome.sources).toEqual([]);
    expect(outcome.warnings.join('\n')).toContain('未路由到任何论文');
  });

  it('drops entries outside the frozen allowed set', async () => {
    vi.mocked(searchUnified).mockReset().mockResolvedValue(
      unified({
        tasks: [
          { question: '方法？', carrier_applied: false, mode: 'hybrid', total_hit_count: 1, rerank_used: 'off', results: results('z') }
        ]
      })
    );
    const items = await createSearchLibraryBatch({
      root: 'root',
      addSource: () => 1,
      unifiedRetrieval: {}
    })([request]);
    const outcome = items[0].outcome;
    if (outcome.status !== 'ok') throw new Error('expected an ok outcome');
    expect(outcome.evidence).toEqual([]);
    expect(outcome.sources).toEqual([]);
  });

  it('rejects at once when the run is already cancelled', async () => {
    vi.mocked(searchUnified).mockReset();
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(
      createSearchLibraryBatch({
        root: 'root',
        addSource: () => 1,
        abortSignal: controller.signal,
        unifiedRetrieval: {}
      })([request])
    ).rejects.toThrow();
    expect(searchUnified).not.toHaveBeenCalled();
    expect(searchUnifiedBatch).not.toHaveBeenCalled();
  });

  it('sends several unified tasks through one batch call', async () => {
    const second = { ...request, task_id: 'q2', query: '数据？' };
    vi.mocked(searchUnifiedBatch).mockReset().mockResolvedValue([
      unified(),
      unified({ question: '数据？' })
    ]);
    const items = await createSearchLibraryBatch({
      root: 'root',
      addSource: () => 1,
      unifiedRetrieval: { headUnits: 12, maxDocuments: 8, bindCarriers: true }
    })([request, second]);

    expect(searchUnified).not.toHaveBeenCalled();
    expect(searchUnifiedBatch).toHaveBeenCalledTimes(1);
    expect(searchUnifiedBatch).toHaveBeenCalledWith('root', [
      expect.objectContaining({
        question: '方法？',
        scope_entry_ids: ['a'],
        top_k: 5,
        head_units: 12,
        max_documents: 8,
        bind_carriers: true,
        mode: 'hybrid'
      }),
      expect.objectContaining({ question: '数据？', scope_entry_ids: ['a'] })
    ]);
    expect(items.map((item) => item.task_id)).toEqual(['q1', 'q2']);
    expect(items.every((item) => item.outcome.status === 'ok')).toBe(true);
  });
});

