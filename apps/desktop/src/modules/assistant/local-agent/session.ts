import type { AssistantMessagePart, Conversation, LlmProfile } from '@/shared/ipc/assistantApi';
import { CLAUDE_CODE_DISPLAY_NAME, LOCAL_AGENTS, localAgentName, type LocalAgentProvider } from '@/shared/lib/localAgentSettings';
export const CLAUDE_SELECTION = 'local-agent:claude';
export const CLAUDE_PROFILE: LlmProfile = { id: CLAUDE_SELECTION, name: CLAUDE_CODE_DISPLAY_NAME, model: '本地 Agent',
  base_url: '', api_key: null, api_protocol: 'anthropic', max_context_length: null,
  temperature: null, top_p: null, max_output_tokens: null };
export type LocalAgentSession = Extract<AssistantMessagePart, { type: 'local-agent' }>;
export const localAgentSelection = (provider: LocalAgentProvider) => `local-agent:${provider}`;
export const selectionLocalProvider = (selection: string): LocalAgentProvider | null => LOCAL_AGENTS.find(agent => localAgentSelection(agent.id) === selection)?.id ?? null;
export const localAgentProfile = (provider: LocalAgentProvider): LlmProfile => ({...CLAUDE_PROFILE,id:localAgentSelection(provider),name:localAgentName(provider)});
export function conversationLocalSession(conversation: Pick<Conversation, 'messages'> | null): LocalAgentSession | null {
  const parts = conversation?.messages.flatMap(message => message.parts ?? []) ?? [];
  const sessions = parts.filter((part): part is LocalAgentSession => part.type === 'local-agent' && LOCAL_AGENTS.some(agent => agent.id === part.provider));
  return [...sessions].reverse().find(part => part.initialized) ?? sessions[sessions.length - 1] ?? null;
}
export function createLocalSession(conversation: Pick<Conversation, 'messages'> | null, provider: LocalAgentProvider = 'claude'): LocalAgentSession {
  const existing = conversationLocalSession(conversation);
  return existing?.provider === provider ? existing : { type: 'local-agent', provider, sessionId: crypto.randomUUID(), initialized: false };
}
