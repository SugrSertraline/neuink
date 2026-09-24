import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { buildDirectExecution, PLANNING_READ_TOOLS } from './executionPolicy';
import { baseRequestRoute } from './requestRouter';

describe('direct execution policy', () => {
  it('narrows greeting capabilities to zero, without affecting ordinary tasks', () => {
    const route = baseRequestRoute({ question: '你好', hasContext: false });
    const { invocationPlan } = buildDirectExecution(DEFAULT_AGENT_RUNTIME_SETTINGS, '你好', 'act', route);
    expect(invocationPlan).toMatchObject({ responseStyle: 'lightweight_chat', enabledToolIds: [], writePolicy: 'chat_only', sourcePolicy: 'none' });
    expect(buildDirectExecution(DEFAULT_AGENT_RUNTIME_SETTINGS, '你好', 'plan', route).invocationPlan.responseStyle).toBeUndefined();
  });
  it.each(['你好', '阅读论文并生成笔记', '给出标题建议，不修改', '找论文再做PPT'])('does not classify or force tools for %s', question => {
    const { plan, invocationPlan } = buildDirectExecution(DEFAULT_AGENT_RUNTIME_SETTINGS, question);
    expect(plan.steps).toEqual([]);
    expect(invocationPlan.requiredToolIds).toEqual([]);
    expect(invocationPlan.enabledToolIds).toContain('note.propose_create');
  });
  it('offers only known read tools in plan mode', () => {
    const { invocationPlan } = buildDirectExecution(DEFAULT_AGENT_RUNTIME_SETTINGS, '计划', 'plan');
    expect(invocationPlan.writePolicy).toBe('chat_only');
    expect(invocationPlan.enabledToolIds.length).toBeGreaterThan(0);
    expect(invocationPlan.enabledToolIds.every(id => PLANNING_READ_TOOLS.has(id))).toBe(true);
    expect(invocationPlan.enabledToolIds).not.toContain('task.run_subagent');
    expect(invocationPlan.enabledToolIds).not.toContain('app.set_appearance');
  });
  it('never grants disabled tools or overrides a read-only agent', () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    settings.mainAssistant.enabledToolIds = ['read_note', 'note.propose_patch'];
    settings.mainAssistant.sandbox = 'read-only';
    const { invocationPlan } = buildDirectExecution(settings, '修改笔记');
    expect(invocationPlan.enabledToolIds).toEqual(['read_note']);
    expect(invocationPlan.writePolicy).toBe('chat_only');
    settings.mainAssistant.permissions.canInvokeTools = false;
    expect(buildDirectExecution(settings, '修改笔记').invocationPlan.enabledToolIds).toEqual([]);
  });
});
