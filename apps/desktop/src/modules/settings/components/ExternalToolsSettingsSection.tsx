import { SettingsPage } from './SettingsPrimitives';
import { SciverseSettingsSection } from '@/modules/sciverse/components/SciverseSettingsSection';
import { ResearchSettingsSection } from './ResearchSettingsSection';

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
    <SettingsPage tab="external-tools" title="工具与扩展" description="管理助手可使用的检索服务，开关更改后自动保存。">
        <ResearchSettingsSection active={active}><SciverseSettingsSection active={active} /></ResearchSettingsSection>
        {ADVANCED_ASSISTANT_SETTINGS_VISIBLE && <fieldset data-setting-id="tools-mcp" tabIndex={-1} disabled={props.runtimeUnavailable} className="min-w-0"><AgentToolRuntimeSection
          runtimeSettings={props.runtimeSettings}
          onUpdateRuntimeSettings={props.onUpdateRuntimeSettings}
        /></fieldset>}
    </SettingsPage>
  );
}
