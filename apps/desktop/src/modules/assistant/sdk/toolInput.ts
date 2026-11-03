import { type ScopeSnapshot } from '@/shared/ipc/assistantApi';
import { isResearchTool } from '@/shared/ipc/researchApi';
import {
  type AgentExecutionSelection,
  type AgentRuntimeSettings,
  type AgentToolId
} from '@/shared/types/agentRuntime';
import { type AgentInvocationPlan, type AssistantTaskPlan } from '@/shared/types/assistant';
import { entryContextWindow } from './entryContext';
import { isPdfTool } from './pdfTools';
import { asObject, optionalNumber, optionalString, requiredString, stringArray } from './toolValues';

export function normalizeToolInput(
  toolName: string,
  input: unknown,
  {
    root,
    scope
  }: {
    root: string;
    scope: ScopeSnapshot;
  }
) {
  const object = asObject(input);

  if (isPdfTool(toolName)) {
    const search = toolName === 'search_pdf_text';
    const start = object.start_page ?? 1, count = object.page_count ?? (search ? 20 : 3);
    if (!Number.isInteger(start) || Number(start) < 1 || Number(start) > 2000 || !Number.isInteger(count) || Number(count) < 1 || Number(count) > (search ? 20 : 5)) {
      throw new Error('PDF 页码范围无效；读取每次最多 5 页，搜索最多 20 页。');
    }
    const query = search ? requiredString(object.query, 'query') : undefined;
    if (query && query.length > 200) throw new Error('PDF 搜索词不能超过 200 个字符。');
    return { root, entry_id: entryIdOrSingleScope(object.entry_id, scope), start_page: start, page_count: count, ...(query ? { query } : {}) };
  }

  if (isResearchTool(toolName)) return { ...object, root };

  if (toolName.startsWith('mcp.')) {
    return {
      args: object,
      root,
      tool_name: toolName
    };
  }

  if (toolName === 'search_segments') {
    return {
      root,
      query: requiredString(object.query, 'query'),
      mode: searchMode(object.mode),
      scope_entry_ids: scopedEntryIds(object.scope_entry_ids, scope),
      top_k: clampTopK(object.top_k)
    };
  }

  if (toolName === 'read_segment_content') {
    return {
      root,
      entry_id: entryIdOrSingleScope(object.entry_id, scope),
      segment_uid: requiredString(object.segment_uid, 'segment_uid')
    };
  }

  if (toolName === 'read_entry_assistant_context') {
    return {
      root,
      entry_id: entryIdOrSingleScope(object.entry_id, scope),
      ...entryContextWindow(object)
    };
  }

  if (toolName === 'search_sciverse_evidence') {
    return {
      query: requiredString(object.query, 'query'),
      top_k: clampNumber(object.top_k, 1, 20, 8),
      sub_queries: clampNumber(object.sub_queries, 0, 4, 0)
    };
  }

  if (toolName === 'read_sciverse_content') {
    return {
      doc_id: requiredString(object.doc_id, 'doc_id'),
      offset: clampNumber(object.offset, 0, Number.MAX_SAFE_INTEGER, 0),
      limit: clampNumber(object.limit, 100, 12_000, 2_000),
      title: optionalString(object.title),
      chunk_id: optionalString(object.chunk_id),
      page_no: optionalNumber(object.page_no)
    };
  }

  if (toolName === 'search_sciverse_metadata') {
    return {
      fields: stringArray(object.fields).slice(0, 20),
      page: clampNumber(object.page, 1, 100, 1),
      page_size: clampNumber(object.page_size, 1, 20, 10),
      query: requiredString(object.query, 'query')
    };
  }

  if (toolName === 'search_sciverse_paper_schema') {
    return {
      page: clampNumber(object.page, 1, 100, 1),
      page_size: clampNumber(object.page_size, 1, 20, 10),
      query: requiredString(object.query, 'query')
    };
  }

  if (toolName === 'get_sciverse_metadata_catalog' || toolName === 'get_sciverse_paper_schema') {
    return {};
  }

  throw new Error(`Unsupported assistant tool: ${toolName}`);
}

export function scopedEnabledToolIds(
  agentToolIds: AgentToolId[],
  activeExecution?: AgentExecutionSelection | null,
  invocationPlan?: AgentInvocationPlan | null
) {
  const planned = invocationPlan ? new Set(invocationPlan.enabledToolIds) : null;
  const candidates = [...new Set([
    ...agentToolIds,
    ...(invocationPlan?.enabledToolIds ?? []) as AgentToolId[]
  ])];

  return candidates.filter((toolId) => {
    if (planned && !planned.has(toolId)) {
      return false;
    }
    if (toolId.startsWith('mcp.')) {
      return isAllowedMcpTool(toolId, activeExecution);
    }
    return true;
  });
}

export function isAllowedMcpTool(
  toolId: AgentToolId,
  activeExecution?: AgentExecutionSelection | null
) {
  if (!toolId.startsWith('mcp.')) {
    return true;
  }
  const [, serverId] = toolId.split('.');
  if (!serverId) {
    return false;
  }
  return activeExecution?.agent.allowedMcpServerIds?.includes(serverId) ?? false;
}

export function mcpToolIdsForAgent(
  runtimeSettings?: AgentRuntimeSettings | null,
  activeExecution?: AgentExecutionSelection | null
): AgentToolId[] {
  if (!runtimeSettings || !activeExecution) {
    return [];
  }
  const allowedServerIds = new Set(activeExecution.agent.allowedMcpServerIds ?? []);
  return runtimeSettings.mcpServers
    .filter((server) => server.enabled && allowedServerIds.has(server.id))
    .flatMap((server) =>
      server.allowedToolNames.map((toolName) => `mcp.${server.id}.${toolName}` as AgentToolId)
    );
}

export function scopedEntryIds(value: unknown, scope: ScopeSnapshot) {
  const requested = stringArray(value);

  if (scope.entry_ids.length === 0) {
    throw new Error('当前冻结范围没有可检索条目，请先选择论文或调整范围。');
  }

  if (requested.length === 0) {
    return scope.entry_ids;
  }

  const allowed = new Set(scope.entry_ids);
  if (requested.some(entryId => !allowed.has(entryId))) {
    throw new Error('检索条目超出冻结范围，不能自动扩大到其他论文。');
  }
  return requested;
}

export function entryIdOrSingleScope(value: unknown, scope: ScopeSnapshot) {
  const entryId = optionalString(value);
  if (!entryId) {
    throw new Error('entry_id is required for explicit Entry reads.');
  }
  if (!scope.entry_ids.includes(entryId)) {
    throw new Error(
      `Entry ${entryId} is outside the frozen Assistant scope. Allowed Entry ids: ${scope.entry_ids.join(', ') || 'none'}. Resolve [C] markers from the Typed Mention Map before retrying.`
    );
  }
  return entryId;
}

export function clampTopK(value: unknown) {
  const numberValue = typeof value === 'number' && Number.isFinite(value) ? value : 8;
  return Math.min(12, Math.max(1, Math.floor(numberValue)));
}

export function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number
) {
  const numberValue = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(numberValue)));
}

export function searchMode(value: unknown) {
  return value === 'keyword' || value === 'semantic' || value === 'hybrid' ? value : 'hybrid';
}

export function proposalToolInput(
  toolName: 'note.propose_create' | 'note.propose_patch' | 'segment_note.propose_patch',
  input: unknown,
  plan?: AssistantTaskPlan
) {
  const object = asObject(input);
  if (toolName === 'note.propose_create') {
    return { ...object, action: 'create', target: 'markdown_note' };
  }
  const action = plan?.noteAction === 'append' ||
    plan?.noteAction === 'delete' ||
    plan?.noteAction === 'prepend' ||
    plan?.noteAction === 'replace' ||
    plan?.noteAction === 'patch'
    ? plan.noteAction
    : object.action === 'append' || object.action === 'delete' || object.action === 'prepend' || object.action === 'replace' || object.action === 'patch'
      ? object.action
      : 'patch';
  return {
    ...object,
    action,
    target: toolName === 'segment_note.propose_patch' ? 'segment_note' : 'markdown_note'
  };
}

export function publicInput(input: unknown) {
  const object = asObject(input);
  const copy = { ...object };
  delete copy.root;
  return copy;
}
