import type {
  AgentExecutionSelection,
  AgentMcpServer,
  AgentProfile,
  AgentPermissions,
  AgentRuntimeSettings,
  AgentToolId,
  AgentToolPackage,
  MainAssistantProfile,
  SubagentOutputKind,
  SubagentProfile
} from '@/shared/types/agentRuntime';
import type { AgentInvocationPlan, AssistantTaskPlan } from '@/shared/types/assistant';

const STORAGE_KEY = 'neuink.agentRuntime.v4';
const LEGACY_MAIN_DESCRIPTION = 'Neuink 全局主助手，负责直接响应用户、选择技能和委派子 agent。';
const LEGACY_MAIN_PROMPT = 'You are Neuink Main Assistant. Stay grounded in workspace evidence, use skills only after loading them, and create user-confirmable proposals for note or Entry metadata writes.';
const DEFAULT_MAIN_DESCRIPTION = 'Neuink 全局主助手，负责直接响应用户、调用工具和委派子 agent。';
const DEFAULT_MAIN_PROMPT = 'You are Neuink Main Assistant. Stay grounded in workspace evidence and create user-confirmable proposals for note or Entry metadata writes.';

const DEFAULT_MAIN_TOOL_IDS: AgentToolId[] = [
  'read_pdf_pages', 'search_pdf_text',
  'search_papers', 'search_web', 'read_webpage', 'import_papers',
  'read_browser_tab',
  'app.set_appearance',
  'create_entry',
  'search_segments',
  'search_library',
  'get_entry_outline',
  'read_segment_content',
  'read_entry_assistant_context',
  'search_sciverse_evidence',
  'read_sciverse_content',
  'read_current_note',
  'read_note',
  'note.propose_create',
  'note.propose_patch',
  'segment_note.propose_patch',
  'entry.propose_meta_patch',
  'tag.propose_change',
  'task.run_subagent'
];

const EVIDENCE_TOOL_IDS: AgentToolId[] = [
  'read_pdf_pages', 'search_pdf_text',
  'search_segments',
  'search_library',
  'get_entry_outline',
  'read_segment_content',
  'read_entry_assistant_context',
  'search_sciverse_evidence',
  'read_sciverse_content'
];

const CAPABILITY_REVISION = 5;

// Capability revision in which each tool joined a default grant. A tool not listed here was part
// of the first grant (revision 0). A grant is complete at revision r when it holds every default
// tool added at or before r, so an old complete grant is judged against the set it was issued under.
const MAIN_TOOL_ADDED_IN: Partial<Record<AgentToolId, number>> = {
  search_papers: 1,
  search_web: 1,
  read_webpage: 1,
  import_papers: 1,
  read_pdf_pages: 2,
  search_pdf_text: 2,
  read_browser_tab: 3,
  get_entry_outline: 4,
  search_library: 5
};
const EVIDENCE_TOOL_ADDED_IN: Partial<Record<AgentToolId, number>> = {
  get_entry_outline: 4,
  search_library: 5
};

/**
 * Adds each default tool a complete older grant lacked, one revision step at a time. A grant
 * missing any tool from the set that existed before a step stays as it is, and so does every later
 * step. Tools added in step 3 or later also require tool-invocation permission.
 */
function extendGrant({
  addedIn,
  canInvokeTools,
  defaults,
  granted,
  revision
}: {
  addedIn: Partial<Record<AgentToolId, number>>;
  canInvokeTools: boolean;
  defaults: AgentToolId[];
  granted: AgentToolId[];
  revision: number;
}): AgentToolId[] {
  let tools = [...granted];
  for (let step = revision + 1; step <= CAPABILITY_REVISION; step += 1) {
    const added = defaults.filter(id => addedIn[id] === step);
    if (added.length === 0) continue;
    const priorComplete = defaults
      .filter(id => (addedIn[id] ?? 0) < step)
      .every(id => tools.includes(id));
    if (!priorComplete) break;
    if (step >= 3 && !canInvokeTools) break;
    tools = [...tools, ...added];
  }
  return [...new Set(tools)];
}

function createMainAssistant(partial: Partial<MainAssistantProfile>): MainAssistantProfile {
  return {
    allowedSubagentIds: partial.allowedSubagentIds ?? ['evidence-agent'],
    allowedMcpServerIds: partial.allowedMcpServerIds ?? [],
    description: partial.description && partial.description !== LEGACY_MAIN_DESCRIPTION
      ? partial.description : DEFAULT_MAIN_DESCRIPTION,
    enabledToolIds: (partial.enabledToolIds ?? DEFAULT_MAIN_TOOL_IDS).filter(isActiveTool),
    id: 'main-assistant',
    kind: 'main_assistant',
    llmProfileId: partial.llmProfileId ?? null,
    name: partial.name ?? 'Neuink 主助手',
    permissions: activePermissions(partial.permissions ?? {
      canInvokeSubagents: true,
      canInvokeTools: true,
      canReadWorkspaceWide: true,
      canWriteProposals: true
    }),
    sandbox: partial.sandbox ?? 'workspace-write-proposals',
    systemPrompt: partial.systemPrompt && partial.systemPrompt !== LEGACY_MAIN_PROMPT
      ? partial.systemPrompt : DEFAULT_MAIN_PROMPT,
    visibleInUi: false
  };
}

function createSubagent(
  partial: Partial<SubagentProfile> &
    Pick<SubagentProfile, 'id' | 'name' | 'outputKind' | 'systemPrompt'>
): SubagentProfile {
  return {
    allowedSubagentIds: [],
    allowedMcpServerIds: partial.allowedMcpServerIds ?? [],
    description: partial.description ?? '',
    enabled: partial.enabled ?? true,
    enabledToolIds: (partial.enabledToolIds ?? EVIDENCE_TOOL_IDS).filter(isActiveTool),
    id: partial.id,
    kind: 'subagent',
    llmProfileId: partial.llmProfileId ?? null,
    name: partial.name,
    outputKind: partial.outputKind,
    permissions: activePermissions(partial.permissions ?? {
      canInvokeSubagents: false,
      canInvokeTools: true,
      canReadWorkspaceWide: partial.outputKind === 'evidence',
      canWriteProposals: false
    }),
    sandbox: partial.sandbox ?? 'read-only',
    systemPrompt: partial.systemPrompt,
    visibleInUi: false
  };
}

export const DEFAULT_AGENT_RUNTIME_SETTINGS: AgentRuntimeSettings = {
  capabilityRevision: 5,
  mainAssistant: createMainAssistant({}),
  mcpServers: [],
  subagents: [
    createSubagent({
      id: 'evidence-agent',
      name: 'EvidenceAgent',
      outputKind: 'evidence',
      enabled: false,
      description: '检索、阅读并整理当前任务需要的证据。',
      systemPrompt:
        'You are Neuink EvidenceAgent. Search and read workspace evidence, then return concise evidence findings with source grounding. Do not write notes.'
    })
  ],
  toolPackages: [],
  version: 4
};

export function readAgentRuntimeSettings() {
  if (typeof window === 'undefined') {
    return DEFAULT_AGENT_RUNTIME_SETTINGS;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_AGENT_RUNTIME_SETTINGS;
  }
  try {
    return normalizeAgentRuntimeSettings(JSON.parse(raw) as Partial<AgentRuntimeSettings>);
  } catch {
    return DEFAULT_AGENT_RUNTIME_SETTINGS;
  }
}

export function saveAgentRuntimeSettings(settings: AgentRuntimeSettings) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeAgentRuntimeSettings(settings)));
}

export function normalizeAgentRuntimeSettings(
  settings: Partial<AgentRuntimeSettings> | null | undefined
): AgentRuntimeSettings {
  if (!settings || settings.version !== 4) {
    return DEFAULT_AGENT_RUNTIME_SETTINGS;
  }
  const revision = settings.capabilityRevision ?? 0;
  return {
    capabilityRevision: 5,
    mainAssistant: normalizeMainAssistant(settings.mainAssistant, revision),
    mcpServers: normalizeMcpServers(settings.mcpServers),
    subagents: normalizeSubagents(settings.subagents, revision),
    toolPackages: normalizeToolPackages(settings.toolPackages),
    version: 4
  };
}

function normalizeMainAssistant(value: unknown, revision = 5) {
  if (!value || typeof value !== 'object') {
    return DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant;
  }
  const normalized = createMainAssistant(value as Partial<MainAssistantProfile>);
  // Extend only a complete older built-in grant. Explicitly restricted profiles stay restricted.
  // Native descriptors still require the user to opt in to the external service in Settings.
  return {
    ...normalized,
    allowedSubagentIds: normalized.allowedSubagentIds.filter((id) => id !== 'patch-planner-agent'),
    enabledToolIds: extendGrant({
      addedIn: MAIN_TOOL_ADDED_IN,
      canInvokeTools: normalized.permissions.canInvokeTools,
      defaults: DEFAULT_MAIN_TOOL_IDS,
      granted: normalized.enabledToolIds,
      revision
    })
  };
}

function normalizeSubagents(value: unknown, revision = 5) {
  const rawSubagents = Array.isArray(value) ? value : DEFAULT_AGENT_RUNTIME_SETTINGS.subagents;
  const hadLegacyPlanner = rawSubagents.some((agent) => agent.id === 'patch-planner-agent');
  const byId = new Map(rawSubagents.map((subagent) => [subagent.id, subagent]));
  return DEFAULT_AGENT_RUNTIME_SETTINGS.subagents.map((defaultSubagent) => {
    const stored = byId.get(defaultSubagent.id);
    // Same rule as the main assistant: only a stored complete evidence grant is extended.
    const storedTools = stored?.enabledToolIds;
    const enabledToolIds = Array.isArray(storedTools)
      ? extendGrant({
          addedIn: EVIDENCE_TOOL_ADDED_IN,
          canInvokeTools: true,
          defaults: EVIDENCE_TOOL_IDS,
          granted: storedTools,
          revision
        })
      : storedTools;
    return createSubagent({
      ...defaultSubagent,
      ...(stored ?? {}),
      enabledToolIds,
      enabled: hadLegacyPlanner ? false : stored?.enabled ?? defaultSubagent.enabled,
      id: defaultSubagent.id,
      outputKind: defaultSubagent.outputKind,
      systemPrompt: stored?.systemPrompt ?? defaultSubagent.systemPrompt
    });
  });
}

function normalizeMcpServers(value: unknown): AgentMcpServer[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((server): server is Partial<AgentMcpServer> & { id: string; name: string } =>
      Boolean(
        server &&
          typeof server === 'object' &&
          typeof server.id === 'string' &&
          typeof server.name === 'string'
      )
    )
    .map((server) => ({
      allowedToolNames: Array.isArray(server.allowedToolNames)
        ? server.allowedToolNames.filter((item): item is string => typeof item === 'string')
        : [],
      command: typeof server.command === 'string' ? server.command : '',
      description: typeof server.description === 'string' ? server.description : '',
      enabled: server.enabled ?? true,
      id: server.id,
      name: server.name
    }));
}

function normalizeToolPackages(value: unknown): AgentToolPackage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((toolPackage): toolPackage is Partial<AgentToolPackage> & { id: string; name: string } =>
      Boolean(
        toolPackage &&
          typeof toolPackage === 'object' &&
          typeof toolPackage.id === 'string' &&
          typeof toolPackage.name === 'string'
      )
    )
    .map((toolPackage) => ({
      allowedToolIds: Array.isArray(toolPackage.allowedToolIds)
        ? (toolPackage.allowedToolIds.filter((item): item is AgentToolId => typeof item === 'string') as AgentToolId[])
        : [],
      description: typeof toolPackage.description === 'string' ? toolPackage.description : '',
      enabled: toolPackage.enabled ?? true,
      id: toolPackage.id,
      kind: toolPackage.kind === 'native' ? 'native' : 'mcp',
      mcpServerId: toolPackage.mcpServerId ?? null,
      name: toolPackage.name,
      permissionMode: toolPackage.permissionMode === 'allow' ? 'allow' : 'ask'
    }));
}

export function equalAgentRuntimeSettings(
  left: AgentRuntimeSettings,
  right: AgentRuntimeSettings
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function resolveAgentProfile(settings: AgentRuntimeSettings, agentId?: string | null) {
  if (!agentId || agentId === settings.mainAssistant.id) {
    return settings.mainAssistant;
  }
  return settings.subagents.find((agent) => agent.id === agentId) ?? settings.mainAssistant;
}

export function resolveAllowedSubagents(settings: AgentRuntimeSettings, agent: AgentProfile) {
  return settings.subagents.filter(
    (candidate) =>
      candidate.enabled &&
      candidate.id !== agent.id &&
      agent.allowedSubagentIds.includes(candidate.id)
  );
}

export function configuredAgentToolIds(settings: AgentRuntimeSettings, agent: AgentProfile): AgentToolId[] {
  const external = settings.mcpServers
    .filter(server => server.enabled && agent.allowedMcpServerIds?.includes(server.id))
    .flatMap(server => server.allowedToolNames.map(name => `mcp.${server.id}.${name}` as AgentToolId));
  const hasAvailableWorker = resolveAllowedSubagents(settings, agent).length > 0;
  const configured = [...agent.enabledToolIds, ...external]
    .filter(id => id !== 'task.run_subagent' || hasAvailableWorker);
  return auditAgentToolPermissions(configured, agent, settings).allowedToolIds;
}

export function auditAgentToolPermissions(
  toolIds: string[],
  agent?: AgentProfile | null,
  settings?: AgentRuntimeSettings | null
) {
  const uniqueToolIds = toolIds.filter(unique);
  if (!agent) {
    return {
      allowedToolIds: uniqueToolIds as AgentToolId[],
      deniedTools: [] as { reason: string; toolId: string }[]
    };
  }

  const allowedToolIds: AgentToolId[] = [];
  const deniedTools: { reason: string; toolId: string }[] = [];
  for (const toolId of uniqueToolIds) {
    const reason = deniedToolReason(toolId, agent, settings);
    if (reason) {
      deniedTools.push({ reason, toolId });
    } else {
      allowedToolIds.push(toolId as AgentToolId);
    }
  }

  return { allowedToolIds, deniedTools };
}

function deniedToolReason(
  toolId: string,
  agent: AgentProfile,
  settings?: AgentRuntimeSettings | null
) {
  if (!agent.permissions.canInvokeTools) {
    return 'tool invocation disabled';
  }
  if (!isActiveTool(toolId)) {
    return 'unsupported tool';
  }
  if (toolId === 'read_browser_tab' && agent.kind !== 'main_assistant') {
    return 'browser tab access requires the main assistant frozen target';
  }
  if (toolId === 'import_papers' && (agent.kind !== 'main_assistant' ||
      !agent.permissions.canWriteProposals || agent.sandbox === 'read-only')) {
    return 'paper import requires main assistant write approval permission';
  }
  if (toolId.startsWith('mcp.')) {
    const [, serverId, ...toolParts] = toolId.split('.');
    const toolName = toolParts.join('.');
    if (!serverId || !agent.allowedMcpServerIds?.includes(serverId)) {
      return 'mcp server not allowed';
    }
    const server = settings?.mcpServers.find((candidate) => candidate.id === serverId);
    if (!server || !server.enabled) {
      return 'mcp server disabled or missing';
    }
    if (
      toolName &&
      server.allowedToolNames.length > 0 &&
      !server.allowedToolNames.includes(toolName)
    ) {
      return 'mcp tool not allowed';
    }
    if (!settings?.toolPackages.some((pkg) => pkg.enabled && pkg.kind === 'mcp' &&
        pkg.mcpServerId === serverId && pkg.permissionMode === 'allow' && pkg.allowedToolIds.includes(toolId as AgentToolId))) {
      return 'mcp tool package not approved';
    }
    return null;
  }
  if (toolId.includes('.propose_') && !agent.permissions.canWriteProposals) {
    return 'write proposals disabled';
  }
  if (toolId === 'task.run_subagent' && !agent.permissions.canInvokeSubagents) {
    return 'subagent invocation disabled';
  }
  if (
    (toolId === 'search_segments' || toolId === 'search_library' ||
      toolId === 'read_pdf_pages' || toolId === 'search_pdf_text' ||
      toolId === 'read_segment_content' ||
      toolId === 'read_entry_assistant_context') &&
    !agent.permissions.canReadWorkspaceWide
  ) {
    return 'workspace-wide read disabled';
  }
  return null;
}

export function selectAgentExecution(
  settings: AgentRuntimeSettings,
  _question: string,
  plan?: AssistantTaskPlan | null,
  preferredAgentId?: string | null,
  invocationPlan?: AgentInvocationPlan | null
): AgentExecutionSelection {
  void preferredAgentId;
  void plan;
  const agent = settings.mainAssistant;
  void invocationPlan;
  return { agent };
}

export function buildAgentSystemPrompt(agent: AgentProfile) {
  const lines = [
    agent.systemPrompt.trim(),
    '',
    `Agent Identity: ${agent.name}`,
    agent.description ? `Agent Description: ${agent.description}` : '',
    `Agent Kind: ${agent.kind}`,
    agent.kind === 'subagent' ? `Subagent Output Kind: ${agent.outputKind}` : '',
    `Agent Sandbox: ${agent.sandbox ?? 'read-only'}`,
    agent.kind === 'subagent'
      ? 'Subagent contract: execute the delegated task only and return structured findings.'
      : 'Main assistant contract: answer the user directly, use tools deliberately, and delegate narrow work to subagents when useful.'
  ].filter(Boolean);

  return lines.join('\n');
}

export function subagentOutputLabel(_outputKind: SubagentOutputKind) {
  return 'Evidence';
}

function unique<T>(value: T, index: number, array: T[]) {
  return array.indexOf(value) === index;
}

function isActiveTool(id: string) {
  return id.startsWith('mcp.') || DEFAULT_MAIN_TOOL_IDS.includes(id as AgentToolId) ||
    ['search_sciverse_metadata', 'get_sciverse_metadata_catalog', 'search_sciverse_paper_schema', 'get_sciverse_paper_schema'].includes(id);
}

function activePermissions(permissions: AgentPermissions): AgentPermissions {
  return {
    canInvokeSubagents: permissions.canInvokeSubagents,
    canInvokeTools: permissions.canInvokeTools,
    canReadWorkspaceWide: permissions.canReadWorkspaceWide,
    canWriteProposals: permissions.canWriteProposals
  };
}
