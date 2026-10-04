import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAssistantHarness } from './engine';
import { readBrowserTab } from '@/shared/ipc/browserApi';
import { getAssistantContextSnapshot, type ConversationMessage, type LlmProfile } from '@/shared/ipc/assistantApi';
import { readAgentExecution, saveAgentExecution, type AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';
import { createNeuinkModel } from '../sdk/provider';
import { scriptedModel } from '../sdk/testHelpers/model';
import type { AssistantActiveSurfaceSnapshot } from '@/shared/types/assistant';
import { planAssistantContext } from './contextPlanner';

vi.mock('../sdk/provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: () => ({}) }));
vi.mock('@/shared/ipc/browserApi', () => ({ readBrowserTab: vi.fn() }));
vi.mock('@/shared/ipc/assistantRoutingApi', () => ({ getAssistantRouteSignals: vi.fn(async () => ({ status: 'unavailable', scores: [] })) }));
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  getAssistantContextSnapshot: vi.fn(), loadAgentRuntimeSettings: async () => null,
  loadPrompt: async () => '{{question}}', listTools: async () => [] }));
vi.mock('@/shared/ipc/agentExecutionApi', () => ({ saveAgentExecution: vi.fn(), readAgentExecution: vi.fn() }));

const browserTab = { id: 'tab-frozen', title: 'Original article', url: 'https://example.org/article?session=private', navigationId: 'nav-frozen' };
const currentSurface: AssistantActiveSurfaceSnapshot = {
  kind: 'browser', capturedAt: '2026-10-03T00:00:00Z', entryId: null, noteId: null, pane: 'right',
  segmentUid: null, surfaceKey: 'browser:tab-frozen', browserTab
};
const options = { root: 'fixture', conversationId: '7ifDV_d90PAk6BE9', question: 'Read this webpage', currentSurface,
  abortSignal: new AbortController().signal,
  settings: { id: 'test', model: 'test', base_url: 'https://example.invalid', max_context_length: 64000 } as LlmProfile,
  scope: { entry_ids: ['entry'], entry_titles: ['Web notes'], tag_ids: [], tag_names: [] } };
const oldPaperMention = { charOffset: 0, entryId: 'old-paper', entryTitle: 'Old paper', id: 'paper-ref',
  kind: 'pdf' as const, label: 'Old paper PDF', marker: '[C1]' };
const oldPaperHistory: ConversationMessage[] = [{ message_id: 'old-request', role: 'user', created_at: '',
  content: 'Summarize [C1]', source_links: [], parts: [{ type: 'context-snapshot', items: [],
    composer: { text: 'Summarize [C1]', mentions: [oldPaperMention] } }] }];
let stored: AgentExecutionRecord;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAssistantContextSnapshot).mockResolvedValue({ active_entry: null, active_note: null, document: null,
    pinned_segments: [], warnings: [] });
  vi.mocked(readBrowserTab).mockResolvedValue({ title: browserTab.title, url: 'https://example.org/article',
    text: 'The page describes a reading workflow.', selection: '', capturedAt: currentSurface.capturedAt,
    truncated: false, limitations: [] });
  vi.mocked(saveAgentExecution).mockImplementation(async (_, record) => {
    stored = structuredClone({ ...record, revision: record.revision + 1 }); return structuredClone(stored);
  });
  vi.mocked(readAgentExecution).mockImplementation(async () => structuredClone(stored));
});

describe('browser surface through the durable harness', () => {
  it('keeps a greeting with browser context in the normal agent without reading the page automatically', async () => {
    const model = scriptedModel([{ text: '你好！' }]); vi.mocked(createNeuinkModel).mockReturnValue(model);
    await runAssistantHarness({ ...options, question: '你好' });
    expect(stored.payload.requestRoute).toMatchObject({ path: 'main_agent', reason: 'context' });
    expect(JSON.stringify(model.doStreamCalls[0].tools)).toContain('read_browser_tab');
    expect(readBrowserTab).not.toHaveBeenCalled();
    expect(getAssistantContextSnapshot).toHaveBeenCalledWith(expect.objectContaining({ activeEntryId: null, activeNote: null }));
  });

  it('passes the exact frozen tab to reading and verifies the URL-cited pending proposal', async () => {
    const markdown = 'Reading workflow. [Source](https://example.org/article)';
    vi.mocked(createNeuinkModel).mockReturnValue(scriptedModel([
      { call: { name: 'read_browser_tab', args: {} } },
      { call: { name: 'note_propose_create', args: { action: 'create', entry_id: 'entry', title: 'Web note', markdown } } },
      { text: '笔记提案已准备，请审核。' }
    ]));
    const answer = await runAssistantHarness(options);
    expect(readBrowserTab).toHaveBeenCalledWith(browserTab, options.abortSignal, 'text');
    expect(answer.taskState?.status).toBe('awaiting_approval');
    expect(answer.noteProposals![0]).toMatchObject({ status: 'pending', markdown, sources: [], proposalDigest: expect.any(String) });
  });

  it.each([false, true])('accepts a webpage-only note after a historical PDF (explicit Entry destination=%s)', async explicitDestination => {
    const markdown = 'Reading workflow. [Source](https://example.org/article)';
    vi.mocked(createNeuinkModel).mockReturnValue(scriptedModel([
      { call: { name: 'read_browser_tab', args: {} } },
      { call: { name: 'note_propose_create', args: { action: 'create', entry_id: 'entry', title: 'Web note', markdown } } },
      { text: '网页笔记提案已准备，请审核。' }
    ]));
    const onNoteProposal = vi.fn();
    const composerSnapshot = { text: '只把当前网页整理成笔记到 [C2]', mentions: explicitDestination
      ? [{ ...oldPaperMention, id: 'destination', kind: 'entry' as const, entryId: 'entry', marker: '[C2]' }] : [] };
    const assistantContext = { items: explicitDestination ? [{ id: 'destination', kind: 'entry' as const,
      contentKind: 'entry' as const, entryId: 'entry', entryTitle: 'Web notes', addedAt: '' }] : [] };
    const answer = await runAssistantHarness({ ...options, conversationHistory: oldPaperHistory,
      composerSnapshot, assistantContext,
      contextPlan: planAssistantContext({ composerSnapshot, items: assistantContext.items, question: composerSnapshot.text }),
      onNoteProposal });
    expect(answer.noteProposals![0]).toMatchObject({ status: 'pending', markdown, sources: [], proposalDigest: expect.any(String) });
    expect(onNoteProposal).toHaveBeenCalledOnce();
  });

  it.each(['pdf', 'tag', 'segment', 'reflow', 'overview'] as const)('still rejects a URL-only note when the current request explicitly includes %s evidence', async kind => {
    vi.mocked(createNeuinkModel).mockReturnValue(scriptedModel([
      { call: { name: 'read_browser_tab', args: {} } },
      { call: { name: 'note_propose_create', args: { action: 'create', entry_id: 'entry', title: 'Mixed note',
        markdown: 'Mixed conclusions. [Web source](https://example.org/article)' } } },
      { text: '已准备混合资料笔记。' }
    ]));
    const onNoteProposal = vi.fn();
    await expect(runAssistantHarness({ ...options, conversationHistory: oldPaperHistory, onNoteProposal,
      composerSnapshot: { text: '结合当前网页和 [C1] 整理笔记', mentions: [{ ...oldPaperMention, kind }] }
    })).rejects.toThrow('without a valid source citation');
    expect(onNoteProposal).not.toHaveBeenCalled();
  });

  it('restores the submitted browser context across recovery instead of reading the newly focused tab', async () => {
    vi.mocked(createNeuinkModel).mockImplementationOnce(() => { throw new Error('provider unavailable'); });
    await expect(runAssistantHarness(options)).rejects.toThrow('provider unavailable');
    const savedId = stored.id;
    vi.mocked(createNeuinkModel).mockReturnValue(scriptedModel([
      { call: { name: 'read_browser_tab', args: {} } }, { text: '网页描述阅读流程。 [来源](https://example.org/article)' }
    ]));
    await runAssistantHarness({ ...options, resumeExecutionId: savedId, currentSurface: {
      ...currentSurface, browserTab: { ...browserTab, id: 'new-tab', url: 'https://other.example/', navigationId: 'nav-new' }
    } });
    expect(readBrowserTab).toHaveBeenCalledWith(browserTab, options.abortSignal, 'text');
    expect(stored.payload.input).toMatchObject({ currentSurface: { browserTab } });
  });
});
