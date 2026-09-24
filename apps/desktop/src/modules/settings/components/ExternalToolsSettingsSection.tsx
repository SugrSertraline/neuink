import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { SciverseSettingsSection } from '@/modules/sciverse/components/SciverseSettingsSection';

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
    <TabsContent
      forceMount
      value="external-tools"
      className="settings-content"
    >
      <div className={cn('settings-panel-content-inner settings-form', 'grid gap-4')}>
        <div>
          <h2 className="text-base font-semibold">外部检索</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            配置 Sciverse 文献检索服务，凭据保存在系统凭据库中。
          </p>
        </div>

        <div data-setting-id="tools-services" tabIndex={-1}><SciverseSettingsSection active={active} /></div>
        {ADVANCED_ASSISTANT_SETTINGS_VISIBLE && <fieldset data-setting-id="tools-mcp" tabIndex={-1} disabled={props.runtimeUnavailable} className="min-w-0"><AgentToolRuntimeSection
          runtimeSettings={props.runtimeSettings}
          onUpdateRuntimeSettings={props.onUpdateRuntimeSettings}
        /></fieldset>}
      </div>
    </TabsContent>
  );
}
