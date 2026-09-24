import type { ModelMessage } from 'ai';
import { buildAgentSystemPrompt } from '@/shared/lib/agentRuntimeSettings';
import { Agent, RunBudget, createAgentLoopState } from '../agent-core';
import { bindExecutionIdentity } from '../runtime/durableExecution';
import { createAgentDriver } from './agentDriver';
import type { answerWithGroundedAgent, GroundedAnswer } from './qna';

/** Same durable Agent and provider, but no workspace, tool catalog, MCP or evidence hydration. */
export async function answerLightweightChat(options: Parameters<typeof answerWithGroundedAgent>[0]): Promise<GroundedAnswer> {
  const { execution, settings, abortSignal, question, activeExecution } = options;
  const budget = options.budget ?? new RunBudget();
  const system = [
    activeExecution ? buildAgentSystemPrompt(activeExecution.agent) : 'You are NeuInk, a research assistant.',
    'Respond briefly and naturally to this standalone greeting in the user\'s language. No task planning is needed. No workspace content has been read, and no tools or write permissions are available. Never claim to have read, searched or modified anything. Do not invent source citations.',
  ].join('\n\n');
  await bindExecutionIdentity(execution, 'main', {
    model: settings.model, endpoint: settings.base_url, protocol: settings.api_protocol,
    agent: activeExecution?.agent, tools: [], system, responseStyle: 'lightweight_chat',
  });
  const state = execution?.get<ReturnType<typeof createAgentLoopState>>('loop:main') ?? createAgentLoopState(question);
  const agent = new Agent<ModelMessage>({
    driver: createAgentDriver({ budget, settings, system, tools: {},
      onTurn: options.onAnswerReset, onDelta: options.onDelta, onReasoningDelta: options.onReasoningDelta }),
    tools: {}, budget, signal: abortSignal, maxTurns: 2,
    messages: [{ role: 'user', content: question }],
    checkpoint: execution?.actor<ModelMessage>('main'),
    saveCheckpoint: execution ? async checkpoint => {
      state.turnCount = checkpoint.turns;
      execution.set('loop:main', state);
      await execution.saveActor('main', checkpoint);
    } : undefined,
    verify: text => !text.trim() || /\[S\d+]/.test(text)
      ? 'Give a brief greeting without unsupported source citations.' : undefined,
  });
  const answer = await agent.run();
  state.status = 'completed';
  return { answer, sources: [], noteProposals: [], entryMetaProposals: [], tagProposals: [], toolEvents: [], agentLoopState: state };
}
