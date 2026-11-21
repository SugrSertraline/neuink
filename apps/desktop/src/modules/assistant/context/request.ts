import type { ModelMessage } from 'ai';
import type { RunContextPolicy, WorkspaceContext } from '@/shared/types/modelContext';
import { latestContextState, contextJson, runPolicyMessage, workspaceMessage } from './workspace';

/** The sole assembly point for new user turns. Earlier model messages are never rewritten. */
export function prepareContextRequest(options: {
  history: readonly ModelMessage[];
  workspace?: WorkspaceContext;
  policy?: RunContextPolicy;
  question: string;
  observations?: readonly string[];
}) {
  const previous = latestContextState(options.history);
  const inputMessages: ModelMessage[] = [];
  if (options.workspace && contextJson(previous.workspace) !== contextJson(options.workspace))
    inputMessages.push(workspaceMessage(options.workspace));
  if (options.policy && contextJson(previous.policy) !== contextJson(options.policy))
    inputMessages.push(runPolicyMessage(options.policy));
  if (options.observations?.length) inputMessages.push({ role: 'user',
    content: `Host capability observations for this request:\n${options.observations.join('\n')}` });
  inputMessages.push({ role: 'user', content: options.question });
  return { messages: [...options.history, ...inputMessages], inputMessages, historyLength: options.history.length };
}

/** A bounded host update for one model step; it never changes the system prefix or declarations. */
export function prepareTurnControl(finish: boolean, blockedTools: string[]): ModelMessage[] {
  if (!finish && !blockedTools.length) return [];
  return [{ role: 'user', content: 'Host turn control (applies to this model step only):\n'
    + (finish ? 'No more tool calls are permitted. Give the final answer now using existing observations; explain incomplete work honestly.'
      : `These tools reached a host limit and cannot execute: ${blockedTools.join(', ')}. Use remaining permitted tools or synthesize the available evidence.`) }];
}
