import type { AgentLoopState } from './state';

const MAX_IDENTICAL_CALLS = 2;
const MAX_IDENTICAL_FAILURES = 2;
const RECENT_FINGERPRINT_LIMIT = 12;

export class AgentLoopGuard {
  constructor(readonly state: AgentLoopState) {}

  startTurn() {
    this.state.turnCount += 1;
    if (this.state.turnCount > this.state.maxTurns) {
      this.stop(`Agent stopped after ${this.state.maxTurns} turns without reaching a terminal response.`);
    }
  }

  beforeToolCall(toolName: string, input: unknown) {
    this.state.toolCallCount += 1;
    if (this.state.toolCallCount > this.state.maxToolCalls) {
      this.stop(`Agent stopped after ${this.state.maxToolCalls} tool calls.`);
    }

    const fingerprint = toolFingerprint(toolName, input);
    const identicalCalls = this.state.recentToolFingerprints.filter(
      (candidate) => candidate === fingerprint
    ).length;
    if (identicalCalls >= MAX_IDENTICAL_CALLS) {
      this.stop(`Agent cycle detected: ${toolName} was called repeatedly with identical input.`);
    }
    if ((this.state.failedToolFingerprints[fingerprint] ?? 0) >= MAX_IDENTICAL_FAILURES) {
      this.stop(`Agent stopped retrying the same failed ${toolName} call.`);
    }

    this.state.recentToolFingerprints.push(fingerprint);
    this.state.recentToolFingerprints = this.state.recentToolFingerprints.slice(
      -RECENT_FINGERPRINT_LIMIT
    );
    return fingerprint;
  }

  recordSuccess(observation: unknown) {
    const nextObservation = stableStringify(observation);
    this.state.noProgressCount = nextObservation === this.state.lastObservation
      ? this.state.noProgressCount + 1
      : 0;
    this.state.lastObservation = nextObservation;
    if (this.state.noProgressCount >= 3) {
      this.stop('Agent stopped because repeated tool results made no progress.');
    }
  }

  recordFailure(fingerprint: string) {
    this.state.failedToolFingerprints[fingerprint] =
      (this.state.failedToolFingerprints[fingerprint] ?? 0) + 1;
  }

  recordCreatedEntry(entryId: string) {
    if (!this.state.createdEntryIds.includes(entryId)) {
      this.state.createdEntryIds.push(entryId);
    }
  }

  private stop(reason: string): never {
    this.state.status = 'failed';
    this.state.stopReason = reason;
    throw new AgentLoopGuardError(reason);
  }
}

export class AgentLoopGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentLoopGuardError';
  }
}

export function toolFingerprint(toolName: string, input: unknown) {
  return `${toolName}:${stableStringify(input)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}
