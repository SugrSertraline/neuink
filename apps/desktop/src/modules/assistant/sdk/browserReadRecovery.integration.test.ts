import { beforeEach, expect, it, vi } from 'vitest';
import { readBrowserTab } from '@/shared/ipc/browserApi';
import { listTools, type LlmProfile } from '@/shared/ipc/assistantApi';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { ASSISTANT_READ_FAILURES } from '@/shared/lib/assistantReadFailure';
import { answerWithGroundedAgent } from './qna';
import { createNeuinkModel } from './provider';
import { scriptedModel } from './testHelpers/model';
import { buildDirectExecution } from '../runtime/executionPolicy';
import { DurableExecution } from '../runtime/durableExecution';
import { RunBudget } from '../agent-core';
import { runResearchTool } from '@/shared/ipc/researchApi';
import { formatAssistantError } from '@/shared/lib/assistantDebug';

vi.mock('@/shared/ipc/browserApi', () => ({ readBrowserTab: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  listTools: vi.fn(), loadPrompt: async () => '{{question}}\n{{document_context}}\n{{tool_notes}}' }));
vi.mock('@/shared/ipc/agentExecutionApi', () => ({ saveAgentExecution: vi.fn(async (_, record) => ({ ...record, revision: record.revision + 1 })) }));
vi.mock('./provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: () => ({}) }));
vi.mock('@/shared/ipc/researchApi', async original => ({ ...await original<typeof import('@/shared/ipc/researchApi')>(), runResearchTool: vi.fn() }));

function options() {
  const runtimeSettings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
  return { root: 'fixture', scope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] }, runtimeSettings,
    browserTabTarget: { id: 'pdf-tab', title: 'Paper', url: 'https://arxiv.org/pdf/1234.5678', navigationId: 'nav' },
    activeExecution: { agent: runtimeSettings.mainAssistant },
    ...buildDirectExecution(runtimeSettings, 'Read this PDF'),
    settings: { id: 'test', model: 'test', base_url: 'https://example.invalid', api_key: null } as LlmProfile,
    question: 'Read this PDF' };
}

beforeEach(() => { vi.clearAllMocks(); vi.mocked(listTools).mockResolvedValue([]); });

it.each([
  [new Error('公开 PDF 读取超时，token=SECRET C:\\Private\\paper.pdf'), ASSISTANT_READ_FAILURES.pdfDownloadTimeout],
  [new Error('公开 PDF 下载连接失败。'), ASSISTANT_READ_FAILURES.pdfDownloadNetwork],
  [new Error('PDF 文字提取超时，请缩小页数后重试。'), ASSISTANT_READ_FAILURES.pdfExtractTimeout],
  [new Error('这些 PDF 页没有可读取的文字层，可能是扫描件。 token=SECRET'), ASSISTANT_READ_FAILURES.noText],
] as const)('returns the actual read failure to the main agent for a safe final answer: %s', async (error, reason) => {
  vi.mocked(readBrowserTab).mockRejectedValue(error);
  const model = scriptedModel([{ call: { name: 'read_browser_tab', args: {} } },
    { text: '未能取得这篇 PDF 的正文，因此不能可靠总结。请检查页面后重试，或提供可读取的文件。' }]);
  vi.mocked(createNeuinkModel).mockReturnValue(model);
  const budget = new RunBudget();
  const execution = new DurableExecution('fixture', { id: 'read-failure', conversationId: 'fixture',
    revision: 0, status: 'running', updatedAt: '', payload: {} }, budget);
  const result = await answerWithGroundedAgent({ ...options(), budget, execution, abortSignal: new AbortController().signal });
  expect(result.answer).toContain('不能可靠总结');
  expect(result.agentLoopState?.status).toBe('completed');
  expect(result.hadRecoverableFailures).toBe(true);
  expect(result.toolEvents).toEqual([expect.objectContaining({ status: 'error', error: reason })]);
  expect(readBrowserTab).toHaveBeenCalledOnce();
  expect(model.doStreamCalls).toHaveLength(2);
  expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain(reason);
  expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('TOOL_EXECUTION_FAILED');
  expect(JSON.stringify([result, execution.record.payload, model.doStreamCalls])).not.toMatch(/SECRET|private worker/);
  expect(budget.writesBlocked).toBe(false);
  expect(budget.toolCalls).toBe(1);
});

it('does not continue the main agent after the user actually cancels a read', async () => {
  const controller = new AbortController();
  vi.mocked(readBrowserTab).mockImplementation(async () => {
    controller.abort(new DOMException('User stopped', 'AbortError')); throw new Error('worker failed');
  });
  const model = scriptedModel([{ call: { name: 'read_browser_tab', args: {} } }, { text: 'must not run' }]);
  vi.mocked(createNeuinkModel).mockReturnValue(model);
  await expect(answerWithGroundedAgent({ ...options(), abortSignal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(model.doStreamCalls).toHaveLength(1);
});

it('accepts an actually read browser PDF URL under a required-citation plan without inventing local markers', async () => {
  const input = options();
  input.plan.citationPolicy = 'required';
  vi.mocked(readBrowserTab).mockResolvedValue({ title: 'Paper', url: input.browserTabTarget.url, text: 'Actual returned text.',
    selection: '', truncated: false, capturedAt: '', limitations: [] });
  const model = scriptedModel([{ call: { name: 'read_browser_tab', args: {} } },
    { text: `实际读取结果支持这一说明。[论文](${input.browserTabTarget.url})` }]);
  vi.mocked(createNeuinkModel).mockReturnValue(model);
  const result = await answerWithGroundedAgent(input);
  expect(result.answer).toContain(input.browserTabTarget.url);
  expect(result.sources).toEqual([]);
  expect(model.doStreamCalls).toHaveLength(2);
});

function webFallbackFixture() {
  vi.mocked(readBrowserTab).mockRejectedValue(new Error('网页读取超时，请稍后重试。'));
  vi.mocked(listTools).mockResolvedValue([{ name: 'read_webpage', description: 'Read', parameters_schema: {
    type: 'object', properties: { url: { type: 'string' } }, required: ['url'],
  } }]);
  vi.mocked(runResearchTool).mockResolvedValue({ results: [{ url: 'https://arxiv.org/html/1234.5678',
    content: 'Verified external body text.', evidence_level: 'web_extract' }], errors: [] });
  return [
    { call: { name: 'read_browser_tab', args: {} } },
    { call: { name: 'read_webpage', args: { url: 'https://arxiv.org/html/1234.5678' } } },
  ];
}

it('corrects the observed browser-timeout/web-success path using actual returned URLs instead of nonexistent [Sx]', async () => {
  const model = scriptedModel([...webFallbackFixture(), { text: 'Claim [S1]' },
    { text: '浏览器读取超时；以下仅依据已取得的[公开网页正文](https://arxiv.org/html/1234.5678)。' }]);
  vi.mocked(createNeuinkModel).mockReturnValue(model);
  const result = await answerWithGroundedAgent(options());
  expect(result.agentLoopState?.status).toBe('completed');
  expect(result.answer).toContain('公开网页正文');
  expect(result.sources).toEqual([]);
  expect(runResearchTool).toHaveBeenCalledOnce();
  expect(JSON.stringify(model.doStreamCalls[3].prompt)).toContain('NO [S#] citation markers');
  expect(JSON.stringify(model.doStreamCalls[3].prompt)).toContain('exact URLs returned');
});

it('still refuses invented markers after two corrections and exposes a safe actionable terminal reason', async () => {
  const model = scriptedModel([...webFallbackFixture(), { text: 'Claim [S1]' }, { text: 'Claim [S1][S2]' }, { text: 'Claim [S1][S2]' }]);
  vi.mocked(createNeuinkModel).mockReturnValue(model);
  const budget = new RunBudget();
  const execution = new DurableExecution('fixture', { id: 'citation-failure', conversationId: 'fixture',
    revision: 0, status: 'running', updatedAt: '', payload: {} }, budget);
  let caught: unknown;
  try { await answerWithGroundedAgent({ ...options(), budget, execution }); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe(ASSISTANT_READ_FAILURES.citation);
  expect(formatAssistantError(caught)).toBe(ASSISTANT_READ_FAILURES.citation);
  expect(execution.get<{ stopReason: string }>('loop:main')?.stopReason).toBe('引用或输出要求未满足');
  expect(model.doStreamCalls).toHaveLength(5);
  expect(budget.writesBlocked).toBe(false);
});
