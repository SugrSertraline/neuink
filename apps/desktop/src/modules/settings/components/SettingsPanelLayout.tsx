import { ArrowLeft } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import type { LlmApiProtocol } from '@/shared/ipc/assistantApi';
import type { ReaderPreferences } from '@/shared/lib/readerPreferences';
import type { AppThemePreset, AppThemePresetId } from '@/shared/lib/themePresets';
import type { UiScale } from '@/shared/lib/uiScale';
import type { AgentProfile, AgentRuntimeSettings } from '@/shared/types/agentRuntime';
import { settingsCategory, type SettingsTab, type SettingsNavigationTarget } from '../settingsCatalog';
import { DataSettingsSection } from './DataSettingsSection';
import { ExternalToolsSettingsSection } from './ExternalToolsSettingsSection';
import { GeneralSettingsSections } from './GeneralSettingsSections';
import { ModelSettingsSection } from './ModelSettingsSection';
import { SettingsCategoryNavigation, SettingsSearch, SettingsSearchResults, SETTINGS_TAB_LABELS, useSettingsNavigation } from './SettingsNavigation';
import type { ModelPreset, ProviderPreset } from './providerPresets';

type LlmProfileLike = {
  id: string;
  name: string;
  model: string;
  base_url: string;
  api_key?: string | null;
  api_protocol?: LlmApiProtocol | null;
  max_context_length?: number | null;
  max_output_tokens?: number | null;
  temperature?: number | null;
  top_p?: number | null;
};

type SettingsStateLike = {
  profiles: LlmProfileLike[];
  assistant_profile_id: string | null;
  translation_profile_id: string | null;
};

type WorkspaceSettingsLike = {
  root: string;
  default_root: string;
  custom_root?: string | null;
  recent_workspaces: Array<{ root: string; last_opened_at_ms: number }>;
};

type TranslationAutomationSettingsLike = {
  auto_translate_pdf: boolean;
  segment_types: string[];
};

export type SettingsPanelLayoutProps = {
  activeSettingsTab: SettingsTab;
  navigationTarget?: SettingsNavigationTarget;
  modelsUnavailable?: boolean;
  modelMutationBusy?: boolean;
  workspaceSettingsUnavailable?: boolean;
  runtimeUnavailable?: boolean;
  feedback?: Array<{ key: string; message: string; error?: boolean; retry?: () => void }>;

  apiProtocol: LlmApiProtocol;
  baseUrl: string;
  busy: boolean;
  cachedModelCatalog: { models: ModelPreset[]; updatedAt: string } | null;
  customParserEndpoint: string;
  customParserApiKey: string;
  readerPreferences: ReaderPreferences;
  draftAssistantProfileId: string | null;
  draftTranslationProfileId: string | null;
  editingId: string | null;
  editingProfile: LlmProfileLike | null;
  effectiveParserEndpointLabel: string;
  maxContextLength: string;
  maxOutputTokens: string;
  model: string;
  modelPresets: ModelPreset[];
  modelRefreshBusy: boolean;
  name: string;
  onBack?: () => void;
  onApiProtocolChange: (value: LlmApiProtocol) => void;
  onBaseUrlChange: (value: string) => void;
  onOpenWorkspace: () => void;
  onCreateWorkspace: () => void;
  onMigrateWorkspace: () => void;
  onOpenCurrentWorkspace: () => void;
  onOpenRecentWorkspace: (root: string) => void;
  onForgetRecentWorkspace: (root: string) => void;
  onClearAll: () => void;
  onCreateProfile: () => Promise<boolean>;
  onModelChange: (value: string) => void;
  onModelPresetSelect: (value: string) => void;
  onNameChange: (value: string) => void;
  onNewProfile: () => void;
  onParserEndpointChange: (value: string) => void;
  onParserApiKeyChange: (value: string) => void;
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onProviderPresetSelect: (label: string) => void;
  onRefreshModels: () => void;
  onRemoveCurrent: () => void;
  onDeleteProfile: (profileId: string) => Promise<void> | void;
  onSaveProfile: () => Promise<boolean>;
  onResetWorkspaceRoot: () => void;
  onSetActiveSettingsTab: (value: SettingsTab) => void;
  onAddAgent: () => void;
  onRemoveAgent: (agentId: string) => void;
  onSelectAgent: (agentId: string) => void;
  onSetTaskProfile: (task: 'assistant' | 'translation', profileId: string) => void;
  onThemePresetChange: (value: AppThemePresetId) => void;
  onUiScaleChange: (value: UiScale) => void;
  onTest: () => void;
  onTestProfile: (profile: LlmProfileLike) => void;
  profileTestStates: Record<string, { message?: string; status: 'error' | 'idle' | 'success' | 'testing' }>;
  providerPreset: ProviderPreset | null;
  providerPresets: ProviderPreset[];
  providersExpanded: boolean;
  settings: SettingsStateLike;
  sidebarMode: boolean;
  temperature: string;
  themePreset: AppThemePresetId;
  themePresets: AppThemePreset[];
  uiScale: UiScale;
  topP: string;
  workspaceCurrentLabel: string;
  workspaceDefaultLabel: string;
  workspaceBusy: boolean;
  workspaceRoot?: string | null;
  workspaceSettings: WorkspaceSettingsLike | null;
  translationAutomation: TranslationAutomationSettingsLike;
  onApiKeyChange: (value: string) => void;
  apiKey: string;
  onMaxContextLengthChange: (value: string) => void;
  onTemperatureChange: (value: string) => void;
  onTopPChange: (value: string) => void;
  onTranslationAutomationChange: (settings: TranslationAutomationSettingsLike) => void;
  onMaxOutputTokensChange: (value: string) => void;
  onUpdateAgent: (nextAgent: AgentProfile) => void;
  onUpdateRuntimeSettings: (nextSettings: AgentRuntimeSettings) => void;
  formatCacheTime: (value: string) => string;
  formatContextLength: (value?: number) => string;
  providerLogo: (preset: ProviderPreset) => ReactNode;
  collapsedProviderCount: number;
  onToggleProvidersExpanded: () => void;
  runtimeSettings: AgentRuntimeSettings;
  selectedAgentId: string | null;
};

export function SettingsPanelLayout(props: SettingsPanelLayoutProps) {
  const { activeSettingsTab, onSetActiveSettingsTab, onBack } = props;
  const navigation = useSettingsNavigation(activeSettingsTab, onSetActiveSettingsTab, props.navigationTarget);
  const category = settingsCategory(activeSettingsTab);
  const scrollPositions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const viewport = navigation.rootRef.current?.querySelector<HTMLElement>('.settings-viewport');
    if (!viewport || navigation.query.trim()) return;
    viewport.scrollTop = scrollPositions.current.get(activeSettingsTab) ?? 0;
  }, [activeSettingsTab, Boolean(navigation.query.trim())]);
  const changeTab = (tab: SettingsTab) => { navigation.setQuery(''); onSetActiveSettingsTab(tab); };
  return <section ref={navigation.rootRef} className="settings-page settings-panel-shell">
    <div className="settings-page-head" data-material="sidebar-toolbar">
      <div className="flex items-center gap-2">{onBack && <Button size="icon-sm" aria-label="返回" variant="ghost" onClick={onBack}><ArrowLeft /></Button>}<span>设置</span></div>
      <SettingsSearch query={navigation.query} onChange={navigation.setQuery} />
    </div>
    <Tabs value={activeSettingsTab} orientation="vertical" className="settings-panel-tabs grid min-h-0 gap-0 overflow-hidden">
      <SettingsCategoryNavigation activeTab={activeSettingsTab} onChange={changeTab} />
      <div className="settings-main">
        {!navigation.query.trim() && category.tabs.length > 1 && <nav aria-label={`${category.title}分组`} className="settings-subnav">
          {category.tabs.map(tab => <Button key={tab} size="sm" variant={activeSettingsTab === tab ? 'secondary' : 'ghost'} aria-pressed={activeSettingsTab === tab} onClick={() => changeTab(tab)}>{SETTINGS_TAB_LABELS[tab]}</Button>)}
        </nav>}
        <div className="settings-viewport" onScroll={event => {
          if (!navigation.query.trim()) scrollPositions.current.set(activeSettingsTab, event.currentTarget.scrollTop);
        }}>
          {navigation.query.trim() && <SettingsSearchResults results={navigation.results} onSelect={navigation.navigate} />}
          <div hidden={Boolean(navigation.query.trim())}>
            <ModelSettingsSection props={props} />
            <GeneralSettingsSections props={props} />
            <DataSettingsSection props={props} />
            <ExternalToolsSettingsSection props={props} />
          </div>
        </div>
        {props.feedback?.length ? <div className="settings-feedback" aria-live="polite">{props.feedback.map(item => <div key={item.key} className={item.error ? 'text-destructive' : 'text-muted-foreground'}>
          <span>{item.message}</span>{item.retry && <Button size="xs" variant="outline" onClick={item.retry}>重试</Button>}
        </div>)}</div> : null}
      </div>
    </Tabs>
  </section>;
}
