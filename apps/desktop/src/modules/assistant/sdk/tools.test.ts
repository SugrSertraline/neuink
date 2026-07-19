import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { readNote } from '@/shared/ipc/workspaceApi';
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
  readNote: vi.fn()
}));

const scope = {
  entry_ids: ['entry-allowed'],
  entry_titles: ['Allowed'],
  tag_ids: [],
  tag_names: []
};

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
  it('adds tools required by the invocation plan to a stale agent preset', () => {
    const tools = scopedEnabledToolIds(
      ['skill.search', 'skill.load'],
      null,
      {
        enabledToolIds: ['read_entry_assistant_context', 'entry.propose_meta_patch'],
        mainAssistantId: 'main-assistant', missing: [], mode: 'agent_execute', rationale: '',
        skillIdsToLoad: [], subagentTasks: [], writePolicy: 'proposal_only'
      }
    );

    expect(tools).toContain('read_entry_assistant_context');
    expect(tools).toContain('entry.propose_meta_patch');
  });
});

describe('model-driven side-effect tools', () => {
  it('creates an Entry from model-chosen arguments and replays idempotently', async () => {
    const create = vi.fn(async (title: string) => ({
      description: '', id: 'entry-1', title, updatedAt: '2026-07-15T00:00:00Z'
    }));
    const state = createAgentLoopState('帮我取名并创建');
    const runtime = await createAssistantTools({
      activeExecution: {
        agent: DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant,
        skillPackages: []
      },
      invocationPlan: {
        enabledToolIds: ['create_entry'], mainAssistantId: 'main-assistant', missing: [],
        mode: 'agent_execute', rationale: '', skillIdsToLoad: [], subagentTasks: [],
        writePolicy: 'workspace_write'
      },
      loopGuard: new AgentLoopGuard(state),
      onCreateEntry: create,
      root: 'C:/workspace',
      scope,
      runtimeSettings: DEFAULT_AGENT_RUNTIME_SETTINGS
    });
    const execute = runtime.tools.create_entry.execute as NonNullable<
      typeof runtime.tools.create_entry.execute
    >;
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
      links: [], markdown: '# Existing\n\nOld text\n', note_id: 'note-1', title: '目标笔记'
    });
    const proposals: Array<{ beforeMarkdown?: string | null }> = [];
    const runtime = await createAssistantTools({
      activeExecution: { agent: DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant, skillPackages: [] },
      invocationPlan: {
        enabledToolIds: ['read_note', 'note.propose_patch'], mainAssistantId: 'main-assistant',
        missing: [], mode: 'agent_execute', rationale: '', skillIdsToLoad: [], subagentTasks: [],
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
