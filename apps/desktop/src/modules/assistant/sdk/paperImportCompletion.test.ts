import { beforeEach, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { listTools, type LlmProfile } from '@/shared/ipc/assistantApi';
import { runResearchTool } from '@/shared/ipc/researchApi';
import { buildDirectExecution } from '../runtime/executionPolicy';
import { answerWithGroundedAgent } from './qna';
import { createNeuinkModel } from './provider';

vi.mock('./provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: () => ({}) }));
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  listTools: vi.fn(), loadPrompt: vi.fn(async () => '{{question}}') }));
vi.mock('@/shared/ipc/researchApi', async original => ({ ...await original<typeof import('@/shared/ipc/researchApi')>(), runResearchTool: vi.fn() }));

const title = 'StretchTime: Adaptive Time Series Forecasting via Symplectic Attention';
const question = `${title} 帮我下载一下这个论文`;
const paper = { id: 'arxiv:2602.08983v1', title, url: 'https://arxiv.org/abs/2602.08983v1',
  pdf_url: 'https://arxiv.org/pdf/2602.08983v1', authors: [], year: '2026', doi: '', abstract_text: 'Abstract only.',
  provider: 'arxiv', evidence_level: 'abstract' };
const search = { name: 'search_papers', args: { query: title } };
const download = { name: 'import_papers', args: { paper_ids: [paper.id] } };
const completion = `论文《${title}》的 PDF 已下载入库，尚未解析。`;
type Turn = { text: string } | { call: { name: string; args: object } };

function model(turns: Turn[]) {
  let index = 0;
  const provider = new MockLanguageModelV3({ doStream: async () => {
    const turn = turns[index++] ?? turns[turns.length - 1];
    return { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      ...('call' in turn ? [{ type: 'tool-call' as const, toolCallId: `call-${index}`, toolName: turn.call.name, input: JSON.stringify(turn.call.args) }]
        : [{ type: 'text-start' as const, id: 't' }, { type: 'text-delta' as const, id: 't', delta: turn.text }, { type: 'text-end' as const, id: 't' }]),
      { type: 'finish', finishReason: { unified: 'call' in turn ? 'tool-calls' : 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } } }
    ] }) };
  } });
  vi.mocked(createNeuinkModel).mockReturnValue(provider);
  return provider;
}

function options() {
  const runtimeSettings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
  return { ...buildDirectExecution(runtimeSettings, question), runtimeSettings,
    activeExecution: { agent: runtimeSettings.mainAssistant }, question, root: 'fixture',
    scope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] },
    settings: { id: 'test', model: 'test', base_url: 'https://example.invalid', api_key: null } as LlmProfile,
    requestToolApproval: vi.fn(async () => true) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTools).mockResolvedValue([
    { name: 'search_papers', description: 'Search', parameters_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'import_papers', description: 'Import', parameters_schema: { type: 'object', properties: { paper_ids: { type: 'array', items: { type: 'string' } } }, required: ['paper_ids'] } },
    { name: 'read_webpage', description: 'Read', parameters_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }
  ]);
  vi.mocked(runResearchTool).mockImplementation(async name => name === 'search_papers' ? { papers: [paper] }
    : name === 'read_webpage' ? { results: [{ url: paper.url, content: 'Paper content.' }] }
      : { results: [{ id: paper.id, entry_id: 'imported-entry', status: 'imported', parsed: false }] });
});

it.each(['imported', 'already_in_library'])('accepts an actual %s receipt without turning a download into a citation failure', async status => {
  vi.mocked(runResearchTool).mockResolvedValueOnce({ papers: [paper] })
    .mockResolvedValueOnce({ results: [{ id: paper.id, entry_id: 'imported-entry', status, parsed: false }] });
  const answer = status === 'already_in_library' ? `论文《${title}》已在文库，无需重复下载。` : completion;
  const provider = model([{ call: search }, { call: download }, { text: answer }]);
  const input = options();
  const result = await answerWithGroundedAgent(input);
  expect(result.answer).toBe(answer);
  expect(result.agentLoopState?.status).toBe('completed');
  expect(provider.doStreamCalls).toHaveLength(3);
  expect(input.requestToolApproval).toHaveBeenCalledOnce();
  expect(vi.mocked(runResearchTool).mock.calls.map(call => call[0])).toEqual(['search_papers', 'import_papers']);
});

it('keeps citation correction on the original download task and does not repeat the completed import', async () => {
  const provider = model([{ call: search }, { call: download }, { text: `${completion} [S999]` },
    { text: `${completion} [原文](${paper.url})` }]);
  const result = await answerWithGroundedAgent(options());
  expect(result.answer).toContain('PDF 已下载入库');
  const prompt = provider.doStreamCalls[3].prompt;
  const correction = prompt[prompt.length - 1];
  expect(JSON.stringify(correction)).toContain(question);
  expect(JSON.stringify(correction)).toContain('Do not acknowledge');
  expect(JSON.stringify(correction)).toContain('Do not repeat completed');
  expect(JSON.stringify(correction)).toContain(paper.url);
  expect(vi.mocked(runResearchTool).mock.calls.map(call => call[0])).toEqual(['search_papers', 'import_papers']);
});

it('still requires evidence for an explicitly grounded answer after importing', async () => {
  const provider = model([{ call: search }, { call: download }, { text: 'The paper proves a theorem.' },
    { text: `根据[论文摘要](${paper.url})，作者提出一种预测架构；PDF 已入库，尚未解析。` }]);
  const input = options(); input.plan.citationPolicy = 'required';
  const result = await answerWithGroundedAgent(input);
  expect(provider.doStreamCalls).toHaveLength(4);
  expect(result.answer).toContain(paper.url);
});

it('still requires citations after reading content beyond the download metadata', async () => {
  const provider = model([{ call: search }, { call: download }, { call: { name: 'read_webpage', args: { url: paper.url } } },
    { text: 'The paper proves a theorem.' }, { text: `根据[原文](${paper.url})，这是已读取内容的说明。` }]);
  await answerWithGroundedAgent(options());
  expect(provider.doStreamCalls).toHaveLength(5);
});

it.each([
  { results: [] },
  { results: [{ id: paper.id, status: 'imported' }] },
  { results: [{ id: paper.id, status: 'failed', error: 'HTTP 404' }] }
])('does not turn an empty, malformed or failed import into a confirmed receipt', async output => {
  vi.mocked(runResearchTool).mockResolvedValueOnce({ papers: [paper] }).mockResolvedValueOnce(output);
  const provider = model([{ call: search }, { call: download }, { text: '无法确认下载结果。' },
    { text: `无法确认下载结果，可查看[论文页面](${paper.url})。` }]);
  const result = await answerWithGroundedAgent(options());
  expect(provider.doStreamCalls).toHaveLength(4);
  expect(result.answer).toContain('无法确认下载结果');
});

it('does not waive citations for search candidates alone', async () => {
  const provider = model([{ call: search }, { text: '找到了这篇论文。' }, { text: `找到了[这篇论文](${paper.url})。` }]);
  await answerWithGroundedAgent(options());
  expect(provider.doStreamCalls).toHaveLength(3);
});

it('blocks a repeated import after an unknown receipt while allowing a truthful final answer', async () => {
  vi.mocked(runResearchTool).mockResolvedValueOnce({ papers: [paper] }).mockResolvedValueOnce({ results: [] });
  model([{ call: search }, { call: download }, { call: download },
    { text: `下载结果不明，请先核对文库。[论文来源](${paper.url})。` }]);
  const input = options();
  const result = await answerWithGroundedAgent(input);
  expect(result.answer).toContain('下载结果不明');
  expect(runResearchTool).toHaveBeenCalledTimes(2);
  expect(input.requestToolApproval).toHaveBeenCalledOnce();
  expect(result.toolEvents?.filter(event => event.toolName === 'import_papers').every(event => event.status === 'error')).toBe(true);
});

it('accepts a verified interactive paper reference and carries its source into final delivery', async () => {
  const answer = '```neuink-papers\n' + JSON.stringify({ items: [{ ref: `research:${paper.id}`, reason: '标题与请求一致，尚未读取全文。' }] }) + '\n```';
  const provider = model([{ call: search }, { text: answer }]);
  const result = await answerWithGroundedAgent(options());
  expect(result.answer).toBe(answer);
  expect(provider.doStreamCalls).toHaveLength(2);
  expect(result).toMatchObject({ externalCitationUrls: [paper.url] });
});

it('carries actual external evidence from a delegated reader through correction and parent verification', async () => {
  const instruction = '检索 StretchTime 的原始来源，不要下载。';
  const provider = model([
    { call: { name: 'task_run_subagent', args: { agent_id: 'evidence-agent', instruction } } },
    { call: search }, { text: '找到了论文 [S999]。' },
    { text: `已找到[论文](${paper.url})，仅取得摘要。` },
    { text: `这是[论文原始来源](${paper.url})，尚未读取全文。` }
  ]);
  const input = options();
  input.runtimeSettings.subagents[0].enabled = true;
  input.runtimeSettings.subagents[0].enabledToolIds = ['search_papers'];
  Object.assign(input, buildDirectExecution(input.runtimeSettings, instruction));
  input.plan.citationPolicy = 'required';
  const result = await answerWithGroundedAgent(input);
  expect(result.externalCitationUrls).toEqual([paper.url]);
  expect(provider.doStreamCalls).toHaveLength(5);
  const prompt = provider.doStreamCalls[3].prompt;
  expect(JSON.stringify(prompt[prompt.length - 1])).toContain(instruction);
  expect(JSON.stringify(prompt[prompt.length - 1])).toContain(paper.url);
  expect(runResearchTool).toHaveBeenCalledOnce();
});
