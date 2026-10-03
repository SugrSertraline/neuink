import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBrowserTab } from '@/shared/ipc/browserApi';
import { readNote } from '@/shared/ipc/workspaceApi';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { listTools, type LlmProfile } from '@/shared/ipc/assistantApi';
import { createAssistantTools } from './tools';
import { agentExecutors } from './agentDriver';
import { createNeuinkModel } from './provider';
import { answerWithGroundedAgent } from './qna';
import { scriptedModel } from './testHelpers/model';
import { browserTabPromptMetadata } from './browserTabTool';
import { buildDirectExecution } from '../runtime/executionPolicy';
import { canReplayAssistantTool, DurableExecution } from '../runtime/durableExecution';
import { RunBudget } from '../agent-core';

vi.mock('@/shared/ipc/browserApi', () => ({ readBrowserTab: vi.fn() }));
vi.mock('@/shared/ipc/workspaceApi', async original => ({ ...await original<typeof import('@/shared/ipc/workspaceApi')>(), readNote: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  listTools: vi.fn(), loadPrompt: async () => '{{question}}\n{{document_context}}\n{{tool_notes}}' }));
vi.mock('@/shared/ipc/agentExecutionApi', () => ({ saveAgentExecution: vi.fn(async (_, record) => ({ ...record, revision: record.revision + 1 })) }));
vi.mock('./provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: () => ({}) }));
const target = { id: 'browser-1', title: 'Example article', url: 'https://example.org/article?token=private#secret', navigationId: 'nav-1' };
const snapshot = { title: target.title, url: 'https://example.org/article', text: 'Visible article evidence.',
  selection: 'Selected sentence.', truncated: false, capturedAt: '2026-10-03T00:00:00Z', limitations: ['Frames are excluded.'] };
const scope = { entry_ids: ['entry'], entry_titles: ['Web notes'], tag_ids: [], tag_names: [] };
const profile = { id: 'test', model: 'test', base_url: 'https://example.invalid', api_key: null } as LlmProfile;
function options(mode: 'act' | 'plan' = 'act') {
  const runtimeSettings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
  return { root: 'fixture', scope: structuredClone(scope), browserTabTarget: { ...target }, runtimeSettings,
    activeExecution: { agent: runtimeSettings.mainAssistant }, ...buildDirectExecution(runtimeSettings, 'Read this webpage', mode) };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTools).mockResolvedValue([]);
  vi.mocked(readBrowserTab).mockResolvedValue({ ...snapshot });
});

describe('frozen browser tab read capability', () => {
  it('is available only to the main assistant with its enabled grant and a captured target', async () => {
    expect((await createAssistantTools(options())).toolNames).toContain('read_browser_tab');
    expect((await createAssistantTools({ ...options(), browserTabTarget: null })).tools.read_browser_tab).toBeUndefined();
    expect((await createAssistantTools({ ...options(), activeExecution: null })).tools.read_browser_tab).toBeUndefined();
    expect((await createAssistantTools({ ...options(), executionDepth: 1 })).tools.read_browser_tab).toBeUndefined();
    const disabled = options();
    disabled.activeExecution.agent.enabledToolIds = ['read_note'];
    expect((await createAssistantTools(disabled)).tools.read_browser_tab).toBeUndefined();
    const noTools = options(); noTools.activeExecution.agent.permissions.canInvokeTools = false;
    expect((await createAssistantTools(noTools)).tools.read_browser_tab).toBeUndefined();
    const child = options();
    expect((await createAssistantTools({ ...child, activeExecution: { agent: {
      ...child.runtimeSettings.subagents[0], enabledToolIds: ['read_browser_tab']
    } } })).tools.read_browser_tab).toBeUndefined();
    expect(readBrowserTab).not.toHaveBeenCalled();
  });

  it('keeps read access in plan mode, classifies it replayable and preserves restored grant narrowing', async () => {
    const runtime = await createAssistantTools(options('plan'));
    expect(runtime.tools.read_browser_tab.needsApproval).not.toBe(true);
    expect(canReplayAssistantTool('read_browser_tab')).toBe(true);
    const restoredState = runtime.snapshot(); restoredState.toolNames = ['read_note'];
    expect((await createAssistantTools({ ...options(), restoredState })).tools.read_browser_tab).toBeUndefined();
  });

  it('freezes the target, accepts no model target override and records no body or private URL in traces', async () => {
    const input = options(); const runtime = await createAssistantTools(input);
    input.browserTabTarget.id = 'browser-2'; input.browserTabTarget.url = 'https://other.example/';
    const execute = agentExecutors(runtime.tools).read_browser_tab;
    await expect(execute({ id: 'browser-2' }, { id: 'bad' })).rejects.toMatchObject({ code: 'TOOL_INVALID_ARGUMENTS' });
    expect(readBrowserTab).not.toHaveBeenCalled();
    expect(await execute({}, { id: 'read' })).toMatchObject({ text: snapshot.text, url: snapshot.url,
      status: 'read', limitations: snapshot.limitations });
    expect(readBrowserTab).toHaveBeenCalledWith(target, undefined, 'text');
    expect(runtime.observations).toHaveLength(1);
    expect(runtime.events).toEqual([expect.objectContaining({ id: 'read', status: 'done', toolName: 'read_browser_tab' })]);
    expect(JSON.stringify(runtime.events)).not.toMatch(/Visible article|token=private|secret/);
    expect(runtime.sourceByMarker.size).toBe(0);
  });

  it('returns only the selected text, reports empty selection and bounds the model observation', async () => {
    const runtime = await createAssistantTools({ ...options(), contextBudget: 40 });
    const execute = agentExecutors(runtime.tools).read_browser_tab;
    expect(await execute({ mode: 'selection' }, { id: 'selection' })).toMatchObject({ text: 'Selected s', truncated: true });
    expect(readBrowserTab).toHaveBeenLastCalledWith(target, undefined, 'selection');
    expect(JSON.stringify(runtime.observations)).not.toContain(snapshot.text);
    vi.mocked(readBrowserTab).mockResolvedValueOnce({ ...snapshot, selection: '' });
    expect(await execute({ mode: 'selection' }, { id: 'empty' })).toMatchObject({ text: '', status: 'empty' });
  });

  it.each(['video_subtitles', 'video_metadata'] as const)('preserves the actual %s coverage and never forwards binary fields', async contentType => {
    vi.mocked(readBrowserTab).mockResolvedValueOnce({ ...snapshot, contentType, extractor: 'yt-dlp', pdfBase64: 'PRIVATE-BINARY',
      limitations: ['No audio or visual understanding.'] });
    const runtime = await createAssistantTools(options());
    const result = await agentExecutors(runtime.tools).read_browser_tab({}, { id: 'video' });
    expect(result).toMatchObject({ contentType, extractor: 'yt-dlp', limitations: ['No audio or visual understanding.'] });
    expect(JSON.stringify(runtime.observations)).not.toContain('PRIVATE-BINARY');
    expect(runtime.sourceByMarker.size).toBe(0);
    expect(runtime.events[0].summary).toContain(contentType === 'video_subtitles' ? '视频字幕' : '非视频内容');
  });

  it.each([{ start_page: 0 }, { page_count: 21 }, { start_page: 1.5 }, { start_page: '2' }])('rejects invalid PDF paging %j before reading', async input => {
    const runtime = await createAssistantTools(options());
    await expect(agentExecutors(runtime.tools).read_browser_tab(input, { id: 'bad' })).rejects.toMatchObject({ code: 'TOOL_INVALID_ARGUMENTS' });
    expect(readBrowserTab).not.toHaveBeenCalled();
  });

  it('ignores an IPC result arriving after cancellation', async () => {
    const controller = new AbortController();
    const runtime = await createAssistantTools({ ...options(), abortSignal: controller.signal });
    vi.mocked(readBrowserTab).mockImplementation(async () => { controller.abort(new Error('Cancelled')); return snapshot; });
    await expect(agentExecutors(runtime.tools).read_browser_tab({}, { id: 'cancel' })).rejects.toThrow('Cancelled');
    expect(runtime.observations).toEqual([]);
    expect(runtime.events.some(event => event.status === 'done')).toBe(false);
  });

  it('removes query, fragment and userinfo from model-facing target metadata', () => {
    expect(browserTabPromptMetadata({ ...target, url: 'https://user:password@example.org/path?token=private#secret' }))
      .toEqual({ title: target.title, url: 'https://example.org/path' });
  });
});

describe('browser read inside the real main agent loop', () => {
  it('does not read the body merely because the tab was submitted', async () => {
    const model = scriptedModel([{ text: '你好！' }]); vi.mocked(createNeuinkModel).mockReturnValue(model);
    await answerWithGroundedAgent({ ...options(), settings: profile, question: '你好' });
    expect(readBrowserTab).not.toHaveBeenCalled();
    const prompt = JSON.stringify(model.doStreamCalls[0].prompt);
    expect(prompt).toContain('no page body has been read');
    expect(prompt).toContain('untrusted source material');
    expect(prompt).not.toMatch(/token=private|#secret|Visible article evidence/);
  });

  it('counts a failed read in the budget and lets the assistant explain it without exposing raw errors', async () => {
    vi.mocked(readBrowserTab).mockRejectedValue(new Error('private backend response token=secret'));
    const model = scriptedModel([{ call: { name: 'read_browser_tab', args: {} } }, { text: '网页已变化，未能读取。请重新选择目标网页。' }]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const budget = new RunBudget();
    const execution = new DurableExecution('fixture', { id: 'browser-run', conversationId: 'conversation',
      revision: 0, status: 'running', updatedAt: '', payload: {} }, budget);
    const result = await answerWithGroundedAgent({ ...options(), settings: profile, question: 'Read webpage', budget, execution });
    expect(result.answer).toContain('未能读取');
    expect(result.hadRecoverableFailures).toBe(true);
    expect(result.toolEvents).toContainEqual(expect.objectContaining({ toolName: 'read_browser_tab', status: 'error' }));
    expect(budget.toolCalls).toBe(1); expect(budget.writesBlocked).toBe(false);
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('TOOL_EXECUTION_FAILED');
    expect(JSON.stringify(result)).not.toContain('token=secret');
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).not.toContain('private backend response');
  });

  it('reads webpage evidence and creates only a pending note proposal with a real URL', async () => {
    const markdown = 'Article summary. [Source](https://example.org/article)';
    const model = scriptedModel([{ call: { name: 'read_browser_tab', args: {} } },
      { call: { name: 'note_propose_create', args: { action: 'create', entry_id: 'entry', title: 'Web note', markdown } } },
      { text: '已准备笔记提案，请审核。' }]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const result = await answerWithGroundedAgent({ ...options(), settings: profile, question: 'Read this page and create a note in entry' });
    expect(result.noteProposals).toHaveLength(1);
    expect(result.noteProposals![0]).toMatchObject({ status: 'pending', entryId: 'entry', markdown, sources: [] });
    expect(result.agentLoopState?.status).toBe('awaiting_approval');
    expect(result.sources).toEqual([]);
  });

  it('can draft into the Entry just created after approval without broadening the original read scope', async () => {
    const input = options(); input.scope.entry_ids = []; input.scope.entry_titles = [];
    const markdown = 'Article summary. [Source](https://example.org/article)';
    const model = scriptedModel([{ call: { name: 'read_browser_tab', args: {} } },
      { call: { name: 'create_entry', args: { title: 'Web article' } } },
      { call: { name: 'note_propose_create', args: { action: 'create', entry_id: 'new-entry', title: 'Web note', markdown } } },
      { text: '条目已创建，笔记提案等待审核。' }]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const onCreateEntry = vi.fn(async () => ({ id: 'new-entry', title: 'Web article', description: '', updatedAt: '' }));
    const requestToolApproval = vi.fn(async () => true);
    const result = await answerWithGroundedAgent({ ...input, settings: profile, question: 'Create an Entry and webpage note', onCreateEntry, requestToolApproval });
    expect(requestToolApproval).toHaveBeenCalledOnce(); expect(onCreateEntry).toHaveBeenCalledOnce();
    expect(result.noteProposals![0]).toMatchObject({ status: 'pending', entryId: 'new-entry', sources: [] });
    expect(input.scope.entry_ids).toEqual([]);
  });

  it('cannot create an Entry or note when entry creation approval is rejected', async () => {
    const model = scriptedModel([{ call: { name: 'create_entry', args: { title: 'Web article' } } }]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const onCreateEntry = vi.fn(); const onNoteProposal = vi.fn();
    await expect(answerWithGroundedAgent({ ...options(), settings: profile, question: 'Create Entry',
      onCreateEntry, onNoteProposal, requestToolApproval: async () => false })).rejects.toThrow('拒绝');
    expect(onCreateEntry).not.toHaveBeenCalled(); expect(onNoteProposal).not.toHaveBeenCalled();
  });

  it('restores only approved created Entry destinations and keeps reads, patches and arbitrary Entries outside scope', async () => {
    const input = options(); input.scope.entry_ids = []; input.scope.entry_titles = [];
    const created = { id: 'approved-entry', title: 'Approved', description: '', updatedAt: '' };
    const onCreateEntry = vi.fn(async () => created); const onNoteProposal = vi.fn();
    const initial = await createAssistantTools({ ...input, onCreateEntry, onNoteProposal });
    await agentExecutors(initial.tools, async () => true).create_entry({ title: 'Approved' }, { id: 'create' });
    const restoredState = JSON.parse(JSON.stringify(initial.snapshot()));
    const restored = await createAssistantTools({ ...input, availableEntries: [], restoredState, onCreateEntry, onNoteProposal });
    const calls = agentExecutors(restored.tools);
    await calls.note_propose_create({ action: 'create', entry_id: created.id, markdown: 'Draft', title: 'Web note' }, { id: 'draft' });
    expect(onNoteProposal).toHaveBeenCalledOnce();
    expect(onNoteProposal).toHaveBeenCalledWith(expect.objectContaining({ entryId: created.id, entryTitle: created.title, status: 'pending' }));
    expect(onCreateEntry).toHaveBeenCalledOnce();
    await expect(calls.read_note({ entry_id: created.id, note_id: 'old-note' }, { id: 'read' })).rejects.toThrow('outside the frozen');
    await expect(calls.note_propose_patch({ action: 'append', entry_id: created.id, note_id: 'old-note', markdown: 'Change' }, { id: 'patch' }))
      .rejects.toThrow('outside the frozen');
    await expect(calls.note_propose_create({ action: 'create', entry_id: 'other-entry', markdown: 'Draft' }, { id: 'other' }))
      .rejects.toThrow('outside the frozen');
    expect(readNote).not.toHaveBeenCalled();
    expect(onNoteProposal).toHaveBeenCalledOnce(); expect(input.scope.entry_ids).toEqual([]);
    input.activeExecution.agent.enabledToolIds = ['read_browser_tab'];
    expect((await createAssistantTools({ ...input, restoredState, onNoteProposal })).tools.note_propose_create).toBeUndefined();
  });

  it('does not use a new Entry creation grant for a restored plan that requests an existing-note edit', async () => {
    const input = options(); input.scope.entry_ids = []; input.scope.entry_titles = [];
    input.plan.noteAction = 'append';
    const onNoteProposal = vi.fn();
    const restoredState = { toolNames: ['note_propose_create'], events: [], observations: [], readNotes: [],
      createdEntries: [['Approved', { id: 'approved-entry', title: 'Approved', description: '', updatedAt: '' }]] };
    const runtime = await createAssistantTools({ ...input, onNoteProposal, restoredState: restoredState as never });
    await expect(agentExecutors(runtime.tools).note_propose_create({ action: 'create', entry_id: 'approved-entry', note_id: 'old-note', markdown: 'Change' }, { id: 'draft' }))
      .rejects.toThrow('outside the frozen');
    expect(onNoteProposal).not.toHaveBeenCalled();
  });
});
