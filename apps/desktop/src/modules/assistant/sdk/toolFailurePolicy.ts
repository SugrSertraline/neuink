import type { ToolSet } from 'ai';
import type { AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';
import { assistantErrorDiagnostic, ASSISTANT_TOOL_PENDING } from '@/shared/lib/assistantDebug';
import { describeAssistantReadFailure, safeAssistantReadFailure } from '@/shared/lib/assistantReadFailure';
import { AgentStoppedError, AgentToolNotExecutedError } from '../agent-core/agent';
import { AgentLoopGuardError } from '../agent-core/cycleGuard';
import { createAgentToolFailure, isAgentToolFailure, type AgentToolNotExecutedCode } from '../agent-core/toolFailure';

const DOCUMENT_READ_TOOLS = new Set(['read_browser_tab', 'read_pdf_pages', 'search_pdf_text']);

const preconditionInstructions = {
  note_read_required: 'Read the current target note before creating a line-precise patch proposal. Use read_note or read_current_note, then derive patch coordinates and expected_text from that fresh result. No proposal was created.',
  patch_coordinates_required: 'Read the current target note and supply line-precise patch_operations with expected_text copied from its current content. No proposal was created.',
  patch_content_mismatch: 'Read the current target note again and rebuild patch_operations from its current content. Line coordinates and expected_text must match; exact replacement text or anchors must match exactly once. No proposal was created.',
  note_target_required: 'Select or confirm the intended Entry and note or segment within the current scope before proposing changes. Supply the confirmed target identifiers; do not guess or expand the scope. No proposal was created.',
  inline_citations_required: 'The proposed content has no inline citation for one or more supplied sources. Place each valid [S#] citation inline beside its supported claim, including inserted or replacement patch text, not on a separate line or in a source list. Remove unused source_markers and retry the proposal; no proposal was created.',
  source_search_required: 'Call search_sciverse_evidence first, then use a doc_id returned by that search earlier in this run. No content read was attempted.',
  local_source_required: 'External evidence cannot be persisted as a local Source Link. Import the paper only after required user confirmation, then read an actual local source before creating a linked note. No proposal was created.'
} as const;

/** Only pure host preconditions may create this type. Remote text never selects its guidance. */
export class ToolPreconditionError extends AgentToolNotExecutedError {
  constructor(readonly reason: keyof typeof preconditionInstructions) {
    super(preconditionInstructions[reason], 'TOOL_PREFLIGHT_FAILED');
  }
}

export const TOOL_FAILURE_INSTRUCTIONS = [
  'Tool failures are observations for you to handle. Read failure.code, outcome, recovery, and the safe diagnostic when present.',
  'For ordinary failures, use another currently allowed read-only approach when useful, or explain the reason, completed work, and incomplete work in natural language.',
  'Never copy internal tool names, failure codes, error objects, stack traces, credentials, or raw HTTP messages into your user-facing answer.',
  'A failed result does not mean the operation was never executed. Do not claim success or that nothing changed without evidence.',
  'If outcome is unknown or recovery.writesBlocked is true, explicitly explain that part of the operation may have completed, inspect using read-only tools, and make no further writes or write variants.',
  'For partial failures, retain and report successful items and inspect the returned details. Never automatically retry the entire batch.'
].join('\n');

/** Host validation before dispatch may establish that no side effect was attempted. */
export function toolPreflight<T>(check: () => T, code: AgentToolNotExecutedCode = 'TOOL_INVALID_ARGUMENTS'): T {
  try { return check(); }
  catch (error) {
    if (error instanceof AgentStoppedError || error instanceof AgentToolNotExecutedError) throw error;
    throw new AgentToolNotExecutedError(error instanceof Error ? error.message : undefined, code);
  }
}

export function safeToolErrorEvent(event: AssistantToolTraceEvent): AssistantToolTraceEvent {
  return event.status === 'error'
    ? { ...event, summary: ASSISTANT_TOOL_PENDING,
      error: safeAssistantReadFailure(event.error) ?? assistantErrorDiagnostic(event.error) }
    : event;
}

/** Treat explicit service failure envelopes as failures before formatting success output.
 * A returned MCP error does not prove that the external tool made no changes. */
export function assertSuccessfulToolResult(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const result = value as Record<string, unknown>;
  if (result.isError === true || result.ok === false || result.status === 'error' || result.status === 'failed'
    || (typeof result.error === 'string' && result.error.length > 0)
    || (result.error !== null && typeof result.error === 'object')) {
    const content = Array.isArray(result.content) ? result.content.slice(0, 4).flatMap(item =>
      item && typeof item === 'object' && typeof item.text === 'string' ? [item.text.slice(0, 2048)] : []).join('\n') : undefined;
    throw new Error(`工具返回失败结果。${assistantErrorDiagnostic(result.error ?? result.message ?? content)}`);
  }
}

/** Every SDK executor reports a failed trace, while core owns recovery and write uncertainty. */
export function trackToolFailures(
  tools: ToolSet,
  report: (event: AssistantToolTraceEvent) => void,
  signal?: AbortSignal
): void {
  for (const [name, definition] of Object.entries(tools)) {
    const execute = definition.execute;
    if (!execute) continue;
    definition.execute = async (input, options) => {
      const activeSignal = options.abortSignal ?? signal;
      activeSignal?.throwIfAborted();
      try {
        const result = await execute(input, options);
        activeSignal?.throwIfAborted();
        if (isAgentToolFailure(result)) {
          report({ id: options.toolCallId, toolName: name, status: 'error', error: result.message });
        } else assertSuccessfulToolResult(result);
        return result;
      } catch (error) {
        activeSignal?.throwIfAborted();
        if (error instanceof ToolPreconditionError) {
          const failure = { ...createAgentToolFailure('TOOL_PREFLIGHT_FAILED'),
            diagnostic: preconditionInstructions[error.reason] };
          report({ id: options.toolCallId, toolName: name, status: 'error', error: failure.message });
          return failure;
        }
        // Ordinary document-read failures are observations. Cancellation, writes, unknown MCP
        // tools and fatal guards retain the core's existing fail-closed semantics.
        if (DOCUMENT_READ_TOOLS.has(name) && !(error instanceof Error && error.name === 'AbortError') && !(error instanceof AgentStoppedError)
          && !(error instanceof AgentToolNotExecutedError) && !(error instanceof AgentLoopGuardError)) {
          const failure = { ...createAgentToolFailure('TOOL_EXECUTION_FAILED'),
            diagnostic: describeAssistantReadFailure(error) };
          report({ id: options.toolCallId, toolName: name, status: 'error', error: failure.diagnostic });
          return failure;
        }
        if (!(error instanceof AgentStoppedError)) {
          report({ id: options.toolCallId, toolName: name, status: 'error',
            error: error instanceof Error ? error.message : typeof error === 'string' ? error : undefined });
        }
        throw error;
      }
    };
  }
}
