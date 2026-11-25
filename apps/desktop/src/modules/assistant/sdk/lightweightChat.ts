import type { ModelMessage } from 'ai';
import { buildAgentSystemPrompt } from '@/shared/lib/agentRuntimeSettings';
import { Agent, RunBudget, createAgentLoopState } from '../agent-core';
import { bindExecutionIdentity } from '../runtime/durableExecution';
import { createTranscriptRecorder } from '../runtime/transcriptRecorder';
import { renderConversationContext } from '../runtime/conversationTranscript';
import { loadPrompt, resolveLlmApiProtocol } from '@/shared/ipc/assistantApi';
import { prepareContextRequest } from '../context/request';
import { composeSystemPolicy } from '../context/policy';
import { observeWorkspaceContext } from '../context/observation';
import { createAgentDriver } from './agentDriver';
import { hasAssistantToolMarkup } from './assistantAnswerMarkup';
import type { answerWithGroundedAgent, GroundedAnswer } from './qna';

/** Same durable Agent and provider, but no workspace, tool catalog, MCP or evidence hydration. */
export async function answerLightweightChat(options: Parameters<typeof answerWithGroundedAgent>[0]): Promise<GroundedAnswer> {
  const { execution, settings, abortSignal, question, activeExecution } = options;
  const budget = options.budget ?? new RunBudget();
  const system = composeSystemPolicy(await loadPrompt('qna_system'), activeExecution
    ? `<agent_profile>\n${buildAgentSystemPrompt(activeExecution.agent)}\n</agent_profile>` : '');
  await bindExecutionIdentity(execution, 'main', {
    model: settings.model, endpoint: settings.base_url, protocol: settings.api_protocol,
    agent: activeExecution?.agent, tools: [], system, responseStyle: 'lightweight_chat',
  });
  const state = execution?.get<ReturnType<typeof createAgentLoopState>>('loop:main') ?? createAgentLoopState(question);
  const model = { profileId: settings.id, model: settings.model, protocol: resolveLlmApiProtocol(settings.api_protocol) };
  const workspace = await observeWorkspaceContext(options);
  const prepared = prepareContextRequest({ history: renderConversationContext(options.conversationHistory ?? [], model,
    options.conversationMemory), question, workspace,
    policy: { mode: 'act', write_policy: 'chat_only', source_policy: 'none', required_tools: [] } });
  const recording = createTranscriptRecorder({ execution, model, initialMessageCount: prepared.messages.length,
    inputMessages: prepared.inputMessages, sources: new Map(), firstNewMarker: 1, onTranscript: options.onModelTranscript });
  const agent = new Agent<ModelMessage>({
    driver: createAgentDriver({ budget, settings, system, tools: {},
      onTurn: options.onAnswerReset, onDelta: options.onDelta, onReasoningDelta: options.onReasoningDelta }),
    tools: {}, budget, signal: abortSignal, maxTurns: 2,
    messages: prepared.messages,
    checkpoint: execution?.actor<ModelMessage>('main'),
    saveCheckpoint: async checkpoint => {
      state.turnCount = checkpoint.turns;
      if (execution) {
        execution.set('loop:main', state);
        await execution.saveActor('main', checkpoint);
      }
      await recording.save(checkpoint);
    },
    verify: text => !text.trim() || /\[S\d+]/.test(text) || hasAssistantToolMarkup(text)
      ? 'Give a brief greeting without unsupported source citations or tool-control tags.' : undefined,
  });
  const answer = await agent.run();
  await recording.finish([]);
  state.status = 'completed';
  return { answer, modelTranscript: recording.current, sources: [], noteProposals: [], entryMetaProposals: [], tagProposals: [], toolEvents: [], agentLoopState: state };
}
