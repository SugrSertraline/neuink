export type AgentToolId =
  | 'create_entry'
  | 'search_segments'
  | 'read_segment_content'
  | 'read_entry_assistant_context'
  | 'read_current_note'
  | 'read_note'
  | 'note.propose_create'
  | 'note.propose_patch'
  | 'segment_note.propose_patch'
  | 'entry.propose_meta_patch'
  | 'tag.propose_change'
  | 'skill.search'
  | 'skill.load'
  | 'task.run_subagent'
  | `mcp.${string}`;

export type AgentLoopStatus =
  | 'running'
  | 'awaiting_user'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentLoopState = {
  version: 1;
  goal: string;
  status: AgentLoopStatus;
  turnCount: number;
  toolCallCount: number;
  maxTurns: number;
  maxToolCalls: number;
  noProgressCount: number;
  recentToolFingerprints: string[];
  failedToolFingerprints: Record<string, number>;
  createdEntryIds: string[];
  lastObservation?: string;
  stopReason?: string;
};

export type AgentMcpServer = {
  allowedToolNames: string[];
  command: string;
  description: string;
  enabled: boolean;
  id: string;
  name: string;
};

export type AgentToolPackage = {
  allowedToolIds: AgentToolId[];
  description: string;
  enabled: boolean;
  id: string;
  kind: 'mcp' | 'native';
  mcpServerId?: string | null;
  name: string;
  permissionMode: 'ask' | 'allow';
};

export type SkillPackageKind = 'builtin' | 'installed';

export type SkillPackageCategory =
  | 'reading'
  | 'research'
  | 'writing'
  | 'report'
  | 'slides'
  | 'automation'
  | 'custom';

export type SkillPackageFile = {
  path: string;
  sizeBytes: number;
};

export type SkillPackageResourceKind = 'asset' | 'reference' | 'script' | 'skill';

export type SkillPackage = {
  category: SkillPackageCategory;
  description: string;
  enabled: boolean;
  id: string;
  installedAt: string | null;
  kind: SkillPackageKind;
  metadataOnly?: boolean;
  name: string;
  packagePath: string | null;
  readme: string;
  resourcePaths?: {
    assets: string[];
    references: string[];
    scripts: string[];
  };
  scriptExecution?: 'disabled' | 'mcp_or_tool_package_required';
  skillMarkdownPath: string | null;
  skillSpecVersion?: string;
  sourceArchivePath: string | null;
  suggestedToolIds: AgentToolId[];
  triggers: string[];
  version: string;
  files: SkillPackageFile[];
};

export type AgentPermissions = {
  canInvokeSubagents: boolean;
  canInvokeTools: boolean;
  canReadWorkspaceWide: boolean;
  canUseSkills: boolean;
  canWriteProposals: boolean;
};

export type AgentSandbox = 'read-only' | 'workspace-write-proposals' | 'workspace-write';

export type AgentBaseProfile = {
  allowedSkillPackageIds: string[];
  allowedSubagentIds: string[];
  allowedMcpServerIds?: string[];
  description: string;
  enabledToolIds: AgentToolId[];
  id: string;
  llmProfileId: string | null;
  name: string;
  permissions: AgentPermissions;
  sandbox?: AgentSandbox;
  systemPrompt: string;
  visibleInUi: boolean;
};

export type MainAssistantProfile = AgentBaseProfile & {
  kind: 'main_assistant';
};

export type SubagentOutputKind = 'evidence' | 'patch_plan' | 'skill_selection';

export type SubagentProfile = AgentBaseProfile & {
  enabled: boolean;
  kind: 'subagent';
  outputKind: SubagentOutputKind;
  subagentManifestPath?: string | null;
};

export type AgentProfile = MainAssistantProfile | SubagentProfile;

export type AgentRuntimeSettings = {
  mainAssistant: MainAssistantProfile;
  mcpServers: AgentMcpServer[];
  subagents: SubagentProfile[];
  skillPackages: SkillPackage[];
  toolPackages: AgentToolPackage[];
  version: 3;
};

export type AgentExecutionSelection = {
  agent: AgentProfile;
  skillPackages: SkillPackage[];
};
