import { invoke } from '@tauri-apps/api/core';

import type { EntryId, NoteId, TagId } from '../types/domain';
import type {
  AssistantAgentRun,
  AssistantComposerSnapshot,
  AssistantContextItem,
  AssistantContextPlan,
  AssistantEntryMetaProposal,
  AssistantNoteProposal,
  AssistantTaskState,
  AssistantTagProposal,
  AssistantTaskPlan
} from '../types/assistant';
import type { AgentRuntimeSettings, SkillPackage } from '../types/agentRuntime';
import type { SearchMode, SearchResults } from './workspaceApi';

export type LlmSettings = {
  base_url: string;
  model: string;
  api_key: string | null;
  api_key_ref: string | null;
  max_context_length: number | null;
  temperature: number | null;
  top_p: number | null;
  max_output_tokens: number | null;
};

export type LlmProfile = {
  id: string;
  name: string;
  base_url: string;
  model: string;
  api_key: string | null;
  max_context_length: number | null;
  temperature: number | null;
  top_p: number | null;
  max_output_tokens: number | null;
};

export type LlmSettingsState = {
  profiles: LlmProfile[];
  assistant_profile_id: string | null;
  assistant_profile: LlmProfile | null;
  translation_profile_id: string | null;
  translation_profile: LlmProfile | null;
};

type LlmSettingsListener = (settings: LlmSettingsState) => void;

const llmSettingsListeners = new Set<LlmSettingsListener>();

export function subscribeLlmSettings(listener: LlmSettingsListener) {
  llmSettingsListeners.add(listener);
  return () => {
    llmSettingsListeners.delete(listener);
  };
}

function publishLlmSettings(settings: LlmSettingsState) {
  for (const listener of llmSettingsListeners) {
    listener(settings);
  }
}

export type ScopeSnapshot = {
  tag_ids: TagId[];
  tag_names: string[];
  entry_ids: EntryId[];
  entry_titles: string[];
};

export type ConversationSourceLink = {
  entry_id: EntryId;
  entry_title: string;
  segment_uid: string;
  page_idx: number;
  quote: string;
};

export type ConversationRole = 'user' | 'assistant';

export type AssistantToolTraceEvent = {
  error?: string;
  id: string;
  input?: unknown;
  sources?: ConversationSourceLink[];
  status: 'running' | 'done' | 'error';
  summary?: string;
  toolName: string;
};

export type AssistantConversationMemory = {
  last_user_goal: string | null;
  message_count: number;
  open_items: string[];
  pending_proposal_count: number;
  source_count: number;
  summary: string;
  updated_at: string;
};

export type AssistantMessagePart =
  | { type: 'text'; markdown: string }
  | { type: 'context'; items: AssistantContextItem[] }
  | {
      composer?: AssistantComposerSnapshot | null;
      items: AssistantContextItem[];
      plan?: AssistantContextPlan | null;
      type: 'context-snapshot';
    }
  | { plan: AssistantTaskPlan; type: 'plan' }
  | { task: AssistantTaskState; type: 'task-state' }
  | { run: AssistantAgentRun; type: 'agent-run' }
  | { memory: AssistantConversationMemory; type: 'memory' }
  | {
      args?: unknown;
      id: string;
      status: AssistantToolTraceEvent['status'];
      toolName: string;
      type: 'tool-call';
    }
  | {
      id: string;
      sourceLinks?: ConversationSourceLink[];
      summary: string;
      toolName: string;
      type: 'tool-result';
    }
  | { source: ConversationSourceLink; type: 'source' }
  | { proposal: AssistantNoteProposal; type: 'note-proposal' }
  | { proposal: AssistantEntryMetaProposal; type: 'entry-meta-proposal' }
  | { proposal: AssistantTagProposal; type: 'tag-proposal' }
  | { id?: string; message: string; toolName?: string; type: 'error' };

export type ConversationMessage = {
  message_id: string;
  role: ConversationRole;
  content: string;
  source_links: ConversationSourceLink[];
  note_proposals?: AssistantNoteProposal[];
  parts?: AssistantMessagePart[];
  tool_events?: AssistantToolTraceEvent[];
  created_at: string;
};

export type Conversation = {
  id: string;
  title: string;
  scope_snapshot: ScopeSnapshot;
  messages: ConversationMessage[];
  created_at: string;
  updated_at: string;
};

export type ConversationMeta = Omit<Conversation, 'messages'> & {
  context_items?: AssistantContextItem[];
  message_count: number;
};

export type AgentRunRecord = {
  answerPreview?: string | null;
  conversationId?: string | null;
  durationMs?: number | null;
  endedAt?: string | null;
  entryId?: string | null;
  failedNodeCount: number;
  messageId?: string | null;
  nodeCount: number;
  question?: string | null;
  run: AssistantAgentRun;
  runId: string;
  savedAt: string;
  startedAt: string;
  status: AssistantAgentRun['status'] | string;
  subagentNodeCount: number;
  toolNodeCount: number;
};

export type AgentRunRecordSummary = Omit<AgentRunRecord, 'run'>;

export type ApplyNoteProposalReceipt = {
  action: string;
  contentHash: string;
  entryId: EntryId;
  noteId: NoteId | null;
  proposalId: string;
  segmentUid: string | null;
  taskId: string;
};

export type ApplyNoteProposalResponse =
  | { kind: 'applied'; receipt: ApplyNoteProposalReceipt }
  | { kind: 'conflict'; currentContentHash: string };

export type ReadSegmentContentResponse = {
  entry_id: EntryId;
  entry_title: string;
  segment_uid: string;
  page_idx: number;
  text: string;
};

export type EntryAssistantSource = ConversationSourceLink;

export type TagRecommendation = {
  confidence: number;
  dimension: string;
  path: string;
  reason: string;
  source: 'existing' | 'new';
};

export type AnalyzeEntryTagsResponse = {
  recommendations: TagRecommendation[];
  skill_version: string;
};

export type ReadEntryAssistantContextResponse = {
  entry_id: EntryId;
  entry_title: string;
  markdown: string;
  sources: EntryAssistantSource[];
};

export type AssistantContextSnapshotPinnedSegment = {
  entryId: EntryId;
  segmentUid: string;
};

export type AssistantEntrySnapshot = {
  entry_id: EntryId;
  entry_title: string;
  has_pdf: boolean;
  parse_status: string | null;
};

export type AssistantNoteSnapshot = {
  entry_id: EntryId;
  entry_title: string;
  note_id: NoteId;
  note_title: string;
  markdown: string;
  markdown_char_count: number;
  source_link_count: number;
  truncated: boolean;
};

export type AssistantDocumentSnapshot = {
  entry_id: EntryId;
  entry_title: string;
  markdown: string;
  markdown_char_count: number;
  sources: EntryAssistantSource[];
  truncated: boolean;
};

export type AssistantPinnedSegmentSnapshot = {
  entry_id: EntryId;
  entry_title: string;
  segment_uid: string;
  page_idx: number;
  text: string;
  text_char_count: number;
  truncated: boolean;
};

export type AssistantContextSnapshot = {
  active_entry: AssistantEntrySnapshot | null;
  active_note: AssistantNoteSnapshot | null;
  document: AssistantDocumentSnapshot | null;
  pinned_segments: AssistantPinnedSegmentSnapshot[];
  warnings: string[];
};

export type AssistantToolDescriptor = {
  name: string;
  description: string;
  parameters_schema: unknown;
};

export type AgentRuntimeTraceEvent = {
  elapsed_ms: number;
  id: string;
  label: string;
  summary: string;
};

export type RunAgentSubagentTaskResponse = {
  agent_id: string;
  agent_name: string;
  answer: string;
  sources: ConversationSourceLink[];
  trace: AgentRuntimeTraceEvent[];
};

export async function getLlmSettings(): Promise<LlmSettingsState> {
  return invoke<LlmSettingsState>('get_llm_settings');
}

export async function saveLlmSettings(settings: {
  apiKey?: string;
  baseUrl: string;
  maxContextLength?: number;
  maxOutputTokens?: number;
  model: string;
  name: string;
  profileId?: string;
  temperature?: number;
  topP?: number;
}): Promise<LlmSettingsState> {
  const nextSettings = await invoke<LlmSettingsState>('save_llm_settings', {
    request: {
      profile_id: settings.profileId ?? null,
      name: settings.name,
      base_url: settings.baseUrl,
      model: settings.model,
      api_key: settings.apiKey ?? null,
      max_context_length: settings.maxContextLength ?? null,
      temperature: settings.temperature ?? null,
      top_p: settings.topP ?? null,
      max_output_tokens: settings.maxOutputTokens ?? null
    }
  });
  publishLlmSettings(nextSettings);
  return nextSettings;
}

export async function clearLlmSettings(): Promise<void> {
  await invoke<void>('clear_llm_settings');
  publishLlmSettings({
    assistant_profile: null,
    assistant_profile_id: null,
    profiles: [],
    translation_profile: null,
    translation_profile_id: null
  });
}

export async function deleteLlmProfile(profileId: string): Promise<LlmSettingsState> {
  const nextSettings = await invoke<LlmSettingsState>('delete_llm_profile', {
    request: {
      profile_id: profileId
    }
  });
  publishLlmSettings(nextSettings);
  return nextSettings;
}

export async function setTaskLlmProfile(
  task: 'assistant' | 'translation',
  profileId: string | null
): Promise<LlmSettingsState> {
  const nextSettings = await invoke<LlmSettingsState>('set_task_llm_profile', {
    request: {
      task,
      profile_id: profileId
    }
  });
  publishLlmSettings(nextSettings);
  return nextSettings;
}

export async function loadPrompt(name: string): Promise<string> {
  return invoke<string>('load_prompt', { request: { name } });
}

export async function invokeAssistantTool<T = unknown>(name: string, args: unknown): Promise<T> {
  return invoke<T>('invoke_tool', { request: { name, args } });
}

export async function listTools(): Promise<AssistantToolDescriptor[]> {
  return invoke<AssistantToolDescriptor[]>('list_tools');
}

export async function runAgentSubagentTask(args: {
  agentId: string;
  contextSnapshot?: AssistantContextSnapshot | null;
  conversationHistory?: ConversationMessage[];
  instruction: string;
  profiles: LlmProfile[];
  question: string;
  root: string;
  runtimeSettings: AgentRuntimeSettings;
  scope: ScopeSnapshot;
}): Promise<RunAgentSubagentTaskResponse> {
  return invoke<RunAgentSubagentTaskResponse>('run_agent_subagent_task', {
    request: {
      root: args.root,
      agent_id: args.agentId,
      instruction: args.instruction,
      question: args.question,
      runtime_settings: args.runtimeSettings,
      profiles: args.profiles,
      context_snapshot: args.contextSnapshot ?? null,
      conversation_history: args.conversationHistory ?? [],
      scope: args.scope
    }
  });
}

export async function loadAgentRuntimeSettings(
  root: string
): Promise<AgentRuntimeSettings | null> {
  return invoke<AgentRuntimeSettings | null>('load_agent_runtime_settings', {
    request: {
      root
    }
  });
}

export async function saveAgentRuntimeSettings(
  root: string,
  settings: AgentRuntimeSettings
): Promise<void> {
  return invoke<void>('save_agent_runtime_settings', {
    request: {
      root,
      settings
    }
  });
}

export async function saveAgentRun(
  root: string,
  args: {
    answerPreview?: string | null;
    conversationId?: string | null;
    entryId?: string | null;
    messageId?: string | null;
    question?: string | null;
    run: AssistantAgentRun;
  }
): Promise<void> {
  return invoke<void>('save_agent_run', {
    request: {
      root,
      run: {
        runId: args.run.id,
        conversationId: args.conversationId ?? null,
        entryId: args.entryId ?? null,
        messageId: args.messageId ?? null,
        question: args.question ?? null,
        answerPreview: args.answerPreview ?? null,
        run: args.run
      }
    }
  });
}

export async function listAgentRuns(
  root: string,
  filters: {
    conversationId?: string | null;
    entryId?: string | null;
    limit?: number;
    startedAfter?: string | null;
    startedBefore?: string | null;
    status?: string | null;
  } = {}
): Promise<AgentRunRecordSummary[]> {
  return invoke<AgentRunRecordSummary[]>('list_agent_runs', {
    request: {
      root,
      conversationId: filters.conversationId ?? null,
      entryId: filters.entryId ?? null,
      startedAfter: filters.startedAfter ?? null,
      startedBefore: filters.startedBefore ?? null,
      status: filters.status ?? null,
      limit: filters.limit ?? 50
    }
  });
}

export async function readAgentRun(root: string, runId: string): Promise<AgentRunRecord> {
  return invoke<AgentRunRecord>('read_agent_run', {
    request: {
      root,
      runId
    }
  });
}

export async function deleteAgentRun(root: string, runId: string): Promise<void> {
  return invoke<void>('delete_agent_run', {
    request: {
      root,
      runId
    }
  });
}

export async function pruneAgentRuns(
  root: string,
  filters: { keepLatest?: number | null; status?: string | null } = {}
): Promise<{ deletedCount: number }> {
  return invoke<{ deletedCount: number }>('prune_agent_runs', {
    request: {
      root,
      keepLatest: filters.keepLatest ?? null,
      status: filters.status ?? null
    }
  });
}

export async function importSkillPackageArchive(
  root: string,
  archivePath: string
): Promise<SkillPackage> {
  return invoke<SkillPackage>('import_skill_package_archive', {
    request: {
      root,
      archivePath
    }
  });
}

export async function listSkillPackages(root: string): Promise<SkillPackage[]> {
  return invoke<SkillPackage[]>('list_skill_packages', {
    request: {
      root
    }
  });
}

export async function loadSkillPackage(root: string, skillId: string): Promise<SkillPackage> {
  return invoke<SkillPackage>('load_skill_package', {
    request: {
      root,
      skillId
    }
  });
}

export async function openPathInFileManager(path: string): Promise<void> {
  return invoke<void>('open_path_in_file_manager', {
    request: {
      path
    }
  });
}

export async function searchSegmentsTool(args: {
  mode?: SearchMode;
  query: string;
  root: string;
  scopeEntryIds?: EntryId[];
  topK?: number;
}): Promise<SearchResults> {
  return invokeAssistantTool<SearchResults>('search_segments', {
    root: args.root,
    query: args.query,
    mode: args.mode ?? 'hybrid',
    scope_entry_ids: args.scopeEntryIds ?? [],
    top_k: args.topK ?? 8
  });
}

export async function readSegmentContent(args: {
  entryId: EntryId;
  root: string;
  segmentUid: string;
}): Promise<ReadSegmentContentResponse> {
  return invoke<ReadSegmentContentResponse>('read_segment_content', {
    request: {
      root: args.root,
      entry_id: args.entryId,
      segment_uid: args.segmentUid
    }
  });
}

export async function readEntryAssistantContext(args: {
  entryId: EntryId;
  root: string;
}): Promise<ReadEntryAssistantContextResponse> {
  return invoke<ReadEntryAssistantContextResponse>('read_entry_assistant_context', {
    request: {
      root: args.root,
      entry_id: args.entryId
    }
  });
}

export async function analyzeEntryTags(args: {
  entryId: EntryId;
  instruction: string;
  root: string;
  skillId?: string;
}): Promise<AnalyzeEntryTagsResponse> {
  return invoke<AnalyzeEntryTagsResponse>('analyze_entry_tags', {
    request: {
      root: args.root,
      entry_id: args.entryId,
      instruction: args.instruction,
      skill_id: args.skillId ?? null
    }
  });
}

export async function getAssistantContextSnapshot(args: {
  activeEntryId?: EntryId | null;
  activeNote?: { entryId: EntryId; noteId: NoteId } | null;
  documentCharBudget?: number;
  noteCharBudget?: number;
  pinnedSegments?: AssistantContextSnapshotPinnedSegment[];
  root: string;
}): Promise<AssistantContextSnapshot> {
  return invoke<AssistantContextSnapshot>('get_assistant_context_snapshot', {
    request: {
      root: args.root,
      active_entry_id: args.activeEntryId ?? null,
      active_note: args.activeNote
        ? {
            entry_id: args.activeNote.entryId,
            note_id: args.activeNote.noteId
          }
        : null,
      pinned_segments: (args.pinnedSegments ?? []).map((segment) => ({
        entry_id: segment.entryId,
        segment_uid: segment.segmentUid
      })),
      document_char_budget: args.documentCharBudget ?? null,
      note_char_budget: args.noteCharBudget ?? null
    }
  });
}

export async function applyNoteProposal(
  root: string,
  taskId: string,
  proposalId: string
): Promise<ApplyNoteProposalResponse> {
  return invoke<ApplyNoteProposalResponse>('apply_note_proposal', {
    request: { proposalId, root, taskId }
  });
}

const CONVERSATION_LIST_CACHE_TTL_MS = 30_000;
const CONVERSATION_LIST_CACHE_LIMIT = 4;
const conversationListCache = new Map<
  string,
  { expiresAt: number; items: ConversationMeta[] }
>();
const conversationListRequests = new Map<string, Promise<ConversationMeta[]>>();

export function getCachedConversations(root: string): ConversationMeta[] | null {
  const cached = conversationListCache.get(root);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    conversationListCache.delete(root);
    return null;
  }
  return cached.items;
}

export function invalidateConversationCache(root: string) {
  conversationListCache.delete(root);
}

function upsertCachedConversation(root: string, conversation: Conversation) {
  const cached = conversationListCache.get(root);
  if (!cached) {
    return;
  }
  const meta = conversationMeta(conversation);
  const items = [
    meta,
    ...cached.items.filter((item) => item.id !== conversation.id)
  ].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  conversationListCache.set(root, {
    expiresAt: Date.now() + CONVERSATION_LIST_CACHE_TTL_MS,
    items
  });
}

function removeCachedConversation(root: string, conversationId: string) {
  const cached = conversationListCache.get(root);
  if (!cached) {
    return;
  }
  conversationListCache.set(root, {
    expiresAt: Date.now() + CONVERSATION_LIST_CACHE_TTL_MS,
    items: cached.items.filter((item) => item.id !== conversationId)
  });
}

function conversationMeta(conversation: Conversation): ConversationMeta {
  const contextItems = [...conversation.messages]
    .reverse()
    .filter((message) => message.role === 'user')
    .flatMap((message) => message.parts ?? [])
    .find((part) => part.type === 'context');
  return {
    context_items: contextItems?.type === 'context' ? contextItems.items : [],
    created_at: conversation.created_at,
    id: conversation.id,
    message_count: conversation.messages.length,
    scope_snapshot: conversation.scope_snapshot,
    title: conversation.title,
    updated_at: conversation.updated_at
  };
}

export async function listConversations(
  root: string,
  options: { force?: boolean } = {}
): Promise<ConversationMeta[]> {
  pruneConversationListCache();
  const cached = conversationListCache.get(root);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  const pending = conversationListRequests.get(root);
  if (pending) {
    return pending;
  }

  const request = invoke<ConversationMeta[]>('list_conversations', {
    request: { root }
  })
    .then((items) => {
      conversationListCache.set(root, {
        expiresAt: Date.now() + CONVERSATION_LIST_CACHE_TTL_MS,
        items
      });
      trimConversationListCache();
      return items;
    })
    .finally(() => {
      conversationListRequests.delete(root);
    });
  conversationListRequests.set(root, request);
  return request;
}

function pruneConversationListCache() {
  const now = Date.now();
  for (const [root, cached] of conversationListCache) {
    if (cached.expiresAt <= now) conversationListCache.delete(root);
  }
}

function trimConversationListCache() {
  while (conversationListCache.size > CONVERSATION_LIST_CACHE_LIMIT) {
    const oldest = conversationListCache.keys().next().value;
    if (typeof oldest !== 'string') return;
    conversationListCache.delete(oldest);
  }
}

export async function loadConversation(root: string, conversationId: string): Promise<Conversation> {
  return invoke<Conversation>('load_conversation', {
    request: {
      root,
      conversation_id: conversationId
    }
  });
}

export async function deleteConversation(root: string, conversationId: string): Promise<void> {
  await invoke<void>('delete_conversation', {
    request: {
      root,
      conversation_id: conversationId
    }
  });
  removeCachedConversation(root, conversationId);
}

export async function renameConversation(
  root: string,
  conversationId: string,
  title: string
): Promise<Conversation> {
  const conversation = await invoke<Conversation>('rename_conversation', {
    request: {
      root,
      conversation_id: conversationId,
      title
    }
  });
  upsertCachedConversation(root, conversation);
  return conversation;
}

export async function createConversation(
  root: string,
  title: string,
  scopeSnapshot: ScopeSnapshot
): Promise<Conversation> {
  const conversation = await invoke<Conversation>('create_conversation', {
    request: {
      root,
      title,
      scope_snapshot: scopeSnapshot
    }
  });
  upsertCachedConversation(root, conversation);
  return conversation;
}

export async function appendConversationMessages(
  root: string,
  conversationId: string,
  messages: Array<{
    content: string;
    note_proposals?: AssistantNoteProposal[];
    parts?: AssistantMessagePart[];
    role: ConversationRole;
    source_links?: ConversationSourceLink[];
    tool_events?: AssistantToolTraceEvent[];
  }>
): Promise<Conversation> {
  const conversation = await invoke<Conversation>('append_conversation_messages', {
    request: {
      root,
      conversation_id: conversationId,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        source_links: message.source_links ?? [],
        tool_events: message.tool_events ?? [],
        note_proposals: message.note_proposals ?? [],
        parts: message.parts ?? []
      }))
    }
  });
  upsertCachedConversation(root, conversation);
  return conversation;
}

export async function updateConversationMessage(
  root: string,
  conversationId: string,
  messageId: string,
  patch: {
    content?: string;
    note_proposals?: AssistantNoteProposal[];
    parts?: AssistantMessagePart[];
    source_links?: ConversationSourceLink[];
    tool_events?: AssistantToolTraceEvent[];
  }
): Promise<Conversation> {
  const conversation = await invoke<Conversation>('update_conversation_message', {
    request: {
      root,
      conversation_id: conversationId,
      message_id: messageId,
      content: patch.content ?? null,
      source_links: patch.source_links ?? null,
      tool_events: patch.tool_events ?? null,
      note_proposals: patch.note_proposals ?? null,
      parts: patch.parts ?? null
    }
  });
  upsertCachedConversation(root, conversation);
  return conversation;
}
