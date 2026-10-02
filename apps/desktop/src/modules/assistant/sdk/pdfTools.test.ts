import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectPdfText, readAssistantPdfBytes, cachePdfText, type PdfTextInfo } from '@/shared/ipc/pdfTextApi';
import { extractPdfText } from './pdfTextExtractor';
import { formatPdfOutput, loadPdfPages } from './pdfTools';
import { executeTool, normalizeToolInput } from './toolSupport';
import { invokeAssistantTool, listTools, type ConversationSourceLink } from '@/shared/ipc/assistantApi';
import { DEFAULT_AGENT_RUNTIME_SETTINGS, normalizeAgentRuntimeSettings } from '@/shared/lib/agentRuntimeSettings';
import { buildDirectExecution } from '../runtime/executionPolicy';
import { createAssistantTools } from './tools';
import { canReplayAssistantTool } from '../runtime/durableExecution';
vi.mock('@/shared/ipc/pdfTextApi', () => ({ inspectPdfText: vi.fn(), readAssistantPdfBytes: vi.fn(), cachePdfText: vi.fn() }));
vi.mock('./pdfTextExtractor', async original => ({ ...await original<typeof import('./pdfTextExtractor')>(), extractPdfText: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(), invokeAssistantTool: vi.fn(), listTools: vi.fn(async () => []) }));
const info: PdfTextInfo = { entry_id: 'paper', entry_title: 'Paper', revision: 'a'.repeat(64), page_count: null, pages: [] };
const pages = [{ page_idx: 0, text: 'Paper shows 42 participants. 中文摘要。', truncated: false }, { page_idx: 1, text: '', truncated: false }];
const scope = { entry_ids: ['paper'], entry_titles: ['Paper'], tag_ids: [], tag_names: [] };
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(inspectPdfText).mockResolvedValue(info);
  vi.mocked(readAssistantPdfBytes).mockResolvedValue(new Uint8Array([1, 2]));
  vi.mocked(extractPdfText).mockResolvedValue({ pageCount: 3, pages });
  vi.mocked(cachePdfText).mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('bounded PDF text tools', () => {
  it('enforces frozen scope, host-owned root and bounded integer ranges before reading', () => {
    expect(normalizeToolInput('read_pdf_pages', { root: 'evil', entry_id: 'paper' }, { root: 'real', scope })).toEqual({ root: 'real', entry_id: 'paper', start_page: 1, page_count: 3 });
    expect(() => normalizeToolInput('read_pdf_pages', { entry_id: 'other' }, { root: 'real', scope })).toThrow('outside');
    for (const input of [{ start_page: 0 }, { page_count: 6 }, { start_page: '1' }, { page_count: 1.5 }]) {
      expect(() => normalizeToolInput('read_pdf_pages', { entry_id: 'paper', ...input }, { root: 'r', scope })).toThrow('页码范围');
    }
    expect(() => normalizeToolInput('search_pdf_text', { entry_id: 'paper', query: ' ' }, { root: 'r', scope })).toThrow();
  });
  it('registers page evidence only after successful revision-bound caching and returns a continuation', async () => {
    const add = vi.fn(() => 7);
    const result = await executeTool('read_pdf_pages', { root: 'root', entry_id: 'paper', start_page: 1, page_count: 2 }, { addSource: add, contextBudget: 8000 });
    expect(readAssistantPdfBytes).toHaveBeenCalledWith('root', 'paper', info.revision);
    expect(cachePdfText).toHaveBeenCalledWith('root', info, 3, pages);
    expect(add).toHaveBeenCalledOnce(); expect(add).toHaveBeenCalledWith(expect.objectContaining({ segment_uid: `pdf-text-v1:${info.revision}:0`, page_idx: 0, quote: pages[0].text }));
    expect(result.modelOutput).toMatchObject({ next_page: 3, empty_pages: [2], evidence: [{ marker: '[S7]', page: 1, text: pages[0].text }] });
  });
  it('uses cached pages without allocating a worker or rereading PDF bytes', async () => {
    vi.mocked(inspectPdfText).mockResolvedValue({ ...info, page_count: 2, pages });
    const result = await loadPdfPages('r', 'paper', 1, 3);
    expect(result.pages).toEqual(pages); expect(extractPdfText).not.toHaveBeenCalled(); expect(readAssistantPdfBytes).not.toHaveBeenCalled();
  });
  it('falls back automatically on an unparsed entry but leaves parsed reads unchanged', async () => {
    const addSource = vi.fn(() => 1);
    vi.mocked(invokeAssistantTool).mockResolvedValue({ entry_id: 'paper', entry_title: 'Paper', markdown: '', sources: [], has_pdf: true, parsed_segment_count: 0 });
    const result = await executeTool('read_entry_assistant_context', { root: 'r', entry_id: 'paper' }, { addSource, contextBudget: 8000 });
    expect(result.modelOutput).toMatchObject({ reading_mode: 'pdf_text_layer', requested_tool: 'read_entry_assistant_context' });
    vi.mocked(inspectPdfText).mockClear();
    vi.mocked(invokeAssistantTool).mockResolvedValue({ entry_id: 'paper', entry_title: 'Paper', markdown: 'Existing parsed text', sources: [], has_pdf: true, parsed_segment_count: 1 });
    await executeTool('read_entry_assistant_context', { root: 'r', entry_id: 'paper' }, { addSource, contextBudget: 8000 });
    expect(inspectPdfText).not.toHaveBeenCalled();
  });
  it('does not register unpersisted evidence on cache failure or cancellation', async () => {
    const addSource = vi.fn(() => 1);
    vi.mocked(cachePdfText).mockRejectedValueOnce(new Error('PDF changed'));
    await expect(executeTool('read_pdf_pages', { root: 'r', entry_id: 'paper' }, { addSource, contextBudget: 8000 })).rejects.toThrow('PDF changed');
    expect(addSource).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(loadPdfPages('r', 'paper', 1, 1, controller.signal)).rejects.toThrow();
  });
  it('reports scanning, no match, partial extraction and budget exhaustion distinctly', () => {
    const add = vi.fn(() => 1);
    const scan = formatPdfOutput('read_pdf_pages', { ...info, page_count: 3, pages: [pages[1]] }, 2, '', add, 4000);
    expect(scan.modelOutput).toMatchObject({ status: 'no_extractable_text', next_page: 3 }); expect(scan.sources).toEqual([]);
    const noMatch = formatPdfOutput('search_pdf_text', { ...info, page_count: 3, pages }, 1, 'absent', add, 4000);
    expect(noMatch.modelOutput.status).toBe('no_match_in_scanned_text'); expect(noMatch.sources).toEqual([]);
    const match = formatPdfOutput('search_pdf_text', { ...info, page_count: 3, pages }, 1, '中文', add, 4000);
    expect(match.sources).toHaveLength(1);
    const partial = formatPdfOutput('read_pdf_pages', { ...info, page_count: 1, pages: [{ ...pages[0], truncated: true }] }, 1, '', add, 4000);
    expect(partial.modelOutput.extraction_truncated_pages).toEqual([1]);
    expect(formatPdfOutput('read_pdf_pages', { ...info, page_count: 2, pages }, 1, '', add, 300).modelOutput.status).toBe('context_budget_exhausted');
  });
  it('serializes concurrent extraction and lets a canceled waiter leave safely', async () => {
    let finish!: (value: PdfTextInfo) => void;
    vi.mocked(inspectPdfText).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const first = loadPdfPages('r', 'paper', 1, 1);
    await vi.waitFor(() => expect(inspectPdfText).toHaveBeenCalledOnce());
    const controller = new AbortController();
    const canceled = loadPdfPages('r', 'paper', 1, 1, controller.signal);
    const third = loadPdfPages('r', 'paper', 1, 1);
    controller.abort(); await expect(canceled).rejects.toThrow();
    expect(inspectPdfText).toHaveBeenCalledOnce(); finish(info);
    await first; await third; expect(inspectPdfText).toHaveBeenCalledTimes(2);
  });
  it('times out a hung transport without late cache writes', async () => {
    vi.useFakeTimers(); let finish!: (value: PdfTextInfo) => void;
    vi.mocked(inspectPdfText).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const promise = loadPdfPages('r', 'paper', 1, 1);
    const assertion = expect(promise).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(30001); await assertion;
    // A different document can finish BEFORE the old native operation settles.
    const next = await loadPdfPages('r', 'other', 1, 1);
    expect(next.pages).toEqual(pages);
    expect(readAssistantPdfBytes).toHaveBeenCalledTimes(1);
    expect(cachePdfText).toHaveBeenCalledTimes(1);
    finish(info); await vi.advanceTimersByTimeAsync(1);
    expect(readAssistantPdfBytes).toHaveBeenCalledTimes(1); expect(cachePdfText).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds orphaned native requests and recovers capacity when they finish', async () => {
    vi.useFakeTimers();
    const finishes: Array<(info: PdfTextInfo) => void> = [];
    for (let i = 0; i < 4; i++) {
      vi.mocked(inspectPdfText).mockReturnValueOnce(new Promise(resolve => { finishes.push(resolve); }));
      const assertion = expect(loadPdfPages('r', `hung-${i}`, 1, 1)).rejects.toThrow('超时');
      await vi.advanceTimersByTimeAsync(30001); await assertion;
    }
    await expect(loadPdfPages('r', 'blocked', 1, 1)).rejects.toThrow('多个未结束请求');
    expect(inspectPdfText).toHaveBeenCalledTimes(4);
    for (const finish of finishes) finish(info);
    await vi.advanceTimersByTimeAsync(1);
    expect(readAssistantPdfBytes).not.toHaveBeenCalled();
    await expect(loadPdfPages('r', 'recovered', 1, 1)).resolves.toMatchObject({ pages });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('registers only granted read tools, respects planning/scope and does not restore explicitly revoked grants', async () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    const runtime = await createAssistantTools({ root: 'r', scope, runtimeSettings: settings, activeExecution: { agent: settings.mainAssistant }, ...buildDirectExecution(settings, 'Read PDF', 'plan') });
    expect(runtime.tools.read_pdf_pages.needsApproval).toBe(false); expect(canReplayAssistantTool('read_pdf_pages')).toBe(true);
    settings.mainAssistant.enabledToolIds = ['read_note'];
    const restricted = await createAssistantTools({ root: 'r', scope, runtimeSettings: settings, activeExecution: { agent: settings.mainAssistant }, ...buildDirectExecution(settings, 'Read PDF') });
    expect(restricted.tools.read_pdf_pages).toBeUndefined(); expect(normalizeAgentRuntimeSettings(settings).mainAssistant.enabledToolIds).toEqual(['read_note']);
    const old = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS); old.capabilityRevision = 1;
    old.mainAssistant.enabledToolIds = old.mainAssistant.enabledToolIds.filter(id => !['read_pdf_pages', 'search_pdf_text', 'import_papers'].includes(id));
    const upgraded = normalizeAgentRuntimeSettings(old);
    expect(upgraded.mainAssistant.enabledToolIds).toContain('read_pdf_pages'); expect(upgraded.mainAssistant.enabledToolIds).not.toContain('import_papers');
    upgraded.mainAssistant.enabledToolIds = upgraded.mainAssistant.enabledToolIds.filter(id => id !== 'read_pdf_pages');
    expect(normalizeAgentRuntimeSettings(upgraded).mainAssistant.enabledToolIds).not.toContain('read_pdf_pages');
  });
});
