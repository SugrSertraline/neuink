import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { RunBudget } from '../agent-core';
import { runJsonModelTask, runTextModelTask } from './modelTasks';
vi.mock('ai', () => ({ generateText: vi.fn(), Output: { json: vi.fn() } }));
vi.mock('./provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: (settings: LlmProfile) => ({
  maxOutputTokens: settings.max_output_tokens ?? undefined
}) }));
beforeEach(() => vi.clearAllMocks());
describe('request-wide model budget', () => {
  it('allows compaction on the final task turn while enforcing its token ceiling', async () => {
    const budget = new RunBudget(1, 48, 2, 100);
    budget.turns = 1;
    vi.mocked(generateText).mockResolvedValue({ text: 'summary', finishReason: 'stop', usage: { inputTokens: 60, outputTokens: 40 } } as never);
    await runTextModelTask({ budget, settings: {} as LlmProfile, system: 'summarize', prompt: 'data', chargeTurn: false });
    expect(budget.turns).toBe(1);
    await expect(runTextModelTask({ budget, settings: {} as LlmProfile, system: 'summarize', prompt: 'data', chargeTurn: false }))
      .rejects.toThrow('token budget exhausted');
    expect(generateText).toHaveBeenCalledOnce();
  });
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
  it('charges real tokens for a compaction call without spending a loop turn', async () => {
    const budget = new RunBudget(1);
    vi.mocked(generateText).mockResolvedValue({ output: { summary: 'ok' }, finishReason: 'stop', usage: { inputTokens: 11, outputTokens: 7 } } as never);
    const options = { budget, settings: {} as LlmProfile, name: 'agent_context_summary', description: 'summary', system: 'summarize', prompt: 'fixture', chargeTurn: false };
    await runJsonModelTask(options);
    expect(budget.snapshot()).toEqual({ turns: 0, toolCalls: 0, inputTokens: 11, outputTokens: 7 });
    // The turn stays reserved for the task itself, so a second compaction still fits.
    await runJsonModelTask(options);
    expect(generateText).toHaveBeenCalledTimes(2);
  });
  it('reports the provider finish reason so a truncated summary is discarded upstream', async () => {
    const budget = new RunBudget();
    const onFinish = vi.fn();
    vi.mocked(generateText).mockResolvedValue({ output: { summary: 'half a sen' }, finishReason: 'length', usage: {} } as never);
    await expect(runJsonModelTask({ budget, settings: {} as LlmProfile, name: 'agent_context_summary', description: 'summary', system: 'summarize', prompt: 'fixture', chargeTurn: false, onFinish }))
      .rejects.toThrow('模型输出达到长度上限');
    expect(onFinish).toHaveBeenCalledWith('length');
  });
  it('keeps the upstream output capacity guard when task-turn charging is disabled', async () => {
    const budget = new RunBudget(1);
    budget.turns = 1;
    vi.mocked(generateText).mockResolvedValue({ output: { ok: true }, finishReason: 'stop', usage: {} } as never);
    await runJsonModelTask({ budget, settings: { max_context_length: 4_096, max_output_tokens: 4_000 } as LlmProfile,
      name: 'check', description: 'check', system: 'a'.repeat(4_000), prompt: 'data', chargeTurn: false, timeoutMs: 5_000 });
    const request = vi.mocked(generateText).mock.calls[0][0];
    expect(request.maxOutputTokens).toBeGreaterThan(0);
    expect(request.maxOutputTokens).toBeLessThan(4_000);
    expect(request.abortSignal).toBeInstanceOf(AbortSignal);
    expect(budget.turns).toBe(1);
    await expect(runJsonModelTask({ budget, settings: { max_context_length: 512 } as LlmProfile,
      name: 'check', description: 'check', system: '中'.repeat(300), prompt: 'data', chargeTurn: false }))
      .rejects.toMatchObject({ name: 'ModelContextLimitError' });
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
