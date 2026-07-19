import type { AgentLoopState } from '@/shared/types/agentRuntime';

export type { AgentLoopState } from '@/shared/types/agentRuntime';

export function createAgentLoopState(goal: string): AgentLoopState {
  return {
    version: 1,
    goal,
    status: 'running',
    turnCount: 0,
    toolCallCount: 0,
    maxTurns: 12,
    maxToolCalls: 24,
    noProgressCount: 0,
    recentToolFingerprints: [],
    failedToolFingerprints: {},
    createdEntryIds: []
  };
}

export function serializeAgentLoopState(state: AgentLoopState) {
  return JSON.parse(JSON.stringify(state)) as AgentLoopState;
}
