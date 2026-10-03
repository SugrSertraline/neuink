import { afterEach, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { AssistantActiveSurfaceSnapshot, AssistantContextItem } from '@/shared/types/assistant';
import { resolveAssistantReadingContext, type AssistantReadingChoice } from './assistantReadingContext';
import { finishAssistantBackgroundRun, getAssistantMessageQueues, queueAssistantBackgroundRun,
  setAssistantBackgroundRun, type AssistantBackgroundRunSnapshot } from './assistantBackgroundRuns';
import type { QueuedAssistantDraft } from './assistantRunController';

const entry = { id: 'paper', title: 'Paper', contents: [{ kind: 'note', note_id: 'note', title: 'Note' }],
  tagIds: [], tags: [], fields: {}, createdAt: '', updatedAt: '', pdfFileName: 'paper.pdf',
  parseMessage: null, parseEndpoint: null, status: 'Parsed', progress: 100 } as LibraryEntry;
const surface: AssistantActiveSurfaceSnapshot = { kind: 'browser', surfaceKey: 'browser:web', entryId: null,
  noteId: null, segmentUid: null, pane: 'right', capturedAt: '2026-10-03T00:00:00Z',
  browserTab: { id: 'web', url: 'https://example.org/paper', title: 'Paper page', navigationId: 'first-document' } };
const base = { entries: [entry], tags: [{ id: 'tag', name: 'Tag', parent_id: null, created_at: '', updated_at: '' }],
  items: [] as AssistantContextItem[], activeEntry: null, activeNote: null, activeSegment: null, activeSurface: surface };

afterEach(() => setAssistantBackgroundRun(null));

it('offers a ready webpage with an explicit model sharing notice and no body attachment', () => {
  const resolved = resolveAssistantReadingContext({ ...base, choice: null });
  expect(resolved.label).toBe('网页 · Paper page');
  expect(resolved.notice).toContain('发送给已配置的模型');
  expect(resolved.notice).toContain('不关联内容');
  expect(resolved).toMatchObject({ entry: null, note: null, segment: null, bound: false, unavailable: false });
  expect(resolved.surface.browserTab).toEqual(surface.browserTab);
  expect(Object.keys(resolved.surface.browserTab!).sort()).toEqual(['id', 'navigationId', 'title', 'url']);
});

it.each<AssistantReadingChoice>(['none', { entryId: 'paper' }, { entryId: 'paper', contentKind: 'pdf' },
  { entryId: 'paper', noteId: 'note' }, { tagId: 'tag' }])('clears browser identity when the reading choice is %j', choice => {
  const resolved = resolveAssistantReadingContext({ ...base, choice });
  expect(resolved.surface.browserTab).toBeUndefined();
  expect(resolved.notice).toBeUndefined();
  expect(resolved.unavailable).toBe(false);
});

it('gives attached selections priority and does not carry the browser target into their snapshot', () => {
  const items: AssistantContextItem[] = [{ kind: 'segment', id: 'selection:paper', entryId: 'paper', entryTitle: 'Paper',
    segmentUid: 'segment', pageIdx: 0, text: 'Selected paragraph', addedAt: '' }];
  expect(resolveAssistantReadingContext({ ...base, choice: null, items })).toMatchObject({ entry,
    segment: { text: 'Selected paragraph' }, surface: { kind: 'entry-overview', entryId: 'paper' } });
  expect(resolveAssistantReadingContext({ ...base, choice: null, items }).surface.browserTab).toBeUndefined();
});

it('keeps ordinary chat available before a webpage is ready without claiming it is readable', () => {
  const resolved = resolveAssistantReadingContext({ ...base, choice: null, activeSurface: { ...surface, browserTab: undefined } });
  expect(resolved).toMatchObject({ unavailable: false, label: '网页（尚未就绪）' });
  expect(resolved.notice).toContain('等待加载完成');
});

it('freezes queued webpage identity even when the active tab and caller snapshot later change', async () => {
  const run: AssistantBackgroundRunSnapshot = { root: 'browser-context-test', conversationId: 'conversation', question: 'first',
    error: null, abortController: new AbortController(), streamingMessageId: 'reply', toolEventsByMessageId: {}, noteProposalsByMessageId: {},
    conversation: { id: 'conversation', title: 'Chat', created_at: '', updated_at: '', messages: [],
      scope_snapshot: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] } } };
  setAssistantBackgroundRun(run);
  const submitted = structuredClone(surface);
  const draft: QueuedAssistantDraft = { activeEntry: null, activeNote: null, activeSegment: null, activeSurface: submitted,
    question: 'Read this page', snapshot: { mentions: [], text: 'Read this page' }, contextItems: [], contextPlan: null,
    scope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] } };
  const next = vi.fn();
  expect(queueAssistantBackgroundRun(run.abortController, draft, next)).toBe(true);
  submitted.browserTab!.url = 'https://example.org/other';
  submitted.browserTab!.navigationId = 'second-document';
  expect(getAssistantMessageQueues(run.root)[0].items[0].draft.activeSurface.browserTab).toEqual(surface.browserTab);
  finishAssistantBackgroundRun(run.abortController);
  await Promise.resolve();
  expect(next).toHaveBeenCalledOnce();
  expect(next.mock.calls[0][1].activeSurface.browserTab).toEqual(surface.browserTab);
});
