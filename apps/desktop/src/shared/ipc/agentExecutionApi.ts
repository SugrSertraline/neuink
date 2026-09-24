import { invoke } from '@tauri-apps/api/core';

export type AgentExecutionRecord = {
  id: string;
  conversationId: string;
  revision: number;
  status: 'running' | 'cancelled' | 'failed' | 'completed' | 'awaiting_approval';
  updatedAt: string;
  payload: Record<string, unknown>;
};
export const readAgentExecution = (root: string, id: string) =>
  invoke<AgentExecutionRecord | null>('read_agent_execution', { root, id });
export const saveAgentExecution = (root: string, record: AgentExecutionRecord) =>
  invoke<AgentExecutionRecord>('save_agent_execution', { root, record });
export const listAgentExecutions = (root: string, conversationId: string) =>
  invoke<AgentExecutionRecord[]>('list_agent_executions', { root, conversationId });
