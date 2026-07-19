import type {
  AgentRuntimeTraceEvent,
  AssistantContextSnapshot,
  ConversationMessage,
  ConversationSourceLink,
  LlmProfile,
  ScopeSnapshot
} from '@/shared/ipc/assistantApi';
import { runAgentSubagentTask } from '@/shared/ipc/assistantApi';
import type { AssistantActiveNote } from '@/shared/types/assistant';
import type { AgentRuntimeSettings } from '@/shared/types/agentRuntime';

export type RunSubagentTaskOptions = {
  agentId: string;
  contextSnapshot?: AssistantContextSnapshot | null;
  conversationHistory?: ConversationMessage[];
  currentNote?: AssistantActiveNote | null;
  instruction: string;
  question: string;
  root: string;
  runtimeSettings: AgentRuntimeSettings;
  scope: ScopeSnapshot;
  settings: LlmProfile;
};

export type SubagentTaskResult = {
  answer: string;
  sources: ConversationSourceLink[];
  trace: AgentRuntimeTraceEvent[];
};

export async function runSubagentTask({
  agentId,
  contextSnapshot,
  conversationHistory = [],
  instruction,
  question,
  root,
  runtimeSettings,
  scope,
  settings
}: RunSubagentTaskOptions): Promise<SubagentTaskResult> {
  const result = await runAgentSubagentTask({
    agentId,
    contextSnapshot,
    conversationHistory,
    instruction,
    profiles: [settings],
    question,
    root,
    runtimeSettings,
    scope
  });

  return {
    answer: result.answer,
    sources: result.sources,
    trace: result.trace
  };
}
