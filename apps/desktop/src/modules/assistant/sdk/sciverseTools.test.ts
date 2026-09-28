import { beforeEach, expect, it, vi } from 'vitest';
import { invokeAssistantTool, listTools } from '@/shared/ipc/assistantApi';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { executeTool } from './toolSupport';
import { createAssistantTools } from './tools';
import { SourceLedger } from '../runtime/sourceLedger';

vi.mock('@/shared/ipc/assistantApi', async original => ({
  ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  invokeAssistantTool: vi.fn(), listTools: vi.fn()
}));

beforeEach(() => vi.clearAllMocks());

it('routes Sciverse IPC results through code normalization with the actual caller budget', async () => {
  const hit = { doc_id: 'doc', chunk_id: 'chunk', title: 'Paper', chunk: 'Evidence '.repeat(2000), author: ['Alice', 'alice'], page_no: 0 };
  vi.mocked(invokeAssistantTool).mockResolvedValue({ hits: [hit, hit] });
  const ledger = new SourceLedger();
  const result = await executeTool('search_sciverse_evidence', { query: 'test' }, {
    addSource: ledger.add.bind(ledger), contextBudget: 2000
  });
  expect(invokeAssistantTool).toHaveBeenCalledExactlyOnceWith('search_sciverse_evidence', { query: 'test' });
  expect(result.modelOutput).toMatchObject({
    papers: [{ doc_id: 'doc', authors: ['Alice'] }],
    evidence: [{ doc_id: 'doc', marker: '[S1]', page_no: null }],
    counts: { duplicate_hits: 1 }, truncated: true
  });
  expect(JSON.stringify(result.modelOutput).length).toBeLessThanOrEqual(2000);
  expect(ledger.sources.size).toBe(1);
  expect(result.sources).toHaveLength(1);
});

it('never exposes retired skill tools even when an old tool catalog advertises them', async () => {
  vi.mocked(listTools).mockResolvedValue(['skill.load', 'skill.search', 'search_sciverse_evidence'].map(name => ({
    name, description: name, parameters_schema: { type: 'object', properties: {} }
  })));
  const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
  const result = await createAssistantTools({
    root: 'fixture', scope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] },
    runtimeSettings: settings, activeExecution: { agent: settings.mainAssistant }
  });
  expect(result.tools.search_sciverse_evidence).toBeDefined();
  expect(Object.keys(result.tools).some(name => /skill/i.test(name))).toBe(false);
});
