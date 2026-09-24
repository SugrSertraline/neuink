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
import { invokeAssistantTool, listTools, listMcpTools } from '@/shared/ipc/assistantApi';
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
  mcpToolIdsForAgent,
  modelInputSchema,
  modelToolName,
  normalizeToolInput,
  noteProposalInputSchema,
  noteProposalSummary,
  noteSnapshotKey,
  numberMarkdownLines,
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
  stringArray,
  tagProposalInputSchema,
  toolDescription,
  trimToBudget
} from './toolSupport';

import type { AgentExecutionSelection, AgentRuntimeSettings, AgentToolId } from '@/shared/types/agentRuntime';
import {
  auditAgentToolPermissions,
  configuredAgentToolIds,
  buildAgentSystemPrompt,
  resolveAllowedSubagents
} from '@/shared/lib/agentRuntimeSettings';

import { assistantContextCharBudget } from './contextBudget';
import { runSubagentTask } from '../runtime/subagent';
import type { DurableExecution } from '../runtime/durableExecution';
import { stableHash } from '../runtime/evidenceLedger';
import { abortable, AgentStoppedError, RunBudget, type AgentLoopGuard } from '../agent-core';
import { SourceLedger } from '../runtime/sourceLedger';
import type { ApplicationActions } from '../runtime/applicationActions';
import { resolveModelProfile } from './modelTasks';
import { PLANNING_READ_TOOLS } from '../runtime/executionPolicy';
import { buildEntryMetaProposal } from './entryMetaProposal';
import {
  ENTRY_META_PROPOSAL_TOOL_DESCRIPTION,
  entryMetaProposalInputSchema,
  entryMetaProposalSummary
} from './entryMetaProposalTool';

const SUPPORTED_TOOL_NAMES = new Set([
  'search_segments',
  'read_segment_content',
  'read_entry_assistant_context',
  'search_sciverse_evidence',
  'read_sciverse_content',
  'search_sciverse_metadata',
  'get_sciverse_metadata_catalog',
  'search_sciverse_paper_schema',
  'get_sciverse_paper_schema'
]);

export function scopedEnabledToolIds(
  agentToolIds: AgentToolId[],
  activeExecution?: AgentExecutionSelection | null,
  invocationPlan?: AgentInvocationPlan | null
) {
  const planned = invocationPlan ? new Set(invocationPlan.enabledToolIds) : null;
  const candidates = [...new Set(agentToolIds)];

  return candidates.filter((toolId) => {
    if (invocationPlan?.executionMode === 'plan' && !PLANNING_READ_TOOLS.has(toolId)) return false;
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
  execution?: DurableExecution;
  actorId?: string;
  restoredState?: ToolRuntimeState;
  applicationActions?: ApplicationActions;
  abortSignal?: AbortSignal;
  budget?: RunBudget;
  sourceLedger?: SourceLedger;
  defaultProfile?: LlmProfile;
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
  snapshot: () => ToolRuntimeState;
  events: AssistantToolTraceEvent[];
  observations: Array<{ output: unknown; toolName: string }>;
  sourceByMarker: Map<number, ConversationSourceLink>;
  toolNames: string[];
  tools: ToolSet;
};

export type ToolRuntimeState = {
  events: AssistantToolTraceEvent[];
  observations: Array<{ output: unknown; toolName: string }>;
  createdEntries: Array<[string, AssistantEntryMetaTarget]>;
  readNotes: Array<[string, { markdown: string; title: string }]>;
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
  execution,
  actorId = 'main',
  restoredState,
  applicationActions,
  abortSignal,
  budget = new RunBudget(),
  sourceLedger,
  defaultProfile,
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
  abortSignal?.throwIfAborted();
  const descriptors = await listTools();
  for (const server of runtimeSettings?.mcpServers ?? []) {
    if (invocationPlan?.executionMode === 'plan' || !server.enabled || !activeExecution?.agent.allowedMcpServerIds?.includes(server.id) ||
        !activeExecution.agent.permissions.canInvokeTools) continue;
    const prefix = `mcp.${server.id}.`;
    const granted = configuredAgentToolIds(runtimeSettings!, activeExecution.agent);
    if (!granted.some(id => id.startsWith(prefix) && (!invocationPlan || invocationPlan.enabledToolIds.includes(id)))) continue;
    const catalog = await abortable(listMcpTools(root, server.id, abortSignal), abortSignal);
    abortSignal?.throwIfAborted();
    for (const item of catalog.tools) {
      descriptors.push({ name: `mcp.${server.id}.${item.name}`,
        description: item.description ?? item.name, parameters_schema: item.inputSchema });
    }
  }
  const events: AssistantToolTraceEvent[] = [...(restoredState?.events ?? [])];
  const observations: Array<{ output: unknown; toolName: string }> = [...(restoredState?.observations ?? [])];
  const ledger = sourceLedger ?? new SourceLedger(initialSourceByMarker);
  const sourceByMarker = ledger.sources;
  const addSource = (source: ConversationSourceLink) => {
    abortSignal?.throwIfAborted();
    return ledger.add(source);
  };

  const emit = (event: AssistantToolTraceEvent) => {
    if (abortSignal?.aborted) return;
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
  const createdEntryByTitle = new Map<string, AssistantEntryMetaTarget>(restoredState?.createdEntries);
  const readNoteSnapshots = new Map<string, { markdown: string; title: string }>(restoredState?.readNotes);

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

  if (enabledToolIds.has('app.set_appearance') && applicationActions && activeExecution?.agent.kind === 'main_assistant') {
    tools.app_set_appearance = tool({
      needsApproval: true,
      description: 'Change the application visual style only when requested by the user. standard=标准, atelier=工作室, liquid-glass=液态玻璃. This reversible local preference never changes documents or model settings.',
      inputSchema: jsonSchema<{ appearance: 'standard' | 'atelier' | 'liquid-glass' }>({
        type: 'object', properties: { appearance: { type: 'string', enum: ['standard', 'atelier', 'liquid-glass'] } },
        required: ['appearance'], additionalProperties: false
      }),
      execute: async (input, options) => {
        (options.abortSignal ?? abortSignal)?.throwIfAborted();
        const appearance = requiredEnum(asObject(input).appearance, 'appearance', ['standard', 'atelier', 'liquid-glass'] as const);
        loopGuard?.beforeToolCall('app.set_appearance', input);
        const result = applicationActions.setAppearance(appearance);
        emit({ id: options.toolCallId, toolName: 'app.set_appearance', status: 'done',
          summary: result.persisted ? `Appearance changed to ${result.current}.` : `Appearance changed for this session; preference could not be saved.` });
        return result;
      }
    });
  }

  const canPropose = activeExecution?.agent.permissions.canWriteProposals === true &&
    activeExecution.agent.sandbox !== 'read-only' && invocationPlan?.writePolicy === 'proposal_only';

  if (enabledToolIds.has('create_entry') && onCreateEntry &&
    activeExecution?.agent.kind === 'main_assistant' && activeExecution.agent.permissions.canWriteProposals &&
    activeExecution.agent.sandbox !== 'read-only' && (
      (invocationPlan?.writePolicy === 'workspace_write' && plan?.intent === 'entry_create') ||
      (invocationPlan?.executionMode === 'act' && invocationPlan.writePolicy === 'proposal_only')
    )) {
    tools.create_entry = tool<unknown, unknown>({
      needsApproval: true,
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
      // MCP declarations/annotations are not a trusted guarantee of read-only behavior.
      needsApproval: descriptor.name.startsWith('mcp.'),
      description: toolDescription(descriptor),
      inputSchema: jsonSchema<unknown>(modelInputSchema(descriptor)),
      execute: async (input, options) => {
        const toolName = descriptor.name;
        const toolCallId = options.toolCallId;
        let fingerprint: string | undefined;

        try {
          const normalizedInput = normalizeToolInput(toolName, input, { root, scope });
          assertToolPrerequisites(toolName, normalizedInput, observations);
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
            signal: options.abortSignal ?? abortSignal,
            contextBudget
          });
          (options.abortSignal ?? abortSignal)?.throwIfAborted();
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
        if ('snapshot' in output && output.snapshot) {
          const modelOutput = asObject(output.modelOutput);
          const entryId = optionalString(modelOutput.entry_id);
          const noteId = optionalString(modelOutput.note_id);
          if (entryId && noteId) {
            readNoteSnapshots.set(noteSnapshotKey(entryId, noteId), output.snapshot);
          }
        } else {
          rememberReadNote(readNoteSnapshots, output.modelOutput);
        }
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
          content_hash: stableHash(note.markdown),
          entry_id: entryId,
          kind: 'read_note',
          markdown,
          markdown_char_count: note.markdown.length,
          note_id: noteId,
          note_title: note.title,
          numbered_markdown: numberMarkdownLines(markdown),
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
    if (!canPropose || !enabledToolIds.has(toolName) || !onNoteProposal) continue;
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
        if (sourceByMarker.size > 0 && proposal.markdown.trim() && proposal.sources.length === 0) {
          throw new Error('A note drafted with available evidence must preserve valid inline source markers in the proposed content.');
        }
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

  if (canPropose && enabledToolIds.has('entry.propose_meta_patch') && onEntryMetaProposal && plan) {
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

  if (canPropose && enabledToolIds.has('tag.propose_change') && onTagProposal) {
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
          entryIds: [...new Set(stringArray(object.entry_ids))],
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
        if (proposal.entryIds.some(id => !availableEntries.some(entry => entry.id === id))) {
          throw new Error('标签提案包含未知条目，请先确认目标条目。');
        }
        if (action === 'create' && !proposal.name) throw new Error('创建标签需要名称。');
        if (action === 'rename' && (!proposal.tagId || !proposal.newName)) throw new Error('重命名标签需要明确的标签 ID 和新名称。');
        if ((action === 'attach' || action === 'detach') && !proposal.tagId && !proposal.name) throw new Error('请指定要添加或移除的标签。');
        proposal.entryTitles = Object.fromEntries(proposal.entryIds.map(id => [id, availableEntries.find(entry => entry.id === id)!.title]));
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

  if (
    enabledToolIds.has('task.run_subagent') &&
    runtimeSettings &&
    activeExecution?.agent.permissions.canInvokeSubagents &&
    resolveAllowedSubagents(runtimeSettings, activeExecution.agent).length > 0 &&
    executionDepth < budget.maxDepth
  ) {
    tools.task_run_subagent = tool<unknown, unknown>({
      description:
        'Delegate a focused evidence search or reading task to an enabled Neuink evidence subagent.',
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

          const profile = resolveModelProfile(resolvedAgent.llmProfileId, profiles, defaultProfile);

          const result = await runSubagentTask({
            execution,
            actorId: `${actorId}/${toolCallId}`,
            abortSignal: options.abortSignal ?? abortSignal,
            budget,
            sourceLedger: ledger,
            executionDepth: executionDepth + 1,
            parentAgent: { ...activeExecution.agent, enabledToolIds: [...enabledToolIds] },
            profiles,
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
          }).catch(error => {
            // Preserve the parent's pending delegation so resumption reuses this child actor,
            // rather than asking the model to create a different child with a new call id.
            if (execution) throw new AgentStoppedError('子任务执行中断，已保留检查点；继续任务将沿用原子任务和已完成的证据。');
            throw error;
          });
          loopGuard?.recordSuccess(result);
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
            agent_summary: buildAgentSystemPrompt(resolvedAgent),
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
    snapshot: () => ({ events, observations, createdEntries: [...createdEntryByTitle], readNotes: [...readNoteSnapshots] }),
    events,
    observations,
    sourceByMarker,
    toolNames: Object.keys(tools),
    tools
  };
}

export { entryIdOrSingleScope, modelToolName } from './toolSupport';

function assertToolPrerequisites(
  toolName: string,
  input: Record<string, unknown>,
  observations: Array<{ output: unknown; toolName: string }>
) {
  if (toolName !== 'read_sciverse_content') return;
  const searchedDocIds = new Set(
    observations
      .filter((observation) => observation.toolName === 'search_sciverse_evidence')
      .flatMap((observation) => {
        const output = asObject(observation.output);
        return Array.isArray(output.evidence)
          ? output.evidence.flatMap((item) => {
              const docId = optionalString(asObject(item).doc_id);
              return docId ? [docId] : [];
            })
          : [];
      })
  );
  const docId = requiredString(input.doc_id, 'doc_id');
  if (!searchedDocIds.has(docId)) {
    throw new Error(
      'read_sciverse_content requires a doc_id returned by search_sciverse_evidence earlier in this run.'
    );
  }
}
