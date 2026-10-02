import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listTools } from '@/shared/ipc/assistantApi';
import { DEFAULT_AGENT_RUNTIME_SETTINGS, normalizeAgentRuntimeSettings } from '@/shared/lib/agentRuntimeSettings';
import { createAssistantTools } from './tools';
import { buildDirectExecution } from '../runtime/executionPolicy';
import { normalizeToolInput } from './toolSupport';
import { canReplayAssistantTool } from '../runtime/durableExecution';
import { researchOutput } from './researchOutput';
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(), listTools: vi.fn() }));
const scope = { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] };
beforeEach(() => { vi.mocked(listTools).mockResolvedValue(['search_papers', 'import_papers', 'search_web', 'read_webpage'].map(name => ({ name, description: name, parameters_schema: { type: 'object', properties: {} } }))); });
describe('research tools share existing permissions', () => {
  it('only allows importing through a main assistant acting with write permission and confirmation', async () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    const execution = buildDirectExecution(settings, '检索并下载论文');
    const runtime = await createAssistantTools({ root: 'root', scope, runtimeSettings: settings, activeExecution: { agent: settings.mainAssistant }, ...execution });
    expect(runtime.tools.import_papers.needsApproval).toBe(true);
    expect(runtime.tools.search_papers.needsApproval).toBe(false);
    expect(canReplayAssistantTool('import_papers')).toBe(false);
    settings.mainAssistant.sandbox = 'read-only';
    const readOnly = await createAssistantTools({ root: 'root', scope, runtimeSettings: settings, activeExecution: { agent: settings.mainAssistant }, ...buildDirectExecution(settings, '检索') });
    expect(readOnly.tools.import_papers).toBeUndefined(); expect(readOnly.tools.search_papers).toBeTruthy();
  });
  it('does not grant research to a restricted saved profile', () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    settings.mainAssistant.enabledToolIds = ['read_note'];
    expect(normalizeAgentRuntimeSettings(settings).mainAssistant.enabledToolIds).toEqual(['read_note']);
  });
  it('extends the old standard profile but respects disabled native providers', async () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    delete settings.capabilityRevision;
    settings.mainAssistant.enabledToolIds = settings.mainAssistant.enabledToolIds.filter(id => !['search_papers', 'import_papers', 'search_web', 'read_webpage'].includes(id));
    const migrated = normalizeAgentRuntimeSettings(settings);
    expect(migrated.mainAssistant.enabledToolIds).toContain('search_papers');
    vi.mocked(listTools).mockResolvedValue([]);
    const runtime = await createAssistantTools({ root: 'r', scope, runtimeSettings: migrated, activeExecution: { agent: migrated.mainAssistant }, ...buildDirectExecution(migrated, '检索') });
    expect(runtime.tools.search_papers).toBeUndefined();
  });
  it('does not restore an explicitly revoked research grant on subsequent normalization', () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    settings.mainAssistant.enabledToolIds = settings.mainAssistant.enabledToolIds.filter(id => id !== 'import_papers');
    expect(normalizeAgentRuntimeSettings(settings).mainAssistant.enabledToolIds).not.toContain('import_papers');
  });
  it('host-supplies the workspace and truncates excerpts without manufacturing sources', () => {
    expect(normalizeToolInput('search_papers', { root: 'attacker', query: 'test' }, { root: 'real', scope })).toEqual({ root: 'real', query: 'test' });
    const output = researchOutput({ papers: [{ id: 'actual-id', url: 'https://arxiv.org/abs/123', abstract_text: 'a'.repeat(9000) }] }, 2000) as { papers: { id: string; abstract_text: string; truncated: boolean }[] };
    expect(output.papers[0].id).toBe('actual-id'); expect(output.papers[0].truncated).toBe(true); expect(output.papers[0].abstract_text.length).toBeLessThan(2000);
  });
});
