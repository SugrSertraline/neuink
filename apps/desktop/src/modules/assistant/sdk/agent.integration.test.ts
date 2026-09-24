import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { jsonSchema, tool, type ToolSet } from 'ai';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { invokeAssistantTool, type LlmProfile } from '@/shared/ipc/assistantApi';
import { createNeuinkModel } from './provider';
import { answerWithGroundedAgent } from './qna';
import { agentExecutors, createAgentDriver } from './agentDriver';
import { finalizeVerifiedProposals } from '../runtime/verifiedProposal';
import { DurableExecution } from '../runtime/durableExecution';
import { Agent, RunBudget } from '../agent-core';
import { saveAgentExecution, type AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';

vi.mock('@/shared/ipc/agentExecutionApi', () => ({ saveAgentExecution: vi.fn(async (_, record) => ({ ...record, revision: record.revision + 1 })) }));

vi.mock('./provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: () => ({}) }));
vi.mock('@/shared/ipc/assistantApi', async (original) => ({
  ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  loadPrompt: vi.fn(async () => '{{question}}'),
  listTools: vi.fn(async () => [{ name: 'read_segment_content', description: 'Read evidence', parameters_schema: {
    type: 'object', properties: { entry_id: { type: 'string' }, segment_uid: { type: 'string' } }, required: ['entry_id', 'segment_uid']
  } }]),
  invokeAssistantTool: vi.fn(async () => ({ entry_id: 'entry', entry_title: 'Paper', segment_uid: 's1', page_idx: 2, text: 'The trial enrolled 42 participants.' }))
}));
const profile = { id: 'test', model: 'test', base_url: 'https://example.invalid', api_key: null } as LlmProfile;
const scope = { entry_ids: ['entry'], entry_titles: ['Paper'], tag_ids: [], tag_names: [] };

function fakeModel(turns: Array<{ text?: string; truncated?: boolean; call?: { name: string; args: unknown } }>) {
  let index = 0;
  return new MockLanguageModelV3({ doStream: async () => {
    const turn = turns[index++];
    if (!turn) throw new Error('Unexpected provider turn');
    return { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      ...(turn.call ? [{ type: 'tool-call' as const, toolCallId: `call-${index}`, toolName: turn.call.name, input: JSON.stringify(turn.call.args) }] : [
        { type: 'text-start' as const, id: 'text' }, { type: 'text-delta' as const, id: 'text', delta: turn.text! }, { type: 'text-end' as const, id: 'text' }
      ]),
      { type: 'finish', finishReason: { unified: turn.truncated ? 'length' : turn.call ? 'tool-calls' : 'stop', raw: turn.truncated ? 'length' : turn.call ? 'tool_calls' : 'stop' },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } } }
    ] }) };
  } });
}
beforeEach(() => vi.clearAllMocks());

describe('production agent wiring', () => {
  it('waits for structured choices, then still requires separate write approval', async () => {
    const model = fakeModel([
      { call: { name: 'ask_user', args: { title: '选择输出', previewMarkdown: '## 研究问题\n\n## 方法', questions: [
        { id: 'output', title: '如何继续？', multiple: false, options: [{ id: 'entry', label: '新建条目' }, { id: 'chat', label: '仅回答' }] }
      ] } } },
      { call: { name: 'create_entry', args: { title: 'WireWay' } } }, { text: '已完成。' }
    ]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    let answer!: (value: import('../runtime/userInput').UserInputAnswers) => void;
    let confirm!: (value: boolean) => void;
    const requestInput = vi.fn((_request: import('../runtime/userInput').UserInputRequest) => new Promise<import('../runtime/userInput').UserInputAnswers>(resolve => { answer = resolve; }));
    const approval = vi.fn(() => new Promise<boolean>(resolve => { confirm = resolve; }));
    const create = vi.fn(async (title: string) => ({ id: 'new', title, description: '', updatedAt: '' }));
    const result = answerWithGroundedAgent({ root: 'fixture', question: '准备资料', scope, settings: profile,
      activeExecution: { agent: settings.mainAssistant }, runtimeSettings: settings,
      invocationPlan: { executionMode: 'act', enabledToolIds: ['create_entry'], mainAssistantId: 'main-assistant', missing: [], mode: 'agent_execute', rationale: '', subagentTasks: [], writePolicy: 'proposal_only' },
      requestUserInput: requestInput, requestToolApproval: approval, onCreateEntry: create });
    await vi.waitFor(() => expect(requestInput).toHaveBeenCalledOnce());
    expect(model.doStreamCalls).toHaveLength(1);
    expect(requestInput.mock.calls[0][0]).toMatchObject({ title: '选择输出', previewMarkdown: '## 研究问题\n\n## 方法' });
    expect(create).not.toHaveBeenCalled();
    answer({ output: { selected: ['entry'], text: '请继续' } });
    await vi.waitFor(() => expect(approval).toHaveBeenCalledOnce());
    expect(create).not.toHaveBeenCalled();
    confirm(true);
    const completed = await result;
    expect(completed.answer).toBe('已完成。');
    expect(completed.toolEvents).toContainEqual(expect.objectContaining({ toolName: 'ask_user', status: 'done', summary: expect.stringContaining('新建条目') }));
    expect(create).toHaveBeenCalledTimes(1);
    const secondPrompt = JSON.stringify(model.doStreamCalls[1].prompt);
    expect(secondPrompt).toContain('writeApproved');
    expect(secondPrompt).toContain('false');
  });
  it('waits for explicit host confirmation before creating an entry through the real tool registry', async () => {
    const model = fakeModel([{ call: { name: 'create_entry', args: { title: 'Confirmed entry' } } }, { text: 'Created.' }]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    let confirm!: (value: boolean) => void;
    const requestApproval = vi.fn(() => new Promise<boolean>(resolve => { confirm = resolve; }));
    const create = vi.fn(async (title: string) => ({ id: 'created', title, description: '', updatedAt: '' }));
    const pending = answerWithGroundedAgent({
      activeExecution: { agent: settings.mainAssistant }, runtimeSettings: settings,
      invocationPlan: { executionMode: 'act', enabledToolIds: ['create_entry'], mainAssistantId: 'main-assistant', missing: [], mode: 'agent_execute', rationale: '', subagentTasks: [], writePolicy: 'proposal_only' },
      question: 'Create an entry', root: 'fixture', scope, settings: profile, requestToolApproval: requestApproval, onCreateEntry: create
    });
    await vi.waitFor(() => expect(requestApproval).toHaveBeenCalledOnce());
    expect(create).not.toHaveBeenCalled();
    expect(requestApproval.mock.calls[0]).toEqual([{ toolName: 'create_entry', toolCallId: 'call-1', input: { title: 'Confirmed entry' } }, undefined]);
    confirm(true);
    expect((await pending).answer).toBe('Created.');
    expect(create).toHaveBeenCalledExactlyOnceWith('Confirmed entry');
  });
  it('returns missing citation placement to the model and accepts only the corrected note', async () => {
    const args = { action: 'create', target: 'markdown_note', entry_id: 'entry', title: 'Trial', source_markers: ['S1'] };
    const model = fakeModel([
      { call: { name: 'read_segment_content', args: { entry_id: 'entry', segment_uid: 's1' } } },
      { call: { name: 'note_propose_create', args: { ...args, markdown: '42 participants.' } } },
      { call: { name: 'note_propose_create', args: { ...args, markdown: '42 participants [S1].\n\nFollow-up questions.' } } },
      { text: 'Prepared a note [S1].' }
    ]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const runtimeSettings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    const result = await answerWithGroundedAgent({
      activeExecution: { agent: runtimeSettings.mainAssistant }, runtimeSettings,
      invocationPlan: { enabledToolIds: ['read_segment_content', 'note.propose_create'],
        mainAssistantId: 'main-assistant', missing: [], mode: 'agent_execute', rationale: '',
        subagentTasks: [], writePolicy: 'proposal_only' },
      question: 'Prepare a grounded note.', root: 'fixture', scope, settings: profile,
      plan: { citationPolicy: 'required', capabilities: [], intent: 'note_create', noteAction: 'create',
        needsNoteProposal: true, target: { kind: 'markdown_note', entryId: 'entry' } } as never
    });
    expect(result.noteProposals).toHaveLength(1);
    expect(result.noteProposals![0].markdown).toBe('42 participants [S1].\n\nFollow-up questions.');
    expect(JSON.stringify(model.doStreamCalls[2].prompt)).toContain('no inline citation');
    expect(invokeAssistantTool).toHaveBeenCalledTimes(1);
  });
  it('never executes a tool call from a length-truncated provider response', async () => {
    vi.mocked(createNeuinkModel).mockReturnValue(fakeModel([
      { truncated: true, call: { name: 'write', args: {} } }, { text: 'No action was taken.' }
    ]));
    const execute = vi.fn(async () => 'written');
    const tools: ToolSet = { write: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute }) };
    const agent = new Agent({ driver: createAgentDriver({ settings: profile, system: '', tools }),
      tools: agentExecutors(tools), messages: [{ role: 'user' as const, content: 'Write' }], budget: new RunBudget() });
    expect(await agent.run()).toBe('No action was taken.');
    expect(execute).not.toHaveBeenCalled();
  });
  it('resumes persisted evidence and pending proposals without rereading or proposing twice', async () => {
    const runtimeSettings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    const options = {
      activeExecution: { agent: runtimeSettings.mainAssistant }, runtimeSettings,
      invocationPlan: { enabledToolIds: ['read_segment_content', 'note.propose_create'], requiredToolIds: ['read_segment_content', 'note.propose_create'],
        mainAssistantId: 'main-assistant', missing: [], mode: 'agent_execute', rationale: '', subagentTasks: [], writePolicy: 'proposal_only' },
      question: 'Read and draft a note.', root: 'fixture', scope, settings: profile,
      plan: { citationPolicy: 'required', capabilities: [], intent: 'note_create', noteAction: 'create', needsNoteProposal: true,
        target: { kind: 'markdown_note', entryId: 'entry' } }
    } as unknown as Parameters<typeof answerWithGroundedAgent>[0];
    const first = fakeModel([
      { call: { name: 'read_segment_content', args: { entry_id: 'entry', segment_uid: 's1' } } },
      { call: { name: 'note_propose_create', args: { action: 'create', target: 'markdown_note', entry_id: 'entry', title: 'Trial note', markdown: '42 participants [S1].', source_markers: ['S1'] } } }
    ]);
    vi.mocked(createNeuinkModel).mockReturnValue(first);
    const budget = new RunBudget();
    const record: AgentExecutionRecord = { id: 'execution-1', conversationId: 'conversation', revision: 0, status: 'running', updatedAt: '', payload: {} };
    await expect(answerWithGroundedAgent({ ...options, budget, execution: new DurableExecution('fixture', record, budget) })).rejects.toThrow('Unexpected provider turn');
    const saves = vi.mocked(saveAgentExecution).mock.calls;
    const persisted = structuredClone(saves[saves.length - 1][1]);
    const restoredBudget = new RunBudget();
    restoredBudget.restore(persisted.payload.budget as ReturnType<RunBudget['snapshot']>);
    const second = fakeModel([{ text: 'The note is ready for review [S1].' }]);
    vi.mocked(createNeuinkModel).mockReturnValue(second);
    const result = await answerWithGroundedAgent({ ...options, budget: restoredBudget, execution: new DurableExecution('fixture', persisted, restoredBudget) });
    expect(invokeAssistantTool).toHaveBeenCalledTimes(1);
    expect(second.doStreamCalls).toHaveLength(1);
    expect(result.noteProposals).toHaveLength(1);
    expect(result.noteProposals![0].sources[0]).toMatchObject({ marker: 'S1', pageIdx: 2, segmentUid: 's1' });
    expect(restoredBudget.turns).toBe(4);
    expect(restoredBudget.toolCalls).toBe(2);
  });
  it('reads a paper and produces a pending note with verifiable local Source Link coordinates', async () => {
    const model = fakeModel([
      { call: { name: 'read_segment_content', args: { entry_id: 'entry', segment_uid: 's1' } } },
      { call: { name: 'note_propose_create', args: { action: 'create', target: 'markdown_note', entry_id: 'entry', title: 'Trial note', markdown: '42 participants [S1].', source_markers: ['S1'] } } },
      { text: 'Prepared a note for review [S1].' }
    ]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const runtimeSettings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    const result = await answerWithGroundedAgent({
      activeExecution: { agent: runtimeSettings.mainAssistant }, runtimeSettings,
      invocationPlan: { enabledToolIds: ['read_segment_content', 'note.propose_create'], requiredToolIds: ['read_segment_content', 'note.propose_create'],
        mainAssistantId: 'main-assistant', missing: [], mode: 'agent_execute', rationale: '', subagentTasks: [], writePolicy: 'proposal_only' },
      question: 'Read the paper and prepare a note.', root: 'fixture', scope, settings: profile,
      plan: { citationPolicy: 'required', capabilities: [], intent: 'note_create', noteAction: 'create', needsNoteProposal: true,
        target: { kind: 'markdown_note', entryId: 'entry' } } as never
    });
    expect(result.agentLoopState?.status).toBe('awaiting_approval');
    expect(result.noteProposals).toHaveLength(1);
    expect(result.noteProposals![0].sources[0]).toMatchObject({ entryId: 'entry', segmentUid: 's1', pageIdx: 2, marker: 'S1' });
    const verified = finalizeVerifiedProposals(result.noteProposals!, 'task')[0];
    expect(verified.proposalDigest).toBeTruthy();
    const tampered = finalizeVerifiedProposals([{ ...result.noteProposals![0], markdown: 'changed' }], 'task')[0];
    expect(tampered.proposalDigest).not.toBe(verified.proposalDigest);
    expect(invokeAssistantTool).toHaveBeenCalledTimes(1); // No workspace write during generation.
  });

  it('uses the same loop for a child and carries its actual evidence into the parent answer', async () => {
    const model = fakeModel([
      { call: { name: 'task_run_subagent', args: { agent_id: 'evidence-agent', instruction: 'Read entry/s1 and cite it.' } } },
      { call: { name: 'read_segment_content', args: { entry_id: 'entry', segment_uid: 's1' } } },
      { text: '42 participants [S1].' },
      { text: 'The paper reports 42 participants [S1].' }
    ]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const runtimeSettings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    runtimeSettings.subagents[0].enabled = true;
    const result = await answerWithGroundedAgent({
      activeExecution: { agent: runtimeSettings.mainAssistant }, runtimeSettings,
      invocationPlan: { enabledToolIds: ['task.run_subagent', 'read_segment_content'], requiredToolIds: ['task.run_subagent'],
        mainAssistantId: 'main-assistant', missing: [], mode: 'agent_execute', rationale: '', subagentTasks: [], writePolicy: 'chat_only' },
      question: 'Delegate evidence reading.', root: 'fixture', scope, settings: profile,
      plan: { citationPolicy: 'required', capabilities: [], intent: 'paper_qa' } as never
    });
    expect(result.answer).toContain('[S1]');
    expect(result.sources).toEqual([{ entry_id: 'entry', entry_title: 'Paper', page_idx: 2, segment_uid: 's1', quote: 'The trial enrolled 42 participants.' }]);
    expect(result.agentLoopState?.status).toBe('completed');
    expect(model.doStreamCalls).toHaveLength(4);
    expect(invokeAssistantTool).toHaveBeenCalledExactlyOnceWith('read_segment_content', { root: 'fixture', entry_id: 'entry', segment_uid: 's1' });
    const parentContinuation = model.doStreamCalls[3].prompt;
    expect(JSON.stringify(parentContinuation)).toContain('42 participants [S1]');
  });
  it('resumes the same interrupted child actor with its saved source ledger and budget', async () => {
    const runtimeSettings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    runtimeSettings.subagents[0].enabled = true;
    const options = {
      activeExecution: { agent: runtimeSettings.mainAssistant }, runtimeSettings,
      invocationPlan: { enabledToolIds: ['task.run_subagent', 'read_segment_content'], requiredToolIds: ['task.run_subagent'],
        mainAssistantId: 'main-assistant', missing: [], mode: 'agent_execute', rationale: '', subagentTasks: [], writePolicy: 'chat_only' },
      question: 'Delegate evidence reading.', root: 'fixture', scope, settings: profile,
      plan: { citationPolicy: 'required', capabilities: [], intent: 'paper_qa' }
    } as unknown as Parameters<typeof answerWithGroundedAgent>[0];
    vi.mocked(createNeuinkModel).mockReturnValue(fakeModel([
      { call: { name: 'task_run_subagent', args: { agent_id: 'evidence-agent', instruction: 'Read entry/s1 and cite it.' } } },
      { call: { name: 'read_segment_content', args: { entry_id: 'entry', segment_uid: 's1' } } }
    ]));
    const budget = new RunBudget();
    const record: AgentExecutionRecord = { id: 'execution-child', conversationId: 'conversation', revision: 0, status: 'running', updatedAt: '', payload: {} };
    const execution = new DurableExecution('fixture', record, budget);
    await expect(answerWithGroundedAgent({ ...options, budget, execution })).rejects.toThrow('子任务执行中断');
    await execution.flush();
    const saved = structuredClone(record);
    const restoredBudget = new RunBudget();
    restoredBudget.restore(saved.payload.budget as ReturnType<RunBudget['snapshot']>);
    const second = fakeModel([{ text: '42 participants [S1].' }, { text: 'The trial had 42 participants [S1].' }]);
    vi.mocked(createNeuinkModel).mockReturnValue(second);
    const result = await answerWithGroundedAgent({ ...options, budget: restoredBudget,
      execution: new DurableExecution('fixture', saved, restoredBudget) });
    expect(invokeAssistantTool).toHaveBeenCalledTimes(1);
    expect(second.doStreamCalls).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({ segment_uid: 's1', page_idx: 2 });
    expect(restoredBudget.toolCalls).toBe(2);
    expect(restoredBudget.turns).toBe(5);
  });

  it('validates JSON-schema arguments before touching the application service', async () => {
    const execute = vi.fn(async () => 'saved');
    const tools: ToolSet = { change: tool({ inputSchema: jsonSchema({ type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false }), execute }) };
    const run = agentExecutors(tools).change;
    await expect(run({ value: 'wrong' }, { id: '1' })).rejects.toThrow('Invalid arguments');
    expect(execute).not.toHaveBeenCalled();
    expect(await run({ value: 3 }, { id: '2' })).toBe('saved');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('fails instead of inventing citation sources or switching to a fallback pipeline', async () => {
    const model = fakeModel([{ text: 'Claim [S999]' }, { text: 'Claim [S999]' }, { text: 'Claim [S999]' }]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    await expect(answerWithGroundedAgent({ question: 'Question', root: 'fixture', scope, settings: profile })).rejects.toThrow('未满足');
    expect(invokeAssistantTool).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(3);
  });
});
