import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeExecution, runDurableHarness } from './durableHarness';
import type { RunAssistantHarnessOptions } from './engine';
import { readAgentExecution, saveAgentExecution, type AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';
import type { ScopeSnapshot } from '@/shared/ipc/assistantApi';
vi.mock('@/shared/ipc/agentExecutionApi', () => ({ readAgentExecution: vi.fn(), saveAgentExecution: vi.fn() }));
const options = { root: 'root', conversationId: 'conversation-1', question: 'Read a paper',
  scope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] },
  settings: { id: 'profile-1', api_key: 'SECRET-DO-NOT-PERSIST', model: 'test' }, profiles: [] } as unknown as RunAssistantHarnessOptions;
let stored: AgentExecutionRecord;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveAgentExecution).mockImplementation(async (_, record) => {
    stored = structuredClone({ ...record, revision: record.revision + 1 });
    return stored;
  });
  vi.mocked(readAgentExecution).mockImplementation(async () => structuredClone(stored));
});
describe('durable harness delivery', () => {
  it('persists only task inputs and redelivers cached results without model or tool replay', async () => {
    const execute = vi.fn(async (input: RunAssistantHarnessOptions) => {
      input.budget!.turn();
      return { answer: 'done', sources: [] };
    });
    const first = await runDurableHarness(options, execute);
    expect(JSON.stringify(stored)).not.toContain('SECRET-DO-NOT-PERSIST');
    expect(stored.status).toBe('running'); // Delivery has not been acknowledged yet.
    expect(stored.payload.deliveryPending).toBe(true);
    const resumed = await runDurableHarness({ ...options, resumeExecutionId: first.executionId }, execute);
    expect(resumed.answer).toBe('done');
    expect(execute).toHaveBeenCalledOnce();
    expect(stored.payload.budget).toMatchObject({ turns: 1 });
    await acknowledgeExecution('root', first.executionId!, false);
    expect(stored.status).toBe('completed');
    expect(stored.payload.deliveryPending).toBe(false);
  });
  it('rejects resuming a checkpoint in another conversation or with another model profile', async () => {
    const first = await runDurableHarness(options, async () => ({ answer: 'done', sources: [] }));
    const execute = vi.fn();
    await expect(runDurableHarness({ ...options, conversationId: 'other', resumeExecutionId: first.executionId }, execute)).rejects.toThrow('当前对话');
    await expect(runDurableHarness({ ...options, settings: { ...options.settings, id: 'other' }, resumeExecutionId: first.executionId }, execute)).rejects.toThrow('原任务');
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(['input', 'budget'])('rejects a damaged %s before writing or executing', async key => {
    const first = await runDurableHarness(options, async () => ({ answer: 'done', sources: [] }));
    delete stored.payload[key];
    vi.mocked(saveAgentExecution).mockClear();
    const execute = vi.fn();
    await expect(runDurableHarness({ ...options, resumeExecutionId: first.executionId }, execute)).rejects.toThrow('无效');
    expect(execute).not.toHaveBeenCalled();
    expect(saveAgentExecution).not.toHaveBeenCalled();
  });
  it('does not call the executor after initial checkpoint failure', async () => {
    vi.mocked(saveAgentExecution).mockRejectedValue('Invalid execution conversation');
    const execute = vi.fn();
    await expect(runDurableHarness(options, execute)).rejects.toThrow('会话标识校验失败');
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('durable harness retrieval scope', () => {
  const frozenScope: ScopeSnapshot = { tag_ids: [], tag_names: [], entry_ids: ['paper-a'], entry_titles: ['Paper A'], scope_intent: 'selection' };
  const currentLibraryScope: ScopeSnapshot = { tag_ids: [], tag_names: [], entry_ids: [], entry_titles: [], scope_intent: 'library' };
  // The first attempt fails before any result is cached, so resuming executes the task again from the saved input.
  const failFirstAttempt = () => vi.fn()
    .mockRejectedValueOnce(new Error('interrupted'))
    .mockImplementation(async () => ({ answer: 'done', sources: [] }));

  it('persists the frozen retrieval scope and ignores the scope supplied on resume', async () => {
    const execute = failFirstAttempt();
    await expect(runDurableHarness({ ...options, retrievalScope: frozenScope }, execute)).rejects.toThrow('interrupted');
    expect(stored.payload.input).toMatchObject({ retrievalScope: frozenScope });
    await runDurableHarness({ ...options, scope: currentLibraryScope, retrievalScope: currentLibraryScope,
      resumeExecutionId: stored.id }, execute);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0].retrievalScope).toEqual(frozenScope);
    expect(execute.mock.calls[1][0].scope).toEqual(options.scope);
  });

  it('fails closed for a legacy checkpoint without retrievalScope instead of inheriting the current scope', async () => {
    const execute = failFirstAttempt();
    await expect(runDurableHarness({ ...options, retrievalScope: frozenScope }, execute)).rejects.toThrow('interrupted');
    delete (stored.payload.input as Record<string, unknown>).retrievalScope;
    await runDurableHarness({ ...options, scope: currentLibraryScope, retrievalScope: currentLibraryScope,
      resumeExecutionId: stored.id }, execute);
    const resumedInput = execute.mock.calls[1][0];
    expect(resumedInput.retrievalScope).toBeUndefined();
    expect(resumedInput.scope).toEqual(options.scope);
  });
});
