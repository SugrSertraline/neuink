import { TabsContent } from '@/components/ui/tabs';
import { ADVANCED_ASSISTANT_SETTINGS_VISIBLE } from '../settingsCatalog';
import { AgentSettingsSection } from './AgentSettingsSection';
import { AppearanceSettingsSection } from './AppearanceSettingsSection';
import { ReaderSettingsSection } from './ReaderSettingsSection';
import { TranslationSettingsSection } from './TranslationSettingsSection';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';

export function GeneralSettingsSections({ props }: { props: SettingsPanelLayoutProps }) {
  return <>
    <AppearanceSettingsSection props={props} />
    <ReaderSettingsSection props={props} />
    <TranslationSettingsSection props={props} />
    {ADVANCED_ASSISTANT_SETTINGS_VISIBLE && (['main-agent', 'subagents'] as const).map(view => <TabsContent forceMount key={view} value={view} className="settings-content">
      <div data-setting-id={view === 'main-agent' ? 'agent-main' : 'agent-subagents'} tabIndex={-1} className="settings-panel-content-inner">
        <p className="mb-3 text-xs text-muted-foreground">当前资料库配置 · 修改自动保存。</p>
        <fieldset disabled={props.runtimeUnavailable} className="min-w-0">
          <AgentSettingsSection {...props} llmProfiles={props.settings.profiles} view={view} />
        </fieldset>
      </div>
    </TabsContent>)}
  </>;
}
