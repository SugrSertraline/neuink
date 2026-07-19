import type {
  AgentExecutionSelection,
  AgentMcpServer,
  AgentProfile,
  AgentRuntimeSettings,
  AgentToolId,
  AgentToolPackage,
  MainAssistantProfile,
  SkillPackage,
  SkillPackageCategory,
  SubagentOutputKind,
  SubagentProfile
} from '@/shared/types/agentRuntime';
import type { AgentInvocationPlan, AssistantTaskPlan } from '@/shared/types/assistant';
import { DEFAULT_FEATURE_SKILL_IDS } from './featureSkills';

const STORAGE_KEY = 'neuink.agentRuntime.v3';

const DEFAULT_MAIN_TOOL_IDS: AgentToolId[] = [
  'create_entry',
  'search_segments',
  'read_segment_content',
  'read_entry_assistant_context',
  'read_current_note',
  'read_note',
  'note.propose_create',
  'note.propose_patch',
  'segment_note.propose_patch',
  'entry.propose_meta_patch',
  'tag.propose_change',
  'skill.search',
  'skill.load',
  'task.run_subagent'
];

const EVIDENCE_TOOL_IDS: AgentToolId[] = [
  'search_segments',
  'read_segment_content',
  'read_entry_assistant_context',
  'skill.search',
  'skill.load'
];

const PATCH_TOOL_IDS: AgentToolId[] = [
  'read_current_note',
  'note.propose_patch',
  'segment_note.propose_patch',
  'skill.search',
  'skill.load'
];

function createMainAssistant(partial: Partial<MainAssistantProfile>): MainAssistantProfile {
  return {
    allowedSkillPackageIds: partial.allowedSkillPackageIds ?? [...DEFAULT_FEATURE_SKILL_IDS],
    allowedSubagentIds:
      partial.allowedSubagentIds ??
      ['skill-selector-agent', 'evidence-agent', 'patch-planner-agent'],
    allowedMcpServerIds: partial.allowedMcpServerIds ?? [],
    description:
      partial.description ?? 'Neuink 全局主助手，负责直接响应用户、选择技能和委派子 agent。',
    enabledToolIds: partial.enabledToolIds ?? DEFAULT_MAIN_TOOL_IDS,
    id: 'main-assistant',
    kind: 'main_assistant',
    llmProfileId: partial.llmProfileId ?? null,
    name: partial.name ?? 'Neuink 主助手',
    permissions: partial.permissions ?? {
      canInvokeSubagents: true,
      canInvokeTools: true,
      canReadWorkspaceWide: true,
      canUseSkills: true,
      canWriteProposals: true
    },
    sandbox: partial.sandbox ?? 'workspace-write-proposals',
    systemPrompt:
      partial.systemPrompt ??
      'You are Neuink Main Assistant. Stay grounded in workspace evidence, use skills only after loading them, and create user-confirmable proposals for note or Entry metadata writes.',
    visibleInUi: false
  };
}

function createSubagent(
  partial: Partial<SubagentProfile> &
    Pick<SubagentProfile, 'id' | 'name' | 'outputKind' | 'systemPrompt'>
): SubagentProfile {
  return {
    allowedSkillPackageIds: partial.allowedSkillPackageIds ?? [...DEFAULT_FEATURE_SKILL_IDS],
    allowedSubagentIds: [],
    allowedMcpServerIds: partial.allowedMcpServerIds ?? [],
    description: partial.description ?? '',
    enabled: partial.enabled ?? true,
    enabledToolIds:
      partial.enabledToolIds ??
      (partial.outputKind === 'patch_plan' ? PATCH_TOOL_IDS : EVIDENCE_TOOL_IDS),
    id: partial.id,
    kind: 'subagent',
    llmProfileId: partial.llmProfileId ?? null,
    name: partial.name,
    outputKind: partial.outputKind,
    permissions: partial.permissions ?? {
      canInvokeSubagents: false,
      canInvokeTools: true,
      canReadWorkspaceWide: partial.outputKind === 'evidence',
      canUseSkills: true,
      canWriteProposals: partial.outputKind === 'patch_plan'
    },
    sandbox: partial.sandbox ?? 'read-only',
    subagentManifestPath:
      partial.subagentManifestPath ??
      `agent-runtime/subagents/${partial.id}/SUBAGENT.toml`,
    systemPrompt: partial.systemPrompt,
    visibleInUi: false
  };
}

function createSkillPackage(
  partial: Partial<SkillPackage> & Pick<SkillPackage, 'id' | 'name' | 'readme' | 'category'>
): SkillPackage {
  return {
    category: partial.category,
    description: partial.description ?? '',
    enabled: partial.enabled ?? true,
    files: partial.files ?? [],
    id: partial.id,
    installedAt: partial.installedAt ?? null,
    kind: partial.kind ?? 'builtin',
    metadataOnly: partial.metadataOnly ?? false,
    name: partial.name,
    packagePath: partial.packagePath ?? null,
    readme: partial.readme,
    resourcePaths: partial.resourcePaths ?? {
      assets: [],
      references: [],
      scripts: []
    },
    scriptExecution: partial.scriptExecution ?? 'disabled',
    skillMarkdownPath: partial.skillMarkdownPath ?? null,
    skillSpecVersion: partial.skillSpecVersion ?? 'agent-skills',
    sourceArchivePath: partial.sourceArchivePath ?? null,
    suggestedToolIds: partial.suggestedToolIds ?? [],
    triggers: partial.triggers ?? [],
    version: partial.version ?? '1.0.0'
  };
}

export const DEFAULT_AGENT_RUNTIME_SETTINGS: AgentRuntimeSettings = {
  mainAssistant: createMainAssistant({}),
  mcpServers: [],
  subagents: [
    createSubagent({
      id: 'skill-selector-agent',
      name: 'SkillSelectorAgent',
      outputKind: 'skill_selection',
      description: '根据任务和 Skill Registry 元数据选择需要加载的 Skill。',
      enabledToolIds: [],
      permissions: {
        canInvokeSubagents: false,
        canInvokeTools: false,
        canReadWorkspaceWide: false,
        canUseSkills: true,
        canWriteProposals: false
      },
      systemPrompt:
        'You are Neuink SkillSelectorAgent. Select Skills only from the supplied registry metadata. Return strict JSON and never execute the task.'
    }),
    createSubagent({
      id: 'evidence-agent',
      name: 'EvidenceAgent',
      outputKind: 'evidence',
      description: '检索、阅读并整理当前任务需要的证据。',
      systemPrompt:
        'You are Neuink EvidenceAgent. Search and read workspace evidence, then return concise evidence findings with source grounding. Do not write notes.'
    }),
    createSubagent({
      id: 'patch-planner-agent',
      name: 'PatchPlannerAgent',
      outputKind: 'patch_plan',
      description: '把 Markdown 笔记修改需求规划成局部 patch。',
      enabledToolIds: PATCH_TOOL_IDS,
      permissions: {
        canInvokeSubagents: false,
        canInvokeTools: true,
        canReadWorkspaceWide: false,
        canUseSkills: true,
        canWriteProposals: true
      },
      systemPrompt:
        'You are Neuink PatchPlannerAgent. For existing Markdown notes, prefer exact local patch operations with anchors. Use full replacement only when explicitly requested.'
    })
  ],
  skillPackages: [],
  toolPackages: [],
  version: 3
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
  if (!settings || settings.version !== 3) {
    return DEFAULT_AGENT_RUNTIME_SETTINGS;
  }
  return {
    mainAssistant: normalizeMainAssistant(settings.mainAssistant),
    mcpServers: normalizeMcpServers(settings.mcpServers),
    subagents: normalizeSubagents(settings.subagents),
    skillPackages: Array.isArray(settings.skillPackages)
      ? settings.skillPackages
      : DEFAULT_AGENT_RUNTIME_SETTINGS.skillPackages,
    toolPackages: normalizeToolPackages(settings.toolPackages),
    version: 3
  };
}

export function mergeRegistrySkillPackages(
  settings: AgentRuntimeSettings,
  registrySkills: SkillPackage[]
) {
  const registryById = new Map(registrySkills.map((skillPackage) => [skillPackage.id, skillPackage]));
  const hasRegistrySkills = registrySkills.length > 0;
  const mergedSkillPackages = [
    ...settings.skillPackages
      .filter((skillPackage) => !hasRegistrySkills || skillPackage.packagePath)
      .map((skillPackage) => {
        const registrySkill = registryById.get(skillPackage.id);
        if (!registrySkill) {
          return skillPackage;
        }
        registryById.delete(skillPackage.id);
        return {
          ...registrySkill,
          enabled: skillPackage.enabled,
          suggestedToolIds: skillPackage.suggestedToolIds.length
            ? skillPackage.suggestedToolIds
            : registrySkill.suggestedToolIds,
          triggers: skillPackage.triggers.length ? skillPackage.triggers : registrySkill.triggers
        };
      }),
    ...registryById.values()
  ];

  const normalized = normalizeAgentRuntimeSettings({
    ...settings,
    skillPackages: mergedSkillPackages
  });
  const registrySkillIds = mergedSkillPackages
    .filter((skillPackage) => skillPackage.enabled)
    .map((skillPackage) => skillPackage.id);
  return {
    ...normalized,
    mainAssistant: {
      ...normalized.mainAssistant,
      allowedSkillPackageIds: [
        ...new Set([...normalized.mainAssistant.allowedSkillPackageIds, ...registrySkillIds])
      ]
    }
  };
}

function normalizeMainAssistant(value: unknown) {
  if (!value || typeof value !== 'object') {
    return DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant;
  }
  const normalized = createMainAssistant(value as Partial<MainAssistantProfile>);
  return {
    ...normalized,
    allowedSubagentIds: [
      ...new Set([...normalized.allowedSubagentIds, 'skill-selector-agent'])
    ],
    enabledToolIds: [...new Set([...normalized.enabledToolIds, ...DEFAULT_MAIN_TOOL_IDS])]
  };
}

function normalizeSubagents(value: unknown) {
  const rawSubagents = Array.isArray(value) ? value : DEFAULT_AGENT_RUNTIME_SETTINGS.subagents;
  const byId = new Map(rawSubagents.map((subagent) => [subagent.id, subagent]));
  return DEFAULT_AGENT_RUNTIME_SETTINGS.subagents.map((defaultSubagent) =>
    createSubagent({
      ...defaultSubagent,
      ...(byId.get(defaultSubagent.id) ?? {}),
      id: defaultSubagent.id,
      outputKind: defaultSubagent.outputKind,
      systemPrompt: byId.get(defaultSubagent.id)?.systemPrompt ?? defaultSubagent.systemPrompt
    })
  );
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

export function listSkillPackageCategories(): SkillPackageCategory[] {
  return ['reading', 'research', 'writing', 'report', 'slides', 'automation', 'custom'];
}

export function createBlankSkillPackage(index: number): SkillPackage {
  return createSkillPackage({
    id: `custom-skill-package-${index}`,
    name: '新技能包',
    category: 'custom',
    kind: 'installed',
    description: '请上传标准 Skills 压缩包，或填写 SKILL.md 内容。',
    readme: '# New Skill\n\nDescribe when and how the model should use this skill.',
    installedAt: new Date().toISOString()
  });
}

export function createSkillPackageFromArchivePath(path: string, index: number): SkillPackage {
  const fileName = path.split(/[\\/]/).pop() ?? `skill-package-${index}.zip`;
  const id =
    fileName
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `skill-package-${index}`;
  return createSkillPackage({
    id,
    name: fileName.replace(/\.[^.]+$/, ''),
    category: 'custom',
    kind: 'installed',
    description: '已登记的标准 Skills 压缩包，后续由 Rust Skill Registry 解包和校验 SKILL.md。',
    readme:
      '# Installed Skill\n\nThis package is registered from a zip archive. Neuink will load SKILL.md when the Rust skill registry is enabled.',
    sourceArchivePath: path,
    installedAt: new Date().toISOString()
  });
}

export function resolveAgentProfile(settings: AgentRuntimeSettings, agentId?: string | null) {
  if (!agentId || agentId === settings.mainAssistant.id) {
    return settings.mainAssistant;
  }
  return settings.subagents.find((agent) => agent.id === agentId) ?? settings.mainAssistant;
}

export function resolveSkillPackages(settings: AgentRuntimeSettings, agent: AgentProfile) {
  return settings.skillPackages.filter(
    (skillPackage) =>
      skillPackage.enabled && agent.allowedSkillPackageIds.includes(skillPackage.id)
  );
}

export function resolveAllowedSubagents(settings: AgentRuntimeSettings, agent: AgentProfile) {
  return settings.subagents.filter(
    (candidate) =>
      candidate.enabled &&
      candidate.id !== agent.id &&
      agent.allowedSubagentIds.includes(candidate.id)
  );
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
  if (toolId.startsWith('mcp.')) {
    const [, serverId, toolName] = toolId.split('.');
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
    return null;
  }
  if ((toolId === 'skill.search' || toolId === 'skill.load') && !agent.permissions.canUseSkills) {
    return 'skills disabled';
  }
  if (toolId.includes('.propose_') && !agent.permissions.canWriteProposals) {
    return 'write proposals disabled';
  }
  if (toolId === 'task.run_subagent' && !agent.permissions.canInvokeSubagents) {
    return 'subagent invocation disabled';
  }
  if (
    (toolId === 'search_segments' ||
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
  question: string,
  plan?: AssistantTaskPlan | null,
  preferredAgentId?: string | null,
  invocationPlan?: AgentInvocationPlan | null
): AgentExecutionSelection {
  void preferredAgentId;
  void plan;
  const agent = settings.mainAssistant;
  const packageIds = new Set([
    ...agent.allowedSkillPackageIds,
    ...(invocationPlan?.skillIdsToLoad ?? []),
    ...skillPackageIdsForQuestion(settings, question)
  ]);
  const skillPackages = settings.skillPackages.filter(
    (skillPackage) => skillPackage.enabled && packageIds.has(skillPackage.id)
  );
  return {
    agent,
    skillPackages
  };
}

function skillPackageIdsForQuestion(settings: AgentRuntimeSettings, question: string) {
  const lowerQuestion = question.toLowerCase();
  return settings.skillPackages
    .filter((skillPackage) =>
      skillPackage.triggers.some((trigger) => lowerQuestion.includes(trigger.toLowerCase()))
    )
    .map((skillPackage) => skillPackage.id);
}

export function buildAgentSystemPrompt(
  agent: AgentProfile,
  skillPackages: SkillPackage[],
  preloadedSkillIds: string[] = []
) {
  const preloadedIds = new Set(preloadedSkillIds);
  const preloadedSkills = skillPackages.filter((skillPackage) => preloadedIds.has(skillPackage.id));
  const lines = [
    agent.systemPrompt.trim(),
    '',
    `Agent Identity: ${agent.name}`,
    agent.description ? `Agent Description: ${agent.description}` : '',
    `Agent Kind: ${agent.kind}`,
    agent.kind === 'subagent' ? `Subagent Output Kind: ${agent.outputKind}` : '',
    `Agent Sandbox: ${agent.sandbox ?? 'read-only'}`,
    agent.kind === 'subagent'
      ? 'Subagent contract: execute the delegated task only, return structured findings, and do not behave like a reusable Skill.'
      : 'Main assistant contract: answer the user directly, use skills/tools deliberately, and delegate narrow work to subagents when useful.',
    skillPackages.length > 0
      ? `Available Skill Metadata:\n${skillPackages.map(skillPackageMetadataLine).join('\n')}`
      : 'Available Skill Metadata: none',
    preloadedSkills.length > 0
      ? `Preloaded Skill Instructions (selected by SkillSelectorAgent for this task):\n${preloadedSkills
          .map((skillPackage) => formatPreloadedSkill(skillPackage))
          .join('\n\n')}`
      : '',
    'Skill loading rule: follow preloaded Skill instructions for this task. Use skill_load only when you need a non-preloaded Skill.',
    'Skill script rule: scripts inside Skills are auxiliary resources and must not be executed directly. Executable tools must be exposed through MCP or an approved Tool Package.'
  ].filter(Boolean);

  return lines.join('\n');
}

function formatPreloadedSkill(skillPackage: SkillPackage) {
  // A malformed or excessively large package must not consume the whole model context.
  const maxChars = 12_000;
  const readme = skillPackage.readme.trim();
  const content = readme.length > maxChars ? `${readme.slice(0, maxChars)}\n\n[SKILL.md truncated]` : readme;
  return `--- SKILL: ${skillPackage.name} (${skillPackage.id}) ---\n${content}\n--- END SKILL ---`;
}

export function subagentOutputLabel(outputKind: SubagentOutputKind) {
  if (outputKind === 'patch_plan') return 'Markdown patch plan';
  if (outputKind === 'skill_selection') return 'Skill selection';
  return 'Evidence';
}

function skillPackageMetadataLine(skillPackage: SkillPackage) {
  const triggers = skillPackage.triggers.length ? skillPackage.triggers.join(', ') : 'none';
  const tools = skillPackage.suggestedToolIds.length
    ? skillPackage.suggestedToolIds.join(', ')
    : 'none';
  const resources = skillPackage.resourcePaths
    ? `refs=${skillPackage.resourcePaths.references.length}, scripts=${skillPackage.resourcePaths.scripts.length}, assets=${skillPackage.resourcePaths.assets.length}`
    : 'refs=0, scripts=0, assets=0';
  return `- ${skillPackage.name} (${skillPackage.id}): ${skillPackage.description || 'No description.'} Triggers: ${triggers}. Suggested tools: ${tools}. Resources: ${resources}.`;
}

function unique<T>(value: T, index: number, array: T[]) {
  return array.indexOf(value) === index;
}
