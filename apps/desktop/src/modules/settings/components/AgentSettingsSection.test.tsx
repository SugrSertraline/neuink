// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import type { AgentRuntimeSettings } from '@/shared/types/agentRuntime';

import { AgentSettingsSection, type AgentSettingsView } from './AgentSettingsSection';

afterEach(cleanup);

describe('AgentSettingsSection information architecture', () => {
  it('shows every runtime subagent grouped by its actual responsibility', () => {
    const { getAllByText, getByText, queryByText } = renderSection('subagents');

    expect(queryByText('TaskOrchestratorAgent')).toBeNull();
    expect(queryByText('MemoryAgent')).toBeNull();
    expect(getAllByText('EvidenceAgent')).toHaveLength(2);
    expect(queryByText('PatchPlannerAgent')).toBeNull();
    expect(queryByText('系统流程')).toBeNull();
    expect(getByText('任务执行')).toBeTruthy();
  });

  it('separates the main agent identity, permissions, and worker assignments', () => {
    const { getByText, queryByLabelText } = renderSection('main-agent');

    expect(getByText('身份与模型')).toBeTruthy();
    expect(getByText('执行权限')).toBeTruthy();
    expect(getByText('可委派的任务型子 Agent')).toBeTruthy();
    expect(getByText('高级设置')).toBeTruthy();
    expect(queryByLabelText('Agent 运行链路')).toBeNull();
  });

  it('does not offer skill loading in assistant permissions', () => {
    const { queryByLabelText } = renderSection('main-agent');
    expect(queryByLabelText('允许加载 Skills')).toBeNull();
  });
});

function renderSection(view: AgentSettingsView) {
  const runtimeSettings = JSON.parse(
    JSON.stringify(DEFAULT_AGENT_RUNTIME_SETTINGS)
  ) as AgentRuntimeSettings;
  return render(
    <AgentSettingsSection
      llmProfiles={[{ id: 'profile-1', model: 'test-model', name: '测试模型' }]}
      runtimeSettings={runtimeSettings}
      selectedAgentId={null}
      view={view}
      onAddAgent={vi.fn()}
      onRemoveAgent={vi.fn()}
      onSelectAgent={vi.fn()}
      onUpdateAgent={vi.fn()}
      onUpdateRuntimeSettings={vi.fn()}
    />
  );
}
