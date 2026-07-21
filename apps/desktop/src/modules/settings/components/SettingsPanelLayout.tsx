import {
  Archive,
  ArrowLeft,
  Bot,
  BookOpen,
  Database,
  Palette,
  PlugZap,
  Server,
  Workflow
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { ReaderPreferences } from '@/shared/lib/readerPreferences';
import type { AppThemePreset, AppThemePresetId } from '@/shared/lib/themePresets';
import type { UiScale } from '@/shared/lib/uiScale';
import type {
  AgentProfile,
  AgentRuntimeSettings,
  SkillPackage
} from '@/shared/types/agentRuntime';

import { DataSettingsSection } from './DataSettingsSection';
import { ExternalToolsSettingsSection } from './ExternalToolsSettingsSection';
import { GeneralSettingsSections } from './GeneralSettingsSections';
import { ModelSettingsSection } from './ModelSettingsSection';
import type { ModelPreset, ProviderPreset } from './providerPresets';

type LlmProfileLike = {
  id: string;
  name: string;
  model: string;
  base_url: string;
  api_key?: string | null;
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

type ParserSourceMode = 'cloud' | 'custom';

type SettingsTab =
  | 'models'
  | 'tasks'
  | 'data'
  | 'appearance'
  | 'reader'
  | 'external-tools'
  | 'main-agent'
  | 'subagents'
  | 'skills';

export type SettingsPanelLayoutProps = {
  activeSettingsTab: SettingsTab;
  baseUrl: string;
  busy: boolean;
  cachedModelCatalog: { models: ModelPreset[]; updatedAt: string } | null;
  cloudUnlocked: boolean;
  customParserEndpoint: string;
  customParserApiKey: string;
  popoEnhancementEnabled: boolean;
  popoEnhancementEndpoint: string;
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
  onBaseUrlChange: (value: string) => void;
  onOpenWorkspace: () => void;
  onCreateWorkspace: () => void;
  onMigrateWorkspace: () => void;
  onOpenCurrentWorkspace: () => void;
  onOpenRecentWorkspace: (root: string) => void;
  onForgetRecentWorkspace: (root: string) => void;
  onClearAll: () => void;
  onCreateProfile: () => Promise<void> | void;
  onModelChange: (value: string) => void;
  onModelPresetSelect: (value: string) => void;
  onNameChange: (value: string) => void;
  onNewProfile: () => void;
  onParserEndpointChange: (value: string) => void;
  onParserApiKeyChange: (value: string) => void;
  onPopoEnhancementEnabledChange: (value: boolean) => void;
  onPopoEnhancementEndpointChange: (value: string) => void;
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onProviderPresetSelect: (label: string) => void;
  onRefreshModels: () => void;
  onRemoveCurrent: () => void;
  onDeleteProfile: (profileId: string) => Promise<void> | void;
  onSaveProfile: () => Promise<void> | void;
  onResetWorkspaceRoot: () => void;
  onSelectParserSourceMode: (mode: ParserSourceMode) => void;
  onSetActiveSettingsTab: (value: SettingsTab) => void;
  onAddAgent: () => void;
  onAddSkillPackage: () => void;
  onImportSkillPackage: () => void;
  onRemoveAgent: (agentId: string) => void;
  onRemoveSkillPackage: (skillPackageId: string) => void;
  onOpenSkillPackageFolder: (skillPackage: SkillPackage) => void;
  onSelectAgent: (agentId: string) => void;
  onSelectSkillPackage: (skillPackageId: string) => void;
  onSetTaskProfile: (task: 'assistant' | 'translation', profileId: string) => void;
  onThemePresetChange: (value: AppThemePresetId) => void;
  onUiScaleChange: (value: UiScale) => void;
  onSetUnlockSecret: (value: string) => void;
  onTest: () => void;
  onTestProfile: (profile: LlmProfileLike) => void;
  profileTestStates: Record<string, { message?: string; status: 'error' | 'idle' | 'success' | 'testing' }>;
  onUnlockCloudParser: () => void;
  parserSourceIntent: ParserSourceMode;
  parserSourceMode: ParserSourceMode;
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
  unlockBusy: boolean;
  unlockSecret: string;
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
  onUpdateSkillPackage: (nextSkillPackage: SkillPackage) => void;
  formatCacheTime: (value: string) => string;
  formatContextLength: (value?: number) => string;
  providerLogo: (preset: ProviderPreset) => ReactNode;
  collapsedProviderCount: number;
  onToggleProvidersExpanded: () => void;
  runtimeSettings: AgentRuntimeSettings;
  selectedAgentId: string | null;
  selectedSkillPackageId: string | null;
};

const SETTINGS_SECTIONS = [
  { value: 'models' as const, icon: Bot, title: '大模型' },
  { value: 'tasks' as const, icon: Server, title: '任务模型' },
  { value: 'data' as const, icon: Database, title: '数据与解析' },
  { value: 'appearance' as const, icon: Palette, title: '外观主题' },
  { value: 'reader' as const, icon: BookOpen, title: '阅读' },
  { value: 'external-tools' as const, icon: PlugZap, title: '外部工具' },
  { value: 'main-agent' as const, icon: Bot, title: '主 Agent' },
  { value: 'subagents' as const, icon: Workflow, title: '子 Agent' },
  { value: 'skills' as const, icon: Archive, title: 'Skills' }
];

export function SettingsPanelLayout(props: SettingsPanelLayoutProps) {
  const { activeSettingsTab, onBack, onSetActiveSettingsTab, sidebarMode } = props;
  const settingsTabsClassName = cn(
    'settings-panel-tabs grid min-h-0 flex-1 gap-0 overflow-hidden border border-border bg-card',
    sidebarMode
      ? 'rounded-none border-0 border-t'
      : 'rounded-lg'
  );
  return (
    <section
      className={cn(
        sidebarMode ? 'app-sidebar' : 'settings-page',
        'settings-panel-shell',
        sidebarMode && 'settings-panel-shell-sidebar'
      )}
    >
      <div className={sidebarMode ? 'side-head' : 'settings-page-head'}>
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <Button size="icon-sm" title="返回" type="button" variant="ghost" onClick={onBack}>
              <ArrowLeft />
            </Button>
          ) : null}
          <span>设置</span>
        </div>
      </div>

      <Tabs
        value={activeSettingsTab}
        onValueChange={(value) => onSetActiveSettingsTab(value as SettingsTab)}
        orientation="vertical"
        className={settingsTabsClassName}
      >
        <div className="settings-panel-nav border-r border-border/70 bg-card">
          <div className="side-body overflow-auto">
            <div className="settings-panel-nav-body p-2">
              <SettingsSidebarSection open title="设置分组">
                <div className="grid gap-1">
                  {SETTINGS_SECTIONS.map((section) => {
                    const Icon = section.icon;
                    const active = activeSettingsTab === section.value;

                    return (
                      <Tooltip key={section.value}>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label={section.title}
                            className={cn(
                              'settings-panel-nav-item min-h-9 w-full justify-start gap-2 px-2 text-left text-xs',
                              active
                                ? 'bg-accent font-semibold text-primary'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                            size="sm"
                            title={section.title}
                            type="button"
                            variant="ghost"
                            onClick={() => onSetActiveSettingsTab(section.value)}
                          >
                            <span className="settings-panel-nav-icon grid size-4 shrink-0 place-items-center">
                              <Icon size={14} />
                            </span>
                            <span className="settings-panel-nav-label min-w-0 flex-1 truncate">
                              {section.title}
                            </span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="right">{section.title}</TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </SettingsSidebarSection>
            </div>
          </div>
        </div>

        <ModelSettingsSection props={props} />
        <GeneralSettingsSections props={props} />
        <DataSettingsSection props={props} />
        <ExternalToolsSettingsSection props={props} />
      </Tabs>
    </section>
  );
}
function SettingsSidebarSection({
  children,
  open,
  title
}: {
  children: ReactNode;
  open: boolean;
  title: string;
}) {
  return (
    <section>
      <div className="settings-panel-nav-heading flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </div>
      {open ? <div className="space-y-0.5">{children}</div> : null}
    </section>
  );
}
