import type { ModelMessage } from 'ai';
import type { ContextState, RunContextPolicy, WorkspaceContext } from '@/shared/types/modelContext';

type ContextKind = 'workspace_context' | 'run_policy';

/** Stable object ordering; reference and content-array order remains semantically significant. */
export function contextJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, item[key]]))
    : item) ?? 'null';
}

export function workspaceMessage(workspace: WorkspaceContext): ModelMessage {
  return contextMessage('workspace_context', workspace);
}

export function runPolicyMessage(policy: RunContextPolicy): ModelMessage {
  return contextMessage('run_policy', policy);
}

function contextMessage(kind: ContextKind, value: unknown): ModelMessage {
  return { role: 'user', content: `<${kind}>\n${contextJson(value)}\n</${kind}>`,
    providerOptions: { neuink: { context: kind } } };
}

function readContextMessage(message: ModelMessage, kind: ContextKind): unknown {
  if (message.role !== 'user' || typeof message.content !== 'string'
    || message.providerOptions?.neuink?.context !== kind) return;
  const start = `<${kind}>\n`, end = `\n</${kind}>`;
  if (!message.content.startsWith(start) || !message.content.endsWith(end)) return;
  try { return JSON.parse(message.content.slice(start.length, -end.length)); }
  catch { return; }
}

export function validWorkspace(value: unknown): value is WorkspaceContext {
  if (!value || typeof value !== 'object') return false;
  const state = value as WorkspaceContext;
  const entry = (item: unknown): item is { id: string; title: string } => Boolean(item && typeof item === 'object'
    && typeof (item as { id: unknown }).id === 'string' && typeof (item as { title: unknown }).title === 'string');
  return state.version === 1 && Boolean(state.scope) && Array.isArray(state.scope.entries) && state.scope.entries.every(entry)
    && Array.isArray(state.scope.tags) && state.scope.tags.every(tag => tag && typeof tag.id === 'string' && typeof tag.name === 'string')
    && (state.active_entry === null || entry(state.active_entry))
    && (state.active_note === null || (entry(state.active_note) && typeof state.active_note.entry_id === 'string'))
    && (state.browser === null || Boolean(state.browser && typeof state.browser.url === 'string' && typeof state.browser.title === 'string'))
    && Array.isArray(state.references) && state.references.every(ref => ref && typeof ref.kind === 'string')
    && Array.isArray(state.pinned_segments) && state.pinned_segments.every(ref => ref && typeof ref.entry_id === 'string'
      && typeof ref.segment_uid === 'string' && typeof ref.revision === 'string' && typeof ref.context_ref === 'string');
}

export function validRunPolicy(value: unknown): value is RunContextPolicy {
  if (!value || typeof value !== 'object') return false;
  const policy = value as RunContextPolicy;
  return ['act', 'plan'].includes(policy.mode) && typeof policy.write_policy === 'string'
    && typeof policy.source_policy === 'string' && Array.isArray(policy.required_tools)
    && policy.required_tools.every(tool => typeof tool === 'string');
}

/** Replay the last valid host messages verbatim; never consult live UI or summary metadata. */
export function latestContextMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  let workspace: ModelMessage | undefined, policy: ModelMessage | undefined;
  for (let index = messages.length - 1; index >= 0 && (!workspace || !policy); index--) {
    const message = messages[index];
    if (!workspace && validWorkspace(readContextMessage(message, 'workspace_context'))) workspace = message;
    if (!policy && validRunPolicy(readContextMessage(message, 'run_policy'))) policy = message;
  }
  return [...(workspace ? [workspace] : []), ...(policy ? [policy] : [])];
}

/** Read only host-authored observations. Pasted lookalike user messages are ordinary text. */
export function latestContextState(messages: readonly ModelMessage[]): ContextState {
  const state: ContextState = {};
  for (const message of latestContextMessages(messages)) {
    const workspace = readContextMessage(message, 'workspace_context');
    if (validWorkspace(workspace)) state.workspace = workspace;
    const policy = readContextMessage(message, 'run_policy');
    if (validRunPolicy(policy)) state.policy = policy;
  }
  return state;
}
