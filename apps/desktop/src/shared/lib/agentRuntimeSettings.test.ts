import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_RUNTIME_SETTINGS, auditAgentToolPermissions, configuredAgentToolIds, normalizeAgentRuntimeSettings, resolveAllowedSubagents, selectAgentExecution } from './agentRuntimeSettings';
import type { SubagentProfile } from '@/shared/types/agentRuntime';

describe('agent capability policy', () => {
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
