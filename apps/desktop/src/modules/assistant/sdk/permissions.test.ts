import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_RUNTIME_SETTINGS, configuredAgentToolIds, normalizeAgentRuntimeSettings } from '@/shared/lib/agentRuntimeSettings';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { createAssistantTools } from './tools';
import { resolveModelProfile } from './modelTasks';
import { createApplicationActions } from '../runtime/applicationActions';
import { sourcesFromMarkers } from './toolSupport';
import { agentExecutors } from './agentDriver';

vi.mock('@/shared/ipc/assistantApi', async original => ({
  ...await original<typeof import('@/shared/ipc/assistantApi')>(), listTools: async () => []
}));
const scope = { entry_ids: ['entry'], entry_titles: ['Paper'], tag_ids: [], tag_names: [] };

describe('capability boundaries', () => {
  it('does not advertise delegation until an evidence worker is enabled', async () => {
    const runtimeSettings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    const options = {
      activeExecution: { agent: runtimeSettings.mainAssistant },
      runtimeSettings, root: 'fixture', scope,
      invocationPlan: { enabledToolIds: ['task.run_subagent'], writePolicy: 'chat_only' }
    } as unknown as Parameters<typeof createAssistantTools>[0];
    const disabled = await createAssistantTools(options);
    expect(disabled.tools.task_run_subagent).toBeUndefined();
    runtimeSettings.subagents[0].enabled = true;
    const enabled = await createAssistantTools(options);
    expect(enabled.tools.task_run_subagent).toBeDefined();
  });
  it('enforces read-only planning even if a caller supplies an overly broad tool list', async () => {
    const runtime = await createAssistantTools({
      activeExecution: { agent: DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant }, root: 'fixture', scope,
      invocationPlan: { executionMode: 'plan', enabledToolIds: ['create_entry', 'app.set_appearance', 'task.run_subagent', 'note.propose_create', 'entry.propose_meta_patch', 'tag.propose_change'], writePolicy: 'proposal_only' } as never,
      onCreateEntry: vi.fn(), applicationActions: createApplicationActions('standard', vi.fn()),
      onNoteProposal: vi.fn(), onEntryMetaProposal: vi.fn(), onTagProposal: vi.fn()
    });
    expect(Object.keys(runtime.tools)).toEqual([]);
  });
  it('does not grant proposal callbacks in a read-only invocation', async () => {
    const runtime = await createAssistantTools({
      activeExecution: { agent: DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant }, root: 'fixture', scope,
      invocationPlan: { enabledToolIds: ['note.propose_create', 'entry.propose_meta_patch', 'tag.propose_change'], writePolicy: 'chat_only' } as never,
      onNoteProposal: vi.fn(), onEntryMetaProposal: vi.fn(), onTagProposal: vi.fn()
    });
    expect(Object.keys(runtime.tools)).toEqual([]);
  });
  it('requires all MCP grants including an approved package', () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    settings.mainAssistant.allowedMcpServerIds = ['server'];
    settings.mcpServers = [{ id: 'server', name: 'Server', command: 'node fixture', enabled: true, description: '', allowedToolNames: ['read.item'] }];
    expect(configuredAgentToolIds(settings, settings.mainAssistant)).not.toContain('mcp.server.read.item');
    settings.toolPackages = [{ id: 'grant', name: 'Grant', description: '', enabled: true, kind: 'mcp', mcpServerId: 'server', permissionMode: 'ask', allowedToolIds: ['mcp.server.read.item'] }];
    expect(configuredAgentToolIds(settings, settings.mainAssistant)).not.toContain('mcp.server.read.item');
    settings.toolPackages[0].permissionMode = 'allow';
    expect(configuredAgentToolIds(settings, settings.mainAssistant)).toContain('mcp.server.read.item');
  });
  it('does not expose retired skill tools', () => {
    expect(configuredAgentToolIds(DEFAULT_AGENT_RUNTIME_SETTINGS, DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant)).not.toContain('skill.load');
  });
  it('replaces old runtime config without touching the separate model profiles', () => {
    expect(normalizeAgentRuntimeSettings({ version: 3 } as never).version).toBe(4);
    expect(normalizeAgentRuntimeSettings({ version: 3 } as never).subagents).toHaveLength(1);
  });
  it('never silently selects a different provider for an invalid profile id', () => {
    const inherited = { id: 'parent' } as LlmProfile;
    expect(resolveModelProfile(null, [], inherited)).toBe(inherited);
    expect(() => resolveModelProfile('missing', [inherited], inherited)).toThrow('unavailable');
    expect(() => resolveModelProfile(null, [inherited])).toThrow('No default');
  });
  it('routes reversible appearance changes through the existing state owner only', async () => {
    const setter = vi.fn(() => true);
    const runtime = await createAssistantTools({
      activeExecution: { agent: DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant },
      applicationActions: createApplicationActions('standard', setter),
      invocationPlan: { enabledToolIds: ['app.set_appearance'], writePolicy: 'chat_only' } as never, root: 'fixture', scope
    });
    expect(runtime.tools.app_set_appearance.needsApproval).toBe(true);
    await expect(agentExecutors(runtime.tools).app_set_appearance({ appearance: 'atelier' }, { id: 'blocked' })).rejects.toThrow('需要用户确认');
    expect(setter).not.toHaveBeenCalled();
    const approve = vi.fn(async () => true);
    const execute = agentExecutors(runtime.tools, approve).app_set_appearance;
    const options = { id: 'appearance' };
    expect(await execute({ appearance: 'atelier' }, options)).toEqual({ previous: 'standard', current: 'atelier', persisted: true });
    expect(await execute({ appearance: 'standard' }, options)).toEqual({ previous: 'atelier', current: 'standard', persisted: true });
    await expect(execute({ appearance: 'arbitrary-settings' }, options)).rejects.toThrow();
    expect(setter).toHaveBeenCalledTimes(2);
    expect(approve).toHaveBeenCalledTimes(2);
  });
  it('rejects fabricated Source Link markers instead of silently discarding them', () => {
    expect(() => sourcesFromMarkers(['S999'], new Map())).toThrow('Unknown evidence');
  });
});
