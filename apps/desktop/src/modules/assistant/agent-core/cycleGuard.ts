import type { AgentLoopState } from './state';
import { AgentToolNotExecutedError } from './agent';

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
      throw new AgentToolNotExecutedError('TOOL_LIMIT_REACHED：工具调用上限已到，本次未执行。请总结已有结果。');
    }
    if (this.state.noProgressCount >= 3) {
      throw new AgentToolNotExecutedError('TOOL_LIMIT_REACHED：连续调用没有新信息，本次未执行。请总结已有结果与限制。');
    }

    const fingerprint = toolFingerprint(toolName, input);
    const identicalCalls = this.state.recentToolFingerprints.filter(
      (candidate) => candidate === fingerprint
    ).length;
    if (identicalCalls >= MAX_IDENTICAL_CALLS) {
      throw new AgentToolNotExecutedError(`TOOL_REPEAT_SKIPPED：${toolName} 已使用相同参数调用多次，本次未执行。请换方法或总结已有结果。`);
    }
    if ((this.state.failedToolFingerprints[fingerprint] ?? 0) >= MAX_IDENTICAL_FAILURES) {
      throw new AgentToolNotExecutedError(`TOOL_REPEAT_SKIPPED：${toolName} 重复失败，本次未执行。请换方法或说明限制。`);
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
    // Always deliver a completed result. Reject the NEXT call before any effects instead.
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
