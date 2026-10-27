import { assistantErrorDiagnostic } from '@/shared/lib/assistantDebug';
import { safeAssistantReadFailure } from '@/shared/lib/assistantReadFailure';
import { AgentLocalLimitError } from '../agent-core/agent';

/** Provider errors can embed request headers; never persist their raw message or stack. */
export function evalError(error: unknown): string {
  if (error instanceof AgentLocalLimitError) return `AgentLocalLimitError: ${error.reason}`;
  return safeAssistantReadFailure(error) ?? assistantErrorDiagnostic(error);
}
