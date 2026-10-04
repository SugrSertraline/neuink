import { describe, expect, it } from 'vitest';

import { AgentLoopGuard, AgentToolNotExecutedError, createAgentLoopState } from './index';

describe('AgentLoopGuard', () => {
  it('permits model-native direct answers without fake tool calls', () => {
    const state = createAgentLoopState('帮我取个名字');
    const guard = new AgentLoopGuard(state);
    guard.startTurn();
    state.status = 'completed';
    expect(state.toolCallCount).toBe(0);
  });

  it('stops an identical tool-call loop', () => {
    const guard = new AgentLoopGuard(createAgentLoopState('create'));
    guard.beforeToolCall('create_entry', { title: 'A' });
    guard.beforeToolCall('create_entry', { title: 'A' });
    expect(() => guard.beforeToolCall('create_entry', { title: 'A' })).toThrow(
      'TOOL_REPEAT_SKIPPED'
    );
  });

  it('stops repeated failures and preserves replayable state', () => {
    const state = createAgentLoopState('read');
    const guard = new AgentLoopGuard(state);
    const fingerprint = guard.beforeToolCall('read', { id: 1 });
    guard.recordFailure(fingerprint);
    guard.recordFailure(fingerprint);
    expect(() => guard.beforeToolCall('read', { id: 1 })).toThrow(AgentToolNotExecutedError);
    expect(state.failedToolFingerprints[fingerprint]).toBe(2);
    expect(state.status).toBe('running');
  });
  it('does not discard a completed result when progress stalls; the next call is skipped', () => {
    const guard = new AgentLoopGuard(createAgentLoopState('read'));
    for (let i = 0; i < 4; i++) expect(() => guard.recordSuccess({ results: [] })).not.toThrow();
    expect(() => guard.beforeToolCall('read', { id: 2 })).toThrow('TOOL_LIMIT_REACHED');
    expect(guard.state.status).toBe('running');
  });

  it.each(['calls', 'failures', 'budget', 'progress'] as const)('attaches a structured host code for %s protection', reason => {
    const state = createAgentLoopState('test');
    const guard = new AgentLoopGuard(state);
    if (reason === 'calls') {
      guard.beforeToolCall('read', {});
      guard.beforeToolCall('read', {});
    } else if (reason === 'failures') {
      const fingerprint = guard.beforeToolCall('read', {});
      guard.recordFailure(fingerprint);
      guard.recordFailure(fingerprint);
    } else if (reason === 'budget') state.toolCallCount = state.maxToolCalls;
    else state.noProgressCount = 3;
    let error: unknown;
    try { guard.beforeToolCall('read', {}); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(AgentToolNotExecutedError);
    expect(error).toMatchObject({ code: reason === 'calls' || reason === 'failures' ? 'TOOL_REPEAT_SKIPPED' : 'TOOL_LIMIT_REACHED' });
  });
});
