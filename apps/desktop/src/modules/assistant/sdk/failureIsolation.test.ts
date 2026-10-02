import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { createNeuinkModel } from './provider';
import { answerWithGroundedAgent } from './qna';
import { createAssistantTools } from './tools';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { invokeAssistantTool, listTools, listMcpTools, loadPrompt, type LlmProfile } from '@/shared/ipc/assistantApi';
import { saveAgentExecution } from '@/shared/ipc/agentExecutionApi';
import { DurableExecution } from '../runtime/durableExecution';
import { buildDirectExecution } from '../runtime/executionPolicy';
import { AgentPersistenceError, RunBudget, type AgentCheckpoint } from '../agent-core';

vi.mock('./provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: () => ({}) }));
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  listTools: vi.fn(), listMcpTools: vi.fn(), invokeAssistantTool: vi.fn(), loadPrompt: vi.fn() }));
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
function model(turns: Array<{ text?: string; call?: typeof readCall | typeof childCall | { name: string; args: object }; error?: Error }>) {
  let index = 0;
  const value = new MockLanguageModelV3({ doStream: async () => {
    const turn = turns[index++];
    if (!turn) throw new Error('Unexpected turn');
    if (turn.error) throw turn.error;
    return { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      ...(turn.call ? [{ type: 'tool-call' as const, toolCallId: `call-${index}`, toolName: turn.call.name, input: JSON.stringify(turn.call.args) }]
        : [{ type: 'text-start' as const, id: 't' }, { type: 'text-delta' as const, id: 't', delta: turn.text! }, { type: 'text-end' as const, id: 't' }]),
      { type: 'finish', finishReason: { unified: turn.call ? 'tool-calls' : 'stop', raw: 'stop' },
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
    expect(JSON.stringify(provider.doStreamCalls[1].prompt)).toContain('Mind map needs one root and valid parents.');
    expect(result.toolEvents).toContainEqual(expect.objectContaining({
      id: 'call-1', toolName: 'present_diagram', status: 'error', error: 'Mind map needs one root and valid parents.'
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
    expect(parentPrompt).toContain('子任务执行失败'); expect(parentPrompt).toContain('42 participants');
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
