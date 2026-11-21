import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { buildDirectExecution, canParallelAssistantTool, PLANNING_READ_TOOLS } from './executionPolicy';
import { baseRequestRoute } from './requestRouter';

describe('direct execution policy', () => {
  it.each(['search_segments', 'read_note', 'read_pdf_pages', 'arxiv_search'])('allows concurrent known reads: %s', name => {
    expect(canParallelAssistantTool(name)).toBe(true);
  });
  it('only overlaps Sciverse content reads after the target has been observed in completed search evidence', () => {
    const observations = [{ toolName: 'search_sciverse_evidence', output: { evidence: [{ doc_id: 'paper-1' }] } }];
    expect(canParallelAssistantTool('read_sciverse_content', { doc_id: 'paper-1' })).toBe(false);
    expect(canParallelAssistantTool('read_sciverse_content', { doc_id: 'paper-1' }, observations)).toBe(true);
    expect(canParallelAssistantTool('read_sciverse_content', { doc_id: 'paper-2' }, observations)).toBe(false);
  });
  it.each(['create_entry', 'import_papers', 'note_propose_create', 'ask_user', 'present_diagram',
    'task_run_subagent', 'mcp.external.read', 'mcp_external_read', 'unknown'])('keeps effects, interactions and external tools exclusive: %s', name => {
    expect(canParallelAssistantTool(name)).toBe(false);
  });
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
    expect(invocationPlan.enabledToolIds).toContain('note_propose_create');
  });
  it('offers only known read tools in plan mode', () => {
    const { invocationPlan } = buildDirectExecution(DEFAULT_AGENT_RUNTIME_SETTINGS, '计划', 'plan');
    expect(invocationPlan.writePolicy).toBe('chat_only');
    expect(invocationPlan.enabledToolIds.length).toBeGreaterThan(0);
    expect(invocationPlan.enabledToolIds.every(id => PLANNING_READ_TOOLS.has(id))).toBe(true);
    expect(invocationPlan.enabledToolIds).not.toContain('task_run_subagent');
    expect(invocationPlan.enabledToolIds).not.toContain('app_set_appearance');
  });
  it('never grants disabled tools or overrides a read-only agent', () => {
    const settings = structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
    settings.mainAssistant.enabledToolIds = ['read_note', 'note_propose_patch'];
    settings.mainAssistant.sandbox = 'read-only';
    const { invocationPlan } = buildDirectExecution(settings, '修改笔记');
    expect(invocationPlan.enabledToolIds).toEqual(['read_note']);
    expect(invocationPlan.writePolicy).toBe('chat_only');
    settings.mainAssistant.permissions.canInvokeTools = false;
    expect(buildDirectExecution(settings, '修改笔记').invocationPlan.enabledToolIds).toEqual([]);
  });
});
