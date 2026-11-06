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

describe('JSON model result errors', () => {
  const options = { settings: {} as LlmProfile, name: 'title', description: 'title', system: 'check', prompt: 'fixture' };

  it('explains when output tokens are exhausted before JSON is generated', async () => {
    vi.mocked(generateText).mockResolvedValue({ finishReason: 'length', usage: { inputTokens: 10, outputTokens: 700 } } as never);
    await expect(runJsonModelTask(options)).rejects.toThrow('模型输出达到长度上限');
  });

  it('explains an empty model response without exposing the SDK error', async () => {
    const noOutput = Object.assign(new Error('No output generated.'), { name: 'AI_NoOutputGeneratedError' });
    vi.mocked(generateText).mockResolvedValue({ finishReason: 'stop', usage: {},
      get output() { throw noOutput; } } as never);
    await expect(runJsonModelTask(options)).rejects.toThrow('模型没有返回可用内容');
  });
});
