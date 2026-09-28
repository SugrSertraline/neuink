import { listTools, listMcpTools, type AssistantToolDescriptor, type AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';
import type { AgentExecutionSelection, AgentRuntimeSettings } from '@/shared/types/agentRuntime';
import type { AgentInvocationPlan } from '@/shared/types/assistant';
import { configuredAgentToolIds } from '@/shared/lib/agentRuntimeSettings';
import { abortable } from '../agent-core';
import { PDF_TOOL_DESCRIPTORS } from './pdfTools';

/** Catalog outages narrow this run's capabilities; they never invalidate healthy tools. */
export async function loadAssistantToolCatalog(options: {
  root: string;
  signal?: AbortSignal;
  runtimeSettings?: AgentRuntimeSettings | null;
  activeExecution?: AgentExecutionSelection | null;
  invocationPlan?: AgentInvocationPlan | null;
}) {
  const { root, signal, runtimeSettings, activeExecution, invocationPlan } = options;
  const notes: string[] = [];
  const events: AssistantToolTraceEvent[] = [];
  const descriptors: AssistantToolDescriptor[] = [...PDF_TOOL_DESCRIPTORS];
  signal?.throwIfAborted();
  try { descriptors.push(...await abortable(listTools(), signal)); }
  catch {
    signal?.throwIfAborted();
    const error = '内置服务工具目录读取失败。本轮只能使用实际提供的工具；请使用已有信息或说明能力限制。';
    notes.push(error);
    events.push({ id: 'catalog:builtin', toolName: 'list_tools', status: 'error', error });
  }
  for (const server of runtimeSettings?.mcpServers ?? []) {
    if (invocationPlan?.executionMode === 'plan' || !server.enabled || !activeExecution?.agent.allowedMcpServerIds?.includes(server.id)
      || !activeExecution.agent.permissions.canInvokeTools) continue;
    const prefix = `mcp.${server.id}.`;
    const granted = configuredAgentToolIds(runtimeSettings!, activeExecution.agent);
    if (!granted.some(id => id.startsWith(prefix) && (!invocationPlan || invocationPlan.enabledToolIds.includes(id)))) continue;
    try {
      const catalog = await abortable(listMcpTools(root, server.id, signal), signal);
      signal?.throwIfAborted();
      descriptors.push(...catalog.tools.map(item => ({ name: `${prefix}${item.name}`,
        description: item.description ?? item.name, parameters_schema: item.inputSchema })));
    } catch {
      signal?.throwIfAborted();
      // Never expose process stderr, commands or credentials to the model or traces.
      const error = `MCP 服务 ${server.id} 的工具目录读取失败，其工具本轮不可用。其他工具仍可使用；不要猜测该服务的工具或声称调用成功。`;
      notes.push(error);
      events.push({ id: `catalog:mcp:${server.id}`, toolName: `${prefix}tools_list`, status: 'error', error });
    }
  }
  return { descriptors, notes, events };
}
