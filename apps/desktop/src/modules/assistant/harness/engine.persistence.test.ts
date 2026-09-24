import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { getAssistantContextSnapshot, loadAgentRuntimeSettings, invokeAssistantTool, type LlmProfile } from '@/shared/ipc/assistantApi';
import { saveAgentExecution, readAgentExecution, type AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';
import { runAssistantHarness, AssistantHarnessError } from './engine';
import { acknowledgeExecution } from './durableHarness';
import { AgentPersistenceError } from '../agent-core';
import { createNeuinkModel } from '../sdk/provider';
import { scriptedModel } from '../sdk/testHelpers/model';
import { readNote } from '@/shared/ipc/workspaceApi';
import { getAssistantRouteSignals } from '@/shared/ipc/assistantRoutingApi';
vi.mock('@/shared/ipc/assistantRoutingApi', () => ({ getAssistantRouteSignals: vi.fn(async () => ({ status: 'unavailable', scores: [] })) }));

vi.mock('../sdk/provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: () => ({}) }));
vi.mock('@/shared/ipc/workspaceApi', () => ({ readNote: vi.fn() }));

vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), generateText: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', async original => ({
  ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  getAssistantContextSnapshot: vi.fn(), loadAgentRuntimeSettings: vi.fn(),
  loadPrompt: async () => '{{question}}',
  listTools: async () => [{ name: 'read_segment_content', description: 'Read evidence', parameters_schema: {
    type: 'object', properties: { entry_id: { type: 'string' }, segment_uid: { type: 'string' } }, required: ['entry_id', 'segment_uid']
  } }],
  invokeAssistantTool: vi.fn(),
}));
vi.mock('@/shared/ipc/agentExecutionApi', () => ({ saveAgentExecution: vi.fn(), readAgentExecution: vi.fn() }));

const options = { root: 'fixture', conversationId: '7ifDV_d90PAk6BE9', question: '整理笔记',
  settings: { id: 'test', model: 'test', base_url: 'https://example.invalid', max_context_length: 64000 } as LlmProfile,
  scope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] } };
let stored: AgentExecutionRecord;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAssistantContextSnapshot).mockResolvedValue({ active_entry: null, active_note: null,
    document: null, pinned_segments: [], warnings: [] });
  vi.mocked(loadAgentRuntimeSettings).mockResolvedValue(null);
  vi.mocked(saveAgentExecution).mockImplementation(async (_, record) => {
    stored = structuredClone({ ...record, revision: record.revision + 1 });
    return structuredClone(stored);
  });
  vi.mocked(readAgentExecution).mockImplementation(async () => structuredClone(stored));
  vi.mocked(createNeuinkModel).mockReturnValue(scriptedModel([{ text: '请先选择需要整理的论文。' }]));
  vi.mocked(invokeAssistantTool).mockResolvedValue({ entry_id: 'entry', entry_title: 'Paper', segment_uid: 's1', page_idx: 2, text: '42 participants.' });
  vi.mocked(readNote).mockResolvedValue({ title: 'Note', markdown: 'Old\n', links: [] } as never);
});

describe('real harness wiring (only model and IPC transports are replaced)', () => {
  it('persists and resumes the main Agent response without a planner, memory call or duplicate model request', async () => {
    const answer = await runAssistantHarness(options);
    expect(answer.answer).toContain('选择');
    expect(answer.taskState?.status).toBe('completed');
    expect(stored.payload.budget).toMatchObject({ turns: 1, inputTokens: 10, outputTokens: 10 });
    expect(stored.conversationId).toBe(options.conversationId);
    const resumed = await runAssistantHarness({ ...options, resumeExecutionId: answer.executionId });
    expect(resumed.answer).toBe(answer.answer);
    expect(generateText).not.toHaveBeenCalled();
    expect(createNeuinkModel).toHaveBeenCalledOnce();
    await acknowledgeExecution(options.root, answer.executionId!, false);
    expect(stored.status).toBe('completed');
  });

  it('answers a greeting in exactly one model turn with no synthetic plan', async () => {
    const model = scriptedModel([{ text: '你好！' }]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const answer = await runAssistantHarness({ ...options, question: '你好' });
    expect(model.doStreamCalls).toHaveLength(1);
    expect(generateText).not.toHaveBeenCalled();
    expect(answer.plan).toBeUndefined();
    expect(answer.conversationMemory).toBeUndefined();
    expect(answer.agentRun?.nodes.some(node => node.kind === 'planner')).toBe(false);
    expect(model.doStreamCalls[0].tools ?? []).toHaveLength(0);
    expect(getAssistantContextSnapshot).not.toHaveBeenCalled();
    expect(getAssistantRouteSignals).not.toHaveBeenCalled();
    expect(stored.payload.requestRoute).toMatchObject({ path: 'lightweight_chat' });
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).not.toContain('Typed Mention Map');
  });

  it('keeps greeting-like mixed tasks and selected reading context in the normal Agent', async () => {
    const model = scriptedModel([{ text: '请指定要修改的标题。' }]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    await runAssistantHarness({ ...options, question: '你好，修改标题' });
    expect(stored.payload.requestRoute).toMatchObject({ path: 'main_agent' });
    expect(getAssistantContextSnapshot).toHaveBeenCalledOnce();
    expect(JSON.stringify(model.doStreamCalls[0].tools)).toContain('note_propose_patch');
  });

  it('does not drop reading context just because the latest text is a greeting', async () => {
    await runAssistantHarness({ ...options, question: '你好', currentEntry: { id: 'entry', title: 'Paper' } });
    expect(stored.payload.requestRoute).toMatchObject({ path: 'main_agent', reason: 'context' });
    expect(getAssistantContextSnapshot).toHaveBeenCalledOnce();
  });

  it('restores the frozen route after a provider failure instead of rerouting the original task', async () => {
    vi.mocked(getAssistantRouteSignals).mockResolvedValue({ status: 'ready', version: 1, model: 'fixture',
      scores: [{ route: 'read', similarity: 0.9 }, { route: 'other', similarity: 0.6 }] });
    vi.mocked(createNeuinkModel).mockImplementationOnce(() => { throw new Error('provider failed'); });
    await expect(runAssistantHarness(options)).rejects.toThrow('provider failed');
    const frozenRoute = structuredClone(stored.payload.requestRoute);
    expect(getAssistantRouteSignals).toHaveBeenCalledOnce();
    const result = await runAssistantHarness({ ...options, resumeExecutionId: stored.id, question: '你好' });
    expect(result.answer).toContain('选择');
    expect(stored.payload.requestRoute).toEqual(frozenRoute);
    expect(getAssistantRouteSignals).toHaveBeenCalledOnce();
  });

  it('keeps paper-note sources, immutable proposal verification and approval in the direct loop', async () => {
    vi.mocked(createNeuinkModel).mockReturnValue(scriptedModel([
      { call: { name: 'read_segment_content', args: { entry_id: 'entry', segment_uid: 's1' } } },
      { call: { name: 'note_propose_create', args: { action: 'create', target: 'markdown_note', entry_id: 'entry', title: 'Trial', markdown: '42 participants [S1].', source_markers: ['S1'] } } },
      { text: '笔记已准备，等待确认 [S1]。' }
    ]));
    const answer = await runAssistantHarness({ ...options, scope: { ...options.scope, entry_ids: ['entry'], entry_titles: ['Paper'] } });
    expect(answer.taskState?.status).toBe('awaiting_approval');
    expect(answer.noteProposals?.[0]).toMatchObject({ status: 'pending', proposalDigest: expect.any(String), sources: [expect.objectContaining({ segmentUid: 's1', pageIdx: 2 })] });
    expect(invokeAssistantTool).toHaveBeenCalledTimes(1);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('does not expose or execute writes in plan mode and freezes the mode across recovery', async () => {
    const onCreateEntry = vi.fn();
    const model = scriptedModel([
      { call: { name: 'create_entry', args: { title: 'Forbidden' } } },
      { text: '1. 阅读论文。2. 整理笔记。请切换普通执行后确认。' }
    ]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const answer = await runAssistantHarness({ ...options, onCreateEntry, composerSnapshot: { mentions: [], text: '先给方案', executionMode: 'plan' } });
    expect(answer.taskState?.status).toBe('awaiting_user');
    expect(onCreateEntry).not.toHaveBeenCalled();
    expect(answer.noteProposals).toHaveLength(0);
    expect(JSON.stringify(model.doStreamCalls[0].tools)).not.toContain('create_entry');
    expect(stored.payload.input).toMatchObject({ composerSnapshot: { executionMode: 'plan' } });
    const resumed = await runAssistantHarness({ ...options, resumeExecutionId: answer.executionId });
    expect(resumed.taskState?.spec.executionMode).toBe('plan');
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it('requires a fresh note read before editing and returns an unapplied line patch', async () => {
    const patch = { action: 'patch', target: 'markdown_note', entry_id: 'entry', note_id: 'note', title: 'Note',
      patch_operations: [{ type: 'replace_lines', start_line: 1, end_line: 1, expected_text: 'Old', new_text: 'New' }] };
    const model = scriptedModel([
      { call: { name: 'note_propose_patch', args: patch } },
      { call: { name: 'read_note', args: { entry_id: 'entry', note_id: 'note' } } },
      { call: { name: 'note_propose_patch', args: patch } },
      { text: '已准备修改，请确认。' }
    ]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const answer = await runAssistantHarness({ ...options, scope: { ...options.scope, entry_ids: ['entry'], entry_titles: ['Paper'] } });
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('Read the current target note');
    expect(readNote).toHaveBeenCalledOnce();
    expect(answer.noteProposals).toHaveLength(1);
    expect(answer.noteProposals?.[0]).toMatchObject({ action: 'patch', beforeMarkdown: 'Old\n', afterMarkdown: 'New\n', status: 'pending' });
    expect(answer.taskState?.status).toBe('awaiting_approval');
  });

  it('rejects uncited paper-derived notes before publishing and permits a corrected inline citation', async () => {
    const base = { action: 'create', target: 'markdown_note', entry_id: 'entry', title: 'Trial' };
    vi.mocked(createNeuinkModel).mockReturnValue(scriptedModel([
      { call: { name: 'read_segment_content', args: { entry_id: 'entry', segment_uid: 's1' } } },
      { call: { name: 'note_propose_create', args: { ...base, markdown: '42 participants.' } } },
      { call: { name: 'note_propose_create', args: { ...base, markdown: '42 participants [S1].' } } },
      { text: '请确认笔记。' }
    ]));
    const answer = await runAssistantHarness({ ...options, scope: { ...options.scope, entry_ids: ['entry'], entry_titles: ['Paper'] } });
    expect(answer.noteProposals).toHaveLength(1);
    expect(answer.noteProposals?.[0].sources[0]).toMatchObject({ segmentUid: 's1', pageIdx: 2 });
  });

  it('fails closed on permission read errors instead of using default grants', async () => {
    vi.mocked(loadAgentRuntimeSettings).mockRejectedValue(new Error('private path must not leak'));
    await expect(runAssistantHarness(options)).rejects.toThrow('不会改用默认权限');
    expect(generateText).not.toHaveBeenCalled();
    expect(stored.status).toBe('failed');
  });

  it('retains the classified error and run diagnostics when a checkpoint fails inside the real harness', async () => {
    const save = vi.mocked(saveAgentExecution).getMockImplementation()!;
    vi.mocked(saveAgentExecution).mockImplementationOnce(save).mockRejectedValue('Checkpoint too large');
    let caught: unknown;
    try { await runAssistantHarness(options); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AssistantHarnessError);
    expect((caught as AssistantHarnessError).cause).toBeInstanceOf(AgentPersistenceError);
    expect((caught as Error).message).toContain('16 MiB');
    expect((caught as AssistantHarnessError).agentRun.status).toBe('failed');
    expect(generateText).not.toHaveBeenCalled();
    expect(saveAgentExecution).toHaveBeenCalledTimes(2);
  });
});
