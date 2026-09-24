import { readAgentExecution, type AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';
import { AgentPersistenceError, RunBudget } from '../agent-core';
import { DurableExecution } from '../runtime/durableExecution';
import type { RunAssistantHarnessOptions } from './engine';
import type { GroundedAnswer } from '../sdk/qna';
import { AssistantHarnessError } from './runState';

// Explicit allowlist. Never persist settings, profiles, callbacks, or their credentials.
const INPUT_KEYS = ['question', 'assistantContext', 'availableEntries', 'availableNotes', 'availableTags',
  'contextPlan', 'composerSnapshot', 'conversationHistory', 'conversationId', 'currentEntry', 'currentNote',
  'currentSegment', 'currentSurface', 'destinationEntryId', 'mentionScope', 'tagMentionScopes',
  'preferredAgentId', 'scope'] as const;

export async function runDurableHarness(
  options: RunAssistantHarnessOptions,
  execute: (options: RunAssistantHarnessOptions) => Promise<GroundedAnswer>
): Promise<GroundedAnswer> {
  const budget = new RunBudget();
  if (!options.conversationId) return execute({ ...options, budget });
  let record: AgentExecutionRecord;
  let input = options;
  if (options.resumeExecutionId) {
    const saved = await readAgentExecution(options.root, options.resumeExecutionId);
    if (!saved || saved.id !== options.resumeExecutionId || saved.conversationId !== options.conversationId || saved.payload?.version !== 1) {
      throw new Error('找不到当前对话的有效任务检查点。');
    }
    if (saved.payload.profileId !== options.settings.id) throw new Error('请切换回原任务使用的模型配置后继续。');
    const original = saved.payload.input as Partial<RunAssistantHarnessOptions>;
    if (!original || typeof original !== 'object' || Array.isArray(original)
      || original.conversationId !== saved.conversationId || typeof original.question !== 'string') {
      throw new Error('任务检查点中的原始输入无效，已停止恢复。');
    }
    // Restore only known task inputs. Current callbacks, permissions and credentials remain authoritative.
    const restored = Object.fromEntries(INPUT_KEYS.filter(key => key in original).map(key => [key, original[key]]));
    input = { ...options, ...restored, resumedFromRunId: saved.id };
    record = saved;
    budget.restore(saved.payload.budget as ReturnType<RunBudget['snapshot']>);
  } else {
    record = { id: `execution-${crypto.randomUUID()}`, conversationId: options.conversationId,
      revision: 0, status: 'running', updatedAt: new Date().toISOString(), payload: {
        version: 1, question: options.question, profileId: options.settings.id,
        input: Object.fromEntries(INPUT_KEYS.map(key => [key, options[key]]))
      } };
  }
  const execution = new DurableExecution(options.root, record, budget);
  record.status = 'running';
  await execution.flush();
  budget.persist = () => execution.flush();
  try {
    const cached = execution.get<GroundedAnswer>('result');
    const alreadyDelivered = cached && options.conversationHistory?.some(message =>
      message.parts?.some(part => part.type === 'agent-run' && part.run.executionId === record.id));
    if (alreadyDelivered) {
      // A crash between conversation save and delivery acknowledgement must not duplicate proposals.
      return { answer: '该任务的结果已经保存在本对话中，请查看原结果。待审核修改仍需由你确认。', sources: [], executionId: record.id };
    }
    const result = cached ?? await execute({ ...input, budget, execution });
    result.executionId = record.id;
    if (result.agentRun) {
      result.agentRun.executionId = record.id;
      result.agentRun.modelUsage = budget.snapshot();
    }
    execution.set('result', result);
    // Delivery is acknowledged only AFTER the conversation and immutable proposals have been saved.
    execution.set('deliveryPending', true);
    await execution.flush();
    return result;
  } catch (error) {
    record.status = options.abortSignal?.aborted ? 'cancelled' : 'failed';
    const cause = error instanceof AssistantHarnessError ? error.cause : error;
    if (!(cause instanceof AgentPersistenceError)) await execution.flush();
    throw error;
  }
}

export async function acknowledgeExecution(root: string, id: string, awaitingApproval: boolean) {
  const record = await readAgentExecution(root, id);
  if (!record) throw new Error('任务记录不存在，无法确认交付。');
  const budget = new RunBudget();
  budget.restore(record.payload.budget as ReturnType<RunBudget['snapshot']>);
  const execution = new DurableExecution(root, record, budget);
  const result = execution.get<GroundedAnswer>('result');
  record.status = awaitingApproval || result?.taskState?.status === 'awaiting_approval' ? 'awaiting_approval' : 'completed';
  execution.set('deliveryPending', false);
  await execution.flush();
}
