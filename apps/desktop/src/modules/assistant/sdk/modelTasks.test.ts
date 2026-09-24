import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { RunBudget } from '../agent-core';
import { runJsonModelTask } from './modelTasks';
vi.mock('ai', () => ({ generateText: vi.fn(), Output: { json: vi.fn() } }));
vi.mock('./provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: () => ({}) }));
beforeEach(() => vi.clearAllMocks());
describe('request-wide model budget', () => {
  it('counts fixed model tasks, reserves before I/O, and records reported tokens', async () => {
    const budget = new RunBudget(1);
    const persist = vi.fn(async () => {});
    budget.persist = persist;
    vi.mocked(generateText).mockResolvedValue({ output: { summary: 'ok' }, usage: { inputTokens: 11, outputTokens: 7 } } as never);
    const options = { budget, settings: {} as LlmProfile, name: 'memory', description: 'memory', system: 'summarize', prompt: 'fixture' };
    await runJsonModelTask(options);
    expect(budget.snapshot()).toEqual({ turns: 1, toolCalls: 0, inputTokens: 11, outputTokens: 7 });
    expect(persist).toHaveBeenCalledTimes(2);
    await expect(runJsonModelTask(options)).rejects.toThrow('budget exhausted');
    expect(generateText).toHaveBeenCalledOnce();
  });
  it('prevents another request after the reported-token ceiling without resetting on restore', () => {
    const budget = new RunBudget(24, 48, 2, 100);
    budget.usage(80, 20);
    const resumed = new RunBudget(24, 48, 2, 100);
    resumed.restore(budget.snapshot());
    expect(() => resumed.turn()).toThrow('token budget exhausted');
  });
});
