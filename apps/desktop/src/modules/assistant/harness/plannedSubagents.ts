import type {
  AgentRuntimeTraceEvent,
  AssistantContextSnapshot,
  AssistantToolDescriptor,
  AssistantToolTraceEvent,
  ConversationMessage,
  ConversationSourceLink,
  LlmProfile,
  ScopeSnapshot
} from '@/shared/ipc/assistantApi';
import type {
  AgentInvocationPlan,
  AssistantActiveNote,
  AssistantAgentRun
} from '@/shared/types/assistant';
import type { AgentExecutionSelection, AgentRuntimeSettings } from '@/shared/types/agentRuntime';
import {
  auditAgentToolPermissions,
  resolveAllowedSubagents
} from '@/shared/lib/agentRuntimeSettings';

import { runSubagentTask } from '../runtime/subagent';
import {
  emitHarnessEvent,
  errorMessage,
  throwIfAborted,
  upsertRunNode
} from './runState';
import { compactVerifierText } from './verification';

type PlannedSubagentResult = {
  agentId: string;
  agentName: string;
  answer: string;
  expectedOutput: string;
  instruction: string;
  sources: ConversationSourceLink[];
  trace: AgentRuntimeTraceEvent[];
};

export function recordToolPermissionAudit({
  activeExecution,
  agentRun,
  invocationPlan,
  runId,
  runtimeSettings,
  toolDescriptors
}: {
  activeExecution: AgentExecutionSelection;
  agentRun: AssistantAgentRun;
  invocationPlan: AgentInvocationPlan;
  runId: string;
  runtimeSettings: AgentRuntimeSettings;
  toolDescriptors: AssistantToolDescriptor[];
}) {
  const backendToolIds = toolDescriptors.map((descriptor) => descriptor.name);
  const requestedToolIds = invocationPlan.enabledToolIds.length > 0
    ? invocationPlan.enabledToolIds
    : activeExecution.agent.enabledToolIds;
  const configuredMcpToolIds = runtimeSettings.mcpServers
    .filter((server) => server.enabled &&
      activeExecution.agent.allowedMcpServerIds?.includes(server.id))
    .flatMap((server) => server.allowedToolNames
      .map((toolName) => `mcp.${server.id}.${toolName}`));
  const availableToolIds = requestedToolIds.filter((toolId) =>
    backendToolIds.includes(toolId) ||
    toolId === 'skill.search' || toolId === 'skill.load' ||
    toolId === 'task.run_subagent' || toolId.startsWith('mcp.')
  ).concat(configuredMcpToolIds);
  const audit = auditAgentToolPermissions(
    availableToolIds,
    activeExecution.agent,
    runtimeSettings
  );
  const deniedSummary = audit.deniedTools
    .map((item) => `${item.toolId}: ${item.reason}`).join('; ');
  upsertRunNode(agentRun, {
    agentId: activeExecution.agent.id,
    error: deniedSummary || undefined,
    id: `${runId}-tool-permissions`,
    inputSummary: `requested=${requestedToolIds.join(', ') || 'none'}`,
    kind: 'tool',
    outputSummary: `allowed=${audit.allowedToolIds.join(', ') || 'none'}${
      audit.deniedTools.length > 0 ? `; denied=${audit.deniedTools.length}` : ''
    }`,
    status: audit.allowedToolIds.length > 0 ? 'succeeded' : 'skipped',
    title: 'Audit tool permissions'
  });
}

export async function runPlannedSubagentTasks(options: {
  abortSignal?: AbortSignal;
  activeExecution: AgentExecutionSelection;
  agentRun: AssistantAgentRun;
  contextSnapshot: AssistantContextSnapshot;
  conversationHistory: ConversationMessage[];
  currentNote?: AssistantActiveNote | null;
  invocationPlan: AgentInvocationPlan;
  onToolEvent?: (event: AssistantToolTraceEvent) => void;
  profiles: LlmProfile[];
  question: string;
  root: string;
  runId: string;
  runtimeSettings: AgentRuntimeSettings;
  scope: ScopeSnapshot;
  settings: LlmProfile;
}) {
  const { activeExecution, agentRun, invocationPlan, onToolEvent, runId } = options;
  const tasks = invocationPlan.subagentTasks;
  if (tasks.length === 0) return '';
  const eventId = `${runId}-planned-subagents`;
  if (!activeExecution.agent.permissions.canInvokeSubagents) {
    recordDisabledSubagents(options, eventId);
    return '';
  }

  const allowed = resolveAllowedSubagents(options.runtimeSettings, activeExecution.agent);
  const results: PlannedSubagentResult[] = [];
  emitHarnessEvent(onToolEvent, {
    id: eventId,
    input: { agentId: activeExecution.agent.id, taskCount: tasks.length },
    status: 'running',
    summary: `Running ${tasks.length} planned subagent task${tasks.length === 1 ? '' : 's'}.`,
    toolName: 'harness.subagents'
  });

  for (const [index, task] of tasks.entries()) {
    throwIfAborted(options.abortSignal);
    const subagent = allowed.find((candidate) => candidate.id === task.agentId);
    const taskEventId = `${eventId}-${index + 1}`;
    if (!subagent) {
      recordUnavailableSubagent(options, taskEventId, task);
      continue;
    }
    const profile = options.profiles.find((item) => item.id === subagent.llmProfileId) ??
      options.profiles[0] ?? options.settings;
    emitHarnessEvent(onToolEvent, {
      id: taskEventId, input: task, status: 'running',
      summary: `Running planned subagent ${subagent.name}.`, toolName: 'harness.subagent'
    });
    upsertRunNode(agentRun, {
      agentId: subagent.id, id: taskEventId,
      inputSummary: compactVerifierText(task.instruction, 220), kind: 'subagent',
      outputSummary: `expected=${task.expectedOutput}`, status: 'running',
      title: `Run ${subagent.name}`
    });
    try {
      const result = await runSubagentTask({
        agentId: subagent.id,
        contextSnapshot: options.contextSnapshot,
        conversationHistory: options.conversationHistory,
        currentNote: options.currentNote,
        instruction: task.instruction,
        question: options.question,
        root: options.root,
        runtimeSettings: options.runtimeSettings,
        scope: options.scope,
        settings: profile
      });
      results.push({
        agentId: subagent.id, agentName: subagent.name, answer: result.answer,
        expectedOutput: task.expectedOutput, instruction: task.instruction,
        sources: result.sources, trace: result.trace
      });
      emitHarnessEvent(onToolEvent, {
        id: taskEventId, input: task, sources: result.sources, status: 'done',
        summary: `Planned subagent ${subagent.name} completed.`, toolName: 'harness.subagent'
      });
      upsertRunNode(agentRun, {
        agentId: subagent.id, id: taskEventId, kind: 'subagent',
        outputSummary: `sources=${result.sources.length}, trace=${result.trace.length}`,
        sourceCount: result.sources.length, status: 'succeeded', title: `Run ${subagent.name}`
      });
    } catch (error) {
      const message = errorMessage(error);
      upsertRunNode(agentRun, {
        agentId: subagent.id, error: message, id: taskEventId,
        kind: 'subagent', status: 'failed', title: `Run ${subagent.name}`
      });
      emitHarnessEvent(onToolEvent, {
        error: message, id: taskEventId, input: task, status: 'error',
        summary: `Planned subagent ${subagent.name} failed.`, toolName: 'harness.subagent'
      });
    }
  }
  emitHarnessEvent(onToolEvent, {
    id: eventId, input: { completed: results.length, taskCount: tasks.length },
    status: results.length > 0 ? 'done' : 'error',
    summary: results.length > 0
      ? `Completed ${results.length} planned subagent task${results.length === 1 ? '' : 's'}.`
      : 'No planned subagent task completed.',
    toolName: 'harness.subagents'
  });
  return formatResults(results);
}

function recordDisabledSubagents(options: Parameters<typeof runPlannedSubagentTasks>[0], id: string) {
  upsertRunNode(options.agentRun, {
    error: 'Subagent invocation is disabled.', id,
    inputSummary: `tasks=${options.invocationPlan.subagentTasks.length}`,
    kind: 'subagent', status: 'skipped', title: 'Run planned subagents'
  });
  emitHarnessEvent(options.onToolEvent, {
    error: 'The selected primary agent is not allowed to invoke subagents.', id,
    status: 'error', summary: 'Skipped planned subagent tasks.',
    toolName: 'harness.subagents'
  });
}

function recordUnavailableSubagent(
  options: Parameters<typeof runPlannedSubagentTasks>[0],
  id: string,
  task: AgentInvocationPlan['subagentTasks'][number]
) {
  const error = `Subagent ${task.agentId} is not allowed for ${options.activeExecution.agent.name}.`;
  upsertRunNode(options.agentRun, {
    agentId: task.agentId, error, id,
    inputSummary: compactVerifierText(task.instruction, 220),
    kind: 'subagent', status: 'skipped', title: `Run ${task.agentId}`
  });
  emitHarnessEvent(options.onToolEvent, {
    error, id, input: task, status: 'error',
    summary: 'Skipped a planned subagent task.', toolName: 'harness.subagent'
  });
}

function formatResults(results: PlannedSubagentResult[]) {
  if (results.length === 0) return '';
  const lines = ['Planned Subagent Results:'];
  for (const result of results) {
    lines.push(
      `- Agent: ${result.agentName} (${result.agentId})`,
      `  Expected output: ${result.expectedOutput}`,
      `  Instruction: ${compactVerifierText(result.instruction, 260)}`,
      `  Sources: ${result.sources.length}`,
      `  Answer: ${compactVerifierText(result.answer, 1200)}`
    );
  }
  return lines.join('\n');
}
