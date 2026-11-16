import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_RUNTIME_SETTINGS, auditAgentToolPermissions, configuredAgentToolIds, normalizeAgentRuntimeSettings, resolveAllowedSubagents, selectAgentExecution } from './agentRuntimeSettings';
import type { SubagentProfile } from '@/shared/types/agentRuntime';

describe('agent capability policy', () => {
  it('migrates browser reads once only for the complete prior main grant', () => {
    const old = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS); old.capabilityRevision = 2;
    old.mainAssistant.enabledToolIds = old.mainAssistant.enabledToolIds.filter(id => id !== 'read_browser_tab');
    const migrated = normalizeAgentRuntimeSettings(old);
    expect(migrated.capabilityRevision).toBe(5);
    expect(migrated.mainAssistant.enabledToolIds).toContain('read_browser_tab');
    migrated.mainAssistant.enabledToolIds = migrated.mainAssistant.enabledToolIds.filter(id => id !== 'read_browser_tab');
    expect(normalizeAgentRuntimeSettings(migrated).mainAssistant.enabledToolIds).not.toContain('read_browser_tab');
    old.mainAssistant.permissions.canInvokeTools = false;
    expect(normalizeAgentRuntimeSettings(old).mainAssistant.enabledToolIds).not.toContain('read_browser_tab');
    old.mainAssistant.permissions.canInvokeTools = true;
    old.mainAssistant.enabledToolIds = old.mainAssistant.enabledToolIds.filter(id => id !== 'read_webpage');
    expect(normalizeAgentRuntimeSettings(old).mainAssistant.enabledToolIds).not.toContain('read_browser_tab');
    expect(auditAgentToolPermissions(['read_browser_tab'], migrated.subagents[0], migrated).allowedToolIds).toEqual([]);
  });
  it('grants search_library by default and gates it on workspace-wide reads', () => {
    const main = DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant;
    expect(main.enabledToolIds).toContain('search_library');
    expect(auditAgentToolPermissions(['search_library'], main, DEFAULT_AGENT_RUNTIME_SETTINGS).allowedToolIds).toEqual(['search_library']);
    const noWorkspaceRead = { ...main, permissions: { ...main.permissions, canReadWorkspaceWide: false } };
    expect(auditAgentToolPermissions(['search_library'], noWorkspaceRead, DEFAULT_AGENT_RUNTIME_SETTINGS).deniedTools)
      .toEqual([{ reason: 'workspace-wide read disabled', toolId: 'search_library' }]);
  });
  it('adds search_library once to a complete revision-4 main grant and keeps restricted grants restricted', () => {
    const complete = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    complete.capabilityRevision = 4;
    complete.mainAssistant.enabledToolIds = complete.mainAssistant.enabledToolIds.filter(id => id !== 'search_library');
    const migrated = normalizeAgentRuntimeSettings(complete);
    expect(migrated.capabilityRevision).toBe(5);
    expect(migrated.mainAssistant.enabledToolIds.filter(id => id === 'search_library')).toHaveLength(1);

    const restricted = structuredClone(complete);
    restricted.mainAssistant.enabledToolIds = restricted.mainAssistant.enabledToolIds.filter(id => id !== 'note.propose_create');
    expect(normalizeAgentRuntimeSettings(restricted).mainAssistant.enabledToolIds).not.toContain('search_library');

    // Once at revision 5, a user's removal of search_library is their choice and is not reversed.
    const removedLater = structuredClone(migrated);
    removedLater.mainAssistant.enabledToolIds = removedLater.mainAssistant.enabledToolIds.filter(id => id !== 'search_library');
    expect(normalizeAgentRuntimeSettings(removedLater).mainAssistant.enabledToolIds).not.toContain('search_library');
  });
  it('does not grant search_library to a complete revision-4 main grant that cannot invoke tools', () => {
    const complete = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    complete.capabilityRevision = 4;
    complete.mainAssistant.enabledToolIds = complete.mainAssistant.enabledToolIds.filter(id => id !== 'search_library');
    complete.mainAssistant.permissions.canInvokeTools = false;
    expect(normalizeAgentRuntimeSettings(complete).mainAssistant.enabledToolIds).not.toContain('search_library');
  });
  it('extends the evidence worker only from its complete revision-4 grant', () => {
    const complete = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    complete.capabilityRevision = 4;
    complete.subagents[0].enabledToolIds = complete.subagents[0].enabledToolIds.filter(id => id !== 'search_library');
    expect(normalizeAgentRuntimeSettings(complete).subagents[0].enabledToolIds).toContain('search_library');

    const restricted = structuredClone(complete);
    restricted.subagents[0].enabledToolIds = ['read_segment_content'];
    expect(normalizeAgentRuntimeSettings(restricted).subagents[0].enabledToolIds).not.toContain('search_library');
  });
  it('judges an old complete grant against the tools that existed at its revision', () => {
    const revision3 = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    revision3.capabilityRevision = 3;
    // A revision-3 grant never had get_entry_outline or search_library.
    revision3.mainAssistant.enabledToolIds = revision3.mainAssistant.enabledToolIds
      .filter(id => id !== 'get_entry_outline' && id !== 'search_library');
    const migrated3 = normalizeAgentRuntimeSettings(revision3).mainAssistant.enabledToolIds;
    expect(migrated3).toEqual(expect.arrayContaining(['get_entry_outline', 'search_library']));

    const revision0 = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    revision0.capabilityRevision = 0;
    const earlierTools = ['search_papers', 'search_web', 'read_webpage', 'import_papers', 'read_pdf_pages', 'search_pdf_text',
      'read_browser_tab', 'get_entry_outline', 'search_library'] as const;
    revision0.mainAssistant.enabledToolIds = revision0.mainAssistant.enabledToolIds
      .filter(id => !(earlierTools as readonly string[]).includes(id));
    const migrated0 = normalizeAgentRuntimeSettings(revision0).mainAssistant.enabledToolIds;
    expect(migrated0).toEqual(expect.arrayContaining([...earlierTools]));
  });
  it('keeps an old grant missing an earlier tool restricted at every later revision', () => {
    const revision1 = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    revision1.capabilityRevision = 1;
    revision1.mainAssistant.enabledToolIds = revision1.mainAssistant.enabledToolIds
      .filter(id => !['search_web', 'read_pdf_pages', 'search_pdf_text', 'read_browser_tab', 'get_entry_outline', 'search_library'].includes(id));
    const migrated = normalizeAgentRuntimeSettings(revision1).mainAssistant.enabledToolIds;
    expect(migrated).not.toContain('read_pdf_pages');
    expect(migrated).not.toContain('read_browser_tab');
    expect(migrated).not.toContain('search_library');
  });
  it('extends a complete older evidence grant that predates get_entry_outline', () => {
    const revision3 = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    revision3.capabilityRevision = 3;
    revision3.subagents[0].enabledToolIds = revision3.subagents[0].enabledToolIds
      .filter(id => id !== 'get_entry_outline' && id !== 'search_library');
    expect(normalizeAgentRuntimeSettings(revision3).subagents[0].enabledToolIds)
      .toEqual(expect.arrayContaining(['get_entry_outline', 'search_library']));
  });
  it('contains autonomous workers only, not fixed model tasks', () => {
    expect(DEFAULT_AGENT_RUNTIME_SETTINGS.subagents.map((agent) => agent.id)).toEqual(['evidence-agent']);
    expect(resolveAllowedSubagents(DEFAULT_AGENT_RUNTIME_SETTINGS, DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant)).toEqual([]);
    expect(configuredAgentToolIds(DEFAULT_AGENT_RUNTIME_SETTINGS, DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant)).not.toContain('task.run_subagent');
    expect(DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant.enabledToolIds).not.toContain('skill.load');
  });
  it('does not restore revoked tools during normalization', () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    settings.mainAssistant.enabledToolIds = ['read_note'];
    expect(normalizeAgentRuntimeSettings(settings).mainAssistant.enabledToolIds).toEqual(['read_note']);
  });
  it('keeps disabled subagents disabled', () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    settings.subagents[0].enabled = false;
    expect(normalizeAgentRuntimeSettings(settings).subagents[0].enabled).toBe(false);
  });
  it('retires the old planner and disables the formerly default-on evidence worker once', () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    settings.subagents[0].enabled = true;
    settings.subagents.push({ ...settings.subagents[0], id: 'patch-planner-agent' } as SubagentProfile);
    settings.mainAssistant.allowedSubagentIds.push('patch-planner-agent');
    const migrated = normalizeAgentRuntimeSettings(settings);
    expect(migrated.subagents).toHaveLength(1);
    expect(migrated.subagents[0].enabled).toBe(false);
    expect(migrated.mainAssistant.allowedSubagentIds).toEqual(['evidence-agent']);
    migrated.subagents[0].enabled = true;
    expect(normalizeAgentRuntimeSettings(migrated).subagents[0].enabled).toBe(true);
    expect(configuredAgentToolIds(migrated, migrated.mainAssistant)).toContain('task.run_subagent');
  });
  it('strips retired skill grants from saved runtime settings', () => {
    const legacy = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS) as unknown as Record<string, unknown>;
    legacy.skillPackages = [{ id: 'untrusted', enabled: true }];
    (legacy.mainAssistant as Record<string, unknown>).allowedSkillPackageIds = ['untrusted'];
    (legacy.mainAssistant as Record<string, unknown>).enabledToolIds = ['read_note', 'skill.load'];
    (legacy.mainAssistant as Record<string, unknown>).systemPrompt = 'You are Neuink Main Assistant. Stay grounded in workspace evidence, use skills only after loading them, and create user-confirmable proposals for note or Entry metadata writes.';
    (legacy.mainAssistant as Record<string, unknown>).permissions = {
      ...DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant.permissions, canUseSkills: true
    };
    const settings = normalizeAgentRuntimeSettings(legacy as never);
    expect(settings).not.toHaveProperty('skillPackages');
    expect(settings.mainAssistant).not.toHaveProperty('allowedSkillPackageIds');
    expect(settings.mainAssistant.permissions).not.toHaveProperty('canUseSkills');
    expect(settings.mainAssistant.enabledToolIds).toEqual(['read_note']);
    expect(settings.mainAssistant.systemPrompt).not.toContain('skills');
    expect(auditAgentToolPermissions(['skill.load'], settings.mainAssistant, settings).allowedToolIds).toEqual([]);
    expect(selectAgentExecution(settings, '').agent.id).toBe('main-assistant');
  });
});
