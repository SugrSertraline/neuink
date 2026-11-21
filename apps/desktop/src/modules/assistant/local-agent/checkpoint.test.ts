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
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>(done => { resolve = done; });
  return { promise, resolve };
}

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
  it('overlaps reads, bounds them at four and preserves the write barrier in arrival order', async () => {
    const { checkpoint } = setup();
    const gate = deferred();
    const writeGate = deferred();
    let active = 0, maximum = 0, finished = 0;
    const read = vi.fn(async () => {
      active++; maximum = Math.max(maximum, active);
      await gate.promise;
      active--; finished++; return 'read';
    });
    const write = vi.fn(async () => {
      expect(active).toBe(0);
      expect(finished).toBe(6);
      expect(saved.payload['local:journal']).toMatchObject({ pending: { name: 'create_entry' } });
      return writeGate.promise;
    });
    const later = vi.fn(async () => 'after write');
    const reads = Array.from({ length: 6 }, () => checkpoint.run('read_note', {}, context(), read));
    const effect = checkpoint.run('create_entry', {}, context(), write);
    const last = checkpoint.run('read_note', {}, context(), later);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
    expect(write).not.toHaveBeenCalled();
    gate.resolve('go');
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(later).not.toHaveBeenCalled();
    writeGate.resolve('created');
    expect(await Promise.all([...reads, effect, last])).toHaveLength(8);
    await checkpoint.settled();
    expect(maximum).toBe(4);
    expect((saved.payload['local:journal'] as { completed: unknown[] }).completed).toHaveLength(1);
  });
  it('checks proposal prerequisites only after earlier note reads have finished', async () => {
    const { checkpoint } = setup();
    const gate = deferred();
    let noteRead = false;
    const read = checkpoint.run('read_note', {}, context(), async () => { await gate.promise; noteRead = true; });
    const preflight = vi.fn(() => { expect(noteRead).toBe(true); });
    const proposal = checkpoint.run('note_propose_patch', {}, context(), async () => 'proposal', preflight);
    expect(preflight).not.toHaveBeenCalled();
    gate.resolve('ready');
    await Promise.all([read, proposal]);
    expect(preflight).toHaveBeenCalledOnce();
  });
  it('delivers successful sibling reads even when another read fails', async () => {
    const { checkpoint } = setup();
    const one = checkpoint.run('read_note', {}, context(), async () => { throw new Error('read failed'); });
    const two = checkpoint.run('read_note', {}, context(), async () => 'evidence');
    const outcomes = await Promise.allSettled([one, two]);
    expect(outcomes[0]).toMatchObject({ status: 'rejected' });
    expect(outcomes[1]).toEqual({ status: 'fulfilled', value: 'evidence' });
    await checkpoint.settled();
  });
  it('cancels uncooperative reads and skips all queued operations', async () => {
    const { checkpoint } = setup();
    const controller = new AbortController();
    const read = vi.fn(() => new Promise(() => {}));
    const write = vi.fn();
    const reads = Array.from({ length: 5 }, () => checkpoint.run('read_note', {}, { ...context(), signal: controller.signal }, read));
    const pending = checkpoint.run('create_entry', {}, { ...context(), signal: controller.signal }, write);
    const outcomes = Promise.allSettled([...reads, pending]);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
    controller.abort();
    expect((await outcomes).every(outcome => outcome.status === 'rejected')).toBe(true);
    await expect(checkpoint.settled()).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toHaveBeenCalledTimes(4);
    expect(write).not.toHaveBeenCalled();
  });
  it('stops queued reads and writes when concurrent pre-dispatch persistence fails', async () => {
    const { checkpoint } = setup();
    vi.mocked(saveAgentExecution).mockRejectedValue('os error 112');
    const effect = vi.fn();
    const reads = Array.from({ length: 6 }, () => checkpoint.run('read_note', {}, context(), effect));
    const write = checkpoint.run('create_entry', {}, context(), effect);
    const outcomes = await Promise.allSettled([...reads, write]);
    expect(outcomes.every(outcome => outcome.status === 'rejected')).toBe(true);
    expect(effect).not.toHaveBeenCalled();
    await expect(checkpoint.settled()).rejects.toThrow('磁盘空间');
  });
  it('discards an interrupted legacy read marker without blocking future effects', async () => {
    const { checkpoint, budget } = setup({ completed: [], pending: { name: 'read_note', replayable: true } });
    expect(budget.writesBlocked).toBe(false);
    await checkpoint.run('read_note', {}, context(), async () => 'fresh');
    expect(saved.payload['local:journal']).toMatchObject({ completed: [] });
    expect((saved.payload['local:journal'] as { pending?: unknown }).pending).toBeUndefined();
    expect(await checkpoint.run('create_entry', {}, context(), async () => 'created')).toBe('created');
  });
  it('rejects damaged journal shapes instead of guessing whether a write was dispatched', () => {
    expect(() => setup({ completed: [], pending: {} })).toThrow('检查点无效');
    expect(() => setup({ completed: 'broken' })).toThrow('检查点无效');
  });
});
