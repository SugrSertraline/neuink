// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runLocalAgent } from '@/shared/ipc/localAgentApi';
import { getAssistantContextSnapshot, loadAgentRuntimeSettings, listTools } from '@/shared/ipc/assistantApi';
import { readBrowserTab } from '@/shared/ipc/browserApi';
import { runResearchTool } from '@/shared/ipc/researchApi';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { setLocalAgentEnabled } from '@/shared/lib/localAgentSettings';
import { ASSISTANT_READ_FAILURES } from '@/shared/lib/assistantReadFailure';
import type { RunAssistantHarnessOptions } from '../harness/engine';
import { runLocalAgentHarness } from './runner';
import { CLAUDE_PROFILE } from './session';

vi.mock('@/shared/ipc/agentExecutionApi', () => ({ saveAgentExecution: vi.fn(async (_root, record) => ({ ...record, revision: record.revision + 1 })), readAgentExecution: vi.fn() }));
vi.mock('@/shared/ipc/localAgentApi', () => ({ runLocalAgent: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  getAssistantContextSnapshot: vi.fn(), loadAgentRuntimeSettings: vi.fn(), listTools: vi.fn() }));
vi.mock('@/shared/ipc/browserApi', () => ({ readBrowserTab: vi.fn() }));
vi.mock('@/shared/ipc/researchApi', async original => ({ ...await original<typeof import('@/shared/ipc/researchApi')>(), runResearchTool: vi.fn() }));

const browserTab = { id: 'frozen-tab', title: 'Selected article',
  url: 'https://example.org/article?session=PRIVATE#secret', navigationId: 'frozen-navigation' };
const currentSurface: NonNullable<RunAssistantHarnessOptions['currentSurface']> = {
  kind: 'browser', capturedAt: '', entryId: null, noteId: null, pane: 'right', segmentUid: null,
  surfaceKey: 'browser:frozen-tab', browserTab
};
const options = (extra: Partial<RunAssistantHarnessOptions> = {}): RunAssistantHarnessOptions => ({
  root: 'C:/fixture', conversationId: 'web', question: '阅读这个网页', settings: CLAUDE_PROFILE,
  scope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] }, ...extra
});
const session = { type: 'local-agent', provider: 'claude',
  sessionId: '550e8400-e29b-41d4-a716-446655440000', initialized: false } as const;
type Handler = Parameters<typeof runLocalAgent>[3];
async function call(handle: Handler, name: string, input: unknown, id = name) {
  const output = await handle({ type: 'tool', id, name, input }) as { isError?: boolean; content: { text: string }[] };
  let value: unknown;
  try { value = JSON.parse(output.content[0].text); } catch { value = output.content[0].text; }
  return { ...output, value };
}
const descriptors = ['search_web', 'read_webpage'].map(name => ({ name, description: name,
  parameters_schema: { type: 'object', additionalProperties: false,
    properties: { [name === 'search_web' ? 'query' : 'url']: { type: 'string' } },
    required: [name === 'search_web' ? 'query' : 'url'] }
}));

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); setLocalAgentEnabled(true);
  vi.mocked(getAssistantContextSnapshot).mockResolvedValue({ active_entry: null, active_note: null,
    document: null, pinned_segments: [], warnings: [] });
  vi.mocked(loadAgentRuntimeSettings).mockResolvedValue(DEFAULT_AGENT_RUNTIME_SETTINGS);
  vi.mocked(listTools).mockResolvedValue(descriptors);
  vi.mocked(readBrowserTab).mockResolvedValue({ title: browserTab.title, url: 'https://example.org/article',
    text: 'Only the selected article was read.', selection: '', capturedAt: '', truncated: true, limitations: ['Partial text.'] });
  vi.mocked(runResearchTool).mockResolvedValue({ results: [{ url: 'https://example.org/public',
    content: 'Actual public text.', truncated: false, evidence_level: 'web_extract' }] });
});

describe.each(['claude', 'codex', 'opencode'] as const)('%s web integration', provider => {
  it('carries the frozen browser identity and reading contract without eagerly reading it', async () => {
    vi.mocked(runLocalAgent).mockImplementation(async request => {
      const prompt = JSON.parse(request.prompt);
      expect(prompt.context.browser).toEqual({ title: browserTab.title, url: 'https://example.org/article' });
      expect(request.prompt).not.toMatch(/PRIVATE|frozen-navigation|secret/);
      expect(request.prompt).toContain('read_browser_tab reads the single browser tab captured');
      expect(request.prompt).toContain('Browser resources have no local Segment');
      expect(request.tools.some(tool => tool.name === 'read_browser_tab')).toBe(true);
      return { result: '你好' };
    });
    await runLocalAgentHarness(options({ currentSurface, question: '你好' }), { ...session, provider }, vi.fn());
    expect(readBrowserTab).not.toHaveBeenCalled();
  });

  it('reads the exact captured tab through host tools and retains its verified URL citation', async () => {
    vi.mocked(runLocalAgent).mockImplementation(async (_request, _signal, _event, handle) => {
      const result = await call(handle, 'read_browser_tab', {});
      expect(result.isError).not.toBe(true);
      expect(result.value).toMatchObject({ status: 'read', truncated: true, limitations: ['Partial text.'] });
      return { result: '以下仅基于已取得的部分正文。[来源](https://example.org/article)' };
    });
    const result = await runLocalAgentHarness(options({ currentSurface }), { ...session, provider, initialized: true }, vi.fn());
    expect(readBrowserTab).toHaveBeenCalledExactlyOnceWith(browserTab, expect.any(AbortSignal), 'text');
    expect(result.sources).toEqual([]);
    expect(result.externalCitationUrls).toEqual(['https://example.org/article']);
  });

  it('provides public search and URL reading without requiring native web tools or extra approval', async () => {
    const approval = vi.fn();
    vi.mocked(runLocalAgent).mockImplementation(async (request, _signal, _event, handle) => {
      expect(JSON.parse(request.prompt).capabilities).toMatchObject({ search_web: true, read_webpage: true, read_browser_tab: false });
      expect(request.prompt).toContain('Prefer the available neuink MCP web tools');
      expect(request.prompt).toContain('exact returned URLs');
      expect((await call(handle, 'read_webpage', { url: 12 })).isError).toBe(true);
      expect(runResearchTool).not.toHaveBeenCalled();
      expect((await call(handle, 'search_web', { query: 'public article' })).isError).not.toBe(true);
      expect((await call(handle, 'read_webpage', { url: 'https://example.org/public' })).isError).not.toBe(true);
      return { result: '[公开正文](https://example.org/public)' };
    });
    const result = await runLocalAgentHarness(options({ requestToolApproval: approval }), { ...session, provider }, vi.fn());
    expect(runResearchTool).toHaveBeenCalledTimes(2);
    expect(runResearchTool).toHaveBeenLastCalledWith('read_webpage', { root: 'C:/fixture', url: 'https://example.org/public' }, expect.any(AbortSignal), 'read_webpage');
    expect(approval).not.toHaveBeenCalled();
    expect(result.externalCitationUrls).toEqual(['https://example.org/public']);
  });

  it('returns safe web failure diagnostics and blocks repeated failed requests', async () => {
    vi.mocked(runResearchTool).mockRejectedValue(new Error('HTTP 403 token=PRIVATE C:/Private/page'));
    vi.mocked(runLocalAgent).mockImplementation(async (_request, _signal, _event, handle) => {
      const failed = await call(handle, 'read_webpage', { url: 'https://example.org/public' }, 'first');
      expect(failed.isError).toBe(true);
      expect(failed.value).toMatchObject({ code: 'TOOL_EXECUTION_FAILED', diagnostic: ASSISTANT_READ_FAILURES.denied,
        recovery: { writesBlocked: false } });
      expect(JSON.stringify(failed)).not.toContain('PRIVATE');
      expect(JSON.stringify(failed)).toContain('不要');
      const repeated = await call(handle, 'read_webpage', { url: 'https://example.org/public#same-page' }, 'second');
      expect(repeated.isError).toBe(true);
      return { result: '当前来源拒绝读取，未取得正文。' };
    });
    const result = await runLocalAgentHarness(options(), { ...session, provider }, vi.fn());
    expect(runResearchTool).toHaveBeenCalledTimes(1);
    expect(result.hadRecoverableFailures).toBe(true);
    expect(result.externalCitationUrls).toEqual([]);
  });
});

it.each(['disabled', 'catalog-error', 'revoked'] as const)('reports unavailable tools without restoring %s capabilities', async reason => {
  if (reason === 'catalog-error') vi.mocked(listTools).mockRejectedValue(new Error('PRIVATE'));
  if (reason === 'disabled') vi.mocked(listTools).mockResolvedValue([]);
  if (reason === 'revoked') vi.mocked(loadAgentRuntimeSettings).mockResolvedValue({ ...DEFAULT_AGENT_RUNTIME_SETTINGS,
    mainAssistant: { ...DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant, enabledToolIds: ['read_note'] } });
  vi.mocked(runLocalAgent).mockImplementation(async request => {
    expect(JSON.parse(request.prompt).capabilities).toMatchObject({ search_web: false, read_webpage: false, read_browser_tab: reason !== 'revoked' });
    expect(request.tools.some(tool => tool.name === 'read_webpage')).toBe(false);
    expect(request.prompt).not.toContain('PRIVATE');
    if (reason === 'catalog-error') expect(request.prompt).toContain('工具目录读取失败');
    return { result: '说明当前工具范围。' };
  });
  await runLocalAgentHarness(options({ currentSurface }), session, vi.fn());
  expect(runResearchTool).not.toHaveBeenCalled();
});
