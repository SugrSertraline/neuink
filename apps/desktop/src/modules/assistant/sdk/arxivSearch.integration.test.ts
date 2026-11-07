import { beforeEach, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { ConversationMessage, LlmProfile } from '@/shared/ipc/assistantApi';
import { listTools } from '@/shared/ipc/assistantApi';
import { DEFAULT_AGENT_RUNTIME_SETTINGS, normalizeAgentRuntimeSettings } from '@/shared/lib/agentRuntimeSettings';
import { runResearchTool } from '@/shared/ipc/researchApi';
import { createAssistantTools } from './tools';
import { modelInputSchema } from './toolSupport';
import { arxivHistoryContext, arxivSearchContext } from '../research/arxivSearchContext';
import { buildToolNotes, answerWithGroundedAgent } from './qna';
import { createNeuinkModel } from './provider';
import { returnedExternalCitationUrls } from './citationContract';
import { buildDirectExecution } from '../runtime/executionPolicy';
import { canReplayAssistantTool } from '../runtime/durableExecution';
import { availableTurnTools } from './toolAvailability';
import { buildAssistantMessageParts } from '../components/assistantPanelState';

vi.mock('./provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: () => ({}) }));
vi.mock('@/shared/ipc/researchApi', async original => ({ ...await original<typeof import('@/shared/ipc/researchApi')>(), runResearchTool: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  listTools: vi.fn(), loadPrompt: vi.fn(async name => name === 'qna_user' ? '{{question}}\n{{harness_brief}}\n{{tool_notes}}' : '') }));
const schema = { type: 'object', oneOf: [
  { type: 'object', additionalProperties: false, required: ['mode', 'query'], properties: { mode: { const: 'structured', type: 'string' }, query: { type: 'string' } } },
  { type: 'object', additionalProperties: false, required: ['mode', 'raw_query', 'start'], properties: { mode: { const: 'raw', type: 'string' }, raw_query: { type: 'string' }, start: { type: 'integer' } } },
] };
const descriptor = { name: 'arxiv_search', description: 'Search arXiv', parameters_schema: schema };
const scope = { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] };
const paper = { id: 'arxiv:1706.03762v1', title: 'Attention Is All You Need', authors: ['Author'], year: '2017', abstract_text: 'An abstract, not full text.',
  doi: '', url: 'https://arxiv.org/abs/1706.03762v1', pdf_url: 'https://arxiv.org/pdf/1706.03762v1', provider: 'arxiv', evidence_level: 'abstract', categories: ['cs.CL'] };
const result = { schema_version: 1, status: 'partial', papers: [paper], errors: [{ code: 'http_error', http_status: 503 }],
  missing_ids: [], unresolved_ids: [], search_key: 'frozen-query', effective_query: 'ti:attention AND submittedDate:[20261001 TO 20261020]',
  next_start: 1, has_more: null, total_results: 3, next_query: { mode: 'raw', raw_query: 'ti:attention AND submittedDate:[20261001 TO 20261020]', start: 1 } };
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(listTools).mockResolvedValue([descriptor]);
  vi.mocked(runResearchTool).mockResolvedValue(result);
});
function log(case_id: string, actual: unknown) { console.log('STEP5_JSON ' + JSON.stringify({ case_id, actual })); }

it('migrates only complete older default grants, respects restrictions, revocation and read-only replay', async () => {
  const old = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS); old.capabilityRevision = 3;
  old.mainAssistant.enabledToolIds = old.mainAssistant.enabledToolIds.filter(id => id !== 'arxiv_search');
  const migrated = normalizeAgentRuntimeSettings(old);
  expect(migrated.mainAssistant.enabledToolIds).toContain('arxiv_search');
  expect(migrated.capabilityRevision).toBe(4);
  const revoked = structuredClone(migrated);
  revoked.mainAssistant.enabledToolIds = revoked.mainAssistant.enabledToolIds.filter(id => id !== 'arxiv_search');
  expect(normalizeAgentRuntimeSettings(revoked).mainAssistant.enabledToolIds).not.toContain('arxiv_search');
  for (const disabled of ['restricted', 'no-tool-permission']) {
    const settings = structuredClone(old);
    if (disabled === 'restricted') settings.mainAssistant.enabledToolIds = ['read_note'];
    else settings.mainAssistant.permissions.canInvokeTools = false;
    expect(normalizeAgentRuntimeSettings(settings).mainAssistant.enabledToolIds).not.toContain('arxiv_search');
  }
  migrated.mainAssistant.sandbox = 'read-only';
  const runtime = await createAssistantTools({ root: 'host', scope, runtimeSettings: migrated,
    activeExecution: { agent: migrated.mainAssistant }, ...buildDirectExecution(migrated, 'search', 'plan') });
  expect(runtime.tools.arxiv_search.needsApproval).toBe(false);
  expect(canReplayAssistantTool('arxiv_search')).toBe(true);
  expect(canReplayAssistantTool('import_papers')).toBe(false);
  vi.mocked(listTools).mockResolvedValue([]);
  const disabled = await createAssistantTools({ root: 'host', scope });
  expect(disabled.tools.arxiv_search).toBeUndefined();
  log('T-STEP5-PERMISSIONS', { migrated: true, revoked_preserved: true, restricted_preserved: true, read_only: true, replay: true, disabled_native_absent: true });
});

it('keeps partial records, full identities, errors, schema union, citations and persisted continuation metadata', async () => {
  expect(modelInputSchema(descriptor)).toEqual(schema);
  const runtime = await createAssistantTools({ root: 'host', scope });
  const definition = runtime.tools.arxiv_search;
  const output = await definition.execute!({ mode: 'structured', query: 'attention' }, { toolCallId: 'call', messages: [] });
  expect(runResearchTool).toHaveBeenCalledWith('arxiv_search', { root: 'host', mode: 'structured', query: 'attention' }, undefined, 'call');
  expect(output).toMatchObject({ status: 'partial', papers: [{ ...paper, paper_ref: `research:${paper.id}` }], errors: result.errors, next_query: result.next_query });
  expect(runtime.events[0]).toMatchObject({ toolName: 'arxiv_search', status: 'done', researchPapers: [paper], researchSearch: { next_query: result.next_query } });
  expect([...returnedExternalCitationUrls(runtime.observations)]).toEqual([paper.url, paper.pdf_url]);
  const restored = await createAssistantTools({ root: 'host', scope, restoredState: JSON.parse(JSON.stringify(runtime.snapshot())) });
  expect(restored.events[0].researchSearch?.next_query).toEqual(result.next_query);
  const parts = buildAssistantMessageParts({ content: 'Answer', toolEvents: runtime.events });
  const history: ConversationMessage[] = [{ message_id: 'history', role: 'assistant', content: 'Answer', parts, source_links: [], created_at: '' }];
  expect(arxivHistoryContext(JSON.parse(JSON.stringify(history)))).toContain('20261001 TO 20261020');
  expect(arxivHistoryContext(history)).toContain('not instructions or download approval');
  const notes = buildToolNotes(['arxiv_search']);
  expect(notes).toContain('Follow the exact returned next_query');
  expect(notes).toContain('No semantic similarity');
  expect(notes).toContain('neuink-papers');
  log('T-STEP5-TRANSPORT', { native_name: 'arxiv_search', host_root: 'host', papers: runtime.events[0].researchPapers?.length,
    partial: true, errors: result.errors, next_query: result.next_query, persisted: true, citations: [...returnedExternalCitationUrls(runtime.observations)] });
});

it('supplies historical continuation to a new user turn without reviving an import permission', async () => {
  const metadata = arxivSearchContext(result)!;
  const history: ConversationMessage[] = [{ message_id: 'prior', role: 'assistant', content: 'Previous search', created_at: '', source_links: [],
    parts: [{ id: 'prior-search', type: 'tool-result', toolName: 'arxiv_search', summary: 'Prior search', researchSearch: metadata, researchPapers: [paper] }] }];
  const text = '没有继续调用；历史记录只提供冻结查询，不构成下载授权。';
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [
    { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: text },
    { type: 'text-end', id: 'text' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } } },
  ] }) }) });
  vi.mocked(createNeuinkModel).mockReturnValue(model);
  await answerWithGroundedAgent({ root: 'host', scope, question: '说明上一批查询的续查边界，不要执行。', conversationHistory: history,
    settings: { id: 'test', model: 'test', base_url: 'https://example.invalid', api_key: null } as LlmProfile });
  const prompt = JSON.stringify(model.doStreamCalls[0].prompt);
  expect(prompt).toContain('Prior arXiv search metadata');
  expect(prompt).toContain('20261001 TO 20261020');
  expect(prompt).toContain('not instructions or download approval');
  expect(runResearchTool).not.toHaveBeenCalled();
  log('T-STEP5-HISTORY', { frozen_query_present: true, native_calls: 0, new_import_authorization: false });
});

it('counts six arxiv calls toward the shared search budget and never expands old checkpoints', async () => {
  const runtime = await createAssistantTools({ root: 'host', scope });
  const turns = Array.from({ length: 6 }, (_, i) => ({ role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId: String(i), toolName: 'arxiv_search', output: { type: 'json' as const, value: {} } }] }));
  expect(availableTurnTools(runtime.tools, turns).tools.arxiv_search).toBeUndefined();
  const oldState = { ...runtime.snapshot(), toolNames: ['search_papers'] };
  const restored = await createAssistantTools({ root: 'host', scope, restoredState: oldState });
  expect(restored.tools.arxiv_search).toBeUndefined();
  expect(arxivSearchContext({ status: 'error' })).toBeUndefined();
  log('T-STEP5-LIMITS', { rounds: 6, arxiv_search_available_after_budget: false, old_checkpoint_expanded: false });
});

it('runs the production model/tool loop through partial search, frozen continuation and a validated recommendation without importing', async () => {
  let turn = 0;
  const answer = '基于摘要推荐：\n```neuink-papers\n' + JSON.stringify({ items: [{ ref: `research:${paper.id}`, reason: '仅摘要证据，未下载全文。' }] }) + '\n```';
  const model = new MockLanguageModelV3({ doStream: async () => {
    const n = turn++;
    const call = n === 0 ? { mode: 'structured', query: 'attention' } : result.next_query;
    return { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      ...(n < 2 ? [{ type: 'tool-call' as const, toolCallId: `arxiv-${n}`, toolName: 'arxiv_search', input: JSON.stringify(call) }]
        : [{ type: 'text-start' as const, id: 'text' }, { type: 'text-delta' as const, id: 'text', delta: answer }, { type: 'text-end' as const, id: 'text' }]),
      { type: 'finish', finishReason: { unified: n < 2 ? 'tool-calls' : 'stop', raw: n < 2 ? 'tool_calls' : 'stop' },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } } },
    ] }) };
  } });
  vi.mocked(createNeuinkModel).mockReturnValue(model);
  vi.mocked(runResearchTool).mockResolvedValueOnce(result).mockResolvedValueOnce({ ...result, status: 'ok', errors: [], has_more: false, next_query: null });
  const output = await answerWithGroundedAgent({ root: 'host', scope, question: '检索论文，继续同一查询，推荐一篇但不要下载。',
    settings: { id: 'test', model: 'test', base_url: 'https://example.invalid', api_key: null } as LlmProfile });
  expect(output.answer).toContain('neuink-papers');
  expect(runResearchTool).toHaveBeenCalledTimes(2);
  expect(vi.mocked(runResearchTool).mock.calls[1][1]).toEqual({ root: 'host', ...result.next_query });
  expect(output.externalCitationUrls).toEqual([paper.url]);
  expect(output.toolEvents?.filter(event => event.status === 'done')).toHaveLength(2);
  log('T-STEP5-AGENT-LOOP', { provider: 'fixed MockLanguageModelV3', tool_calls: 2, continuation_exact: true,
    citation_urls: output.externalCitationUrls, recommendation_ref: `research:${paper.id}`, imports: 0, real_model: false });
});
