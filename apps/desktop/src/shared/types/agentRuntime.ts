export type AgentToolId =
  | 'app.set_appearance'
  | 'create_entry'
  | 'search_segments'
  | 'read_segment_content'
  | 'read_entry_assistant_context'
  | 'search_sciverse_evidence'
  | 'read_sciverse_content'
  | 'read_current_note'
  | 'read_note'
  | 'note.propose_create'
  | 'note.propose_patch'
  | 'segment_note.propose_patch'
  | 'entry.propose_meta_patch'
  | 'tag.propose_change'
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

export type AgentPermissions = {
  canInvokeSubagents: boolean;
  canInvokeTools: boolean;
  canReadWorkspaceWide: boolean;
  canWriteProposals: boolean;
};

export type AgentSandbox = 'read-only' | 'workspace-write-proposals' | 'workspace-write';

export type AgentBaseProfile = {
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

export type SubagentOutputKind = 'evidence';

export type SubagentProfile = AgentBaseProfile & {
  enabled: boolean;
  kind: 'subagent';
  outputKind: SubagentOutputKind;
};

export type AgentProfile = MainAssistantProfile | SubagentProfile;

export type AgentRuntimeSettings = {
  mainAssistant: MainAssistantProfile;
  mcpServers: AgentMcpServer[];
  subagents: SubagentProfile[];
  toolPackages: AgentToolPackage[];
  version: 4;
};

export type AgentExecutionSelection = {
  agent: AgentProfile;
};
