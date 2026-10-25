// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendConversationMessages, createConversation, listConversations, updateConversationMessage, type Conversation } from '@/shared/ipc/assistantApi';
import { runAssistantHarness } from '../harness/engine';
import { acknowledgeExecution } from '../harness/durableHarness';
import { getAssistantBackgroundRun, runAssistantPanelTask, setAssistantBackgroundRun } from './assistantRunController';
import { findAssistantBackgroundRun, getAssistantBackgroundRuns, guardAssistantView, stopAssistantBackgroundRun } from './assistantBackgroundRuns';
import { decideToolApproval, getToolApprovals } from '../runtime/toolApproval';
import { runLocalAgentHarness } from '../local-agent/runner';
import { CLAUDE_PROFILE, conversationLocalSession } from '../local-agent/session';
import { ASSISTANT_READ_FAILURES } from '@/shared/lib/assistantReadFailure';

vi.mock('@/shared/ipc/assistantApi', async original => ({
  ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  createConversation: vi.fn(), appendConversationMessages: vi.fn(),
  updateConversationMessage: vi.fn(), listConversations: vi.fn(), saveAgentRun: vi.fn(async () => {}),
}));
vi.mock('../harness/engine', () => ({ runAssistantHarness: vi.fn(), AssistantHarnessError: class extends Error {} }));
vi.mock('../harness/durableHarness', () => ({ acknowledgeExecution: vi.fn() }));
vi.mock('../local-agent/runner', () => ({runLocalAgentHarness:vi.fn()}));

const scope = { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] };
let disk: Conversation;
const lastMessage = () => disk.messages[disk.messages.length - 1];
function options() {
  return {
    conversation: null, root: 'fixture', entries: [], tags: [], scope,
    selectedProfile: { id: 'test' }, profiles: [], runEntry: null, runNote: null, runSegment: null,
    runSurface: { kind: 'library' }, runAbortControllerRef: { current: null },
    messageContextItems: [], submittedContextPlan: null,
    submittedComposerSnapshot: { text: 'hello', mentions: [] }, trimmedQuestion: 'hello',
    toolEventsByMessageId: {}, noteProposalsByMessageId: {}, resetComposer: false,
    forceNextScroll: vi.fn(), onAddAssistantContext: vi.fn(), onCreateAssistantEntry: vi.fn(),
    setBusy: vi.fn(), setComposerResetKey: vi.fn(), setConversation: vi.fn(),
    setConversations: vi.fn(), setError: vi.fn(), setHistoryOpen: vi.fn(),
    setNoteProposalsByMessageId: vi.fn(), setOptimisticMessages: vi.fn(),
    setStreamingMessageId: vi.fn(), setToolEventsByMessageId: vi.fn(),
  } as unknown as Parameters<typeof runAssistantPanelTask>[0];
}

beforeEach(() => {
  vi.resetAllMocks();
  disk = { id: '7ifDV_d90PAk6BE9', title: 'test', messages: [], scope_snapshot: scope,
    created_at: '', updated_at: '' };
  vi.mocked(createConversation).mockImplementation(async () => structuredClone(disk));
  vi.mocked(appendConversationMessages).mockImplementation(async (_, __, messages) => {
    disk.messages.push(...messages.map((message, index) => ({ ...message, message_id: `msg-${disk.messages.length + index}`,
      created_at: '', source_links: message.source_links ?? [] })));
    return structuredClone(disk);
  });
  vi.mocked(updateConversationMessage).mockImplementation(async (_, __, id, update) => {
    Object.assign(disk.messages.find(message => message.message_id === id)!, update);
    return structuredClone(disk);
  });
  vi.mocked(listConversations).mockResolvedValue([]);
  vi.mocked(acknowledgeExecution).mockResolvedValue(undefined);
});
afterEach(() => { setAssistantBackgroundRun(null); vi.useRealTimers(); });

describe('assistant production controller persistence boundaries', () => {
  it.each(['completed', 'canceled'] as const)('saves local thinking separately from the answer when %s', async status => {
    const input = options(); input.selectedProfile = CLAUDE_PROFILE;
    vi.mocked(runLocalAgentHarness).mockImplementation(async callbacks => {
      callbacks.onReasoningDelta?.('先检查来源。');
      callbacks.onDelta?.('临时答复');
      callbacks.onAnswerReset?.();
      callbacks.onReasoningDelta?.('\n\n再比较结果。');
      callbacks.onDelta?.('保留的答复');
      if (status === 'canceled') {
        input.runAbortControllerRef.current!.abort();
        callbacks.onReasoningDelta?.('停止后到达，不应保存');
        throw new Error('用户已停止任务');
      }
      return { answer: '最终答复', sources: [] };
    });
    await runAssistantPanelTask(input);
    expect(lastMessage().parts).toContainEqual({ type: 'reasoning', text: '先检查来源。\n\n再比较结果。' });
    expect(lastMessage().content).toContain(status === 'completed' ? '最终答复' : '保留的答复');
    expect(lastMessage().content).not.toContain('临时答复');
    expect(lastMessage().content).not.toContain('先检查来源');
    expect(JSON.stringify(lastMessage())).not.toContain('停止后到达');
  });
  it('discards a rejected answer while preserving completed tool receipts and the verification error', async () => {
    vi.mocked(runAssistantHarness).mockImplementation(async callbacks => {
      callbacks.onToolEvent?.({ id: 'imported', toolName: 'import_papers', status: 'done', summary: 'PDF 已下载入库 1 篇，尚未解析。' });
      callbacks.onDelta?.('收到，规则已确认。错误结论 [S999]。');
      throw new Error(ASSISTANT_READ_FAILURES.citation);
    });
    await runAssistantPanelTask(options());
    expect(lastMessage().content).not.toContain('规则已确认');
    expect(lastMessage().content).not.toContain('[S999]');
    expect(lastMessage().content).toContain('已完成的操作');
    expect(lastMessage().content).toContain('PDF 已下载入库 1 篇');
    expect(lastMessage().tool_events).toContainEqual(expect.objectContaining({ id: 'imported', status: 'done' }));
    expect(lastMessage().parts).toContainEqual({ type: 'error', message: ASSISTANT_READ_FAILURES.citation });
  });
  it('persists the local engine before startup and resumes its identity on the next turn', async () => {
    const input = options(); input.selectedProfile = CLAUDE_PROFILE;
    vi.mocked(runLocalAgentHarness).mockImplementation(async (_options,session,initialized) => {
      expect(conversationLocalSession(disk)?.sessionId).toBe(session.sessionId);
      initialized({...session,initialized:true});
      return {answer:'Claude 回答',sources:[]};
    });
    await runAssistantPanelTask(input);
    const identity = conversationLocalSession(disk)!;
    expect(identity.initialized).toBe(true); expect(runAssistantHarness).not.toHaveBeenCalled();
    const next = options(); next.conversation = structuredClone(disk);
    await runAssistantPanelTask(next);
    expect(vi.mocked(runLocalAgentHarness).mock.calls[1][1]).toEqual(identity);
    expect(lastMessage().content).toBe('Claude 回答');
  });
  it('keeps a local conversation local after startup failure and stores an actionable error', async () => {
    const input = options(); input.selectedProfile = CLAUDE_PROFILE;
    vi.mocked(runLocalAgentHarness).mockRejectedValue(new Error('Claude Code 无法启动，请检查安装。'));
    await runAssistantPanelTask(input);
    expect(conversationLocalSession(disk)?.initialized).toBe(false);
    expect(lastMessage().parts).toContainEqual({type:'error',message:'Claude Code 无法启动，请检查安装。'});
    expect(getAssistantBackgroundRuns()).toHaveLength(0);
  });
  it('persists a rejected approval as a normal stop without an error banner', async () => {
    const input = options();
    vi.mocked(runAssistantHarness).mockImplementation(async callbacks => {
      callbacks.onDelta?.('准备下载。');
      await callbacks.requestToolApproval!({ toolName: 'create_entry', toolCallId: 'reject', input: {} }, callbacks.abortSignal);
      callbacks.abortSignal?.throwIfAborted();
      throw new Error('Must stop before executing');
    });
    const run = runAssistantPanelTask(input);
    await vi.waitFor(() => expect(getToolApprovals()).toHaveLength(1));
    decideToolApproval(getToolApprovals()[0].id, false);
    await run;
    expect(lastMessage().content).toContain('准备下载。');
    expect(lastMessage().content).toContain('任务已停止');
    expect(lastMessage().parts?.some(part => part.type === 'error')).toBe(false);
    expect(input.setError).toHaveBeenLastCalledWith(null);
    expect(input.setBusy).toHaveBeenLastCalledWith(false);
    expect(getToolApprovals()).toHaveLength(0);
    expect(getAssistantBackgroundRuns()).toHaveLength(0);
  });
  it('keeps two conversations independent after switching views and stops only the selected task', async () => {
    const disks = new Map(['A', 'B'].map(id => [id, { ...structuredClone(disk), id }]));
    vi.mocked(appendConversationMessages).mockImplementation(async (_, id, messages) => {
      const target = disks.get(id)!;
      target.messages.push(...messages.map((message, index) => ({ ...message,
        message_id: `${id}-${index}`, created_at: '', source_links: [] })));
      return structuredClone(target);
    });
    vi.mocked(updateConversationMessage).mockImplementation(async (_, id, messageId, update) => {
      const target = disks.get(id)!;
      Object.assign(target.messages.find(message => message.message_id === messageId)!, update);
      return structuredClone(target);
    });
    type Result = Awaited<ReturnType<typeof runAssistantHarness>>;
    const pending = new Map<string, { callbacks: Parameters<typeof runAssistantHarness>[0]; resolve: (result: Result) => void }>();
    vi.mocked(runAssistantHarness).mockImplementation(callbacks => new Promise((resolve, reject) => {
      pending.set(callbacks.conversationId!, { callbacks, resolve });
      callbacks.abortSignal?.addEventListener('abort', () => reject(new Error('用户已停止任务')), { once: true });
    }));
    let generation = 0;
    const first = options();
    first.conversation = disks.get('A')!;
    const viewConversation = vi.fn();
    const viewBusy = vi.fn();
    first.setConversation = guardAssistantView(() => generation === 0, viewConversation);
    first.setBusy = guardAssistantView(() => generation === 0, viewBusy);
    const runA = runAssistantPanelTask(first);
    await vi.waitFor(() => expect(pending.has('A')).toBe(true));
    const controllerA = findAssistantBackgroundRun('fixture', 'A')!.abortController;

    generation++;
    viewConversation.mockClear(); viewBusy.mockClear();
    const second = options();
    second.conversation = disks.get('B')!;
    // Same panel ref: starting another conversation must not abort the first one.
    second.runAbortControllerRef = first.runAbortControllerRef;
    const runB = runAssistantPanelTask(second);
    await vi.waitFor(() => expect(pending.has('B')).toBe(true));
    expect(controllerA.signal.aborted).toBe(false);
    expect(getAssistantBackgroundRuns('fixture')).toHaveLength(2);
    pending.get('A')!.callbacks.onToolEvent?.({ id: 'a-tool', toolName: 'read', status: 'running' });
    expect(findAssistantBackgroundRun('fixture', 'A')!.toolEventsByMessageId['A-1']).toHaveLength(1);
    expect(findAssistantBackgroundRun('fixture', 'B')!.toolEventsByMessageId).toEqual({});

    stopAssistantBackgroundRun(findAssistantBackgroundRun('fixture', 'B')!.abortController);
    await runB;
    expect(controllerA.signal.aborted).toBe(false);
    expect(findAssistantBackgroundRun('fixture', 'A')).not.toBeNull();
    expect(disks.get('B')!.messages[1].content).toContain('任务已停止');
    expect(disks.get('B')!.messages[1].parts?.some(part => part.type === 'error')).toBe(false);
    expect(second.setError).toHaveBeenLastCalledWith(null);
    pending.get('A')!.resolve({ answer: 'A 的最终回答', sources: [] });
    await runA;
    expect(disks.get('A')!.messages[1].content).toBe('A 的最终回答');
    expect(viewConversation).not.toHaveBeenCalled();
    expect(viewBusy).not.toHaveBeenCalled();
    expect(getAssistantBackgroundRuns()).toHaveLength(0);
  });

  it('rejects a second writer for a running conversation without aborting it', async () => {
    const first = options(); first.conversation = disk;
    let finish!: (value: Awaited<ReturnType<typeof runAssistantHarness>>) => void;
    vi.mocked(runAssistantHarness).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const run = runAssistantPanelTask(first);
    await vi.waitFor(() => expect(finish).toBeDefined());
    const duplicate = options(); duplicate.conversation = disk;
    await runAssistantPanelTask(duplicate);
    expect(duplicate.setError).toHaveBeenCalledWith(expect.stringContaining('仍在运行'));
    expect(runAssistantHarness).toHaveBeenCalledTimes(1);
    expect(first.runAbortControllerRef.current?.signal.aborted).toBe(false);
    finish({ answer: 'done', sources: [] });
    await run;
  });

  it('does not overwrite a delivered result when history refresh fails', async () => {
    const input = options();
    vi.mocked(runAssistantHarness).mockResolvedValue({ answer: 'FINAL', sources: [], executionId: 'execution-1' });
    vi.mocked(listConversations).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('refresh failed'));
    await runAssistantPanelTask(input);
    expect(lastMessage()?.content).toBe('FINAL');
    expect(lastMessage()?.parts?.some(part => part.type === 'error')).toBe(false);
    expect(updateConversationMessage).toHaveBeenCalledTimes(1);
    expect(input.setError).toHaveBeenLastCalledWith(expect.stringContaining('结果已保存'));
    expect(input.setBusy).toHaveBeenLastCalledWith(false);
  });

  it('keeps the delivered answer if checkpoint acknowledgement fails', async () => {
    const input = options();
    vi.mocked(runAssistantHarness).mockResolvedValue({ answer: 'FINAL', sources: [], executionId: 'execution-1' });
    vi.mocked(acknowledgeExecution).mockRejectedValue(new Error('disk unavailable'));
    await runAssistantPanelTask(input);
    expect(lastMessage()?.content).toBe('FINAL');
    expect(input.setError).toHaveBeenLastCalledWith(expect.stringContaining('结果已经保存'));
    expect(updateConversationMessage).toHaveBeenCalledTimes(1);
  });

  it('drains pending draft writes before terminal errors and ignores late stream events', async () => {
    vi.useFakeTimers();
    const input = options();
    let completeDraft!: () => void;
    let draftStarted = false;
    const update = vi.mocked(updateConversationMessage).getMockImplementation()!;
    vi.mocked(updateConversationMessage).mockImplementationOnce(async (...args) => {
      draftStarted = true;
      await new Promise<void>(resolve => { completeDraft = resolve; });
      return update(...args);
    });
    let callbacks!: Parameters<typeof runAssistantHarness>[0];
    let fail!: (error: Error) => void;
    vi.mocked(runAssistantHarness).mockImplementation(async current => {
      callbacks = current;
      current.onDelta?.('partial');
      return new Promise((_, reject) => { fail = reject; });
    });
    const run = runAssistantPanelTask(input);
    await vi.waitFor(() => expect(callbacks).toBeDefined());
    await vi.advanceTimersByTimeAsync(60);
    expect(draftStarted).toBe(true);
    fail(new Error('network interrupted'));
    await vi.advanceTimersByTimeAsync(0);
    expect(updateConversationMessage).toHaveBeenCalledTimes(1);
    completeDraft();
    await run;
    expect(lastMessage()?.parts).toContainEqual({ type: 'error', message: 'network interrupted' });
    const writes = vi.mocked(updateConversationMessage).mock.calls.length;
    callbacks.onDelta?.('late data');
    callbacks.onToolEvent?.({ id: 'late', toolName: 'read', status: 'done' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(updateConversationMessage).toHaveBeenCalledTimes(writes);
    expect(lastMessage()?.content).toBe('partial');
    expect(getAssistantBackgroundRun()).toBeNull();
  });
});
