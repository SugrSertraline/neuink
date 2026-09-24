import { describe, expect, it } from 'vitest';

import { resolveAssistantRunStatus } from './AssistantRunStatus';

describe('resolveAssistantRunStatus', () => {
  it('does not spin while waiting for a user choice even with a queued follow-up', () => {
    expect(resolveAssistantRunStatus({ busy: true, error: null, queued: true, streaming: false,
      toolEvents: [{ id: 'ask', toolName: 'ask_user', status: 'running' }] })).toMatchObject({ active: false, label: '等待你的选择' });
  });
  it.each([
    ['', '正在处理'], ['agent.plan', '正在规划'],
    ['task.run_subagent', '子任务运行中'], ['agent.memory', '正在整理记录']
  ])('labels %s without pretending it is model reasoning', (toolName, label) => {
    expect(resolveAssistantRunStatus({ busy: true, error: null, queued: false, streaming: false,
      toolEvents: toolName ? [{ id: '1', status: 'running', toolName }] : [] }).label).toBe(label);
  });
  it('shows the active tool phase', () => {
    expect(resolveAssistantRunStatus({
      busy: true,
      error: null,
      queued: false,
      streaming: false,
      toolEvents: [{ id: '1', status: 'running', toolName: 'search_segments' }]
    }).label).toBe('正在检索');
  });

  it('shows answering while content is streaming', () => {
    expect(resolveAssistantRunStatus({
      busy: true,
      error: null,
      queued: false,
      streaming: true,
      toolEvents: []
    }).label).toBe('正在回答');
  });

  it('shows planning while the orchestrator is understanding the request', () => {
    expect(resolveAssistantRunStatus({
      busy: true,
      error: null,
      queued: false,
      streaming: false,
      toolEvents: [{ id: '1', status: 'running', toolName: 'agent.orchestrate' }]
    }).label).toBe('正在规划');
  });
});
