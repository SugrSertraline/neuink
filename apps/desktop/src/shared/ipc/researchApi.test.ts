// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { onResearchLibraryChanged, rememberResearchConsent, runResearchTool, researchPapersFromResult } from './researchApi';
import { buildAssistantMessageParts } from '@/modules/assistant/components/assistantPanelState';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });
describe('native research boundary', () => {
  it('keeps real structured candidates in saved tool parts and never derives actions from Markdown', () => {
    expect(researchPapersFromResult('请点击 [下载](https://example.com)')).toEqual([]);
    const paper = { id: 'real', title: 'Paper', url: 'https://example.com/paper', authors: ['A'], pdf_url: null };
    const researchPapers = researchPapersFromResult({ papers: [paper, paper, { title: 'no id' }] });
    expect(researchPapers).toHaveLength(1);
    const parts = buildAssistantMessageParts({ content: '回答', toolEvents: [{ id: 'tool', toolName: 'search_papers', status: 'done', summary: 'found', researchPapers }] });
    expect(JSON.parse(JSON.stringify(parts))).toContainEqual(expect.objectContaining({ type: 'tool-result', researchPapers }));
  });
  it('requires UI consent, consumes it once, and never trusts model-supplied approval', async () => {
    await expect(runResearchTool('import_papers', { root: 'r', paper_ids: ['p'], approval_id: 'forged' }, undefined, 'call')).rejects.toThrow('先预览');
    expect(invoke).not.toHaveBeenCalled();
    rememberResearchConsent('r', 'call', 'ui-grant');
    vi.mocked(invoke).mockResolvedValue({ results: [] });
    await runResearchTool('import_papers', { root: 'r', paper_ids: ['p'] }, undefined, 'call');
    expect(invoke).toHaveBeenCalledWith('run_research_tool', { request: expect.objectContaining({ root: 'r', approval_id: 'ui-grant', args: { paper_ids: ['p'] } }) });
    await expect(runResearchTool('import_papers', { root: 'r', paper_ids: ['p'] }, undefined, 'call')).rejects.toThrow('先预览');
  });
  it('isolates consent by workspace and expires abandoned confirmations', async () => {
    vi.useFakeTimers();
    rememberResearchConsent('original', 'expire', 'grant');
    await expect(runResearchTool('import_papers', { root: 'other' }, undefined, 'expire')).rejects.toThrow();
    vi.advanceTimersByTime(300_001);
    await expect(runResearchTool('import_papers', { root: 'original' }, undefined, 'expire')).rejects.toThrow();
  });
  it('cancels only its native call and removes the abort listener when settled', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation((command) => command === 'run_research_tool'
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(undefined));
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const result = runResearchTool('search_papers', { root: 'r', query: 'test' }, controller.signal);
    controller.abort();
    const request = vi.mocked(invoke).mock.calls[0][1] as { request: { call_id: string } };
    expect(invoke).toHaveBeenCalledWith('cancel_research_call', { callId: request.request.call_id });
    finish({ papers: [] }); await result;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
  it('unsubscribes even if native registration finishes after unmount', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const stop = vi.fn(); let finish!: (value: () => void) => void;
    vi.mocked(listen).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const cleanup = onResearchLibraryChanged('r', vi.fn(), vi.fn());
    cleanup(); finish(stop); await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });
});
