/** Safe model-facing failures. Diagnostic exceptions belong at the host boundary, never here. */
export type AgentToolNotExecutedCode =
  | 'TOOL_NOT_AVAILABLE' | 'TOOL_INVALID_ARGUMENTS' | 'TOOL_PREFLIGHT_FAILED'
  | 'TOOL_NOT_EXECUTED' | 'TOOL_APPROVAL_UNAVAILABLE' | 'TOOL_REPEAT_SKIPPED'
  | 'TOOL_WRITE_BLOCKED' | 'TOOL_LIMIT_REACHED';
export type AgentToolFailureCode = AgentToolNotExecutedCode
  | 'TOOL_EXECUTION_FAILED' | 'TOOL_PARTIAL_FAILURE' | 'TOOL_OUTCOME_UNKNOWN';
export type AgentToolFailure = {
  ok: false;
  code: AgentToolFailureCode;
  message: string;
  /** Compatibility with existing result renderers; always the same safe message. */
  error: string;
  /** Optional host allowlisted diagnostic category, never a raw backend exception. */
  diagnostic?: string;
  outcome: 'not_executed' | 'failed' | 'unknown';
  recovery: {
    action: 'correct_arguments' | 'use_available_tool' | 'retry_or_alternative' | 'inspect_then_report' | 'summarize';
    retryable: boolean;
    writesBlocked: boolean;
  };
};

type FailureTemplate = Pick<AgentToolFailure, 'message' | 'outcome' | 'recovery'>;
const templates: Record<AgentToolFailureCode, FailureTemplate> = {
  TOOL_NOT_AVAILABLE: {
    message: '工具不可用，本次未执行。请选择当前可用工具，或说明能力限制。', outcome: 'not_executed',
    recovery: { action: 'use_available_tool', retryable: false, writesBlocked: false }
  },
  TOOL_INVALID_ARGUMENTS: {
    message: '工具参数无效，本次未执行。请依据工具参数定义纠正后再调用。', outcome: 'not_executed',
    recovery: { action: 'correct_arguments', retryable: true, writesBlocked: false }
  },
  TOOL_PREFLIGHT_FAILED: {
    message: '工具执行前检查未通过，本次未执行。请检查所需条件或使用其他方案。', outcome: 'not_executed',
    recovery: { action: 'retry_or_alternative', retryable: true, writesBlocked: false }
  },
  TOOL_NOT_EXECUTED: {
    message: '工具被执行前保护拦截，本次未执行。请核对已有结果或选择其他方案。', outcome: 'not_executed',
    recovery: { action: 'retry_or_alternative', retryable: false, writesBlocked: false }
  },
  TOOL_APPROVAL_UNAVAILABLE: {
    message: '本次操作无法获取所需确认，未执行。请说明限制，不要尝试绕过确认。', outcome: 'not_executed',
    recovery: { action: 'summarize', retryable: false, writesBlocked: false }
  },
  TOOL_REPEAT_SKIPPED: {
    message: '重复操作已被拦截，本次未执行。请使用已有结果，不要更换调用标识重复操作。', outcome: 'not_executed',
    recovery: { action: 'summarize', retryable: false, writesBlocked: false }
  },
  TOOL_EXECUTION_FAILED: {
    message: '工具未能完成请求。可纠正参数、尝试其他方案，或根据已有信息说明限制。', outcome: 'failed',
    recovery: { action: 'retry_or_alternative', retryable: true, writesBlocked: false }
  },
  TOOL_PARTIAL_FAILURE: {
    message: '操作仅部分完成。请核对返回的逐项结果并说明未完成部分，不要自动重试整个批次。', outcome: 'failed',
    recovery: { action: 'inspect_then_report', retryable: false, writesBlocked: false }
  },
  TOOL_OUTCOME_UNKNOWN: {
    message: '操作已开始，但结果无法确认，可能已产生修改。后续写操作已禁用；请只读核对并向用户说明，不要自动重试或改用其他写工具。', outcome: 'unknown',
    recovery: { action: 'inspect_then_report', retryable: false, writesBlocked: true }
  },
  TOOL_WRITE_BLOCKED: {
    message: '此前操作结果不明，本次写操作未执行。请只读核对并向用户说明，不要更换工具、参数或调用标识绕过保护。', outcome: 'not_executed',
    recovery: { action: 'inspect_then_report', retryable: false, writesBlocked: true }
  },
  TOOL_LIMIT_REACHED: {
    message: 'TOOL_LIMIT_REACHED：工具预算已用完，本次未执行。请整理已有结果并说明限制。', outcome: 'not_executed',
    recovery: { action: 'summarize', retryable: false, writesBlocked: false }
  }
};

export function createAgentToolFailure(code: AgentToolFailureCode, writesBlocked = false): AgentToolFailure {
  const template = templates[code];
  return { ok: false, code, message: template.message, error: template.message, outcome: template.outcome,
    recovery: { ...template.recovery, writesBlocked: writesBlocked || template.recovery.writesBlocked } };
}

/** Only accept the host's fixed safe representation, not arbitrary remote error strings. */
export function isAgentToolFailure(value: unknown): value is AgentToolFailure {
  if (!value || typeof value !== 'object') return false;
  const failure = value as Partial<AgentToolFailure>;
  if (failure.ok !== false || !failure.code || !Object.prototype.hasOwnProperty.call(templates, failure.code)) return false;
  const template = templates[failure.code];
  return failure.message === template.message && failure.error === template.message && failure.outcome === template.outcome
    && (failure.diagnostic === undefined || typeof failure.diagnostic === 'string')
    && failure.recovery?.action === template.recovery.action && failure.recovery.retryable === template.recovery.retryable
    && typeof failure.recovery.writesBlocked === 'boolean'
    && (!template.recovery.writesBlocked || failure.recovery.writesBlocked);
}
