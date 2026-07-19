import type { EntryId, NoteId, TagId } from './domain';

export type AssistantSegmentContextItem = {
  id: string;
  kind: 'segment';
  entryId: EntryId;
  entryTitle: string;
  segmentUid: string;
  pageIdx: number;
  text: string;
  addedAt: string;
};

export type AssistantEntryContextItem = {
  id: string;
  kind: 'entry';
  entryId: EntryId;
  entryTitle: string;
  contentId?: string;
  contentKind?: 'entry' | 'note' | 'overview' | 'pdf' | 'reflow';
  contentTitle?: string;
  addedAt: string;
};

export type AssistantContextItem = AssistantSegmentContextItem | AssistantEntryContextItem;

export type AssistantContextInput = (
  | Omit<AssistantSegmentContextItem, 'addedAt' | 'id'>
  | Omit<AssistantEntryContextItem, 'addedAt' | 'id'>
) & {
  id?: string;
};

export type AssistantContext = {
  items: AssistantContextItem[];
};

export type AssistantContextAddOptions = {
  draftQuestion?: string;
};

export type AssistantComposerMentionRole = 'evidence' | 'read' | 'write';

export type AssistantComposerMentionKind =
  | 'entry'
  | 'note'
  | 'overview'
  | 'pdf'
  | 'reflow'
  | 'segment'
  | 'tag';

export type AssistantComposerMention = {
  charOffset: number;
  contentId?: string | null;
  contentTitle?: string | null;
  entryId: EntryId;
  entryTitle: string;
  id: string;
  kind: AssistantComposerMentionKind;
  label: string;
  marker: string;
  pageIdx?: number | null;
  role?: AssistantComposerMentionRole | null;
  segmentUid?: string | null;
  tagId?: TagId | null;
  tagName?: string | null;
  text?: string | null;
};

export type AssistantComposerSnapshot = {
  mentions: AssistantComposerMention[];
  text: string;
};

export type AssistantContextAttachmentRole = 'edit_target' | 'evidence' | 'read';

export type AssistantContextHydration = 'full_if_budget' | 'metadata_only' | 'search_first' | 'summary';

export type AssistantContextPlanItem = {
  attachmentId: string;
  contentId?: string;
  entryId: EntryId;
  entryTitle: string;
  hydration: AssistantContextHydration;
  kind: AssistantContextItem['kind'] | 'note' | 'pdf' | 'reflow' | 'overview';
  reason: string;
  role: AssistantContextAttachmentRole;
  segmentUid?: string;
};

export type AssistantContextPlan = {
  editTarget?: {
    attachmentId: string;
    targetKind: 'markdown_note' | 'segment_note';
  } | null;
  items: AssistantContextPlanItem[];
  summary: string;
};

export type AssistantTaskIntent =
  | 'general_qa'
  | 'paper_qa'
  | 'paper_search'
  | 'paper_summary'
  | 'note_create'
  | 'note_update'
  | 'segment_note_update'
  | 'entry_meta_update'
  | 'tag_attach'
  | 'tag_create'
  | 'tag_detach'
  | 'tag_update'
  | 'unsupported'
  | 'unknown';

export type AssistantTaskTargetKind =
  | 'chat_only'
  | 'entry_meta'
  | 'markdown_note'
  | 'segment_note';

export type AssistantTaskCapability =
  | 'read_document'
  | 'read_note'
  | 'search_evidence'
  | 'synthesize'
  | 'propose_note'
  | 'propose_entry_meta_change'
  | 'propose_tag_change';

export type AssistantTaskDeliverable =
  | 'chat_answer'
  | 'note_create_proposal'
  | 'note_patch_proposal'
  | 'segment_note_proposal'
  | 'entry_meta_change_proposal'
  | 'tag_change_proposal';

export type AssistantTaskPlanMissing =
  | 'active_entry'
  | 'active_note'
  | 'document_context'
  | 'entry_fields'
  | 'entry_target'
  | 'entry_value'
  | 'output_destination'
  | 'tag_guidance'
  | 'tag_target'
  | 'target_segment'
  | 'write_confirmation';

export type AssistantTaskPlan = {
  attachments: AssistantContextPlanItem[];
  capabilities: AssistantTaskCapability[];
  citationPolicy?: 'none' | 'preserve' | 'required';
  clarificationQuestion?: string;
  confidence: number;
  deliverables: AssistantTaskDeliverable[];
  entryMetaChange?: {
    entryId?: EntryId;
    fields: Array<'description' | 'title'>;
  };
  intent: AssistantTaskIntent;
  evidencePolicy?: 'none' | 'optional' | 'required';
  missing: AssistantTaskPlanMissing[];
  noteAction?: 'append' | 'create' | 'delete' | 'patch' | 'prepend' | 'replace';
  tagChange?: {
    action: 'attach' | 'create' | 'detach' | 'rename';
    deriveFromDocument?: boolean;
    entryIds: EntryId[];
    name?: string;
    newName?: string;
    tagId?: TagId;
  };
  needsCurrentNote: boolean;
  needsDocumentContext: boolean;
  needsNoteProposal: boolean;
  needsSegmentSearch: boolean;
  rationale: string;
  request?: string;
  target: {
    entryId?: EntryId;
    kind: AssistantTaskTargetKind;
    noteId?: NoteId;
    segmentUid?: string;
  };
  steps: Array<{
    dependsOn: string[];
    id: string;
    kind:
      | 'draft_note'
      | 'propose_entry_meta_change'
      | 'propose_tag_change'
      | 'read_context'
      | 'search'
      | 'synthesize_answer';
  }>;
};

export type AssistantTaskStatus =
  | 'running'
  | 'awaiting_user'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AssistantTaskPhase =
  | 'observe'
  | 'hydrate'
  | 'compile'
  | 'collect_evidence'
  | 'synthesize'
  | 'propose'
  | 'verify'
  | 'apply';

export type AssistantEvidenceRecord = {
  acquiredBy: 'document_read' | 'note_source_link' | 'pinned' | 'search' | 'segment_read';
  entryId: EntryId;
  entryTitle: string;
  evidenceId: string;
  pageIdx: number;
  quote: string;
  quoteHash: string;
  segmentUid: string;
};

export type AssistantEvidenceLedger = {
  createdAt: string;
  evidence: AssistantEvidenceRecord[];
  ledgerId: string;
  taskId: string;
  updatedAt: string;
};

export type AssistantTaskState = {
  agentLoopState?: import('./agentRuntime').AgentLoopState;
  conversationId: string;
  createdAt: string;
  evidenceLedger: AssistantEvidenceLedger;
  goal: {
    normalizedGoal: string;
    originalRequest: string;
  };
  operation: AssistantNoteProposalAction | null;
  phase: AssistantTaskPhase;
  proposalIds: string[];
  revision: number;
  spec: AssistantTaskPlan;
  status: AssistantTaskStatus;
  taskId: string;
  updatedAt: string;
};

export type AssistantTagProposal = {
  action: 'attach' | 'create' | 'detach' | 'rename';
  appliedAt?: string;
  createdAt: string;
  entryIds: EntryId[];
  error?: string;
  id: string;
  confidence?: number;
  name?: string;
  newName?: string;
  rationale?: string;
  skillVersion?: string;
  status: 'applied' | 'applying' | 'error' | 'pending' | 'rejected';
  tagId?: TagId;
};

export type AssistantEntryMetaProposal = {
  afterDescription: string;
  afterTitle: string;
  appliedAt?: string;
  baseUpdatedAt: string;
  beforeDescription: string;
  beforeTitle: string;
  createdAt: string;
  entryId: EntryId;
  entryTitle: string;
  error?: string;
  fields: Array<'description' | 'title'>;
  id: string;
  rationale?: string;
  sources: AssistantNoteProposalSource[];
  status: 'applied' | 'applying' | 'error' | 'pending' | 'rejected';
};

export type AssistantEntryMetaTarget = {
  description: string;
  id: EntryId;
  title: string;
  updatedAt: string;
};

export type AssistantInvocationMode = 'agent_execute' | 'clarify' | 'direct_answer';

export type AssistantWritePolicy = 'chat_only' | 'proposal_only' | 'workspace_write';

export type AssistantNoteEditMode = 'append' | 'delete' | 'patch' | 'prepend' | 'replace';

export type AssistantSubagentTaskPlan = {
  agentId: string;
  expectedOutput: 'evidence' | 'outline' | 'patch_plan' | 'summary';
  instruction: string;
};

export type AgentInvocationPlan = {
  enabledToolIds: string[];
  missing: string[];
  mode: AssistantInvocationMode;
  noteEditMode?: AssistantNoteEditMode;
  mainAssistantId: string;
  rationale: string;
  skillIdsToLoad: string[];
  subagentTasks: AssistantSubagentTaskPlan[];
  writePolicy: AssistantWritePolicy;
};

export type AssistantAgentRunNodeKind =
  | 'observe'
  | 'hydrate'
  | 'planner'
  | 'main_assistant'
  | 'subagent'
  | 'tool'
  | 'verifier';

export type AssistantAgentRunNodeStatus =
  | 'canceled'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped';

export type AssistantAgentRunNode = {
  agentId?: string | null;
  durationMs?: number;
  endedAt?: string;
  error?: string;
  id: string;
  inputSummary?: string;
  kind: AssistantAgentRunNodeKind;
  outputSummary?: string;
  skillIds?: string[];
  sourceCount?: number;
  startedAt: string;
  status: AssistantAgentRunNodeStatus;
  title: string;
  toolName?: string;
};

export type AssistantAgentRun = {
  durationMs?: number;
  endedAt?: string;
  id: string;
  invocationMode?: AssistantInvocationMode;
  mainAssistantId?: string;
  nodes: AssistantAgentRunNode[];
  resumedFromRunId?: string;
  resumeFromNodeId?: string;
  startedAt: string;
  status: 'running' | 'succeeded' | 'failed' | 'canceled';
  subagentTaskCount: number;
  verifierErrors: number;
  verifierWarnings: number;
};

export type AssistantActiveSegment = {
  entryId: EntryId;
  entryTitle: string;
  pageIdx: number;
  segmentUid: string;
  text: string;
};

export type AssistantNoteProposalAction =
  | 'append'
  | 'create'
  | 'delete'
  | 'patch'
  | 'prepend'
  | 'replace';

export type AssistantNoteProposalStatus =
  | 'applied'
  | 'applying'
  | 'error'
  | 'pending'
  | 'rejected';

export type AssistantNoteProposalSource = {
  entryId: EntryId;
  entryTitle: string;
  marker?: string;
  pageIdx: number;
  quote: string;
  segmentUid: string;
};

export type AssistantNoteProposalTargetKind = 'markdown_note' | 'segment_note';

export type AssistantMarkdownPatchOperation =
  | {
      newText: string;
      oldText: string;
      type: 'replace_exact';
    }
  | {
      anchorText: string;
      text: string;
      type: 'insert_after' | 'insert_before';
    }
  | {
      text: string;
      type: 'append';
    };

export type AssistantNoteProposal = {
  action: AssistantNoteProposalAction;
  appliedAt?: string;
  afterMarkdown?: string | null;
  baseContentHash?: string | null;
  beforeMarkdown?: string | null;
  createdAt: string;
  entryId: EntryId;
  entryTitle: string;
  error?: string;
  id: string;
  idempotencyKey?: string;
  markdown: string;
  noteId?: NoteId | null;
  noteTitle?: string | null;
  pageIdx?: number | null;
  patchOperations?: AssistantMarkdownPatchOperation[];
  rationale?: string;
  proposalDigest?: string;
  segmentUid?: string | null;
  sources: AssistantNoteProposalSource[];
  status: AssistantNoteProposalStatus;
  targetKind?: AssistantNoteProposalTargetKind;
  taskId?: string;
  title: string;
  verifiedAt?: string;
};

export type AssistantActiveNote = {
  entryId: EntryId;
  entryTitle: string;
  noteId: NoteId;
  noteTitle: string;
};
