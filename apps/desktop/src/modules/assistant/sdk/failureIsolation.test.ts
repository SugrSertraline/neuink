import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { createNeuinkModel } from './provider';
import { answerWithGroundedAgent } from './qna';
import { createAssistantTools } from './tools';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { invokeAssistantTool, invokeMcpTool, listTools, listMcpTools, loadPrompt, type LlmProfile } from '@/shared/ipc/assistantApi';
import { ResearchImportNotApprovedError, runResearchTool } from '@/shared/ipc/researchApi';
import { saveAgentExecution } from '@/shared/ipc/agentExecutionApi';
import { DurableExecution } from '../runtime/durableExecution';
import { buildDirectExecution } from '../runtime/executionPolicy';
import { AgentPersistenceError, AgentStoppedError, RunBudget, type AgentCheckpoint } from '../agent-core';

vi.mock('./provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: () => ({}) }));
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  listTools: vi.fn(), listMcpTools: vi.fn(), invokeAssistantTool: vi.fn(), invokeMcpTool: vi.fn(), loadPrompt: vi.fn() }));
vi.mock('@/shared/ipc/researchApi', async original => ({ ...await original<typeof import('@/shared/ipc/researchApi')>(), runResearchTool: vi.fn() }));
vi.mock('@/shared/ipc/agentExecutionApi', () => ({ saveAgentExecution: vi.fn() }));
const profile = { id: 'test', model: 'test', base_url: 'https://example.invalid', api_key: null } as LlmProfile;
const scope = { entry_ids: ['entry'], entry_titles: ['Paper'], tag_ids: [], tag_names: [] };
const read = { name: 'read_segment_content', description: 'Read', parameters_schema: { type: 'object',
  properties: { entry_id: { type: 'string' }, segment_uid: { type: 'string' } }, required: ['entry_id', 'segment_uid'] } };
const readCall = { name: read.name, args: { entry_id: 'entry', segment_uid: 's1' } };
const childCall = { name: 'task_run_subagent', args: { agent_id: 'evidence-agent', instruction: 'Read entry/s1' } };
const diagramCall = { name: 'present_diagram', args: { kind: 'mindmap', title: 'Example', nodes: [
  { id: 'root', label: 'Root' }, { id: 'child', label: 'Child', parent_id: 'root' }
] } };
function model(turns: Array<{ text?: string; call?: typeof readCall | typeof childCall | { name: string; args: object }; error?: Error; truncated?: boolean; effect?: () => void }>) {
  let index = 0;
  const value = new MockLanguageModelV3({ doStream: async () => {
    const turn = turns[index++];
    if (!turn) throw new Error('Unexpected turn');
    turn.effect?.();
    if (turn.error) throw turn.error;
    return { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      ...(turn.call ? [{ type: 'tool-call' as const, toolCallId: `call-${index}`, toolName: turn.call.name, input: JSON.stringify(turn.call.args) }]
        : [{ type: 'text-start' as const, id: 't' }, { type: 'text-delta' as const, id: 't', delta: turn.text! }, { type: 'text-end' as const, id: 't' }]),
      { type: 'finish', finishReason: { unified: turn.truncated ? 'length' : turn.call ? 'tool-calls' : 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } } }
    ] }) };
  } });
  vi.mocked(createNeuinkModel).mockReturnValue(value);
  return value;
}
function options() {
  const runtimeSettings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
  runtimeSettings.subagents[0].enabled = true;
  const budget = new RunBudget();
  return { runtimeSettings, activeExecution: { agent: runtimeSettings.mainAssistant },
    ...buildDirectExecution(runtimeSettings, 'Read'), root: 'fixture', scope, settings: profile, question: 'Read', budget,
    execution: new DurableExecution('fixture', { id: 'execution-isolation', conversationId: 'conversation', revision: 0,
      status: 'running', updatedAt: '', payload: {} }, budget) };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadPrompt).mockResolvedValue('{{question}}');
  vi.mocked(listTools).mockResolvedValue([read]);
  vi.mocked(invokeAssistantTool).mockResolvedValue({ entry_id: 'entry', entry_title: 'Paper', segment_uid: 's1', page_idx: 2, text: '42 participants.' });
  vi.mocked(saveAgentExecution).mockImplementation(async (_, record) => ({ ...record, revision: record.revision + 1 }));
});

describe('ordinary failures stay inside the tool boundary', () => {
  it('lets the model correct a diagram semantic error in a durable run', async () => {
    const invalid = { ...diagramCall, args: { ...diagramCall.args, nodes: [
      { id: 'root', label: 'Root' }, { id: 'child', label: 'Child', parent_id: 'missing' }
    ] } };
    const provider = model([{ call: invalid }, { call: diagramCall }, { text: '已生成示例结构图。' }]);
    const result = await answerWithGroundedAgent(options());
    expect(result.agentLoopState?.status).toBe('completed');
    expect(provider.doStreamCalls).toHaveLength(3);
    expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('TOOL_EXECUTION_FAILED');
    expect(result.toolEvents).toContainEqual(expect.objectContaining({
      id: 'call-1', toolName: 'present_diagram', status: 'error'
    }));
    expect(result.toolEvents).toContainEqual(expect.objectContaining({
      id: 'call-2', toolName: 'present_diagram', status: 'done', diagram: expect.objectContaining({ kind: 'mindmap' })
    }));
    expect(invokeAssistantTool).not.toHaveBeenCalled();
  });
  it('replays an unfinished diagram presentation from its durable checkpoint', async () => {
    const input = options(); const controller = new AbortController();
    let saved: typeof input.execution.record | undefined;
    model([{ call: diagramCall }]);
    vi.mocked(saveAgentExecution).mockImplementation(async (_, record) => {
      const next = { ...record, revision: record.revision + 1 };
      const actor = record.payload['actor:main'] as AgentCheckpoint<unknown> | undefined;
      if (actor?.pending?.started) {
        saved = structuredClone(next);
        controller.abort(new Error('Interrupted before diagram presentation'));
      }
      return next;
    });
    await expect(answerWithGroundedAgent({ ...input, abortSignal: controller.signal }))
      .rejects.toThrow('Interrupted before diagram presentation');
    expect(saved).toBeDefined();
    expect((saved!.payload['actor:main'] as AgentCheckpoint<unknown>).pending).toMatchObject({ started: true, next: 0 });

    vi.mocked(saveAgentExecution).mockImplementation(async (_, record) => ({ ...record, revision: record.revision + 1 }));
    const provider = model([{ text: '已恢复并生成示例结构图。' }]);
    const budget = new RunBudget();
    budget.restore(saved!.payload.budget as ReturnType<RunBudget['snapshot']>);
    const result = await answerWithGroundedAgent({ ...input, budget,
      execution: new DurableExecution('fixture', saved!, budget) });
    expect(result.agentLoopState?.status).toBe('completed');
    expect(result.toolEvents?.filter(event => event.toolName === 'present_diagram')).toEqual([
      expect.objectContaining({ id: 'call-1', status: 'done', diagram: expect.objectContaining({ kind: 'mindmap' }) })
    ]);
    expect(provider.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(provider.doStreamCalls[0].prompt)).toContain('rendered');
    expect(budget.toolCalls).toBe(1);
    expect(invokeAssistantTool).not.toHaveBeenCalled();
  });
  it('returns a failed child and its actual partial evidence to the parent in a durable run', async () => {
    const provider = model([{ call: childCall }, { call: readCall }, { error: new Error('provider secret diagnostic') },
      { text: '子任务未完成，但已取得的片段提到 42 participants [S1]。' }]);
    const input = options(); input.invocationPlan.requiredToolIds = ['task.run_subagent'];
    const result = await answerWithGroundedAgent(input);
    expect(result.agentLoopState?.status).toBe('completed');
    expect(result.toolEvents).toContainEqual(expect.objectContaining({ toolName: 'task_run_subagent', status: 'error' }));
    expect(result.sources[0]).toMatchObject({ segment_uid: 's1' });
    const parentPrompt = JSON.stringify(provider.doStreamCalls[3].prompt);
    expect(parentPrompt).toContain('TOOL_EXECUTION_FAILED'); expect(parentPrompt).toContain('42 participants');
    expect(parentPrompt).not.toContain('secret diagnostic');
  });
  it('still stops the parent for child checkpoint persistence failure', async () => {
    const provider = model([{ call: childCall }]);
    vi.mocked(saveAgentExecution).mockImplementation(async (_, record) => {
      if (record.payload['actor:main/call-1']) throw new Error('disk full');
      return { ...record, revision: record.revision + 1 };
    });
    await expect(answerWithGroundedAgent(options())).rejects.toBeInstanceOf(AgentPersistenceError);
    expect(provider.doStreamCalls).toHaveLength(1);
  });
  it('returns child output truncation with acquired evidence for the reserved parent summary', async () => {
    const provider = model([{ call: childCall }, { call: readCall }, { text: 'unfinished child answer', truncated: true },
      { text: '子任务未完成，已有片段提到 42 participants [S1]。' }]);
    const input = options(); const budget = new RunBudget(4);
    input.budget = budget; input.execution = new DurableExecution('fixture', input.execution.record, budget);
    const result = await answerWithGroundedAgent(input);
    expect(result.agentLoopState?.status).toBe('completed');
    expect(result.sources[0]).toMatchObject({ segment_uid: 's1' });
    const parentPrompt = JSON.stringify(provider.doStreamCalls[3].prompt);
    expect(parentPrompt).toContain('TOOL_EXECUTION_FAILED');
    expect(parentPrompt).toContain('子任务输出达到长度上限');
    expect(parentPrompt).toContain('42 participants');
    expect(parentPrompt).not.toContain('unfinished child answer');
    expect(budget.turns).toBe(4);
    expect(result.toolEvents).toContainEqual(expect.objectContaining({ toolName: 'task_run_subagent', status: 'error' }));
  });
  it('lets the parent summarize when the child has insufficient local context capacity', async () => {
    const provider = model([{ call: childCall }, { text: '子任务上下文不足，没有取得足够证据。' }]);
    const input = options(); input.runtimeSettings.subagents[0].systemPrompt = 'Worker instructions. '.repeat(10_000);
    const result = await answerWithGroundedAgent(input);
    expect(result.agentLoopState?.status).toBe('completed');
    expect(provider.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('子任务上下文容量不足');
    expect(invokeAssistantTool).not.toHaveBeenCalled();
  });
  it('returns a child local turn cap without consuming the parent summary opportunity', async () => {
    const provider = model([{ call: childCall }, { call: readCall },
      ...Array.from({ length: 7 }, () => ({ text: 'Unsupported marker [S999].' })),
      { text: '子任务未能完成核验，已有片段提到 42 participants [S1]。' }]);
    const result = await answerWithGroundedAgent(options());
    expect(result.agentLoopState?.status).toBe('completed');
    expect(provider.doStreamCalls).toHaveLength(10);
    const parentPrompt = JSON.stringify(provider.doStreamCalls[9].prompt);
    expect(parentPrompt).toContain('子任务局部轮次已用完');
    expect(parentPrompt).toContain('42 participants');
    expect(result.sources[0]).toMatchObject({ segment_uid: 's1' });
  });
  it('does not recover a local child limit once the shared token budget is exhausted', async () => {
    const provider = model([{ call: childCall }, { text: 'unfinished', truncated: true }]);
    const input = options(); const budget = new RunBudget(24, 48, 2, 40);
    input.budget = budget; input.execution = new DurableExecution('fixture', input.execution.record, budget);
    await expect(answerWithGroundedAgent(input)).rejects.toBeInstanceOf(AgentStoppedError);
    expect(provider.doStreamCalls).toHaveLength(2);
  });
  it('keeps an unknown explicit child stop fatal instead of guessing from its text', async () => {
    const provider = model([{ call: childCall }, { error: new AgentStoppedError('context length local limit words are not a typed reason') }]);
    await expect(answerWithGroundedAgent(options())).rejects.toBeInstanceOf(AgentStoppedError);
    expect(provider.doStreamCalls).toHaveLength(2);
  });
  it('still stops the parent when the user cancels during the child model request', async () => {
    const controller = new AbortController();
    const provider = model([{ call: childCall }, { text: 'unfinished', effect: () => controller.abort(new Error('User stopped child')) }]);
    await expect(answerWithGroundedAgent({ ...options(), abortSignal: controller.signal })).rejects.toThrow('User stopped child');
    expect(provider.doStreamCalls).toHaveLength(2);
  });
  it('preserves one shared model turn for the parent to synthesize after delegation', async () => {
    const provider = model([{ call: childCall }, { text: '没有足够证据。' }, { text: '资料不足，暂时不能确认。' }]);
    const input = options(); const budget = new RunBudget(3);
    input.budget = budget; input.execution = new DurableExecution('fixture', input.execution.record, budget);
    expect((await answerWithGroundedAgent(input)).answer).toContain('不能确认');
    expect(provider.doStreamCalls).toHaveLength(3); expect(budget.turns).toBe(3);
    expect(provider.doStreamCalls[1].tools).toBeUndefined();
  });
  it('allows a cited-task limitation answer when its required read failed to acquire evidence', async () => {
    model([{ call: readCall }, { text: '无法读取这个片段，没有足够证据确认结论。' }]);
    vi.mocked(invokeAssistantTool).mockRejectedValue(new Error('file missing'));
    const input = options(); input.invocationPlan.requiredToolIds = ['read_segment_content']; input.plan.citationPolicy = 'required';
    const result = await answerWithGroundedAgent(input);
    expect(result.agentLoopState?.status).toBe('completed'); expect(result.sources).toEqual([]);
    expect(invokeAssistantTool).toHaveBeenCalledOnce();
  });
  it('skips a repeated failed local read, then lets the parent report the limitation', async () => {
    const provider = model([{ call: readCall }, { call: readCall }, { call: readCall }, { text: '读取失败，无法确认。' }]);
    vi.mocked(invokeAssistantTool).mockRejectedValue(new Error('file missing'));
    const result = await answerWithGroundedAgent(options());
    expect(result.agentLoopState?.status).toBe('completed'); expect(invokeAssistantTool).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(provider.doStreamCalls[3].prompt)).toContain('TOOL_REPEAT_SKIPPED');
  });
  it.each(['search_sciverse_metadata', 'get_sciverse_metadata_catalog', 'search_sciverse_paper_schema', 'get_sciverse_paper_schema'])(
    'returns %s failure to the parent rather than declaring an uncertain write', async name => {
      vi.mocked(listTools).mockResolvedValue([{ name, description: 'Read', parameters_schema: { type: 'object', properties: {} } }]);
      vi.mocked(invokeAssistantTool).mockRejectedValue(new Error('HTTP 403'));
      model([{ call: { name, args: {} } }, { text: '该来源不可用，暂时不能确认。' }]);
      const { runtimeSettings: _settings, activeExecution: _active, invocationPlan: _invocation, ...input } = options();
      const result = await answerWithGroundedAgent(input);
      expect(result.agentLoopState?.status).toBe('completed');
      expect(result.toolEvents).toContainEqual(expect.objectContaining({ toolName: name, status: 'error' }));
    });
});

describe('tool catalog failure isolation', () => {
  function mcpOptions() {
    const input = options(); const settings = input.runtimeSettings;
    settings.mainAssistant.allowedMcpServerIds = ['bad', 'good'];
    settings.mcpServers = ['bad', 'good'].map(id => ({ id, name: id, command: 'private-command', enabled: true, description: '', allowedToolNames: ['lookup'] }));
    settings.toolPackages = ['bad', 'good'].map(id => ({ id, name: id, description: '', enabled: true, kind: 'mcp' as const,
      mcpServerId: id, permissionMode: 'allow' as const, allowedToolIds: [`mcp.${id}.lookup` as const] }));
    Object.assign(input, buildDirectExecution(settings, 'Read'));
    vi.mocked(listMcpTools).mockRejectedValueOnce(new Error('private-command secret-stderr')).mockResolvedValueOnce({ tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: {} } }] });
    return input;
  }
  it('keeps healthy catalogs and informs the main agent of unavailable required capabilities', async () => {
    const input = mcpOptions(); input.invocationPlan.requiredToolIds = ['mcp.bad.lookup'];
    const provider = model([{ text: '所需服务暂不可用，未执行该操作。' }]);
    const result = await answerWithGroundedAgent(input);
    expect(result.agentLoopState?.status).toBe('completed');
    const declarations = provider.doStreamCalls[0].tools?.map(t => t.name) ?? [];
    expect(declarations).toContain('mcp_good_lookup'); expect(declarations).not.toContain('mcp_bad_lookup');
    const prompt = JSON.stringify(provider.doStreamCalls[0].prompt);
    expect(prompt).toContain('bad'); expect(prompt).not.toMatch(/private-command|secret-stderr/);
    expect(invokeAssistantTool).not.toHaveBeenCalled();
  });
  it('does not swallow user cancellation while loading a catalog', async () => {
    const input = mcpOptions(); const controller = new AbortController();
    vi.mocked(listMcpTools).mockReset().mockImplementation(async () => { controller.abort(new Error('User stopped')); throw new Error('cancel'); });
    await expect(createAssistantTools({ ...input, abortSignal: controller.signal })).rejects.toThrow('User stopped');
    expect(listMcpTools).toHaveBeenCalledOnce();
  });
  it('can still answer when the native catalog is temporarily unavailable', async () => {
    vi.mocked(listTools).mockRejectedValue(new Error('private IPC details'));
    const provider = model([{ text: '当前资料服务不可用，未读取文件。' }]);
    const result = await answerWithGroundedAgent(options());
    expect(result.agentLoopState?.status).toBe('completed');
    expect(JSON.stringify(provider.doStreamCalls[0].prompt)).toContain('内置服务工具目录读取失败');
    expect(JSON.stringify(provider.doStreamCalls[0].prompt)).not.toContain('private IPC details');
  });
  it('restores a run when an optional service goes offline without changing frozen capabilities', async () => {
    const input = mcpOptions();
    vi.mocked(listMcpTools).mockReset().mockResolvedValue({ tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: {} } }] });
    model([{ error: new Error('model temporarily offline') }]);
    await expect(answerWithGroundedAgent(input)).rejects.toThrow('model temporarily offline');
    const saved = structuredClone(input.execution.record);
    vi.mocked(listMcpTools).mockReset().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: {} } },
        { name: 'newly_added', inputSchema: { type: 'object', properties: {} } }] });
    const provider = model([{ text: '部分服务暂不可用，未执行操作。' }]);
    const result = await answerWithGroundedAgent({ ...input, execution: new DurableExecution('fixture', saved, input.budget) });
    expect(result.agentLoopState?.status).toBe('completed');
    const declarations = provider.doStreamCalls[0].tools?.map(t => t.name) ?? [];
    expect(declarations).toContain('mcp_good_lookup'); expect(declarations).not.toContain('mcp_bad_lookup');
    expect(declarations).not.toContain('mcp_good_newly_added');
  });
  it('does not expand the original tool set when an unavailable catalog recovers', async () => {
    vi.mocked(listTools).mockRejectedValueOnce(new Error('offline'));
    const first = await createAssistantTools(options());
    const restored = await createAssistantTools({ ...options(), restoredState: first.snapshot() });
    expect(restored.tools.read_segment_content).toBeUndefined();
    expect(restored.identityToolNames).toEqual(first.identityToolNames);
  });
});

describe('SDK failure results reach the model through production wiring', () => {
  it('keeps genuine keyword fallback evidence without leaking successful-search warnings', async () => {
    vi.mocked(listTools).mockResolvedValue([{ name: 'search_segments', description: 'Search', parameters_schema: {
      type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }]);
    vi.mocked(invokeAssistantTool).mockResolvedValue({ query: 'participants', mode: 'semantic_fallback_keyword',
      index_generation: 1, total_hit_count: 1, warnings: ['Embedding unavailable at C:\\Private\\models\\secret-model.onnx; Authorization: Bearer secret-token'],
      entries: [{ entry_id: 'entry', entry_title: 'Paper', hit_count: 1, max_score: 1, hits: [{
        entry_id: 'entry', entry_title: 'Paper', target: { kind: 'segment', entry_id: 'entry', segment_uid: 's1', page_idx: 2 },
        snippet: '42 participants.', score: 1
      }] }]
    });
    const provider = model([{ call: { name: 'search_segments', args: { query: 'participants' } } },
      { text: '关键词检索的片段显示 42 participants [S1]。' }]);
    const result = await answerWithGroundedAgent(options());
    expect(result.agentLoopState?.status).toBe('completed');
    expect(result.toolEvents).toContainEqual(expect.objectContaining({ toolName: 'search_segments', status: 'done' }));
    expect(result.sources[0]).toMatchObject({ segment_uid: 's1', quote: '42 participants.' });
    expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('keyword fallback results');
    expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('42 participants.');
    expect(JSON.stringify([provider.doStreamCalls, result.toolEvents])).not.toMatch(/Private|secret-model|Authorization|secret-token/);
  });

  it('rejects a native error envelope before turning it into a successful read', async () => {
    vi.mocked(invokeAssistantTool).mockResolvedValue({ ok: false, error: 'HTTP 403 Authorization: Bearer secret-value' });
    const provider = model([{ call: readCall }, { text: '读取未完成，没有足够证据。' }]);
    const result = await answerWithGroundedAgent(options());
    expect(result.agentLoopState?.status).toBe('completed');
    expect(result.toolEvents).toContainEqual(expect.objectContaining({ toolName: read.name, status: 'error' }));
    const prompt = JSON.stringify(provider.doStreamCalls[1].prompt);
    expect(prompt).toContain('TOOL_EXECUTION_FAILED');
    expect(prompt).not.toContain('secret-value');
    expect(result.sources).toEqual([]);
  });

  it.each(['returned error', 'thrown error'])('gates MCP writes after %s while allowing a local read', async mode => {
    const input = options();
    input.runtimeSettings.mainAssistant.allowedMcpServerIds = ['server'];
    input.runtimeSettings.mcpServers = [{ id: 'server', name: 'Server', command: 'unused', enabled: true,
      description: '', allowedToolNames: ['write'] }];
    input.runtimeSettings.toolPackages = [{ id: 'external', name: 'External', description: '', enabled: true,
      kind: 'mcp', mcpServerId: 'server', permissionMode: 'allow', allowedToolIds: ['mcp.server.write'] }];
    Object.assign(input, buildDirectExecution(input.runtimeSettings, 'Read'));
    vi.mocked(listMcpTools).mockResolvedValue({ tools: [{ name: 'write', inputSchema: { type: 'object', properties: {} } }] });
    if (mode === 'returned error') {
      vi.mocked(invokeMcpTool).mockResolvedValue({ output: { isError: true, content: [{ type: 'text', text: 'HTTP 403 secret-token remote body' }] } });
    } else vi.mocked(invokeMcpTool).mockRejectedValue(new Error('HTTP 403 secret-token remote body'));
    const call = { name: 'mcp_server_write', args: {} };
    const provider = model([{ call }, { call: readCall }, { call }, { text: '外部操作结果不明；只读核对取得 42 participants [S1]。' }]);
    const approval = vi.fn(async () => true);
    const result = await answerWithGroundedAgent({ ...input, requestToolApproval: approval });
    expect(result.agentLoopState?.status).toBe('completed');
    expect(invokeMcpTool).toHaveBeenCalledOnce();
    expect(invokeAssistantTool).toHaveBeenCalledOnce();
    expect(approval).toHaveBeenCalledOnce();
    expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('TOOL_OUTCOME_UNKNOWN');
    expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('HTTP 403');
    expect(provider.doStreamCalls[1].tools?.some(tool => tool.name === 'mcp_server_write')).toBe(false);
    expect(provider.doStreamCalls[1].tools?.some(tool => tool.name === read.name)).toBe(true);
    expect(input.budget.writesBlocked).toBe(true);
    expect(JSON.stringify(provider.doStreamCalls[3].prompt)).toContain('TOOL_NOT_AVAILABLE');
    expect(JSON.stringify(result.toolEvents)).not.toContain('secret-token');
    expect(JSON.stringify(provider.doStreamCalls)).not.toContain('secret-token');
  });

  it('keeps partial paper import identities and tells the model not to retry the entire batch', async () => {
    vi.mocked(listTools).mockResolvedValue([{ name: 'import_papers', description: 'Import', parameters_schema: {
      type: 'object', properties: { paper_ids: { type: 'array', items: { type: 'string' } } }, required: ['paper_ids'] } }]);
    vi.mocked(runResearchTool).mockResolvedValue({ results: [
      { id: 'paper-1', entry_id: 'entry-new', status: 'imported' },
      { id: 'paper-2', status: 'failed', error: 'HTTP 404 https://private.invalid/?token=secret-value' }
    ] });
    const provider = model([{ call: { name: 'import_papers', args: { paper_ids: ['paper-1', 'paper-2'] } } },
      { text: '一篇已入库，另一篇未完成；请核对资料库。' }]);
    const result = await answerWithGroundedAgent({ ...options(), requestToolApproval: async () => true });
    expect(result.agentLoopState?.status).toBe('completed');
    expect(result.toolEvents).toContainEqual(expect.objectContaining({ toolName: 'import_papers', status: 'error' }));
    const prompt = JSON.stringify(provider.doStreamCalls[1].prompt);
    expect(prompt).toContain('TOOL_PARTIAL_FAILURE');
    expect(prompt).toContain('entry-new');
    expect(prompt).toContain('不要自动重试整个批次');
    expect(prompt).not.toContain('secret-value');
    expect(runResearchTool).toHaveBeenCalledOnce();
  });

  it('marks missing native import consent as not executed and continues with reads', async () => {
    vi.mocked(listTools).mockResolvedValue([read, { name: 'import_papers', description: 'Import', parameters_schema: {
      type: 'object', properties: { paper_ids: { type: 'array', items: { type: 'string' } } }, required: ['paper_ids'] } }]);
    vi.mocked(runResearchTool).mockRejectedValue(new ResearchImportNotApprovedError('本地确认已失效'));
    const provider = model([{ call: { name: 'import_papers', args: { paper_ids: ['paper-1'] } } },
      { call: readCall }, { text: '未执行导入；已有片段提到 42 participants [S1]。' }]);
    const input = options();
    const result = await answerWithGroundedAgent({ ...input, requestToolApproval: async () => true });
    expect(result.agentLoopState?.status).toBe('completed');
    expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('TOOL_APPROVAL_UNAVAILABLE');
    expect(input.budget.writesBlocked).toBe(false);
    expect(invokeAssistantTool).toHaveBeenCalledOnce();
  });

  it('returns a missing confirmation host as not executed without calling the tool', async () => {
    vi.mocked(listTools).mockResolvedValue([{ name: 'import_papers', description: 'Import', parameters_schema: {
      type: 'object', properties: { paper_ids: { type: 'array', items: { type: 'string' } } }, required: ['paper_ids'] } }]);
    const provider = model([{ call: { name: 'import_papers', args: { paper_ids: ['paper-1'] } } },
      { text: '当前入口无法取得确认，未执行导入。' }]);
    const result = await answerWithGroundedAgent(options());
    expect(result.agentLoopState?.status).toBe('completed');
    expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('TOOL_APPROVAL_UNAVAILABLE');
    expect(runResearchTool).not.toHaveBeenCalled();
  });

  it('lets the model correct a rejected title before any create operation was dispatched', async () => {
    const provider = model([{ call: { name: 'create_entry', args: { title: '   ' } } },
      { call: { name: 'create_entry', args: { title: 'Valid title' } } }, { text: '已创建条目 Valid title。' }]);
    const create = vi.fn(async (title: string) => ({ id: 'created', title, description: '', updatedAt: '2026-10-03' }));
    const input = options();
    const result = await answerWithGroundedAgent({ ...input, onCreateEntry: create, requestToolApproval: async () => true });
    expect(result.agentLoopState?.status).toBe('completed');
    expect(create).toHaveBeenCalledExactlyOnceWith('Valid title');
    expect(input.budget.writesBlocked).toBe(false);
    expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('TOOL_INVALID_ARGUMENTS');
    expect(JSON.stringify(provider.doStreamCalls[1].prompt)).not.toContain('TOOL_OUTCOME_UNKNOWN');
  });
});
