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

import {
  asObject,
  assertModelToolNameAvailable,
  assertValidModelToolNames,
  buildNoteProposal,
  entryIdOrSingleScope,
  errorMessage,
  executeTool,
  loadSkillOutput,
  maxMarker,
  mcpToolDescriptors,
  mcpToolIdsForAgent,
  modelInputSchema,
  modelToolName,
  normalizeToolInput,
  noteProposalInputSchema,
  noteProposalSummary,
  noteSnapshotKey,
  optionalString,
  proposalToolDescription,
  proposalToolInput,
  publicInput,
  readCurrentNoteInputSchema,
  readCurrentNoteOutput,
  rememberReadNote,
  requiredEnum,
  requiredString,
  runSubagentInputSchema,
  runningSummary,
  searchSkillsOutput,
  skillLoadInputSchema,
  skillSearchInputSchema,
  sourceKey,
  stringArray,
  tagProposalInputSchema,
  toolDescription,
  trimToBudget
} from './toolSupport';

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

function isAllowedMcpTool(
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

export async function createAssistantTools({
  activeExecution,
  availableEntries = [],
  assistantContext,
  contextSnapshot,
  contextBudget = assistantContextCharBudget(null),
  conversationHistory = [],
  currentEntry,
  currentNote,
  executionDepth = 0,
  initialSourceByMarker,
  markerStart = 1,
  loopGuard,
  onCreateEntry,
  onNoteProposal,
  onEntryMetaProposal,
  onTagProposal,
  onToolEvent,
  profiles = [],
  invocationPlan,
  plan,
  root,
  runtimeSettings,
  scope
}: CreateAssistantToolsOptions): Promise<AssistantToolRuntime> {
  const descriptors = [
    ...(await listTools()),
    ...mcpToolDescriptors(runtimeSettings)
  ];
  const events: AssistantToolTraceEvent[] = [];
  const observations: Array<{ output: unknown; toolName: string }> = [];
  const sourceByMarker = new Map<number, ConversationSourceLink>(initialSourceByMarker ?? []);
  const markerBySourceKey = new Map<string, number>();
  let nextMarker = Math.max(markerStart, maxMarker(sourceByMarker) + 1);

  for (const [marker, source] of sourceByMarker) {
    markerBySourceKey.set(sourceKey(source), marker);
  }

  const addSource = (source: ConversationSourceLink) => {
    const key = sourceKey(source);
    const existing = markerBySourceKey.get(key);
    if (existing) {
      return existing;
    }

    const marker = nextMarker;
    nextMarker += 1;
    sourceByMarker.set(marker, source);
    markerBySourceKey.set(key, marker);
    return marker;
  };

  const emit = (event: AssistantToolTraceEvent) => {
    const index = events.findIndex((current) => current.id === event.id);
    const nextEvent =
      index >= 0
        ? {
            ...events[index],
            ...event
          }
        : event;

    if (index >= 0) {
      events[index] = nextEvent;
    } else {
      events.push(nextEvent);
    }

    onToolEvent?.(nextEvent);
  };

  const tools: ToolSet = {};
  const createdEntryByTitle = new Map<string, AssistantEntryMetaTarget>();
  const readNoteSnapshots = new Map<string, { markdown: string; title: string }>();

  const scopedToolIds = scopedEnabledToolIds(
    [
      ...(activeExecution?.agent.enabledToolIds ??
        (Array.from(SUPPORTED_TOOL_NAMES) as AgentToolId[])),
      ...mcpToolIdsForAgent(runtimeSettings, activeExecution)
    ],
    activeExecution,
    invocationPlan
  );
  const permissionAudit = auditAgentToolPermissions(
    scopedToolIds,
    activeExecution?.agent,
    runtimeSettings
  );
  const enabledToolIds = new Set<AgentToolId>(permissionAudit.allowedToolIds);

  if (enabledToolIds.has('create_entry') && onCreateEntry) {
    tools.create_entry = tool<unknown, unknown>({
      description:
        'Create an Entry as an external side effect. Choose the title yourself from the conversation, then call this tool once. Do not use this tool when the user only asks for title suggestions.',
      inputSchema: jsonSchema<unknown>({
        additionalProperties: false,
        properties: {
          title: {
            description: 'The final Entry title chosen from the conversation.',
            minLength: 1,
            type: 'string'
          }
        },
        required: ['title'],
        type: 'object'
      } as JSONSchema7),
      execute: async (input, options) => {
        const object = asObject(input);
        const title = requiredString(object.title, 'title');
        const cached = createdEntryByTitle.get(title);
        if (cached) {
          emit({
            id: options.toolCallId,
            input: { title },
            status: 'done',
            summary: `Reused this run's Entry "${cached.title}" instead of creating a duplicate.`,
            toolName: 'create_entry'
          });
          return { entry_id: cached.id, idempotent_replay: true, kind: 'entry_created', title: cached.title };
        }
        const fingerprint = loopGuard?.beforeToolCall('create_entry', { title });
        emit({
          id: options.toolCallId,
          input: { title },
          status: 'running',
          summary: `Creating Entry "${title}".`,
          toolName: 'create_entry'
        });
        try {
          const entry = await onCreateEntry(title);
          createdEntryByTitle.set(title, entry);
          availableEntries.push(entry);
          loopGuard?.recordCreatedEntry(entry.id);
          loopGuard?.recordSuccess(entry);
          emit({
            id: options.toolCallId,
            input: { title },
            status: 'done',
            summary: `Created Entry "${entry.title}".`,
            toolName: 'create_entry'
          });
          return { entry_id: entry.id, kind: 'entry_created', title: entry.title };
        } catch (error) {
          if (fingerprint) loopGuard?.recordFailure(fingerprint);
          emit({
            error: errorMessage(error),
            id: options.toolCallId,
            input: { title },
            status: 'error',
            toolName: 'create_entry'
          });
          throw error;
        }
      }
    }) as ToolSet[string];
  }

  for (const descriptor of descriptors) {
    if (!SUPPORTED_TOOL_NAMES.has(descriptor.name) && !descriptor.name.startsWith('mcp.')) {
      continue;
    }
    if (!enabledToolIds.has(descriptor.name as AgentToolId)) {
      continue;
    }

    const exposedToolName = modelToolName(descriptor.name);
    assertModelToolNameAvailable(tools, descriptor.name, exposedToolName);
    tools[exposedToolName] = tool<unknown, unknown>({
      description: toolDescription(descriptor),
      inputSchema: jsonSchema<unknown>(modelInputSchema(descriptor)),
      execute: async (input, options) => {
        const toolName = descriptor.name;
        const toolCallId = options.toolCallId;
        let fingerprint: string | undefined;

        try {
          const normalizedInput = normalizeToolInput(toolName, input, { root, scope });
          fingerprint = loopGuard?.beforeToolCall(toolName, normalizedInput);
          emit({
            id: toolCallId,
            input: publicInput(normalizedInput),
            status: 'running',
            summary: runningSummary(toolName, normalizedInput),
            toolName
          });

          const output = await executeTool(toolName, normalizedInput, {
            addSource,
            contextBudget
          });
          observations.push({ output: output.modelOutput, toolName });
          loopGuard?.recordSuccess(output.modelOutput);

          emit({
            id: toolCallId,
            input: publicInput(normalizedInput),
            sources: output.sources,
            status: 'done',
            summary: output.summary,
            toolName
          });

          return output.modelOutput;
        } catch (error) {
          if (fingerprint) loopGuard?.recordFailure(fingerprint);
          emit({
            error: errorMessage(error),
            id: toolCallId,
            input,
            status: 'error',
            toolName
          });
          throw error;
        }
      }
    }) as ToolSet[string];
  }

  if (enabledToolIds.has('read_current_note')) {
    tools.read_current_note = tool<unknown, unknown>({
    description:
      'Read an explicitly selected Markdown note body and metadata. Use this only after the user has selected or confirmed the target note.',
    inputSchema: jsonSchema<unknown>(readCurrentNoteInputSchema()),
    execute: async (input, options) => {
      loopGuard?.beforeToolCall('read_current_note', input);
      const toolCallId = options.toolCallId;

      try {
        emit({
          id: toolCallId,
          input: publicInput(input),
          status: 'running',
          summary: 'Reading the selected Markdown note.',
          toolName: 'read_current_note'
        });

        const output = await readCurrentNoteOutput({
          contextSnapshot,
          contextBudget,
          currentNote,
          root
        });
        rememberReadNote(readNoteSnapshots, output.modelOutput);
        observations.push({ output: output.modelOutput, toolName: 'read_current_note' });
        loopGuard?.recordSuccess(output.modelOutput);

        emit({
          id: toolCallId,
          input: publicInput(input),
          status: 'done',
          summary: output.summary,
          toolName: 'read_current_note'
        });

        return output.modelOutput;
      } catch (error) {
        emit({
          error: errorMessage(error),
          id: toolCallId,
          input,
          status: 'error',
          toolName: 'read_current_note'
        });
        throw error;
      }
    }
  }) as ToolSet[string];
  }

  if (enabledToolIds.has('read_note')) {
    tools.read_note = tool<unknown, unknown>({
      description:
        'Read one explicitly referenced Markdown note by Entry id and note id. Use ids from the Typed Mention Map; this does not depend on the currently open note.',
      inputSchema: jsonSchema<unknown>({
        additionalProperties: false,
        properties: {
          entry_id: { type: 'string' },
          note_id: { type: 'string' }
        },
        required: ['entry_id', 'note_id'],
        type: 'object'
      } as JSONSchema7),
      execute: async (input, options) => {
        const object = asObject(input);
        const entryId = entryIdOrSingleScope(object.entry_id, scope);
        const noteId = requiredString(object.note_id, 'note_id');
        loopGuard?.beforeToolCall('read_note', { entry_id: entryId, note_id: noteId });
        emit({
          id: options.toolCallId,
          input: { entry_id: entryId, note_id: noteId },
          status: 'running',
          summary: 'Reading an explicitly referenced Markdown note.',
          toolName: 'read_note'
        });
        const note = await readNote(root, entryId, noteId);
        const markdown = trimToBudget(note.markdown, Math.min(36_000, contextBudget));
        readNoteSnapshots.set(noteSnapshotKey(entryId, noteId), {
          markdown: note.markdown,
          title: note.title
        });
        const output = {
          entry_id: entryId,
          kind: 'read_note',
          markdown,
          markdown_char_count: note.markdown.length,
          note_id: noteId,
          note_title: note.title,
          source_link_count: note.links.length,
          truncated: markdown.length < note.markdown.length
        };
        observations.push({ output, toolName: 'read_note' });
        loopGuard?.recordSuccess(output);
        emit({
          id: options.toolCallId,
          input: { entry_id: entryId, note_id: noteId },
          status: 'done',
          summary: `Read Markdown note "${note.title}".`,
          toolName: 'read_note'
        });
        return output;
      }
    }) as ToolSet[string];
  }

  const proposalToolNames = [
    'note.propose_create',
    'note.propose_patch',
    'segment_note.propose_patch'
  ] as const;
  for (const toolName of proposalToolNames) {
    if (!enabledToolIds.has(toolName) || !onNoteProposal) continue;
    const exposedToolName = modelToolName(toolName);
    assertModelToolNameAvailable(tools, toolName, exposedToolName);
    tools[exposedToolName] = tool<unknown, unknown>({
      description: proposalToolDescription(toolName),
      inputSchema: jsonSchema<unknown>(noteProposalInputSchema()),
      execute: async (input, options) => {
        loopGuard?.beforeToolCall(toolName, input);
        const normalizedInput = proposalToolInput(toolName, input, plan);
        const proposal = buildNoteProposal(normalizedInput, {
          assistantContext,
          availableEntries,
          contextSnapshot,
          currentEntry,
          currentNote,
          plan,
          readNoteSnapshots,
          scope,
          sourceByMarker
        });
        onNoteProposal(proposal);
        loopGuard?.recordSuccess({ proposal_id: proposal.id });
        emit({
          id: options.toolCallId,
          input: publicInput(normalizedInput),
          status: 'done',
          summary: noteProposalSummary(proposal),
          toolName
        });
        return {
          kind: 'note_proposal',
          proposal_id: proposal.id,
          summary: noteProposalSummary(proposal)
        };
      }
    }) as ToolSet[string];
  }

  if (enabledToolIds.has('entry.propose_meta_patch') && onEntryMetaProposal && plan) {
    const toolName = 'entry.propose_meta_patch';
    const exposedToolName = modelToolName(toolName);
    assertModelToolNameAvailable(tools, toolName, exposedToolName);
    tools[exposedToolName] = tool<unknown, unknown>({
      description: ENTRY_META_PROPOSAL_TOOL_DESCRIPTION,
      inputSchema: jsonSchema<unknown>(entryMetaProposalInputSchema()),
      execute: async (input, options) => {
        loopGuard?.beforeToolCall(toolName, input);
        const proposal = buildEntryMetaProposal(input, {
          entries: availableEntries,
          plan,
          sourceByMarker
        });
        onEntryMetaProposal(proposal);
        loopGuard?.recordSuccess({ proposal_id: proposal.id });
        emit({
          id: options.toolCallId,
          input: publicInput(input),
          status: 'done',
          summary: entryMetaProposalSummary(proposal),
          toolName
        });
        return {
          kind: 'entry_meta_proposal',
          proposal_id: proposal.id,
          summary: entryMetaProposalSummary(proposal)
        };
      }
    }) as ToolSet[string];
  }

  if (enabledToolIds.has('tag.propose_change') && onTagProposal) {
    const toolName = 'tag.propose_change';
    const exposedToolName = modelToolName(toolName);
    assertModelToolNameAvailable(tools, toolName, exposedToolName);
    tools[exposedToolName] = tool<unknown, unknown>({
      description:
        'Create a reviewable Tag change proposal. This never applies the Tag change directly.',
      inputSchema: jsonSchema<unknown>(tagProposalInputSchema()),
      execute: async (input, options) => {
        loopGuard?.beforeToolCall(toolName, input);
        const object = asObject(input);
        const action = requiredEnum(object.action, 'action', ['attach', 'create', 'detach', 'rename']);
        const proposal: AssistantTagProposal = {
          action,
          createdAt: new Date().toISOString(),
          entryIds: stringArray(object.entry_ids),
          id: `tag-proposal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: optionalString(object.name) ?? undefined,
          newName: optionalString(object.new_name) ?? undefined,
          rationale: optionalString(object.rationale) ?? undefined,
          status: 'pending',
          tagId: optionalString(object.tag_id) ?? undefined
        };
        if ((action === 'attach' || action === 'detach') && proposal.entryIds.length === 0) {
          throw new Error('Tag attach/detach proposals require entry_ids.');
        }
        onTagProposal(proposal);
        loopGuard?.recordSuccess({ proposal_id: proposal.id });
        emit({
          id: options.toolCallId,
          input: publicInput(input),
          status: 'done',
          summary: `Created a reviewable Tag ${action} proposal.`,
          toolName
        });
        return { kind: 'tag_proposal', proposal_id: proposal.id };
      }
    }) as ToolSet[string];
  }

  if (enabledToolIds.has('skill.search')) {
    tools.skill_search = tool<unknown, unknown>({
      description:
        'List loaded Neuink skill packages for the current agent. Use this when deciding which SKILL.md instructions to load before a larger task.',
      inputSchema: jsonSchema<unknown>(skillSearchInputSchema()),
      execute: async (input, options) => {
        const toolCallId = options.toolCallId;
        loopGuard?.beforeToolCall('skill.search', input);
        emit({
          id: toolCallId,
          input: publicInput(input),
          status: 'running',
          summary: 'Listing loaded skill packages for the current agent.',
          toolName: 'skill.search'
        });

        const output = searchSkillsOutput(input, activeExecution?.skillPackages ?? []);
        loopGuard?.recordSuccess(output.modelOutput);
        emit({
          id: toolCallId,
          input: publicInput(input),
          status: 'done',
          summary: output.summary,
          toolName: 'skill.search'
        });
        return output.modelOutput;
      }
    }) as ToolSet[string];
  }

  if (enabledToolIds.has('skill.load')) {
    tools.skill_load = tool<unknown, unknown>({
      description:
        'Load one Neuink skill package by id. Use this to fetch SKILL.md instructions before performing a report, synthesis, or slide generation task.',
      inputSchema: jsonSchema<unknown>(skillLoadInputSchema()),
      execute: async (input, options) => {
        const toolCallId = options.toolCallId;
        loopGuard?.beforeToolCall('skill.load', input);
        emit({
          id: toolCallId,
          input: publicInput(input),
          status: 'running',
          summary: 'Loading skill instructions.',
          toolName: 'skill.load'
        });
        const output = loadSkillOutput(input, activeExecution?.skillPackages ?? []);
        loopGuard?.recordSuccess(output.modelOutput);
        emit({
          id: toolCallId,
          input: publicInput(input),
          status: 'done',
          summary: output.summary,
          toolName: 'skill.load'
        });
        return output.modelOutput;
      }
    }) as ToolSet[string];
  }

  if (
    enabledToolIds.has('task.run_subagent') &&
    runtimeSettings &&
    activeExecution?.agent.permissions.canInvokeSubagents &&
    executionDepth < 2
  ) {
    tools.task_run_subagent = tool<unknown, unknown>({
      description:
        'Delegate the current task to an allowed Neuink subagent. Use this for report outlines, PPT outlines, evidence synthesis, or focused research subtasks.',
      inputSchema: jsonSchema<unknown>(runSubagentInputSchema(activeExecution)),
      execute: async (input, options) => {
        const toolCallId = options.toolCallId;
        loopGuard?.beforeToolCall('task.run_subagent', input);
        try {
          emit({
            id: toolCallId,
            input: publicInput(input),
            status: 'running',
            summary: 'Delegating a task to a subagent.',
            toolName: 'task.run_subagent'
          });

          const object = asObject(input);
          const agentId = requiredString(object.agent_id, 'agent_id');
          const instruction = requiredString(object.instruction, 'instruction');
          const resolvedAgent = resolveAllowedSubagents(runtimeSettings, activeExecution.agent).find(
            (candidate) => candidate.id === agentId
          );
          if (!resolvedAgent) {
            throw new Error('The selected subagent is not allowed for the current agent.');
          }

          const profile =
            profiles.find((item) => item.id === resolvedAgent.llmProfileId) ?? profiles[0];
          if (!profile) {
            throw new Error('No LLM profile is available for subagent execution.');
          }

          const result = await runSubagentTask({
            agentId,
            contextSnapshot,
            conversationHistory,
            currentNote,
            instruction,
            question: optionalString(object.question) ?? instruction,
            root,
            runtimeSettings,
            scope,
            settings: profile
          });
          loopGuard?.recordSuccess(result);
          const subagentSkillPackages = runtimeSettings.skillPackages.filter(
            (skillPackage) =>
              skillPackage.enabled &&
              resolvedAgent.allowedSkillPackageIds.includes(skillPackage.id)
          );

          emit({
            id: toolCallId,
            input: publicInput(input),
            sources: result.sources,
            status: 'done',
            summary: `Subagent ${resolvedAgent.name} completed its delegated task.`,
            toolName: 'task.run_subagent'
          });

          return {
            answer: result.answer,
            agent_id: resolvedAgent.id,
            agent_name: resolvedAgent.name,
            kind: 'subagent_result',
            sources: result.sources,
            skill_summary: buildAgentSystemPrompt(
              resolvedAgent,
              subagentSkillPackages
            ),
            trace: result.trace
          };
        } catch (error) {
          emit({
            error: errorMessage(error),
            id: toolCallId,
            input,
            status: 'error',
            toolName: 'task.run_subagent'
          });
          throw error;
        }
      }
    }) as ToolSet[string];
  }

  assertValidModelToolNames(tools);
  return {
    events,
    observations,
    sourceByMarker,
    toolNames: Object.keys(tools),
    tools
  };
}

export { entryIdOrSingleScope, modelToolName } from './toolSupport';
