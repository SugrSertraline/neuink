import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeExecution, runDurableHarness } from './durableHarness';
import type { RunAssistantHarnessOptions } from './engine';
import { readAgentExecution, saveAgentExecution, type AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';
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
