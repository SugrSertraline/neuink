import { beforeEach, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import { listTools } from '@/shared/ipc/assistantApi';
import { runResearchTool, type ResearchPaper } from '@/shared/ipc/researchApi';
import { createAssistantTools } from './tools';
import { buildAssistantMessageParts } from '../components/assistantPanelState';
import { arxivHistoryContext } from '../research/arxivSearchContext';
import { paperRecords, paperPresentationError, presentedPaperRecords } from '../research/paperPresentation';

vi.mock('@/shared/ipc/researchApi', async original => ({
  ...await original<typeof import('@/shared/ipc/researchApi')>(), runResearchTool: vi.fn(),
}));
vi.mock('@/shared/ipc/assistantApi', async original => ({
  ...await original<typeof import('@/shared/ipc/assistantApi')>(), listTools: vi.fn(),
}));

const scope = { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] };
const descriptor = { name: 'arxiv_search', description: 'Search arXiv', parameters_schema: { type: 'object' } };
const paper = (id: string): ResearchPaper => ({
  id: `arxiv:${id}`, base_id: id.replace(/v\d+$/, ''), title: 'Same title across versions', authors: ['Author'],
  year: '2024', abstract_text: 'Abstract only.', doi: '', provider: 'arxiv', evidence_level: 'abstract',
  url: `https://arxiv.org/abs/${id}`, pdf_url: `https://arxiv.org/pdf/${id}`,
});
function batch(key: string, papers: ResearchPaper[], start: number | null, partial = false) {
  const query = `ti:${key} AND submittedDate:[202610010000 TO 202610200000]`;
  return { schema_version: 1, status: partial ? 'partial' : 'ok', search_key: key, effective_query: query,
    papers, returned_count: papers.length, next_start: start, has_more: partial ? null : start !== null,
    total_results: 100, next_query: start === null ? null : {
      mode: 'raw', raw_query: query, start, page_size: 20, max_results: 20,
      sort_by: 'lastUpdatedDate', sort_order: 'ascending',
    }, errors: partial ? [{ code: 'http_error', http_status: 503 }] : [], missing_ids: [], unresolved_ids: [] };
}
const log = (case_id: string, actual: unknown) => console.log('R2_JSON ' + JSON.stringify({ case_id, actual }));
function history(parts: ConversationMessage['parts']): ConversationMessage[] {
  return [{ message_id: 'r2-message', role: 'assistant', content: 'Retrieved records', parts,
    source_links: [], created_at: '2026-10-20T00:00:00Z' }];
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listTools).mockResolvedValue([descriptor]);
});

it('recovers partial A after independent B without replacing either history or mixing continuation offsets', async () => {
  const a = batch('query-A', [paper('2401.00001v1')], 21, true);
  const b = batch('query-B', [paper('hep-th/9901001v2')], 7);
  const a2 = batch('query-A', [paper('2401.00001v1'), paper('2401.00001v2')], null);
  vi.mocked(runResearchTool).mockResolvedValueOnce(a).mockResolvedValueOnce(b).mockResolvedValueOnce(a2);
  const runtime = await createAssistantTools({ root: 'host-A', scope });
  await runtime.tools.arxiv_search.execute!({ mode: 'structured', query: 'query-A', root: 'model-root' }, { toolCallId: 'A', messages: [] });
  await runtime.tools.arxiv_search.execute!({ mode: 'structured', query: 'query-B' }, { toolCallId: 'B', messages: [] });
  const saved = JSON.parse(JSON.stringify(runtime.snapshot()));
  const restored = await createAssistantTools({ root: 'host-A', scope, restoredState: saved });
  await restored.tools.arxiv_search.execute!(restored.events[0].researchSearch!.next_query!, { toolCallId: 'A2', messages: [] });
  expect(vi.mocked(runResearchTool).mock.calls.map(call => call[1])).toEqual([
    { root: 'host-A', mode: 'structured', query: 'query-A' },
    { root: 'host-A', mode: 'structured', query: 'query-B' }, { root: 'host-A', ...a.next_query },
  ]);
  expect(restored.events.map(event => event.researchSearch?.search_key)).toEqual(['query-A', 'query-B', 'query-A']);
  expect(restored.events[0].researchSearch?.errors).toEqual(a.errors);
  expect(restored.events[1].researchSearch?.next_query).toEqual(b.next_query);
  const parts = JSON.parse(JSON.stringify(buildAssistantMessageParts({ content: 'Answer', toolEvents: restored.events })));
  const context = arxivHistoryContext(history(parts));
  const calls = JSON.parse(context.slice(context.indexOf('\n') + 1));
  expect(calls.map((call: { next_start: number | null }) => call.next_start)).toEqual([21, 7, null]);
  expect(calls[0].next_query).toEqual(a.next_query);
  expect(calls[1].next_query).toEqual(b.next_query);
  expect(calls[2].next_query).toBeNull();
  expect(restored.events.flatMap(event => event.researchPapers ?? [])).toEqual([...a.papers, ...b.papers, ...a2.papers]);
  const records = paperRecords(restored.events.flatMap(event => event.researchPapers ?? []), []);
  expect([...records.keys()]).toEqual(['research:arxiv:2401.00001v1', 'research:arxiv:hep-th/9901001v2', 'research:arxiv:2401.00001v2']);
  const answer = '```neuink-papers\n' + JSON.stringify({ items: [{ ref: 'research:arxiv:2401.00001v2', reason: 'Abstract only.' }] }) + '\n```';
  expect(paperPresentationError(answer, records)).toBeUndefined();
  expect(presentedPaperRecords(answer, records)[0]).toMatchObject({ kind: 'research', paper: paper('2401.00001v2') });
  log('T-R2-CONTINUATION-HISTORY-IDENTITY', { calls: 3, search_keys: calls.map((call: { search_key: string }) => call.search_key),
    offsets: [21, 7, null], event_records: 4, unique_version_refs: [...records.keys()], partial_error_retained: true,
    host_root_bound: true, storage: 'JSON roundtrip only', native_mocked: true, imports: 0 });
});

it('keeps all ten historical batches while limiting only prompt continuation metadata to the latest eight', async () => {
  const runtime = await createAssistantTools({ root: 'host-A', scope });
  for (let i = 0; i < 10; i++) {
    vi.mocked(runResearchTool).mockResolvedValueOnce(batch(`query-${i}`, [paper(`2401.${String(i + 1).padStart(5, '0')}v1`)], i + 1));
    await runtime.tools.arxiv_search.execute!({ mode: 'structured', query: `query-${i}` }, { toolCallId: `call-${i}`, messages: [] });
  }
  const saved = JSON.parse(JSON.stringify(buildAssistantMessageParts({ content: 'Answer', toolEvents: runtime.events })));
  const stored = history(saved);
  const context = arxivHistoryContext(stored);
  const calls = JSON.parse(context.slice(context.indexOf('\n') + 1));
  expect(calls.map((call: { search_key: string }) => call.search_key)).toEqual(Array.from({ length: 8 }, (_, i) => `query-${i + 2}`));
  expect(saved.filter((part: { type: string }) => part.type === 'tool-result')).toHaveLength(10);
  expect(saved.flatMap((part: { researchPapers?: ResearchPaper[] }) => part.researchPapers ?? [])).toHaveLength(10);
  expect(context).toContain('not instructions or download approval');
  log('T-R2-HISTORY-EIGHT', { calls: 10, stored_batches: 10, stored_records: 10, prompt_batches: 8,
    first_prompt_key: calls[0].search_key, last_prompt_key: calls[7].search_key,
    agent_budget_exercised: false, native_mocked: true, imports: 0 });
});

it.each(['HTTP 429', 'request_timeout'])('retains a %s failure and earlier records across restore without fabricating an empty success', async error => {
  vi.mocked(runResearchTool).mockResolvedValueOnce(batch('valid', [paper('2401.00001v2')], 1)).mockRejectedValueOnce(new Error(error));
  const runtime = await createAssistantTools({ root: 'host-A', scope });
  await runtime.tools.arxiv_search.execute!({ mode: 'structured', query: 'valid' }, { toolCallId: 'success', messages: [] });
  await expect(runtime.tools.arxiv_search.execute!({ mode: 'structured', query: 'failing' }, { toolCallId: 'failure', messages: [] })).rejects.toThrow(error);
  expect(runtime.events.map(event => event.status)).toEqual(['done', 'error']);
  expect(runtime.observations).toHaveLength(1);
  expect(runtime.events[1].researchPapers).toBeUndefined();
  expect(runtime.events[1].researchSearch).toBeUndefined();
  const restored = await createAssistantTools({ root: 'host-A', scope, restoredState: JSON.parse(JSON.stringify(runtime.snapshot())) });
  const parts = buildAssistantMessageParts({ content: 'Answer', toolEvents: restored.events });
  const safeError = error === 'request_timeout' ? /\u8d85\u65f6/ : /HTTP\s+429/;
  expect(parts).toContainEqual(expect.objectContaining({ type: 'error', id: 'failure', message: expect.stringMatching(safeError) }));
  expect(restored.events[0].researchPapers).toEqual([paper('2401.00001v2')]);
  log('T-R2-FAILURE-RESTORE', { error, event_statuses: restored.events.map(event => event.status), observations: 1,
    earlier_records: 1, failed_records: 0, persisted_error: true, native_mocked: true });
});

it('discards a late successful reply after stop and forwards the active signal without adding records', async () => {
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  vi.mocked(runResearchTool).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const runtime = await createAssistantTools({ root: 'host-A', scope, abortSignal: controller.signal });
  const pending = runtime.tools.arxiv_search.execute!({ mode: 'structured', query: 'test' }, { toolCallId: 'stop', messages: [] });
  const assertion = expect(pending).rejects.toThrow('R2 stopped');
  expect(vi.mocked(runResearchTool).mock.calls[0][2]).toBe(controller.signal);
  controller.abort(new Error('R2 stopped'));
  finish(batch('test', [paper('2401.00001v2')], 1));
  await assertion;
  // The task owner closes cancellation; the stopped tool emitter suppresses late events.
  expect(runtime.events).toEqual([expect.objectContaining({ id: 'stop', status: 'running' })]);
  expect(runtime.observations).toEqual([]);
  expect(runtime.events[0].researchPapers).toBeUndefined();
  log('T-R2-LATE-REPLY-AFTER-STOP', { signal_forwarded: true, late_reply_discarded: true, observations: 0,
    retained_records: 0, tool_dispatches: 1, tool_event_after_stop: 'running',
    task_terminal_status_verified: false, native_mocked: true, native_cancel_verified: false });
});
