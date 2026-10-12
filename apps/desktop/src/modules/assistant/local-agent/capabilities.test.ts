// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runLocalAgent } from '@/shared/ipc/localAgentApi';
import { getAssistantContextSnapshot, loadAgentRuntimeSettings, listTools } from '@/shared/ipc/assistantApi';
import { readAgentExecution, saveAgentExecution, type AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';
import { readNote } from '@/shared/ipc/workspaceApi';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { setLocalAgentEnabled } from '@/shared/lib/localAgentSettings';
import { allowLocalAgentPermission } from '@/shared/lib/localAgentPermissions';
import { requestToolApproval } from '../runtime/toolApproval';
import { runLocalAgentHarness } from './runner';
import { CLAUDE_PROFILE } from './session';
import type { RunAssistantHarnessOptions } from '../harness/engine';

vi.mock('@/shared/ipc/localAgentApi', () => ({ runLocalAgent: vi.fn() }));
vi.mock('@/shared/ipc/agentExecutionApi', () => ({ readAgentExecution: vi.fn(), saveAgentExecution: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  getAssistantContextSnapshot: vi.fn(), loadAgentRuntimeSettings: vi.fn(), listTools: vi.fn() }));
vi.mock('@/shared/ipc/workspaceApi', () => ({ readNote: vi.fn() }));
const session = { type: 'local-agent', provider: 'claude', sessionId: '550e8400-e29b-41d4-a716-446655440000', initialized: false } as const;
const scope = { entry_ids: ['e1'], entry_titles: ['Paper'], tag_ids: ['t1'], tag_names: ['Time series'] };
const entry = { id: 'e1', title: 'Paper', description: 'Original', updatedAt: 'r1' };
const options = (extra: Partial<RunAssistantHarnessOptions> = {}): RunAssistantHarnessOptions => ({
  root: 'fixture', conversationId: 'conversation-1', question: '整理论文', settings: CLAUDE_PROFILE,
  scope, availableEntries: [entry], currentEntry: entry, ...extra
});
type Handler = Parameters<typeof runLocalAgent>[3];
async function call(handle: Handler, name: string, input: unknown, id = crypto.randomUUID()) {
  const result = await handle({ type: 'tool', name, input, id }) as { isError?: boolean; content: { text: string }[] };
  return { ...result, value: JSON.parse(result.content[0].text) };
}
let stored: AgentExecutionRecord;
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); setLocalAgentEnabled(true);
  vi.mocked(getAssistantContextSnapshot).mockResolvedValue({ active_entry: null, active_note: null, document: null, pinned_segments: [], warnings: [] });
  vi.mocked(loadAgentRuntimeSettings).mockResolvedValue(DEFAULT_AGENT_RUNTIME_SETTINGS);
  vi.mocked(listTools).mockResolvedValue([]);
  vi.mocked(saveAgentExecution).mockImplementation(async (_root, record) => {
    stored = structuredClone({ ...record, revision: record.revision + 1 }); return stored;
  });
  vi.mocked(readAgentExecution).mockImplementation(async () => structuredClone(stored));
  vi.mocked(readNote).mockResolvedValue({ note_id: 'n1', title: 'Note', markdown: 'Original', revision: 'r1', links: [] });
});

describe('local Agent capability parity and recovery', () => {
  it.each(['claude', 'codex', 'opencode'] as const)('%s returns reviewable metadata and tag proposals, without applying them', async provider => {
    vi.mocked(runLocalAgent).mockImplementation(async (request, _signal, _event, handle) => {
      expect(request.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['entry_propose_meta_patch', 'tag_propose_change']));
      const meta = await call(handle, 'entry_propose_meta_patch', { entry_id: 'e1', title: 'Revised', description: 'New summary' });
      expect(meta.isError).not.toBe(true);
      const tag = await call(handle, 'tag_propose_change', { action: 'attach', entry_ids: ['e1'], tag_id: 't1' });
      expect(tag.isError).not.toBe(true);
      return { result: '修改提案等待确认。' };
    });
    const result = await runLocalAgentHarness(options(), { ...session, provider }, vi.fn());
    expect(result.entryMetaProposals).toEqual([expect.objectContaining({ beforeTitle: 'Paper', afterTitle: 'Revised', status: 'pending', baseUpdatedAt: 'r1' })]);
    expect(result.tagProposals).toEqual([expect.objectContaining({ action: 'attach', status: 'pending', entryIds: ['e1'] })]);
    expect(result.taskState?.status).toBe('awaiting_approval');
  });

  it('corrects an invented citation in the same native session and fails closed after two corrections', async () => {
    vi.mocked(runLocalAgent).mockResolvedValueOnce({ result: '虚构来源 [S99]' }).mockImplementationOnce(async request => {
      expect(request.resume).toBe(true);
      expect(JSON.parse(request.prompt).correction).toContain('NO [S#] citation markers');
      return { result: '尚未取得可引用材料。' };
    });
    const result = await runLocalAgentHarness(options(), session, vi.fn());
    expect(result.answer).not.toContain('[S99]');
    expect(runLocalAgent).toHaveBeenCalledTimes(2);
    vi.mocked(runLocalAgent).mockReset().mockResolvedValue({ result: '仍然虚构 [S99]' });
    await expect(runLocalAgentHarness(options(), session, vi.fn())).rejects.toThrow('来源');
    expect(runLocalAgent).toHaveBeenCalledTimes(3);
    expect(stored.status).toBe('failed');
    expect(stored.payload.result).toBeUndefined();
  });

  it('uses the shared frozen mention map and conversation context, including tag entries', async () => {
    vi.mocked(runLocalAgent).mockImplementation(async request => {
      const prompt = JSON.parse(request.prompt);
      expect(prompt.harnessBrief).toContain('Earlier instruction');
      expect(prompt.harnessBrief).toContain('C1');
      expect(prompt.harnessBrief).toContain('e2');
      expect(prompt.harnessBrief).toContain('exhaustive');
      return { result: '已理解范围。' };
    });
    await runLocalAgentHarness(options({
      conversationHistory: [{ message_id: 'u1', role: 'user', content: 'Earlier instruction', created_at: '', source_links: [] }],
      composerSnapshot: { text: '阅读 [C1]', mentions: [{ id: 'm1', kind: 'tag', marker: 'C1', tagId: 't1', tagName: 'Time series',
        charOffset: 3, entryId: '', entryTitle: '', label: 'Time series' }] },
      tagMentionScopes: { t1: { ...scope, entry_ids: ['e1', 'e2'], entry_titles: ['Paper', 'Second paper'] } }
    }), session, vi.fn());
  });

  it.each(['plan', 'sandbox'] as const)('does not expose mutation proposals or permit native operations in %s', async mode => {
    if (mode === 'sandbox') vi.mocked(loadAgentRuntimeSettings).mockResolvedValue({ ...DEFAULT_AGENT_RUNTIME_SETTINGS,
      mainAssistant: { ...DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant, sandbox: 'read-only' } });
    allowLocalAgentPermission('fixture', { provider: 'claude', toolName: 'Bash' });
    const approve = vi.fn(requestToolApproval('fixture', 'conversation-1'));
    vi.mocked(runLocalAgent).mockImplementation(async (request, _signal, _event, handle) => {
      expect(request.tools.some(tool => /propose|create_entry/.test(tool.name))).toBe(false);
      expect((await call(handle, 'approve_tool', { tool_name: 'Bash', input: { command: 'write' } })).value.behavior).toBe('deny');
      return { result: '只读说明。' };
    });
    await runLocalAgentHarness(options({ requestToolApproval: approve,
      composerSnapshot: { text: '制定计划', mentions: [], executionMode: mode === 'plan' ? 'plan' : 'act' } }), session, vi.fn());
    expect(approve).not.toHaveBeenCalled();
  });

  it('restores a failed task with the original request and completed proposals, then redelivers without rerunning', async () => {
    vi.mocked(runLocalAgent).mockImplementationOnce(async (_request, _signal, event, handle) => {
      event({ type: 'message', value: { type: 'system', subtype: 'init', mcp_servers: [{ name: 'neuink', status: 'connected' }] } });
      await call(handle, 'entry_propose_meta_patch', { entry_id: 'e1', title: 'Revised' });
      throw new Error('Connection lost');
    });
    await expect(runLocalAgentHarness(options({ question: 'Original task' }), session, vi.fn())).rejects.toThrow('Connection lost');
    const id = stored.id;
    const proposal = (stored.payload.entryMetaProposals as { id: string }[])[0];
    vi.mocked(runLocalAgent).mockImplementationOnce(async (request, _signal, _event, handle) => {
      const prompt = JSON.parse(request.prompt);
      expect(prompt.request).toBe('Original task');
      expect(request.resume).toBe(true);
      expect(prompt.recovery.proposals).toContainEqual({ id: proposal.id, status: 'pending' });
      expect((await call(handle, 'entry_propose_meta_patch', { title: 'Revised', entry_id: 'e1' })).value.proposal_id).toBe(proposal.id);
      return { result: '提案等待确认。' };
    });
    const resumed = await runLocalAgentHarness(options({ resumeExecutionId: id, question: 'Changed prompt' }), session, vi.fn());
    expect(resumed.entryMetaProposals).toHaveLength(1);
    expect(resumed.agentRun?.executionId).toBe(id);
    const restoreSession = vi.fn();
    const redelivered = await runLocalAgentHarness(options({ resumeExecutionId: id }), session, restoreSession);
    expect(redelivered.entryMetaProposals?.[0].id).toBe(proposal.id);
    expect(restoreSession).toHaveBeenCalledWith({ ...session, initialized: true });
    expect(runLocalAgent).toHaveBeenCalledTimes(2);
  });

  it('does not rerun a completed entry creation after a lost CLI connection', async () => {
    const create = vi.fn(async () => entry), approve = vi.fn(async () => true);
    vi.mocked(runLocalAgent).mockImplementationOnce(async (_request, _signal, _event, handle) => {
      expect((await call(handle, 'create_entry', { title: 'Paper' })).isError).not.toBe(true);
      throw new Error('Connection lost');
    });
    await expect(runLocalAgentHarness(options({ onCreateEntry: create, requestToolApproval: approve }), session, vi.fn())).rejects.toThrow('Connection lost');
    const id = stored.id;
    vi.mocked(runLocalAgent).mockImplementationOnce(async (_request, _signal, _event, handle) => {
      expect((await call(handle, 'create_entry', { title: 'Paper' })).isError).not.toBe(true);
      return { result: '已创建条目。' };
    });
    await runLocalAgentHarness(options({ resumeExecutionId: id, onCreateEntry: create, requestToolApproval: approve }), session, vi.fn());
    expect(create).toHaveBeenCalledOnce(); expect(approve).toHaveBeenCalledOnce();
  });

  it('blocks new writes and native operations when a prior write outcome is unknown', async () => {
    const create = vi.fn(async () => { throw new Error('Transport lost after dispatch'); }), approve = vi.fn(async () => true);
    vi.mocked(runLocalAgent).mockImplementation(async (_request, _signal, _event, handle) => {
      expect((await call(handle, 'create_entry', { title: 'First' })).value.code).toBe('TOOL_OUTCOME_UNKNOWN');
      expect((await call(handle, 'create_entry', { title: 'Second' })).value.code).toBe('TOOL_WRITE_BLOCKED');
      expect((await call(handle, 'approve_tool', { tool_name: 'Bash', input: {} })).value.behavior).toBe('deny');
      return { result: '操作结果无法确认，需要先核对。' };
    });
    await runLocalAgentHarness(options({ onCreateEntry: create, requestToolApproval: approve }), session, vi.fn());
    expect(create).toHaveBeenCalledOnce(); expect(approve).toHaveBeenCalledOnce();
    expect(stored.payload.budget).toMatchObject({ uncertainWriteGate: true });
  });

  it('stops before model startup if the checkpoint cannot be saved', async () => {
    vi.mocked(saveAgentExecution).mockRejectedValue(new Error('os error 112'));
    await expect(runLocalAgentHarness(options(), session, vi.fn())).rejects.toThrow('磁盘空间');
    expect(runLocalAgent).not.toHaveBeenCalled();
  });
});
