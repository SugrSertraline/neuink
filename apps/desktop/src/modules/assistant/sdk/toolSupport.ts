import { jsonSchema, tool, type JSONSchema7, type ToolSet } from 'ai';

import type {
  AssistantContextSnapshot,
  AssistantToolDescriptor,
  AssistantToolTraceEvent,
  ConversationMessage,
  ConversationSourceLink,
  LlmProfile,
  ReadEntryAssistantContextResponse,
  ReadSegmentContentResponse,
  ScopeSnapshot
} from '@/shared/ipc/assistantApi';
import { invokeAssistantTool, listTools } from '@/shared/ipc/assistantApi';
import type {
  AgentInvocationPlan,
  AssistantActiveNote,
  AssistantContext,
  AssistantEntryMetaProposal,
  AssistantEntryMetaTarget,
  AssistantMarkdownPatchOperation,
  AssistantNoteProposal,
  AssistantNoteProposalAction,
  AssistantNoteProposalSource,
  AssistantSegmentContextItem,
  AssistantTagProposal,
  AssistantTaskPlan
} from '@/shared/types/assistant';
import { readNote } from '@/shared/ipc/workspaceApi';
import type { SearchHit, SearchResults } from '@/shared/ipc/workspaceApi';
import type { AgentExecutionSelection, AgentRuntimeSettings, AgentToolId } from '@/shared/types/agentRuntime';
import {
  auditAgentToolPermissions,
  buildAgentSystemPrompt,
  resolveAllowedSubagents
} from '@/shared/lib/agentRuntimeSettings';

import { assistantContextCharBudget } from './contextBudget';
import { runSubagentTask } from '../runtime/subagent';
import type { AgentLoopGuard } from '../agent-core';
import { buildEntryMetaProposal } from './entryMetaProposal';
import {
  ENTRY_META_PROPOSAL_TOOL_DESCRIPTION,
  entryMetaProposalInputSchema,
  entryMetaProposalSummary
} from './entryMetaProposalTool';

const SUPPORTED_TOOL_NAMES = new Set([
  'search_segments',
  'read_segment_content',
  'read_entry_assistant_context'
]);

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

type ToolEventHandler = (event: AssistantToolTraceEvent) => void;
type NoteProposalHandler = (proposal: AssistantNoteProposal) => void;
type EntryMetaProposalHandler = (proposal: AssistantEntryMetaProposal) => void;
type TagProposalHandler = (proposal: AssistantTagProposal) => void;
type CreateEntryHandler = (title: string) => Promise<AssistantEntryMetaTarget>;

type CreateAssistantToolsOptions = {
  activeExecution?: AgentExecutionSelection | null;
  availableEntries?: AssistantEntryMetaTarget[];
  assistantContext?: AssistantContext | null;
  contextSnapshot?: AssistantContextSnapshot | null;
  contextBudget?: number;
  conversationHistory?: ConversationMessage[];
  currentEntry?: {
    id: string;
    title: string;
  } | null;
  currentNote?: AssistantActiveNote | null;
  executionDepth?: number;
  initialSourceByMarker?: Map<number, ConversationSourceLink>;
  markerStart?: number;
  loopGuard?: AgentLoopGuard;
  onCreateEntry?: CreateEntryHandler;
  onNoteProposal?: NoteProposalHandler;
  onEntryMetaProposal?: EntryMetaProposalHandler;
  onTagProposal?: TagProposalHandler;
  onToolEvent?: ToolEventHandler;
  profiles?: LlmProfile[];
  invocationPlan?: AgentInvocationPlan | null;
  plan?: AssistantTaskPlan;
  root: string;
  runtimeSettings?: AgentRuntimeSettings | null;
  scope: ScopeSnapshot;
};

type AssistantToolRuntime = {
  events: AssistantToolTraceEvent[];
  observations: Array<{ output: unknown; toolName: string }>;
  sourceByMarker: Map<number, ConversationSourceLink>;
  toolNames: string[];
  tools: ToolSet;
};

type JsonObject = Record<string, unknown>;

type ToolEvidence = {
  entry_id: string;
  entry_title: string;
  marker: string;
  page: number;
  score?: number;
  segment_uid: string;
  snippet?: string;
  text?: string;
};


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
      entry_id: entryIdOrSingleScope(object.entry_id, scope)
    };
  }

  throw new Error(`Unsupported assistant tool: ${toolName}`);
}

export function mcpToolDescriptors(runtimeSettings?: AgentRuntimeSettings | null): AssistantToolDescriptor[] {
  if (!runtimeSettings) {
    return [];
  }
  return runtimeSettings.mcpServers
    .filter((server) => server.enabled && server.allowedToolNames.length > 0)
    .flatMap((server) =>
      server.allowedToolNames.map((toolName) => ({
        description: `Execute MCP tool ${toolName} through ${server.name}. This tool is permission-gated by Neuink Agent Runtime.`,
        name: `mcp.${server.id}.${toolName}`,
        parameters_schema: {
          additionalProperties: true,
          type: 'object'
        }
      }))
    );
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

export async function executeTool(
  toolName: string,
  input: JsonObject,
  {
    addSource,
    contextBudget
  }: {
    addSource: (source: ConversationSourceLink) => number;
    contextBudget: number;
  }
) {
  if (toolName.startsWith('mcp.')) {
    const result = await invokeAssistantTool<{
      output?: unknown;
      summary?: string;
    }>(toolName, input);
    return {
      modelOutput: result.output ?? result,
      sources: [],
      summary: result.summary ?? `Executed ${toolName}.`
    };
  }

  if (toolName === 'search_segments') {
    const results = await invokeAssistantTool<SearchResults>('search_segments', input);
    return formatSearchSegmentsOutput(results, addSource);
  }

  if (toolName === 'read_segment_content') {
    const result = await invokeAssistantTool<ReadSegmentContentResponse>(
      'read_segment_content',
      input
    );
    return formatReadSegmentOutput(result, addSource, contextBudget);
  }

  if (toolName === 'read_entry_assistant_context') {
    const result = await invokeAssistantTool<ReadEntryAssistantContextResponse>(
      'read_entry_assistant_context',
      input
    );
    return formatReadEntryOutput(result, addSource, contextBudget);
  }

  throw new Error(`Unsupported assistant tool: ${toolName}`);
}

export async function readCurrentNoteOutput({
  contextSnapshot,
  contextBudget,
  currentNote,
  root
}: {
  contextSnapshot?: AssistantContextSnapshot | null;
  contextBudget: number;
  currentNote?: AssistantActiveNote | null;
  root: string;
}) {
  if (contextSnapshot?.active_note) {
    const note = contextSnapshot.active_note;
    return {
      modelOutput: {
        available: true,
        entry_id: note.entry_id,
        entry_title: note.entry_title,
        kind: 'read_current_note',
        markdown: note.markdown,
        markdown_char_count: note.markdown_char_count,
        note_id: note.note_id,
        note_title: note.note_title,
        source_link_count: note.source_link_count,
        truncated: note.truncated
      },
      summary: note.truncated
        ? `Read hydrated selected note "${note.note_title}" with truncation.`
        : `Read hydrated selected note "${note.note_title}".`
    };
  }

  if (!currentNote) {
    return {
      modelOutput: {
        available: false,
        kind: 'read_current_note',
        reason: 'No Markdown note was explicitly selected.'
      },
      summary: 'No selected Markdown note is available.'
    };
  }

  const budget = Math.min(36_000, contextBudget);
  const note = await readNote(root, currentNote.entryId, currentNote.noteId);
  const truncated = note.markdown.length > budget;
  const markdown = trimToBudget(note.markdown, budget);

  return {
    modelOutput: {
      available: true,
      entry_id: currentNote.entryId,
      entry_title: currentNote.entryTitle,
      kind: 'read_current_note',
      markdown,
      markdown_char_count: note.markdown.length,
      note_id: currentNote.noteId,
      note_title: note.title || currentNote.noteTitle,
      source_link_count: note.links.length,
      truncated
    },
    summary: truncated
      ? `Read selected note "${note.title || currentNote.noteTitle}" with truncation.`
      : `Read selected note "${note.title || currentNote.noteTitle}".`
  };
}

export function formatSearchSegmentsOutput(
  results: SearchResults,
  addSource: (source: ConversationSourceLink) => number
) {
  const hits = results.entries.flatMap((group) => group.hits).slice(0, 24);
  const evidence = hits
    .filter((hit): hit is SearchHit & { target: { kind: 'segment'; entry_id: string; segment_uid: string; page_idx: number } } => hit.target.kind === 'segment')
    .slice(0, 12)
    .map((hit) => {
      const source: ConversationSourceLink = {
        entry_id: hit.target.entry_id,
        entry_title: hit.entry_title,
        page_idx: hit.target.page_idx,
        quote: compactQuote(hit.snippet),
        segment_uid: hit.target.segment_uid
      };
      const marker = addSource(source);
      return {
        entry_id: source.entry_id,
        entry_title: source.entry_title,
        marker: `[S${marker}]`,
        page: source.page_idx + 1,
        score: hit.score,
        segment_uid: source.segment_uid,
        snippet: hit.snippet
      } satisfies ToolEvidence;
    });

  const modelOutput = {
    evidence,
    kind: 'search_segments',
    mode: results.mode,
    query: results.query,
    total_hit_count: results.total_hit_count,
    warnings: results.warnings ?? []
  };

  const warningText =
    (results.warnings ?? []).length > 0 ? ` ${results.warnings?.join(' ')}` : '';

  return {
    modelOutput,
    sources: evidence.map((item) => sourceFromEvidence(item)),
    summary:
      evidence.length > 0
        ? `Found ${evidence.length} segment${evidence.length === 1 ? '' : 's'} for "${results.query}" using ${results.mode}.${warningText}`
        : `No parsed PDF segments matched "${results.query}" using ${results.mode}.${warningText}`
  };
}

export function formatReadSegmentOutput(
  result: ReadSegmentContentResponse,
  addSource: (source: ConversationSourceLink) => number,
  contextBudget: number
) {
  const text = trimToBudget(result.text, Math.min(8_000, contextBudget));
  const source: ConversationSourceLink = {
    entry_id: result.entry_id,
    entry_title: result.entry_title,
    page_idx: result.page_idx,
    quote: compactQuote(text),
    segment_uid: result.segment_uid
  };
  const marker = addSource(source);
  const evidence: ToolEvidence = {
    entry_id: source.entry_id,
    entry_title: source.entry_title,
    marker: `[S${marker}]`,
    page: source.page_idx + 1,
    segment_uid: source.segment_uid,
    text
  };

  return {
    modelOutput: {
      evidence,
      kind: 'read_segment_content'
    },
    sources: [source],
    summary: `Read ${result.entry_title}, p.${result.page_idx + 1}.`
  };
}

export function formatReadEntryOutput(
  result: ReadEntryAssistantContextResponse,
  addSource: (source: ConversationSourceLink) => number,
  contextBudget: number
) {
  const originalMarkerToMarker = new Map<number, number>();
  const originalMarkerToSource = new Map<number, ConversationSourceLink>();
  const trimmed = trimToBudget(result.markdown, contextBudget);
  const markdown = trimmed.replace(/\[S(\d+)]/g, (full, markerText: string) => {
    const originalMarker = Number(markerText);
    const source = result.sources[originalMarker - 1];

    if (!source) {
      return full;
    }

    const existing = originalMarkerToMarker.get(originalMarker);
    if (existing) {
      return `[S${existing}]`;
    }

    const nextMarker = addSource(source);
    originalMarkerToMarker.set(originalMarker, nextMarker);
    originalMarkerToSource.set(originalMarker, source);
    return `[S${nextMarker}]`;
  });
  const sources = [...originalMarkerToSource.values()];

  return {
    modelOutput: {
      entry_id: result.entry_id,
      entry_title: result.entry_title,
      kind: 'read_entry_assistant_context',
      markdown,
      source_markers: [...originalMarkerToMarker.values()].map((marker) => `[S${marker}]`)
    },
    sources,
    summary: result.markdown.trim()
      ? `Read parsed markdown for ${result.entry_title} (${originalMarkerToMarker.size} source markers).`
      : `${result.entry_title} has no parsed PDF markdown yet.`
  };
}

export function noteProposalInputSchema(): JSONSchema7 {
  return {
    additionalProperties: false,
    properties: {
      action: {
        description:
          'Proposal action. Use create for a new note, prepend for adding content to the beginning, append for adding content to the end, patch for exact local edits, delete for removing requested content, and replace only for replacing an entire note body.',
        enum: ['create', 'prepend', 'append', 'delete', 'patch', 'replace'],
        type: 'string'
      },
      entry_id: {
        description:
          'Target Entry id. Omit only when a target Entry was explicitly selected or confirmed.',
        type: 'string'
      },
      markdown: {
        description:
          'Markdown body to create, prepend, append, or use as the replacement note body. For patch, this can be a short human-readable summary or preview; patch_operations are authoritative.',
        type: 'string'
      },
      note_id: {
        description:
          'Target note id for prepend/append/replace. Omit only when an explicit selected note is the target.',
        type: 'string'
      },
      note_title: {
        description: 'Existing note title for prepend/append/replace, if known.',
        type: 'string'
      },
      page_idx: {
        description:
          'Zero-based page index for a target Segment Note. Usually omit this when segment_uid comes from pinned context.',
        type: 'number'
      },
      patch_operations: {
        description:
          'Exact local Markdown edits for action=patch. Each old_text or anchor_text must be copied from read_note or read_current_note and should match exactly once.',
        items: {
          additionalProperties: false,
          properties: {
            anchor_text: {
              description: 'Exact Markdown anchor text for insert_before or insert_after.',
              type: 'string'
            },
            new_text: {
              description: 'Replacement Markdown for replace_exact.',
              type: 'string'
            },
            old_text: {
              description: 'Exact Markdown text to replace. Must match exactly once.',
              type: 'string'
            },
            text: {
              description: 'Markdown text to insert or append.',
              type: 'string'
            },
            type: {
              enum: ['replace_exact', 'insert_after', 'insert_before', 'append'],
              type: 'string'
            }
          },
          required: ['type'],
          type: 'object'
        },
        type: 'array'
      },
      rationale: {
        description: 'Short reason why this note change is useful.',
        type: 'string'
      },
      segment_uid: {
        description:
          'Target segment uid when target is segment_note. Omit to use the first pinned Segment context when available.',
        type: 'string'
      },
      source_markers: {
        description:
          'Evidence markers from tool output or pinned context, such as S1 or [S2], that support the note content.',
        items: {
          type: 'string'
        },
        type: 'array'
      },
      title: {
        description: 'Title for the new note, or replacement title for prepend/append/replace.',
        type: 'string'
      },
      target: {
        description:
          'Target note type. Use markdown_note for normal Markdown notes. Use segment_note when the user asks to add to or update the note attached to the selected/pinned PDF segment.',
        enum: ['markdown_note', 'segment_note'],
        type: 'string'
      }
    },
    required: ['action'],
    type: 'object'
  } as JSONSchema7;
}

export function readCurrentNoteInputSchema(): JSONSchema7 {
  return {
    additionalProperties: false,
    properties: {},
    type: 'object'
  } as JSONSchema7;
}

export function skillSearchInputSchema(): JSONSchema7 {
  return {
    additionalProperties: false,
    properties: {
      category: { type: 'string' },
      query: { type: 'string' }
    },
    type: 'object'
  } as JSONSchema7;
}

export function skillLoadInputSchema(): JSONSchema7 {
  return {
    additionalProperties: false,
    properties: {
      skill_id: { type: 'string' }
    },
    required: ['skill_id'],
    type: 'object'
  } as JSONSchema7;
}

export function tagProposalInputSchema(): JSONSchema7 {
  return {
    additionalProperties: false,
    properties: {
      action: { enum: ['attach', 'create', 'detach', 'rename'], type: 'string' },
      entry_ids: { items: { type: 'string' }, type: 'array' },
      name: { type: 'string' },
      new_name: { type: 'string' },
      rationale: { type: 'string' },
      tag_id: { type: 'string' }
    },
    required: ['action'],
    type: 'object'
  } as JSONSchema7;
}

export function runSubagentInputSchema(
  activeExecution?: AgentExecutionSelection | null
): JSONSchema7 {
  const allowedAgentIds =
    activeExecution?.agent.allowedSubagentIds.length
      ? activeExecution.agent.allowedSubagentIds
      : undefined;
  return {
    additionalProperties: false,
    properties: {
      agent_id: {
        enum: allowedAgentIds,
        type: 'string'
      },
      instruction: {
        description: 'Specific delegated task instruction for the subagent.',
        type: 'string'
      },
      question: {
        description: 'Optional natural-language user question for the subagent.',
        type: 'string'
      }
    },
    required: ['agent_id', 'instruction'],
    type: 'object'
  } as JSONSchema7;
}

export function searchSkillsOutput(
  input: unknown,
  skillPackages: AgentExecutionSelection['skillPackages']
) {
  const object = asObject(input);
  const category = optionalString(object.category)?.trim().toLowerCase() ?? '';
  const query = optionalString(object.query)?.trim().toLowerCase() ?? '';
  const matches = skillPackages.filter((skillPackage) => {
    if (category && skillPackage.category !== category) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack =
      `${skillPackage.name}\n${skillPackage.description}\n${skillPackage.category}\n${skillPackage.triggers.join('\n')}`.toLowerCase();
    return haystack.includes(query);
  });
  return {
    modelOutput: {
      items: matches.map((skillPackage) => ({
        category: skillPackage.category,
        description: skillPackage.description,
        id: skillPackage.id,
        name: skillPackage.name,
        resources: skillPackage.resourcePaths ?? { assets: [], references: [], scripts: [] },
        script_execution: skillPackage.scriptExecution ?? 'disabled',
        suggested_tools: skillPackage.suggestedToolIds,
        triggers: skillPackage.triggers
      })),
      kind: 'skill_package_search',
      total: matches.length
    },
    summary:
      matches.length > 0
        ? `Found ${matches.length} skill package${matches.length === 1 ? '' : 's'} for the current agent.`
        : 'No loaded skill packages matched the query.'
  };
}

export function loadSkillOutput(
  input: unknown,
  skillPackages: AgentExecutionSelection['skillPackages']
) {
  const object = asObject(input);
  const skillId = requiredString(object.skill_id, 'skill_id');
  const skillPackage = skillPackages.find((item) => item.id === skillId);
  if (!skillPackage) {
    throw new Error('The requested skill package is not loaded for the current agent.');
  }
  return {
    modelOutput: {
      category: skillPackage.category,
      description: skillPackage.description,
      files: skillPackage.files.map((file) => file.path),
      id: skillPackage.id,
      kind: 'skill_package_load',
      name: skillPackage.name,
      readme: skillPackage.readme,
      resources: skillPackage.resourcePaths ?? { assets: [], references: [], scripts: [] },
      script_execution: skillPackage.scriptExecution ?? 'disabled',
      script_policy:
        'Scripts are auxiliary files only. Do not execute them unless they are exposed through MCP or an approved Tool Package with permissions.',
      source_archive_path: skillPackage.sourceArchivePath,
      suggested_tools: skillPackage.suggestedToolIds,
      triggers: skillPackage.triggers,
      version: skillPackage.version
    },
    summary: `Loaded skill package "${skillPackage.name}".`
  };
}

export function buildNoteProposal(
  input: unknown,
  {
    assistantContext,
    availableEntries,
    contextSnapshot,
    currentEntry,
    currentNote,
    plan,
    readNoteSnapshots,
    scope,
    sourceByMarker
  }: {
    assistantContext?: AssistantContext | null;
    availableEntries: AssistantEntryMetaTarget[];
    contextSnapshot?: AssistantContextSnapshot | null;
    currentEntry?: { id: string; title: string } | null;
    currentNote?: AssistantActiveNote | null;
    plan?: AssistantTaskPlan;
    readNoteSnapshots: Map<string, { markdown: string; title: string }>;
    scope: ScopeSnapshot;
    sourceByMarker: Map<number, ConversationSourceLink>;
  }
): AssistantNoteProposal {
  const object = asObject(input);
  const plannedSegmentTarget = plan?.target.kind === 'segment_note'
    ? segmentTargetFromPlan(plan, assistantContext)
    : null;
  const defaultSegmentTarget =
    plannedSegmentTarget ??
    assistantContext?.items.find(
      (item): item is AssistantSegmentContextItem => item.kind === 'segment'
    ) ??
    null;
  const targetKind = noteProposalTargetKind(
    object.target ?? (plan?.target.kind === 'segment_note' ? 'segment_note' : undefined),
    {
    currentNote,
    defaultSegmentTarget,
    object
    }
  );
  const hasPlannedMarkdownNote =
    targetKind === 'markdown_note' && Boolean(plan?.target.noteId);
  const action = noteProposalAction(plan?.noteAction ?? object.action, {
    currentNote,
    hasPlannedMarkdownNote,
    targetKind
  });
  const entryId =
    optionalString(object.entry_id) ??
    (plan?.needsNoteProposal ? plan.target.entryId : null) ??
    (targetKind === 'markdown_note' ? currentNote?.entryId : null) ??
    (targetKind === 'segment_note' ? defaultSegmentTarget?.entryId : null) ??
    currentEntry?.id ??
    null;

  if (!entryId) {
    throw new Error('A note proposal needs a target Entry.');
  }

  const entryTitle =
    targetKind === 'segment_note' && defaultSegmentTarget?.entryId === entryId
      ? defaultSegmentTarget.entryTitle
      : currentNote?.entryId === entryId
      ? currentNote.entryTitle
      : currentEntry?.id === entryId
        ? currentEntry.title
        : availableEntries.find((entry) => entry.id === entryId)?.title ??
          scope.entry_titles[scope.entry_ids.indexOf(entryId)] ??
          entryId;
  const segmentUid =
    targetKind === 'segment_note'
      ? optionalString(object.segment_uid) ?? plan?.target.segmentUid ?? defaultSegmentTarget?.segmentUid ?? null
      : null;
  const pageIdx =
    targetKind === 'segment_note'
      ? optionalNumber(object.page_idx) ?? defaultSegmentTarget?.pageIdx ?? null
      : null;

  if (targetKind === 'segment_note' && !segmentUid) {
    throw new Error('Segment note proposals need a target segment_uid.');
  }

  const noteId = targetKind === 'segment_note' || action === 'create'
    ? null
    : optionalString(object.note_id) ?? plan?.target.noteId ?? currentNote?.noteId ?? null;

  if (targetKind === 'markdown_note' && action !== 'create' && !noteId) {
    throw new Error('Prepend, append, and replace note proposals need a target note.');
  }

  const noteTitle =
    targetKind === 'segment_note'
      ? `Segment Note${pageIdx === null ? '' : ` p.${pageIdx + 1}`}`
      : optionalString(object.note_title) ??
        (noteId ? readNoteSnapshots.get(noteSnapshotKey(entryId, noteId))?.title ?? null : null) ??
        (currentNote?.noteId === noteId ? currentNote.noteTitle : null);
  const title =
    optionalString(object.title) ??
    noteTitle ??
    (action === 'create' ? 'AI note' : 'Updated note');
  const patchOperations = action === 'patch' ? markdownPatchOperations(object.patch_operations) : undefined;
  const markdown =
    action === 'patch'
      ? optionalString(object.markdown) ?? patchOperationsPreview(patchOperations ?? [])
      : requiredString(object.markdown, 'markdown');
  const sourceMarkers = [
    ...stringArray(object.source_markers),
    ...markersFromMarkdown(markdown)
  ];
  const beforeMarkdown = proposalBeforeMarkdown({
    action,
    contextSnapshot,
    entryId,
    noteId,
    readNoteSnapshots,
    targetKind
  });
  const afterMarkdown = proposalAfterMarkdown({
    action,
    beforeMarkdown,
    markdown,
    patchOperations,
    targetKind
  });

  return {
    action,
    afterMarkdown,
    beforeMarkdown,
    createdAt: new Date().toISOString(),
    entryId,
    entryTitle,
    id: `note-proposal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    markdown,
    noteId,
    noteTitle,
    pageIdx,
    patchOperations,
    rationale: optionalString(object.rationale) ?? undefined,
    segmentUid,
    sources: sourcesFromMarkers(sourceMarkers, sourceByMarker),
    status: 'pending',
    targetKind,
    title
  };
}

export function proposalBeforeMarkdown({
  action,
  contextSnapshot,
  entryId,
  noteId,
  readNoteSnapshots,
  targetKind
}: {
  action: AssistantNoteProposalAction;
  contextSnapshot?: AssistantContextSnapshot | null;
  entryId: string;
  noteId: string | null;
  readNoteSnapshots: Map<string, { markdown: string; title: string }>;
  targetKind: 'markdown_note' | 'segment_note';
}) {
  if (targetKind !== 'markdown_note' || action === 'create' || !noteId) {
    return action === 'create' ? '' : null;
  }

  const explicitlyRead = readNoteSnapshots.get(noteSnapshotKey(entryId, noteId));
  if (explicitlyRead) return explicitlyRead.markdown;

  const activeNote = contextSnapshot?.active_note;
  if (!activeNote || activeNote.entry_id !== entryId || activeNote.note_id !== noteId) {
    return null;
  }

  return activeNote.markdown;
}

export function proposalAfterMarkdown({
  action,
  beforeMarkdown,
  markdown,
  patchOperations,
  targetKind
}: {
  action: AssistantNoteProposalAction;
  beforeMarkdown: string | null;
  markdown: string;
  patchOperations?: AssistantMarkdownPatchOperation[];
  targetKind: 'markdown_note' | 'segment_note';
}) {
  if (targetKind !== 'markdown_note') {
    return markdown;
  }

  if (action === 'patch' && beforeMarkdown !== null && patchOperations) {
    try {
      return applyMarkdownPatchPreview(beforeMarkdown, patchOperations);
    } catch {
      return null;
    }
  }

  if (action === 'append' && beforeMarkdown !== null) {
    return appendMarkdownPreview(beforeMarkdown, markdown);
  }

  if (action === 'prepend' && beforeMarkdown !== null) {
    return prependMarkdownPreview(beforeMarkdown, markdown);
  }

  return markdown;
}

export function appendMarkdownPreview(currentMarkdown: string, markdownToAppend: string) {
  const current = currentMarkdown.trimEnd();
  const next = markdownToAppend.trim();
  if (!current) {
    return ensureTrailingNewlinePreview(next);
  }
  if (!next) {
    return ensureTrailingNewlinePreview(current);
  }
  return ensureTrailingNewlinePreview(`${current}\n\n${next}`);
}

export function prependMarkdownPreview(currentMarkdown: string, markdownToPrepend: string) {
  const current = currentMarkdown.trim();
  const previous = markdownToPrepend.trim();
  if (!previous) {
    return ensureTrailingNewlinePreview(current);
  }
  if (!current) {
    return ensureTrailingNewlinePreview(previous);
  }
  return ensureTrailingNewlinePreview(`${previous}\n\n${current}`);
}

export function ensureTrailingNewlinePreview(markdown: string) {
  const trimmed = markdown.trim();
  return trimmed ? `${trimmed}\n` : '';
}

export function applyMarkdownPatchPreview(
  markdown: string,
  operations: AssistantMarkdownPatchOperation[]
) {
  let nextMarkdown = markdown;

  for (const operation of operations) {
    if (operation.type === 'append') {
      nextMarkdown = appendMarkdownPreview(nextMarkdown, operation.text);
      continue;
    }

    if (operation.type === 'replace_exact') {
      if (countOccurrences(nextMarkdown, operation.oldText) !== 1) {
        throw new Error('Patch replacement text must match exactly once.');
      }
      nextMarkdown = nextMarkdown.replace(operation.oldText, operation.newText);
      continue;
    }

    const matchCount = countOccurrences(nextMarkdown, operation.anchorText);
    if (matchCount !== 1) {
      throw new Error('Patch anchor text must match exactly once.');
    }

    const index = nextMarkdown.indexOf(operation.anchorText);
    nextMarkdown =
      operation.type === 'insert_before'
        ? `${nextMarkdown.slice(0, index)}${operation.text}${nextMarkdown.slice(index)}`
        : `${nextMarkdown.slice(0, index + operation.anchorText.length)}${operation.text}${nextMarkdown.slice(index + operation.anchorText.length)}`;
  }

  return ensureTrailingNewlinePreview(nextMarkdown);
}

export function countOccurrences(haystack: string, needle: string) {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (index <= haystack.length) {
    const nextIndex = haystack.indexOf(needle, index);
    if (nextIndex < 0) {
      break;
    }
    count += 1;
    index = nextIndex + needle.length;
  }
  return count;
}

export function noteProposalAction(
  value: unknown,
  {
    currentNote,
    hasPlannedMarkdownNote,
    targetKind
  }: {
    currentNote?: AssistantActiveNote | null;
    hasPlannedMarkdownNote: boolean;
    targetKind: 'markdown_note' | 'segment_note';
  }
): AssistantNoteProposalAction {
  if (
    value === 'append' ||
    value === 'create' ||
    value === 'delete' ||
    value === 'patch' ||
    value === 'prepend' ||
    value === 'replace'
  ) {
    if (targetKind === 'segment_note' && value === 'create') {
      return 'append';
    }
    return value;
  }

  return currentNote || hasPlannedMarkdownNote ? 'append' : 'create';
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

export function modelToolName(toolId: string) {
  const normalized = toolId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return normalized || 'tool';
}

export function assertModelToolNameAvailable(
  tools: ToolSet,
  internalToolId: string,
  exposedToolName: string
) {
  if (Object.prototype.hasOwnProperty.call(tools, exposedToolName)) {
    throw new Error(
      `Assistant tools collide after name normalization: ${internalToolId} -> ${exposedToolName}.`
    );
  }
}

export function assertValidModelToolNames(tools: ToolSet) {
  const invalidName = Object.keys(tools).find(
    (name) => !/^[a-zA-Z0-9_-]+$/.test(name)
  );
  if (invalidName) {
    throw new Error(`Invalid model tool function name: ${invalidName}.`);
  }
}

export function proposalToolDescription(toolName: string) {
  if (toolName === 'note.propose_create') {
    return 'Create a reviewable proposal for a new Markdown note. This never writes to disk.';
  }
  if (toolName === 'segment_note.propose_patch') {
    return 'Create a reviewable prepend, append, patch, delete, or replacement proposal for the confirmed Segment Note target.';
  }
  return 'Create a reviewable prepend, append, patch, delete, or replacement proposal for the confirmed Markdown note target.';
}

export function markdownPatchOperations(value: unknown): AssistantMarkdownPatchOperation[] {
  if (!Array.isArray(value)) {
    throw new Error('patch_operations is required for patch proposals.');
  }

  const operations = value.map((item, index) => {
    const object = asObject(item);
    const type = object.type;

    if (type === 'replace_exact') {
      return {
        newText: requiredStringAllowEmpty(object.new_text, `patch_operations[${index}].new_text`),
        oldText: requiredString(object.old_text, `patch_operations[${index}].old_text`),
        type
      } satisfies AssistantMarkdownPatchOperation;
    }

    if (type === 'insert_after' || type === 'insert_before') {
      return {
        anchorText: requiredString(object.anchor_text, `patch_operations[${index}].anchor_text`),
        text: requiredStringAllowEmpty(object.text, `patch_operations[${index}].text`),
        type
      } satisfies AssistantMarkdownPatchOperation;
    }

    if (type === 'append') {
      return {
        text: requiredStringAllowEmpty(object.text, `patch_operations[${index}].text`),
        type
      } satisfies AssistantMarkdownPatchOperation;
    }

    throw new Error(`Unsupported patch operation type at patch_operations[${index}].`);
  });

  if (operations.length === 0) {
    throw new Error('patch_operations must contain at least one operation.');
  }

  return operations;
}

export function patchOperationsPreview(operations: AssistantMarkdownPatchOperation[]) {
  return operations
    .map((operation) => {
      if (operation.type === 'replace_exact') {
        return operation.newText;
      }
      if (operation.type === 'append') {
        return operation.text;
      }
      return operation.text;
    })
    .filter((text) => text.trim().length > 0)
    .join('\n\n');
}

export function noteProposalTargetKind(
  value: unknown,
  {
    currentNote,
    defaultSegmentTarget,
    object
  }: {
    currentNote?: AssistantActiveNote | null;
    defaultSegmentTarget?: { segmentUid: string } | null;
    object: JsonObject;
  }
): 'markdown_note' | 'segment_note' {
  if (value === 'markdown_note' || value === 'segment_note') {
    return value;
  }

  if (optionalString(object.segment_uid)) {
    return 'segment_note';
  }

  if (
    !currentNote &&
    defaultSegmentTarget &&
    (object.action === 'append' || object.action === 'prepend' || object.action === 'replace')
  ) {
    return 'segment_note';
  }

  return 'markdown_note';
}

export function segmentTargetFromPlan(
  plan: AssistantTaskPlan,
  assistantContext?: AssistantContext | null
): {
  entryId: string;
  entryTitle: string;
  pageIdx: number | null;
  segmentUid: string;
} | null {
  const segmentUid = plan.target.segmentUid;
  if (!segmentUid) {
    return null;
  }

  const contextItem = assistantContext?.items.find(
    (item) =>
      item.kind === 'segment' &&
      item.segmentUid === segmentUid &&
      (!plan.target.entryId || item.entryId === plan.target.entryId)
  ) as AssistantSegmentContextItem | undefined;
  if (contextItem) {
    return contextItem;
  }

  if (!plan.target.entryId) {
    return null;
  }

  return {
    entryId: plan.target.entryId,
    entryTitle: plan.target.entryId,
    pageIdx: optionalNumber((plan.target as Record<string, unknown>).pageIdx) ?? null,
    segmentUid
  };
}

export function markersFromMarkdown(markdown: string) {
  return [...markdown.matchAll(/\[S(\d+)]/g)].map((match) => `S${match[1]}`);
}

export function sourcesFromMarkers(
  markers: string[],
  sourceByMarker: Map<number, ConversationSourceLink>
): AssistantNoteProposalSource[] {
  const seen = new Set<number>();
  const sources: AssistantNoteProposalSource[] = [];

  for (const marker of markers) {
    const markerNumber = Number(marker.replace(/[[\]S\s]/gi, ''));
    if (!Number.isFinite(markerNumber) || seen.has(markerNumber)) {
      continue;
    }

    const source = sourceByMarker.get(markerNumber);
    if (!source) {
      continue;
    }

    seen.add(markerNumber);
    sources.push({
      entryId: source.entry_id,
      entryTitle: source.entry_title,
      marker: `S${markerNumber}`,
      pageIdx: source.page_idx,
      quote: source.quote,
      segmentUid: source.segment_uid
    });
  }

  return sources;
}

export function noteProposalSummary(proposal: AssistantNoteProposal) {
  if (proposal.targetKind === 'segment_note') {
    return `Prepared a ${proposal.action === 'replace' ? 'replacement' : 'segment note'} proposal for ${proposal.noteTitle ?? proposal.title}.`;
  }
  if (proposal.action === 'create') {
    return `Prepared a new note proposal: ${proposal.title}.`;
  }
  if (proposal.action === 'append') {
    return `Prepared an append proposal for ${proposal.noteTitle ?? proposal.title}.`;
  }
  if (proposal.action === 'prepend') {
    return `Prepared a prepend proposal for ${proposal.noteTitle ?? proposal.title}.`;
  }
  if (proposal.action === 'patch') {
    return `Prepared a patch proposal for ${proposal.noteTitle ?? proposal.title}.`;
  }
  return `Prepared a replacement proposal for ${proposal.noteTitle ?? proposal.title}.`;
}

export function modelInputSchema(descriptor: AssistantToolDescriptor): JSONSchema7 {
  const schema = cloneJsonSchema(descriptor.parameters_schema);
  const objectSchema = schema as JSONSchema7 & {
    properties?: Record<string, JSONSchema7>;
    required?: string[];
  };

  if (objectSchema.type !== 'object') {
    return schema;
  }

  objectSchema.properties = objectSchema.properties ?? {};
  delete objectSchema.properties.root;

  if (descriptor.name === 'read_segment_content') {
    objectSchema.required = ['entry_id', 'segment_uid'];
  } else if (descriptor.name === 'read_entry_assistant_context') {
    objectSchema.required = ['entry_id'];
  } else {
    objectSchema.required = (objectSchema.required ?? []).filter((key: string) => key !== 'root');
  }

  describeProperty(objectSchema, 'query', 'Search phrase or question to locate relevant PDF segments.');
  describeProperty(objectSchema, 'mode', 'Search mode. Prefer hybrid for content lookup; use keyword for exact terms.');
  describeProperty(objectSchema, 'scope_entry_ids', 'Optional Entry ids. Omit this to use the current Neuink scope.');
  describeProperty(objectSchema, 'top_k', 'Optional maximum number of segment hits to return.');
  describeProperty(objectSchema, 'entry_id', 'Required Entry id for explicit Entry or segment reads.');
  describeProperty(objectSchema, 'segment_uid', 'Segment uid returned by search_segments.');

  return objectSchema;
}

export function cloneJsonSchema(schema: unknown): JSONSchema7 {
  if (!isPlainObject(schema)) {
    return {
      additionalProperties: true,
      properties: {},
      type: 'object'
    } as JSONSchema7;
  }

  return JSON.parse(JSON.stringify(schema)) as JSONSchema7;
}

export function describeProperty(
  schema: JSONSchema7 & { properties?: Record<string, JSONSchema7> },
  property: string,
  description: string
) {
  const existing = schema.properties?.[property];
  if (existing && isPlainObject(existing) && !existing.description) {
    existing.description = description;
  }
}

export function toolDescription(descriptor: AssistantToolDescriptor) {
  if (descriptor.name === 'search_segments') {
    return `${descriptor.description} Use this for find/locate questions and questions about experiments, methods, datasets, results, tables, figures, or conclusions.`;
  }
  if (descriptor.name === 'read_segment_content') {
    return `${descriptor.description} Use this after search_segments when a snippet is not enough.`;
  }
  if (descriptor.name === 'read_entry_assistant_context') {
    return `${descriptor.description} Use this only for an explicitly selected, named, or confirmed Entry.`;
  }
  return descriptor.description;
}

export function scopedEntryIds(value: unknown, scope: ScopeSnapshot) {
  const requested = stringArray(value);

  if (scope.entry_ids.length === 0) {
    return requested;
  }

  if (requested.length === 0) {
    return scope.entry_ids;
  }

  const allowed = new Set(scope.entry_ids);
  const filtered = requested.filter((entryId) => allowed.has(entryId));
  return filtered.length > 0 ? filtered : scope.entry_ids;
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

export function searchMode(value: unknown) {
  return value === 'keyword' || value === 'semantic' || value === 'hybrid' ? value : 'hybrid';
}

export function runningSummary(toolName: string, input: JsonObject) {
  if (toolName === 'search_segments') {
    return `Searching parsed PDF segments for "${String(input.query)}" using ${String(input.mode)}.`;
  }
  if (toolName === 'read_segment_content') {
    return `Reading segment ${String(input.segment_uid)}.`;
  }
  if (toolName === 'read_entry_assistant_context') {
    return `Reading parsed markdown for Entry ${String(input.entry_id)}.`;
  }
  return 'Running assistant tool.';
}

export function publicInput(input: unknown) {
  const object = asObject(input);
  const copy = { ...object };
  delete copy.root;
  return copy;
}

export function sourceFromEvidence(evidence: ToolEvidence): ConversationSourceLink {
  return {
    entry_id: evidence.entry_id,
    entry_title: evidence.entry_title,
    page_idx: evidence.page - 1,
    quote: compactQuote(evidence.text ?? evidence.snippet ?? ''),
    segment_uid: evidence.segment_uid
  };
}

export function asObject(value: unknown): JsonObject {
  return isPlainObject(value) ? (value as JsonObject) : {};
}

export function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function requiredString(value: unknown, name: string) {
  const text = optionalString(value);
  if (!text) {
    throw new Error(`${name} is required.`);
  }
  return text;
}

export function requiredStringAllowEmpty(value: unknown, name: string) {
  if (typeof value !== 'string') {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function requiredEnum<const T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[]
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;
}

export function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function maxMarker(sourceByMarker: Map<number, ConversationSourceLink>) {
  return Math.max(0, ...sourceByMarker.keys());
}

export function sourceKey(source: ConversationSourceLink) {
  return `${source.entry_id}:${source.segment_uid}`;
}

export function noteSnapshotKey(entryId: string, noteId: string) {
  return `${entryId}:${noteId}`;
}

export function rememberReadNote(
  snapshots: Map<string, { markdown: string; title: string }>,
  value: unknown
) {
  const output = asObject(value);
  const entryId = optionalString(output.entry_id);
  const noteId = optionalString(output.note_id);
  if (!entryId || !noteId || typeof output.markdown !== 'string') return;
  snapshots.set(noteSnapshotKey(entryId, noteId), {
    markdown: output.markdown,
    title: optionalString(output.note_title) ?? noteId
  });
}

export function compactQuote(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function trimToBudget(text: string, budget: number) {
  if (text.length <= budget) {
    return text;
  }

  return `${text.slice(0, budget)}\n\n[Context truncated because it exceeds the configured model context length.]`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
