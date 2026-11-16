import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import type { ScopeSnapshot } from '@/shared/ipc/assistantApi';
import { readNote, searchSegmentsBatch } from '@/shared/ipc/workspaceApi';
import { createAgentLoopState, AgentLoopGuard } from '../agent-core';
import {
  createAssistantTools,
  entryIdOrSingleScope,
  modelToolName,
  scopedEnabledToolIds
} from './tools';

vi.mock('@/shared/ipc/assistantApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/ipc/assistantApi')>()),
  listTools: vi.fn(async () => [])
}));
vi.mock('@/shared/ipc/workspaceApi', () => ({
  readNote: vi.fn(),
  searchSegmentsBatch: vi.fn()
}));

const scope = {
  entry_ids: ['entry-allowed'],
  entry_titles: ['Allowed'],
  tag_ids: [],
  tag_names: []
};

// Library entries the search may bind to. Selected ids must exist here, or the search stops for clarification.
const libraryEntries = [
  { id: 'entry-allowed', title: 'Allowed' },
  { id: 'entry-other', title: 'Other' }
] as never;

describe('search_library tool wiring', () => {
  const emptyBatch = (tasks: Array<{ task_id: string }>) => tasks.map((task) => ({
    task_id: task.task_id,
    results: { query: 'q', mode: 'hybrid', index_generation: 1, total_hit_count: 0, entries: [], warnings: [] }
  }));

  async function runSearchLibraryTool(
    input: Record<string, unknown>,
    frozenScope: ScopeSnapshot = scope,
    legacyScope: ScopeSnapshot = frozenScope
  ) {
    const runtime = await createAssistantTools({
      activeExecution: { agent: DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant },
      availableEntries: libraryEntries,
      root: 'C:/workspace',
      retrievalScope: frozenScope,
      scope: legacyScope,
      runtimeSettings: DEFAULT_AGENT_RUNTIME_SETTINGS
    });
    const execute = runtime.tools.search_library.execute as NonNullable<typeof runtime.tools.search_library.execute>;
    const output = await execute(input, { toolCallId: 'search-1', messages: [] } as never);
    return { runtime, output: output as Record<string, unknown> };
  }

  it('is registered by default for the main assistant', async () => {
    const runtime = await createAssistantTools({
      activeExecution: { agent: DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant },
      root: 'C:/workspace',
      scope,
      runtimeSettings: DEFAULT_AGENT_RUNTIME_SETTINGS
    });
    expect(runtime.toolNames).toContain('search_library');
  });

  it('defaults to planning and sends one batch call scoped to the frozen selection', async () => {
    vi.mocked(searchSegmentsBatch).mockReset().mockImplementation(async (_root, tasks) => emptyBatch(tasks));
    const { output } = await runSearchLibraryTool({ question: '论文 A 使用什么数据集？' });

    // No model is configured in this test, so the planner degrades; the reason proves planning was requested.
    expect(output.planning).toMatchObject({ status: 'degraded', reason: 'no_model_configured' });
    expect(searchSegmentsBatch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchSegmentsBatch).mock.calls[0][1]).toEqual([expect.objectContaining({
      task_id: 'direct',
      query: '论文 A 使用什么数据集？',
      mode: 'hybrid',
      scope_entry_ids: ['entry-allowed']
    })]);
  });

  it('turns planning off only for an explicit false', async () => {
    vi.mocked(searchSegmentsBatch).mockReset().mockImplementation(async (_root, tasks) => emptyBatch(tasks));
    const { output } = await runSearchLibraryTool({ question: '论文 A 使用什么数据集？', use_planning: false });
    expect(output.planning).toMatchObject({ status: 'disabled' });
  });

  it('never searches when the frozen scope is unresolved', async () => {
    vi.mocked(searchSegmentsBatch).mockReset();
    const { output } = await runSearchLibraryTool(
      { question: '论文 A 使用什么数据集？' },
      { ...scope, scope_intent: 'unresolved' }
    );
    expect(searchSegmentsBatch).not.toHaveBeenCalled();
    expect(String(output.warnings)).toContain('请先明确');
  });

  it('never searches for an explicit empty scope array', async () => {
    vi.mocked(searchSegmentsBatch).mockReset();
    const { output } = await runSearchLibraryTool({ question: '论文 A 使用什么数据集？', scope_entry_ids: [] });
    expect(searchSegmentsBatch).not.toHaveBeenCalled();
    expect(output.warnings).toContain('范围内没有可检索条目。');
  });

  it('searches only the retrieval scope even when the legacy run scope is the whole library', async () => {
    vi.mocked(searchSegmentsBatch).mockReset().mockImplementation(async (_root, tasks) => emptyBatch(tasks));
    const legacyLibrary = {
      entry_ids: ['entry-allowed', 'entry-other'],
      entry_titles: ['Allowed', 'Other'],
      tag_ids: [],
      tag_names: [],
      scope_intent: 'library' as const
    };
    await runSearchLibraryTool({ question: '论文 A 使用什么方法？', use_planning: false }, scope, legacyLibrary);
    expect(vi.mocked(searchSegmentsBatch).mock.calls[0][1]).toEqual([
      expect.objectContaining({ scope_entry_ids: ['entry-allowed'] })
    ]);
  });

  it('asks for clarification instead of using the legacy scope when no retrieval scope is supplied', async () => {
    vi.mocked(searchSegmentsBatch).mockReset();
    const runtime = await createAssistantTools({
      activeExecution: { agent: DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant },
      root: 'C:/workspace',
      scope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [], scope_intent: 'library' },
      runtimeSettings: DEFAULT_AGENT_RUNTIME_SETTINGS
    });
    const execute = runtime.tools.search_library.execute as NonNullable<typeof runtime.tools.search_library.execute>;
    const output = await execute({ question: '论文 A？', use_planning: false }, { toolCallId: 'search-2', messages: [] } as never) as Record<string, unknown>;
    expect(output.status).toBe('needs_clarification');
    expect(searchSegmentsBatch).not.toHaveBeenCalled();
  });
});

describe('Assistant tool scope', () => {
  it('accepts an Entry inside the frozen scope', () => {
    expect(entryIdOrSingleScope('entry-allowed', scope)).toBe('entry-allowed');
  });

  it('rejects an Entry outside the frozen scope', () => {
    expect(() => entryIdOrSingleScope('entry-other', scope)).toThrow(
      'outside the frozen Assistant scope'
    );
  });
});

describe('modelToolName', () => {
  it.each([
    ['entry.propose_meta_patch', 'entry_propose_meta_patch'],
    ['note.propose_create', 'note_propose_create'],
    ['segment_note.propose_patch', 'segment_note_propose_patch'],
    ['mcp.server.search-web', 'mcp_server_search-web']
  ])('normalizes %s to an OpenAI-compatible function name', (internalName, expected) => {
    const exposedName = modelToolName(internalName);

    expect(exposedName).toBe(expected);
    expect(exposedName).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe('scopedEnabledToolIds', () => {
  it('never lets a model-generated plan grant tools missing from the agent policy', () => {
    const tools = scopedEnabledToolIds(
      ['task.run_subagent'],
      null,
      {
        enabledToolIds: ['read_entry_assistant_context', 'entry.propose_meta_patch'],
        mainAssistantId: 'main-assistant', missing: [], mode: 'agent_execute', rationale: '',
        subagentTasks: [], writePolicy: 'proposal_only'
      }
    );

    expect(tools).toEqual([]);
  });
});

describe('model-driven side-effect tools', () => {
  it('always offers the host diagram presenter to the main agent and persists its artifact', async () => {
    const runtime = await createAssistantTools({
      activeExecution: { agent: DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant },
      invocationPlan: { enabledToolIds: [], mainAssistantId: 'main-assistant', missing: [],
        mode: 'agent_execute', rationale: '', subagentTasks: [], writePolicy: 'chat_only' },
      root: 'C:/workspace', scope, runtimeSettings: DEFAULT_AGENT_RUNTIME_SETTINGS
    });
    expect(runtime.toolNames).toContain('present_diagram');
    await (runtime.tools.present_diagram.execute as NonNullable<typeof runtime.tools.present_diagram.execute>)(
      { kind: 'mindmap', title: '整理', nodes: [{ id: 'root', label: '论文整理' }] },
      { toolCallId: 'diagram-1', messages: [] } as never
    );
    expect(runtime.events).toContainEqual(expect.objectContaining({ id: 'diagram-1', status: 'done',
      diagram: expect.objectContaining({ code: 'mindmap\n  n0["论文整理"]' }) }));
    expect(runtime.snapshot().events[0].diagram?.title).toBe('整理');
  });
  it('creates an Entry from model-chosen arguments and replays idempotently', async () => {
    const create = vi.fn(async (title: string) => ({
      description: '', id: 'entry-1', title, updatedAt: '2026-07-15T00:00:00Z'
    }));
    const state = createAgentLoopState('帮我取名并创建');
    const runtime = await createAssistantTools({
      activeExecution: {
        agent: { ...DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant, sandbox: 'workspace-write' }
      },
      invocationPlan: {
        enabledToolIds: ['create_entry'], mainAssistantId: 'main-assistant', missing: [],
        mode: 'agent_execute', rationale: '', subagentTasks: [],
        writePolicy: 'workspace_write'
      },
      loopGuard: new AgentLoopGuard(state),
      plan: { intent: 'entry_create' } as never,
      onCreateEntry: create,
      root: 'C:/workspace',
      scope,
      runtimeSettings: DEFAULT_AGENT_RUNTIME_SETTINGS
    });
    const execute = runtime.tools.create_entry.execute as NonNullable<
      typeof runtime.tools.create_entry.execute
    >;
    expect(runtime.tools.create_entry.needsApproval).toBe(true);
    const options = { toolCallId: 'call-1', messages: [] } as never;

    const first = await execute({ title: '软件工程论文学习' }, options);
    const replay = await execute({ title: '软件工程论文学习' }, options);

    expect(first).toMatchObject({ entry_id: 'entry-1', kind: 'entry_created' });
    expect(replay).toMatchObject({ entry_id: 'entry-1', idempotent_replay: true });
    expect(create).toHaveBeenCalledOnce();
    expect(state.createdEntryIds).toEqual(['entry-1']);
  });

  it('returns allowed Entry ids so the Agent can recover from a bad guess', () => {
    expect(() => entryIdOrSingleScope('entry-other', scope)).toThrow(
      'Allowed Entry ids: entry-allowed'
    );
  });

  it('reads an explicitly mentioned Note before creating a verified patch proposal', async () => {
    vi.mocked(readNote).mockResolvedValue({
      links: [], markdown: '# Existing\n\nOld text\n', note_id: 'note-1', revision: 'revision-1', title: '目标笔记'
    });
    const proposals: Array<{ beforeMarkdown?: string | null }> = [];
    const runtime = await createAssistantTools({
      activeExecution: { agent: DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant },
      invocationPlan: {
        enabledToolIds: ['read_note', 'note.propose_patch'], mainAssistantId: 'main-assistant',
        missing: [], mode: 'agent_execute', rationale: '', subagentTasks: [],
        writePolicy: 'proposal_only'
      },
      onNoteProposal: (proposal) => proposals.push(proposal),
      plan: {
        attachments: [], capabilities: ['read_note', 'propose_note'], confidence: 1,
        deliverables: ['chat_answer'], intent: 'general_qa', missing: [],
        needsCurrentNote: false, needsDocumentContext: false, needsNoteProposal: false,
        needsSegmentSearch: false, rationale: '', steps: [], target: { kind: 'chat_only' }
      },
      root: 'C:/workspace', scope, runtimeSettings: DEFAULT_AGENT_RUNTIME_SETTINGS
    });
    const options = { toolCallId: 'call-note', messages: [] } as never;
    await (runtime.tools.read_note.execute as NonNullable<typeof runtime.tools.read_note.execute>)(
      { entry_id: 'entry-allowed', note_id: 'note-1' }, options
    );
    await (runtime.tools.note_propose_patch.execute as NonNullable<
      typeof runtime.tools.note_propose_patch.execute
    >)({
      action: 'patch', entry_id: 'entry-allowed', note_id: 'note-1',
      patch_operations: [{ new_text: 'New text', old_text: 'Old text', type: 'replace_exact' }],
      target: 'markdown_note', title: '目标笔记'
    }, options);

    expect(proposals[0]?.beforeMarkdown).toContain('Old text');
  });
});
