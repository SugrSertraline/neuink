import { beforeEach, expect, it, vi } from 'vitest';
import { runResearchTool } from '@/shared/ipc/researchApi';
import { executeTool } from './toolSupport';
vi.mock('@/shared/ipc/researchApi', async original => ({ ...await original<typeof import('@/shared/ipc/researchApi')>(), runResearchTool: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const run = () => executeTool('import_papers', { root: 'fixture', paper_ids: ['p1'] }, { addSource: () => 1, contextBudget: 10000, toolCallId: 'import' });

it.each([{}, { results: [] }, { results: [{ id: 'p1', status: 'imported' }] },
  { results: [{ id: 'p2', entry_id: 'e2', status: 'imported' }] },
  { results: [{ id: 'p1', entry_id: 'e1', status: 'pending' }] }])('reports malformed import receipts as unknown outcomes instead of success', async output => {
  vi.mocked(runResearchTool).mockResolvedValue(output);
  expect((await run()).modelOutput).toMatchObject({ ok: false, code: 'TOOL_OUTCOME_UNKNOWN', recovery: { writesBlocked: true } });
});

it('summarizes only actual successful imports', async () => {
  vi.mocked(runResearchTool).mockResolvedValue({ results: [{ id: 'p1', entry_id: 'e1', status: 'imported', parsed: false }] });
  expect((await run()).summary).toBe('PDF 已下载入库 1 篇，尚未解析。');
});

it('keeps known partial results without treating failed papers as imported', async () => {
  vi.mocked(runResearchTool).mockResolvedValue({ results: [
    { id: 'p1', entry_id: 'e1', status: 'imported' }, { id: 'p2', status: 'failed', error: 'HTTP 404 token=secret' }
  ] });
  const result = await executeTool('import_papers', { root: 'fixture', paper_ids: ['p1', 'p2'] }, { addSource: () => 1, contextBudget: 10000 });
  expect(result.modelOutput).toMatchObject({ ok: false, code: 'TOOL_PARTIAL_FAILURE', results: [
    { id: 'p1', entry_id: 'e1', status: 'imported' }, { id: 'p2', status: 'failed' }
  ] });
  expect(JSON.stringify(result)).not.toContain('secret');
});
