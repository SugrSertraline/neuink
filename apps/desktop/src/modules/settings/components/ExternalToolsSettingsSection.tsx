import { SettingsPage } from './SettingsPrimitives';
import { SciverseSettingsSection } from '@/modules/sciverse/components/SciverseSettingsSection';
import { ResearchSettingsSection } from './ResearchSettingsSection';
import { ResearchComponentSettings } from './ResearchComponentSettings';

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
    <SettingsPage tab="external-tools" title="检索与工具" description="管理论文和网页检索及研究组件。">
        <ResearchSettingsSection active={active}>
          <SciverseSettingsSection active={active} />
          <ResearchComponentSettings active={active} workspaceRoot={props.workspaceRoot} />
        </ResearchSettingsSection>
        {ADVANCED_ASSISTANT_SETTINGS_VISIBLE && <fieldset data-setting-id="tools-mcp" tabIndex={-1} disabled={props.runtimeUnavailable} className="min-w-0"><AgentToolRuntimeSection
          runtimeSettings={props.runtimeSettings}
          onUpdateRuntimeSettings={props.onUpdateRuntimeSettings}
        /></fieldset>}
    </SettingsPage>
  );
}
