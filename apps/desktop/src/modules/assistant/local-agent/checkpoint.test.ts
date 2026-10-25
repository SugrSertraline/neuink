import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAgentCheckpoint } from './checkpoint';
import { RunBudget, AgentToolNotExecutedError } from '../agent-core';
import { DurableExecution } from '../runtime/durableExecution';
import { saveAgentExecution, type AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';
import type { AgentTool } from '../agent-core/agent';
import { createAgentToolFailure } from '../agent-core/toolFailure';
vi.mock('@/shared/ipc/agentExecutionApi', () => ({ saveAgentExecution: vi.fn() }));
let saved: AgentExecutionRecord;
function setup(journal?: unknown) {
  const budget = new RunBudget();
  const execution = new DurableExecution('fixture', { id: 'execution-id', conversationId: 'c1', revision: 0,
    status: 'running', updatedAt: '', payload: journal ? { 'local:journal': journal } : {} }, budget);
  return { budget, checkpoint: new LocalAgentCheckpoint(execution, budget, vi.fn()) };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(saveAgentExecution).mockImplementation(async (_root, record) => {
    saved = structuredClone({ ...record, revision: record.revision + 1 }); return saved;
  });
});
const context = () => ({ id: crypto.randomUUID() });

describe('native Agent write-ahead receipts', () => {
  it('persists a dispatched write before effects and reuses its receipt across new call IDs', async () => {
    const { checkpoint } = setup();
    const effect = vi.fn(async () => {
      expect(saved.payload['local:journal']).toMatchObject({ pending: { name: 'create_entry' } });
      return { entry_id: 'e1' };
    });
    expect(await checkpoint.run('create_entry', { title: 'Paper' }, context(), effect)).toEqual({ entry_id: 'e1' });
    const restored = setup(saved.payload['local:journal']).checkpoint;
    expect(await restored.run('create_entry', { title: 'Paper' }, context(), effect)).toEqual({ entry_id: 'e1' });
    expect(effect).toHaveBeenCalledOnce();
  });
  it.each([{ pending: { name: 'create_entry', replayable: true } }, { nativePending: true }])('blocks any new write after an interrupted operation: %j', async state => {
    const { checkpoint, budget } = setup({ completed: [], ...state });
    expect(budget.writesBlocked).toBe(true);
    const effect = vi.fn();
    expect(await checkpoint.run('mcp_external_write', {}, context(), effect)).toMatchObject({ code: 'TOOL_WRITE_BLOCKED' });
    expect(effect).not.toHaveBeenCalled();
    expect(await checkpoint.run('read_note', {}, context(), async () => 'fresh text')).toBe('fresh text');
  });
  it('never reuses old note reads or restores confirmation decisions', async () => {
    const { checkpoint } = setup();
    const read = vi.fn(async () => 'fresh');
    await checkpoint.run('read_note', {}, context(), read);
    await checkpoint.run('read_note', {}, context(), read);
    expect(read).toHaveBeenCalledTimes(2);
    const denied = vi.fn(async () => undefined) as AgentTool;
    denied.prepare = vi.fn(async () => { throw new AgentToolNotExecutedError('approval unavailable'); });
    await expect(checkpoint.run('create_entry', {}, context(), denied)).rejects.toThrow('approval unavailable');
    expect(denied).not.toHaveBeenCalled();
    expect((saved.payload['local:journal'] as { pending?: unknown }).pending).toBeUndefined();
  });
  it('retains a known receipt when cancellation arrives just after the effect', async () => {
    const { checkpoint } = setup();
    const controller = new AbortController();
    await expect(checkpoint.run('create_entry', {}, { ...context(), signal: controller.signal }, async () => {
      controller.abort(); return { entry_id: 'created' };
    })).rejects.toMatchObject({ name: 'AbortError' });
    const next = setup(saved.payload['local:journal']);
    expect(next.budget.writesBlocked).toBe(false);
    const duplicate = vi.fn();
    expect(await next.checkpoint.run('create_entry', {}, context(), duplicate)).toEqual({ entry_id: 'created' });
    expect(duplicate).not.toHaveBeenCalled();
  });
  it('does not execute when pre-dispatch persistence fails', async () => {
    const { checkpoint } = setup();
    vi.mocked(saveAgentExecution).mockRejectedValue('os error 112');
    const effect = vi.fn();
    await expect(checkpoint.run('create_entry', {}, context(), effect)).rejects.toThrow('磁盘空间');
    await expect(checkpoint.run('read_note', {}, context(), effect)).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
  });
  it('records partial results without replaying a whole batch', async () => {
    const { checkpoint } = setup();
    const effect = vi.fn(async () => createAgentToolFailure('TOOL_PARTIAL_FAILURE'));
    await checkpoint.run('import_papers', { ids: ['a', 'b'] }, context(), effect);
    await checkpoint.run('import_papers', { ids: ['a', 'b'] }, context(), effect);
    expect(effect).toHaveBeenCalledOnce();
  });
  it('serializes concurrent host effects so neither pending record can overwrite the other', async () => {
    const { checkpoint } = setup();
    let release!: () => void;
    const first = vi.fn(() => new Promise(resolve => { release = () => resolve('first'); }));
    const second = vi.fn(async () => 'second');
    const one = checkpoint.run('create_entry', { title: 'one' }, context(), first);
    const two = checkpoint.run('create_entry', { title: 'two' }, context(), second);
    await vi.waitFor(() => expect(first).toHaveBeenCalledOnce());
    expect(second).not.toHaveBeenCalled(); release();
    await expect(Promise.all([one, two])).resolves.toEqual(['first', 'second']);
    expect((saved.payload['local:journal'] as { completed: unknown[] }).completed).toHaveLength(2);
  });
  it('rejects damaged journal shapes instead of guessing whether a write was dispatched', () => {
    expect(() => setup({ completed: [], pending: {} })).toThrow('检查点无效');
    expect(() => setup({ completed: 'broken' })).toThrow('检查点无效');
  });
});
