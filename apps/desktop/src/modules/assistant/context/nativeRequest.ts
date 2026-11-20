import type { NativeContextState, RunContextPolicy, WorkspaceContext } from '@/shared/types/modelContext';
import { prepareContextRequest } from './request';
import { contextJson, runPolicyMessage, workspaceMessage } from './workspace';

/** Native agents own their model history. Send only acknowledged state changes on resume. */
export function prepareNativeContextRequest(options: {
  previous?: NativeContextState;
  workspace: WorkspaceContext;
  policy: RunContextPolicy;
  agentProfile: string;
  capabilities: string[];
  question: string;
}) {
  const previous = options.previous;
  const history = [
    ...(previous?.workspace ? [workspaceMessage(previous.workspace)] : []),
    ...(previous?.policy ? [runPolicyMessage(previous.policy)] : [])
  ];
  const prepared = prepareContextRequest({ history, workspace: options.workspace, policy: options.policy, question: options.question });
  const capabilities = [...options.capabilities].sort();
  const state: NativeContextState = { version: 1, workspace: options.workspace, policy: options.policy,
    agent_profile: options.agentProfile, capabilities };
  return { state, payload: {
    request: options.question,
    ...(prepared.inputMessages.some(message => message.providerOptions?.neuink?.context === 'workspace_context')
      ? { workspace_context: options.workspace } : {}),
    ...(prepared.inputMessages.some(message => message.providerOptions?.neuink?.context === 'run_policy')
      ? { run_policy: options.policy } : {}),
    ...(previous?.agent_profile !== options.agentProfile ? { agent_profile: options.agentProfile } : {}),
    ...(contextJson(previous?.capabilities) !== contextJson(capabilities) ? { capabilities } : {})
  } };
}
