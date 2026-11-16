import { describe, expect, it, vi } from 'vitest';
import { searchSegmentsBatch, type SearchResults, type SearchSegmentsBatchItem } from '@/shared/ipc/workspaceApi';
import { createSearchLibraryBatch } from './searchLibraryBatch';
import type { TaskSearchRequest } from './searchLibrary';

vi.mock('@/shared/ipc/workspaceApi', () => ({ searchSegmentsBatch: vi.fn() }));

const request: TaskSearchRequest = {
  task_id: 'q1',
  query: '方法？',
  english_query: 'method',
  sub_queries: ['baseline'],
  section_filter: 'Experiments',
  segment_types: ['table'],
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

function results(mode: string, warnings: string[] = [], entryId = 'a') {
  return {
    query: '方法？',
    mode,
    index_generation: 1,
    total_hit_count: 1,
    entries: [{ entry_id: entryId, entry_title: `Paper ${entryId}`, hit_count: 1, max_score: 0.9, hits: [segmentHit(entryId)] }],
    warnings
  } as unknown as SearchResults;
}

describe('createSearchLibraryBatch', () => {
  it('sends one batch with the per-task options and scope', async () => {
    vi.mocked(searchSegmentsBatch).mockReset().mockResolvedValue([{ task_id: 'q1', results: results('hybrid') }]);
    await createSearchLibraryBatch({ root: 'root', addSource: () => 1 })([request]);
    expect(searchSegmentsBatch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchSegmentsBatch).mock.calls[0]).toEqual(['root', [{
      task_id: 'q1',
      query: '方法？',
      mode: 'hybrid',
      top_k: 5,
      scope_entry_ids: ['a'],
      english_query: 'method',
      sub_queries: ['baseline'],
      section_filter: 'Experiments',
      segment_types: ['table']
    }]]);
  });

  it('reports the actual backend mode and its keyword-fallback warning', async () => {
    vi.mocked(searchSegmentsBatch).mockReset().mockResolvedValue([
      { task_id: 'q1', results: results('hybrid_fallback_keyword') }
    ]);
    const [item] = await createSearchLibraryBatch({ root: 'root', addSource: () => 1 })([request]);
    expect(item.task_id).toBe('q1');
    expect(item.outcome).toMatchObject({ status: 'ok', mode: 'hybrid_fallback_keyword' });
    if (item.outcome.status === 'ok') {
      expect(item.outcome.warnings.join(' ')).toContain('keyword fallback');
      expect(item.outcome.evidence[0]).toMatchObject({ entry_id: 'a', segment_uid: 'a-seg' });
    }
  });

  it('replaces backend task error text with host copy and keeps the fixed code', async () => {
    vi.mocked(searchSegmentsBatch).mockReset().mockResolvedValue([
      { task_id: 'q1', error: { code: 'search_failed', message: 'C:\\private\\path failure' } } satisfies SearchSegmentsBatchItem
    ]);
    const [item] = await createSearchLibraryBatch({ root: 'root', addSource: () => 1 })([request]);
    expect(item.outcome).toEqual({ status: 'error', code: 'search_failed', message: '该子问题检索失败，请稍后重试。' });
    expect(JSON.stringify(item.outcome)).not.toContain('private');
  });

  it('marks a result envelope without results as malformed for that task only', async () => {
    vi.mocked(searchSegmentsBatch).mockReset().mockResolvedValue([{ task_id: 'q1' }]);
    const [item] = await createSearchLibraryBatch({ root: 'root', addSource: () => 1 })([request]);
    expect(item.outcome).toMatchObject({ status: 'error', code: 'malformed_result' });
  });

  it('omits tasks the backend did not answer so the caller can mark them missing', async () => {
    vi.mocked(searchSegmentsBatch).mockReset().mockResolvedValue([]);
    const items = await createSearchLibraryBatch({ root: 'root', addSource: () => 1 })([request]);
    expect(items).toEqual([]);
  });

  it('does not call the backend for an empty request list', async () => {
    vi.mocked(searchSegmentsBatch).mockReset();
    expect(await createSearchLibraryBatch({ root: 'root', addSource: () => 1 })([])).toEqual([]);
    expect(searchSegmentsBatch).not.toHaveBeenCalled();
  });

  it('drops hits from another paper before formatting, so no source is registered for them', async () => {
    vi.mocked(searchSegmentsBatch).mockReset().mockResolvedValue([{
      task_id: 'q1',
      results: {
        ...results('hybrid'),
        entries: [
          { entry_id: 'a', entry_title: 'Paper a', hit_count: 1, max_score: 0.9, hits: [segmentHit('a')] },
          { entry_id: 'b', entry_title: 'Paper b', hit_count: 1, max_score: 0.95, hits: [segmentHit('b')] }
        ]
      } as unknown as SearchResults
    }]);
    const addSource = vi.fn((_source: unknown) => 1);
    const [item] = await createSearchLibraryBatch({ root: 'root', addSource })([request]);
    expect(item.outcome.status).toBe('ok');
    if (item.outcome.status === 'ok') {
      expect(item.outcome.evidence.map((evidence) => evidence.entry_id)).toEqual(['a']);
      expect(item.outcome.sources).toMatchObject([{ entry_id: 'a' }]);
    }
    expect(addSource).toHaveBeenCalledTimes(1);
    expect(addSource.mock.calls[0][0]).toMatchObject({ entry_id: 'a' });
  });

  it('keeps global results inside the frozen library ids', async () => {
    vi.mocked(searchSegmentsBatch).mockReset().mockResolvedValue([{
      task_id: 'q1',
      results: results('hybrid', [], 'deleted-paper')
    }]);
    const addSource = vi.fn(() => 1);
    const [item] = await createSearchLibraryBatch({ root: 'root', addSource })([{
      ...request,
      scope_entry_ids: [],
      allowed_entry_ids: ['a']
    }]);
    expect(item.outcome).toMatchObject({ status: 'ok', evidence: [] });
    expect(addSource).not.toHaveBeenCalled();
  });

  it('rejects promptly when cancelled and never registers a late native result', async () => {
    let resolveNative: (items: SearchSegmentsBatchItem[]) => void = () => {};
    vi.mocked(searchSegmentsBatch).mockReset().mockImplementation(() => new Promise((resolve) => { resolveNative = resolve; }));
    const controller = new AbortController();
    const addSource = vi.fn(() => 1);
    const pending = createSearchLibraryBatch({ root: 'root', addSource, abortSignal: controller.signal })([request]);
    controller.abort(new Error('run cancelled'));
    await expect(pending).rejects.toThrow('run cancelled');
    resolveNative([{ task_id: 'q1', results: results('hybrid') }]);
    await Promise.resolve();
    expect(addSource).not.toHaveBeenCalled();
  });
});
