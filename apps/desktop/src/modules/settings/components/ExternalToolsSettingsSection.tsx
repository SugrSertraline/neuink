import { SettingsPage } from './SettingsPrimitives';
import { SciverseSettingsSection } from '@/modules/sciverse/components/SciverseSettingsSection';
import { ResearchSettingsSection } from './ResearchSettingsSection';
import { AssistantDebugSetting } from './AssistantDebugSetting';
import { LocalAgentSettingsSection } from './LocalAgentSettingsSection';

import { AgentToolRuntimeSection } from './AgentSettingsSection';
import { ADVANCED_ASSISTANT_SETTINGS_VISIBLE } from '../settingsCatalog';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';

export function ExternalToolsSettingsSection({
  props
}: {
  props: SettingsPanelLayoutProps;
}) {
  const active = props.activeSettingsTab === 'external-tools';

  return (
    <SettingsPage tab="external-tools" title="检索与工具" description="管理论文和网页检索、本地 Agent 及诊断选项。">
        <LocalAgentSettingsSection active={active} workspaceRoot={props.workspaceRoot} />
        <ResearchSettingsSection active={active}><SciverseSettingsSection active={active} /></ResearchSettingsSection>
        <AssistantDebugSetting />
        {ADVANCED_ASSISTANT_SETTINGS_VISIBLE && <fieldset data-setting-id="tools-mcp" tabIndex={-1} disabled={props.runtimeUnavailable} className="min-w-0"><AgentToolRuntimeSection
          runtimeSettings={props.runtimeSettings}
          onUpdateRuntimeSettings={props.onUpdateRuntimeSettings}
        /></fieldset>}
    </SettingsPage>
  );
}
