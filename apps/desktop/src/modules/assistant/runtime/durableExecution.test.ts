import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunBudget } from '../agent-core';
import { DurableExecution, canReplayAssistantTool } from './durableExecution';
import { saveAgentExecution, type AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';
vi.mock('@/shared/ipc/agentExecutionApi', () => ({ saveAgentExecution: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const record = (): AgentExecutionRecord => ({ id: 'execution-test', conversationId: 'conversation', revision: 0,
  status: 'running', updatedAt: '', payload: {} });
describe('execution persistence', () => {
  it('serializes concurrent saves with fresh CAS revisions and immutable payloads', async () => {
    vi.mocked(saveAgentExecution).mockImplementation(async (_, record) => ({ ...record, revision: record.revision + 1 }));
    const budget = new RunBudget();
    const execution = new DurableExecution('root', record(), budget);
    execution.set('value', 1);
    const first = execution.flush();
    execution.set('value', 2);
    const second = execution.flush();
    await Promise.all([first, second]);
    expect(vi.mocked(saveAgentExecution).mock.calls.map(call => call[1].revision)).toEqual([0, 1]);
    expect(vi.mocked(saveAgentExecution).mock.calls.map(call => call[1].payload.value)).toEqual([1, 2]);
    expect(execution.record.revision).toBe(2);
  });
  it('never bypasses a failed checkpoint with later writes', async () => {
    vi.mocked(saveAgentExecution).mockRejectedValue(new Error('conflict'));
    const execution = new DurableExecution('root', record(), new RunBudget());
    await expect(execution.flush()).rejects.toThrow('安全保存');
    await expect(execution.flush()).rejects.toThrow('安全保存');
    expect(saveAgentExecution).toHaveBeenCalledOnce();
  });
  it('does not treat external tools or writes as safe replay operations', () => {
    expect(canReplayAssistantTool('mcp_service_write')).toBe(false);
    expect(canReplayAssistantTool('create_entry')).toBe(false);
    expect(canReplayAssistantTool('read_segment_content')).toBe(true);
    expect(canReplayAssistantTool('ask_user')).toBe(true); // Re-ask, never infer consent after restart.
  });
  it.each([
    ['Invalid execution conversation', '会话标识校验失败'],
    ['Execution conversation no longer exists', '所属对话已不存在'],
    ['Execution changed in another runner. Reload before continuing.', '另一执行器'],
    ['Another process is saving this execution. Retry after it finishes.', '另一个进程'],
    ['Checkpoint too large', '16 MiB'],
    ['Access denied (os error 5)', '没有写入权限'],
    ['disk full (os error 112)', '磁盘空间不足'],
  ])('preserves the actionable category for %s', async (error, expected) => {
    vi.mocked(saveAgentExecution).mockRejectedValue(error);
    await expect(new DurableExecution('root', record(), new RunBudget()).flush()).rejects.toThrow(expected);
  });
  it('does not expose unclassified backend details', async () => {
    vi.mocked(saveAgentExecution).mockRejectedValue('PRIVATE-PATH secret-key request-body');
    await expect(new DurableExecution('root', record(), new RunBudget()).flush()).rejects.toThrow('任务存储写入失败');
  });
  it('fails closed when a snapshot is not serializable', async () => {
    const execution = new DurableExecution('root', record(), new RunBudget());
    execution.set('cycle', execution.record.payload);
    await expect(execution.flush()).rejects.toThrow('无法序列化');
    execution.set('cycle', undefined);
    await expect(execution.flush()).rejects.toThrow('无法序列化');
    expect(saveAgentExecution).not.toHaveBeenCalled();
  });
});
