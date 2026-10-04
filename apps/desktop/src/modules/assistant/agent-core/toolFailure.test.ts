import { describe, expect, it, vi } from 'vitest';
import { Agent, AgentPersistenceError, AgentStoppedError, AgentToolNotExecutedError, RunBudget,
  type AgentDriver, type AgentTool, type AgentTurn } from './agent';
import { createAgentToolFailure, isAgentToolFailure, type AgentToolFailureCode } from './toolFailure';

const call = (name: string, error?: string) => ({ name, id: name, input: {}, ...(error === undefined ? {} : { error }) });
const calling = (...calls: ReturnType<typeof call>[]): AgentTurn<string> => ({ text: '', messages: ['calls'], calls });
const final: AgentTurn<string> = { text: 'summary', messages: ['summary'], calls: [] };
function driver(turns: AgentTurn<string>[]): AgentDriver<string> {
  return { turn: vi.fn(async () => turns.shift()!), instruction: text => text,
    result: vi.fn((_, output, failed) => JSON.stringify({ output, failed })) };
}

describe('safe tool failures', () => {
  it.each(['TOOL_NOT_AVAILABLE', 'TOOL_INVALID_ARGUMENTS', 'TOOL_PREFLIGHT_FAILED', 'TOOL_NOT_EXECUTED',
    'TOOL_APPROVAL_UNAVAILABLE', 'TOOL_REPEAT_SKIPPED', 'TOOL_WRITE_BLOCKED', 'TOOL_LIMIT_REACHED',
    'TOOL_EXECUTION_FAILED', 'TOOL_PARTIAL_FAILURE', 'TOOL_OUTCOME_UNKNOWN'] as AgentToolFailureCode[])(
    'creates and recognizes the fixed %s representation', code => {
      const failure = createAgentToolFailure(code);
      expect(isAgentToolFailure(failure)).toBe(true);
      expect(isAgentToolFailure({ ...failure, message: 'remote secret' })).toBe(false);
      expect(isAgentToolFailure({ ...failure, outcome: 'success' })).toBe(false);
      expect(isAgentToolFailure(createAgentToolFailure(code, true))).toBe(true);
    });
  it.each([null, 'error', {}, { ok: false, code: 'toString' }, { ok: false, code: 'TOOL_EXECUTION_FAILED', recovery: null }])(
    'does not mistake an arbitrary result for a classified failure: %j', value => expect(isAgentToolFailure(value)).toBe(false));

  it('returns unknown tools, malformed arguments, and preflight failures in order without leaking diagnostics', async () => {
    const execute = vi.fn(async () => 'ok');
    const preflight = Object.assign(execute, { prepare: vi.fn(async () => { throw new Error('PRIVATE_PATH token=secret'); }) });
    const provider = driver([calling(call('missing'), call('toString'), call('invalid', 'PRIVATE_PATH token=secret'), call('prepare')), final]);
    const budget = new RunBudget();
    const agent = new Agent({ driver: provider, tools: { invalid: execute, prepare: preflight }, messages: [], budget });
    expect(await agent.run()).toBe('summary');
    expect(execute).not.toHaveBeenCalled();
    expect(preflight.prepare).toHaveBeenCalledOnce();
    expect(vi.mocked(provider.result).mock.calls.map(([, output]) => (output as { code: string }).code)).toEqual([
      'TOOL_NOT_AVAILABLE', 'TOOL_NOT_AVAILABLE', 'TOOL_INVALID_ARGUMENTS', 'TOOL_PREFLIGHT_FAILED'
    ]);
    expect(JSON.stringify(agent.messages)).not.toMatch(/PRIVATE_PATH|token=secret/);
    expect(budget.writesBlocked).toBe(false);
    expect(budget.toolCalls).toBe(4);
  });

  it('classifies a malformed call to an unavailable tool by availability rather than exception text', async () => {
    const provider = driver([calling(call('removed_tool', 'private provider parse details')), final]);
    const agent = new Agent({ driver: provider, tools: {}, messages: [], budget: new RunBudget() });
    await agent.run();
    expect(provider.result).toHaveBeenCalledWith(call('removed_tool', 'private provider parse details'),
      createAgentToolFailure('TOOL_NOT_AVAILABLE'), true);
    expect(JSON.stringify(agent.messages)).not.toContain('private provider');
  });

  it('honors the host driver classification when a registered tool is unavailable for this turn', async () => {
    const unavailable = { ...call('temporarily_removed', 'provider detail'), errorCode: 'TOOL_NOT_AVAILABLE' as const };
    const provider = driver([calling(unavailable), final]);
    const execute = vi.fn(async () => 'must not execute');
    await new Agent({ driver: provider, tools: { temporarily_removed: execute }, messages: [], budget: new RunBudget() }).run();
    expect(execute).not.toHaveBeenCalled();
    expect(provider.result).toHaveBeenCalledWith(unavailable, createAgentToolFailure('TOOL_NOT_AVAILABLE'), true);
  });

  it.each([true, false])('attaches only a host-allowlisted diagnostic without changing replayability %s', async replayable => {
    const exception = new Error('HTTP 403 PRIVATE_PATH token=secret');
    const diagnostic = vi.fn(() => 'HTTP 403：访问被拒绝');
    const provider = driver([calling(call('tool')), final]);
    const agent = new Agent({ driver: provider, tools: { tool: async () => { throw exception; } }, messages: [], budget: new RunBudget(),
      canReplayTool: () => replayable, toolErrorDiagnostic: diagnostic });
    await agent.run();
    expect(diagnostic).toHaveBeenCalledWith(exception);
    expect(provider.result).toHaveBeenCalledWith(call('tool'), {
      ...createAgentToolFailure(replayable ? 'TOOL_EXECUTION_FAILED' : 'TOOL_OUTCOME_UNKNOWN'), diagnostic: 'HTTP 403：访问被拒绝'
    }, true);
    expect(JSON.stringify(agent.messages)).not.toMatch(/PRIVATE_PATH|token=secret/);
    expect(isAgentToolFailure(vi.mocked(provider.result).mock.calls[0][1])).toBe(true);
  });

  it('falls back to the fixed safe failure if the diagnostic formatter itself fails', async () => {
    const provider = driver([calling(call('tool')), final]);
    await new Agent({ driver: provider, tools: { tool: async () => { throw new Error('secret'); } }, messages: [], budget: new RunBudget(),
      canReplayTool: () => true, toolErrorDiagnostic: () => { throw new Error('broken diagnostic helper'); } }).run();
    expect(provider.result).toHaveBeenCalledWith(call('tool'), createAgentToolFailure('TOOL_EXECUTION_FAILED'), true);
  });

  it.each([new Error('private-key'), 'private-key', { diagnostic: 'private-key' }])(
    'lets the model recover from a replayable tool exception without returning raw data: %j', exception => {
      const provider = driver([calling(call('read')), final]);
      const budget = new RunBudget();
      const onToolError = vi.fn();
      const agent = new Agent({ driver: provider, tools: { read: async () => { throw exception; } },
        canReplayTool: () => true, messages: [], budget, onToolError });
      return agent.run().then(answer => {
        expect(answer).toBe('summary');
        const failure = createAgentToolFailure('TOOL_EXECUTION_FAILED');
        expect(provider.result).toHaveBeenCalledWith(call('read'), failure, true);
        expect(onToolError).toHaveBeenCalledWith(call('read'), exception, failure);
        expect(JSON.stringify(agent.messages)).not.toContain('private-key');
        expect(budget.writesBlocked).toBe(false);
      });
    });

  it('uses only the trusted host code for an explicit pre-effect rejection and permits the next write', async () => {
    const write = vi.fn(async () => 'created');
    const provider = driver([calling(call('reject'), call('write')), final]);
    const budget = new RunBudget();
    await new Agent({ driver: provider, messages: [], budget, tools: {
      reject: async () => { throw new AgentToolNotExecutedError('private validator details', 'TOOL_INVALID_ARGUMENTS'); }, write
    } }).run();
    expect(provider.result).toHaveBeenNthCalledWith(1, call('reject'), createAgentToolFailure('TOOL_INVALID_ARGUMENTS'), true);
    expect(write).toHaveBeenCalledOnce();
    expect(budget.writesBlocked).toBe(false);
  });

  it('preserves acknowledged partial results, marks failure, and does not call a partially completed write again', async () => {
    const output = { ...createAgentToolFailure('TOOL_PARTIAL_FAILURE'), results: [{ id: 'created' }, { status: 'failed' }] };
    const write = vi.fn(async () => output);
    const provider = driver([calling(call('write')), final]);
    const budget = new RunBudget();
    await new Agent({ driver: provider, messages: [], budget, tools: { write } }).run();
    expect(provider.result).toHaveBeenCalledWith(call('write'), output, true);
    expect(write).toHaveBeenCalledOnce();
    expect(budget.writesBlocked).toBe(false);
    expect(output.recovery.retryable).toBe(false);
  });

  it.each([new AgentStoppedError('budget exhausted'), new AgentPersistenceError('storage unavailable'),
    new DOMException('Cancelled', 'AbortError'), new Error('safety fatal')])(
    'never converts cancellation, persistence, budget or safety fatal signals into tool results: %j', async error => {
      const provider = driver([calling(call('fatal'), call('later')), final]);
      const later = vi.fn();
      const budget = new RunBudget();
      await expect(new Agent({ driver: provider, messages: [], budget, canReplayTool: () => true,
        tools: { fatal: async () => { throw error; }, later }, isFatal: value => value instanceof Error && value.message === 'safety fatal' }).run()).rejects.toBe(error);
      expect(later).not.toHaveBeenCalled();
      expect(provider.result).not.toHaveBeenCalled();
      expect(provider.turn).toHaveBeenCalledOnce();
    });

  it('keeps preflight cancellation fatal without claiming an uncertain write', async () => {
    const signal = new AbortController();
    const tool: AgentTool = Object.assign(vi.fn(), { prepare: async () => { signal.abort(new Error('Cancelled')); return vi.fn(); } });
    const budget = new RunBudget();
    await expect(new Agent({ driver: driver([calling(call('write'))]), messages: [], budget,
      signal: signal.signal, tools: { write: tool } }).run()).rejects.toThrow('Cancelled');
    expect(budget.writesBlocked).toBe(false);
    expect(tool).not.toHaveBeenCalled();
  });
});
