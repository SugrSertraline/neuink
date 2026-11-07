import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_RUNTIME_SETTINGS, auditAgentToolPermissions, configuredAgentToolIds, normalizeAgentRuntimeSettings, resolveAllowedSubagents, selectAgentExecution } from './agentRuntimeSettings';
import type { SubagentProfile } from '@/shared/types/agentRuntime';

describe('agent capability policy', () => {
  it('migrates old tool IDs without restoring revoked tools or changing external routes', () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    const raw = {
      ...settings,
      mainAssistant: { ...settings.mainAssistant,
        enabledToolIds: ['read_note', 'note.propose_patch', 'note_propose_patch', 'app.set_appearance'] },
      subagents: [{ ...settings.subagents[0], enabledToolIds: ['read_note', 'task.run_subagent'] }],
      toolPackages: [{ id: 'native', name: 'Native', enabled: true, kind: 'native', description: '',
        permissionMode: 'ask', allowedToolIds: ['note.propose_patch', 'mcp.server.read.item'] }]
    };
    const migrated = normalizeAgentRuntimeSettings(raw as never);
    expect(migrated.mainAssistant.enabledToolIds).toEqual(['read_note', 'note_propose_patch', 'app_set_appearance']);
    expect(migrated.subagents[0].enabledToolIds).toEqual(['read_note', 'task_run_subagent']);
    expect(migrated.toolPackages[0].allowedToolIds).toEqual(['note_propose_patch', 'mcp.server.read.item']);
    expect(normalizeAgentRuntimeSettings(migrated)).toEqual(migrated);
  });

  it('continues to reject every proposal tool when writing is disabled', () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    settings.mainAssistant.permissions.canWriteProposals = false;
    const ids = ['note_propose_create', 'note_propose_patch', 'segment_note_propose_patch',
      'entry_propose_meta_patch', 'tag_propose_change'];
    const audit = auditAgentToolPermissions(ids, settings.mainAssistant, settings);
    expect(audit.allowedToolIds).toEqual([]);
    expect(audit.deniedTools).toEqual(ids.map(toolId => ({ toolId, reason: 'write proposals disabled' })));
    expect(configuredAgentToolIds(settings, settings.mainAssistant)).not.toEqual(expect.arrayContaining(ids));
  });

  it('migrates browser reads once only for the complete prior main grant', () => {
    const old = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS); old.capabilityRevision = 2;
    old.mainAssistant.enabledToolIds = old.mainAssistant.enabledToolIds.filter(id => id !== 'read_browser_tab');
    const migrated = normalizeAgentRuntimeSettings(old);
    expect(migrated.capabilityRevision).toBe(4);
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
  it('contains autonomous workers only, not fixed model tasks', () => {
    expect(DEFAULT_AGENT_RUNTIME_SETTINGS.subagents.map((agent) => agent.id)).toEqual(['evidence-agent']);
    expect(resolveAllowedSubagents(DEFAULT_AGENT_RUNTIME_SETTINGS, DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant)).toEqual([]);
    expect(configuredAgentToolIds(DEFAULT_AGENT_RUNTIME_SETTINGS, DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant)).not.toContain('task_run_subagent');
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
    expect(configuredAgentToolIds(migrated, migrated.mainAssistant)).toContain('task_run_subagent');
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
