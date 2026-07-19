import { describe, expect, it } from 'vitest';

import { AgentLoopGuard, createAgentLoopState } from './index';

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
      'cycle detected'
    );
  });

  it('stops repeated failures and preserves replayable state', () => {
    const state = createAgentLoopState('read');
    const guard = new AgentLoopGuard(state);
    const fingerprint = guard.beforeToolCall('read', { id: 1 });
    guard.recordFailure(fingerprint);
    guard.recordFailure(fingerprint);
    expect(() => guard.beforeToolCall('read', { id: 1 })).toThrow('same failed');
    expect(state.failedToolFingerprints[fingerprint]).toBe(2);
  });
});
