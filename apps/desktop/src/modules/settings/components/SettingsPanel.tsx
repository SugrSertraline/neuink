import { open } from '@tauri-apps/plugin-dialog';
import {
  ChevronDown,
  ChevronUp,
  KeyRound
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useToast } from '@/shared/hooks/useToast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  clearLlmSettings,
  deleteLlmProfile,
  getLlmSettings,
  importSkillPackageArchive,
  loadAgentRuntimeSettings,
  listSkillPackages,
  openPathInFileManager,
  saveAgentRuntimeSettings,
  saveLlmSettings,
  setTaskLlmProfile,
  type LlmProfile,
  type LlmSettingsState
} from '@/shared/ipc/assistantApi';
import {
  getWorkspaceSettings,
  forgetRecentWorkspace,
  inspectWorkspacePath,
  migrateWorkspaceRoot,
  updateTranslationAutomationSettings,
  type TranslationAutomationSettings,
  type WorkspacePathInspection,
  type WorkspaceSettings
} from '@/shared/ipc/workspaceApi';
import {
  CLOUD_PARSER_ENDPOINT,
  type ParserSourceMode,
  isCloudParserEndpoint,
  persistCloudUnlockState,
  readInitialParserSourceMode,
  readStoredCloudUnlockState,
  verifyCloudParserSecret
} from '@/shared/lib/parserSettings';
import {
  createBlankSkillPackage,
  equalAgentRuntimeSettings,
  mergeRegistrySkillPackages,
  normalizeAgentRuntimeSettings,
  readAgentRuntimeSettings
} from '@/shared/lib/agentRuntimeSettings';
import {
  equalReaderPreferences,
  type ReaderPreferences
} from '@/shared/lib/readerPreferences';
import type { AppThemePreset, AppThemePresetId } from '@/shared/lib/themePresets';
import type { UiScale } from '@/shared/lib/uiScale';
import type {
  AgentProfile,
  AgentRuntimeSettings,
  SkillPackage
} from '@/shared/types/agentRuntime';

import {
  listOpenAiCompatibleModels,
  testOpenAiCompatibleConnection,
  type ProviderModelInfo
} from '../../assistant/sdk/provider';
import { SettingsPanelLayout } from './SettingsPanelLayout';
import {
  resolveWorkspaceSelection,
  type WorkspaceSelectionIntent
} from '../workspaceSelection';
import {
  PROVIDER_PRESETS,
  type ModelPreset,
  type ProviderPreset
} from './providerPresets';

type SettingsPanelProps = {
  onBack?: () => void;
  parserEndpoint: string;
  parserApiKey: string;
  readerPreferences: ReaderPreferences;
  themePreset: AppThemePresetId;
  themePresets: AppThemePreset[];
  uiScale: UiScale;
  onParserEndpointChange: (value: string) => void;
  onParserApiKeyChange: (value: string) => void;
  popoEnhancementEnabled: boolean;
  popoEnhancementEndpoint: string;
  onPopoEnhancementEnabledChange: (value: boolean) => void;
  onPopoEnhancementEndpointChange: (value: string) => void;
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onResetWorkspaceRoot?: () => Promise<void>;
  onBeforeWorkspaceChange?: () => Promise<void>;
  onCreateWorkspaceRoot?: (root: string) => Promise<void>;
  onSettingsChanged?: (settings: LlmSettingsState) => void;
  onThemePresetChange: (value: AppThemePresetId) => void;
  onUiScaleChange: (value: UiScale) => void;
  onSwitchWorkspaceRoot?: (root: string) => Promise<void>;
  workspaceRoot?: string | null;
};

type PendingWorkspaceAction = {
  intent: WorkspaceSelectionIntent;
  inspection: WorkspacePathInspection;
};

type ProfileTestState = {
  message?: string;
  status: 'error' | 'idle' | 'success' | 'testing';
};


type ModelCatalogCache = Record<
  string,
  {
    models: ModelPreset[];
    updatedAt: string;
  }
>;

const COLLAPSED_PROVIDER_COUNT = 8;
const MODEL_CATALOG_CACHE_STORAGE_KEY = 'neuink.llmModelCatalog.v1';
const DEFAULT_TRANSLATION_AUTOMATION: TranslationAutomationSettings = {
  auto_translate_pdf: false,
  segment_types: [
    'paragraph', 'heading', 'table', 'math', 'figure', 'code', 'list',
    'page_header', 'page_footer', 'page_number', 'aside_text', 'page_footnote'
  ]
};


export function SettingsPanel({
  onBack,
  parserEndpoint,
  parserApiKey,
  readerPreferences,
  themePreset,
  themePresets,
  uiScale,
  onParserEndpointChange,
  onParserApiKeyChange,
  popoEnhancementEnabled,
  popoEnhancementEndpoint,
  onPopoEnhancementEnabledChange,
  onPopoEnhancementEndpointChange,
  onReaderPreferencesChange,
  onResetWorkspaceRoot,
  onBeforeWorkspaceChange,
  onCreateWorkspaceRoot,
  onSettingsChanged,
  onThemePresetChange,
  onUiScaleChange,
  onSwitchWorkspaceRoot,
  workspaceRoot
}: SettingsPanelProps) {
  const { notify } = useToast();
  const notifyFailure = (title: string, caught: unknown) => {
    notify({
      tone: 'danger',
      title,
      description: caught instanceof Error ? caught.message : String(caught)
    });
  };
  const sidebarMode = Boolean(onBack);
  const [settings, setSettings] = useState<LlmSettingsState>({
    assistant_profile: null,
    assistant_profile_id: null,
    profiles: [],
    translation_profile: null,
    translation_profile_id: null
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434/v1');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [maxContextLength, setMaxContextLength] = useState('8192');
  const [temperature, setTemperature] = useState('0.2');
  const [topP, setTopP] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');
  const [busy, setBusy] = useState(false);
  const [modelRefreshBusy, setModelRefreshBusy] = useState(false);
  const [modelCatalogCache, setModelCatalogCache] = useState<ModelCatalogCache>(() =>
    readModelCatalogCache()
  );
  const [providersExpanded, setProvidersExpanded] = useState(false);
  const [cloudUnlocked, setCloudUnlocked] = useState(readStoredCloudUnlockState);
  const [unlockSecret, setUnlockSecret] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [customParserEndpoint, setCustomParserEndpoint] = useState(parserEndpoint);
  const [customParserApiKey, setCustomParserApiKey] = useState(parserApiKey);
  const [parserSourceMode, setParserSourceMode] = useState<ParserSourceMode>(() =>
    readInitialParserSourceMode(parserEndpoint)
  );
  const [parserSourceIntent, setParserSourceIntent] = useState<ParserSourceMode>(() =>
    readInitialParserSourceMode(parserEndpoint)
  );
  const [savedParserEndpoint, setSavedParserEndpoint] = useState(parserEndpoint);
  const [savedParserApiKey, setSavedParserApiKey] = useState(parserApiKey);
  const [draftPopoEnhancementEnabled, setDraftPopoEnhancementEnabled] = useState(
    popoEnhancementEnabled
  );
  const [draftPopoEnhancementEndpoint, setDraftPopoEnhancementEndpoint] = useState(
    popoEnhancementEndpoint
  );
  const [savedPopoEnhancementEnabled, setSavedPopoEnhancementEnabled] = useState(
    popoEnhancementEnabled
  );
  const [savedPopoEnhancementEndpoint, setSavedPopoEnhancementEndpoint] = useState(
    popoEnhancementEndpoint
  );
  const [draftReaderPreferences, setDraftReaderPreferences] = useState(readerPreferences);
  const [savedReaderPreferences, setSavedReaderPreferences] = useState(readerPreferences);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings | null>(null);
  const [translationAutomation, setTranslationAutomation] = useState<TranslationAutomationSettings>(
    DEFAULT_TRANSLATION_AUTOMATION
  );
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [pendingWorkspaceAction, setPendingWorkspaceAction] = useState<PendingWorkspaceAction | null>(null);
  const [profileTestStates, setProfileTestStates] = useState<Record<string, ProfileTestState>>({});

  useEffect(() => {
    setDraftReaderPreferences(readerPreferences);
    setSavedReaderPreferences(readerPreferences);
  }, [readerPreferences]);
  const savedProfileFingerprintRef = useRef<string | null>(null);
  const profileSaveRequestRef = useRef(0);
  const pendingSavedParserEndpointRef = useRef<string | null>(null);
  const autoSaveToastTimerRef = useRef<number | null>(null);
  const announceAutoSave = (description: string) => {
    if (autoSaveToastTimerRef.current !== null) {
      window.clearTimeout(autoSaveToastTimerRef.current);
    }
    autoSaveToastTimerRef.current = window.setTimeout(() => {
      autoSaveToastTimerRef.current = null;
      notify({ tone: 'success', title: '设置已自动保存', description });
    }, 450);
  };
  useEffect(
    () => () => {
      if (autoSaveToastTimerRef.current !== null) {
        window.clearTimeout(autoSaveToastTimerRef.current);
      }
    },
    []
  );
  const [draftAssistantProfileId, setDraftAssistantProfileId] = useState<string | null>(null);
  const [draftTranslationProfileId, setDraftTranslationProfileId] = useState<string | null>(null);
  const [draftAgentRuntimeSettings, setDraftAgentRuntimeSettings] = useState<AgentRuntimeSettings>(() =>
    readAgentRuntimeSettings()
  );
  const [savedAgentRuntimeSettings, setSavedAgentRuntimeSettings] = useState<AgentRuntimeSettings>(() =>
    readAgentRuntimeSettings()
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    draftAgentRuntimeSettings.subagents[0]?.id ?? null
  );
  const [selectedSkillPackageId, setSelectedSkillPackageId] = useState<string | null>(
    draftAgentRuntimeSettings.skillPackages[0]?.id ?? null
  );
  const [activeSettingsTab, setActiveSettingsTab] = useState<
    'models' | 'tasks' | 'data' | 'appearance' | 'reader' | 'main-agent' | 'subagents' | 'skills'
  >(
    'models'
  );
  const editingProfile = useMemo(
    () => settings.profiles.find((profile) => profile.id === editingId) ?? null,
    [editingId, settings.profiles]
  );
  const providerPreset = useMemo(
    () => PROVIDER_PRESETS.find((preset) => sameBaseUrl(preset.baseUrl, baseUrl)) ?? null,
    [baseUrl]
  );
  const modelCatalogKey = normalizeBaseUrl(baseUrl);
  const cachedModelCatalog = modelCatalogCache[modelCatalogKey] ?? null;
  const modelPresets =
    cachedModelCatalog?.models.length ? cachedModelCatalog.models : providerPreset?.models ?? [];
  const visibleProviderPresets = providersExpanded
    ? PROVIDER_PRESETS
    : PROVIDER_PRESETS.slice(0, COLLAPSED_PROVIDER_COUNT);
  const effectiveParserEndpoint =
    parserSourceMode === 'cloud' ? CLOUD_PARSER_ENDPOINT : customParserEndpoint.trim();

  useEffect(() => {
    let cancelled = false;
    void getLlmSettings().then((nextSettings) => {
      if (cancelled) {
        return;
      }
      applySettings(nextSettings);
      const target = nextSettings.profiles[0] ?? null;
      if (target) {
        fillForm(target);
      }
      setDraftAssistantProfileId(nextSettings.assistant_profile_id);
      setDraftTranslationProfileId(nextSettings.translation_profile_id);
      onSettingsChanged?.(nextSettings);
    });
    void getWorkspaceSettings()
      .then((nextWorkspaceSettings) => {
        if (cancelled) {
          return;
        }
        setWorkspaceSettings(nextWorkspaceSettings);
        setTranslationAutomation(
          nextWorkspaceSettings.translation_automation ?? DEFAULT_TRANSLATION_AUTOMATION
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [onSettingsChanged]);

  useEffect(() => {
    const currentRoot = workspaceRoot ?? workspaceSettings?.root ?? '';
    if (!currentRoot) {
      return;
    }
    let cancelled = false;
    void Promise.all([loadAgentRuntimeSettings(currentRoot), listSkillPackages(currentRoot)])
      .then(([workspaceRuntimeSettings, registrySkills]) => {
        if (cancelled) {
          return;
        }
        const nextSettings = mergeRegistrySkillPackages(
          normalizeAgentRuntimeSettings(workspaceRuntimeSettings ?? readAgentRuntimeSettings()),
          registrySkills
        );
        setDraftAgentRuntimeSettings(nextSettings);
        setSavedAgentRuntimeSettings(nextSettings);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, workspaceSettings?.root]);

  useEffect(() => {
    if (
      pendingSavedParserEndpointRef.current &&
      parserEndpoint !== pendingSavedParserEndpointRef.current
    ) {
      return;
    }
    pendingSavedParserEndpointRef.current = null;
    setCloudUnlocked(readStoredCloudUnlockState());
    if (!isCloudParserEndpoint(parserEndpoint)) {
      setCustomParserEndpoint(parserEndpoint);
    }
    setSavedParserEndpoint(parserEndpoint);
    const nextSourceMode = readInitialParserSourceMode(parserEndpoint);
    setParserSourceMode(nextSourceMode);
    setParserSourceIntent(nextSourceMode);
  }, [parserEndpoint]);

  useEffect(() => {
    setCustomParserApiKey(parserApiKey);
    setSavedParserApiKey(parserApiKey);
  }, [parserApiKey]);

  useEffect(() => {
    setDraftPopoEnhancementEnabled(popoEnhancementEnabled);
    setSavedPopoEnhancementEnabled(popoEnhancementEnabled);
  }, [popoEnhancementEnabled]);

  useEffect(() => {
    setDraftPopoEnhancementEndpoint(popoEnhancementEndpoint);
    setSavedPopoEnhancementEndpoint(popoEnhancementEndpoint);
  }, [popoEnhancementEndpoint]);

  useEffect(() => {
    setDraftReaderPreferences(readerPreferences);
    setSavedReaderPreferences(readerPreferences);
  }, [readerPreferences]);

  useEffect(() => {
    setSelectedAgentId((current) =>
      draftAgentRuntimeSettings.subagents.some((agent) => agent.id === current)
        ? current
        : draftAgentRuntimeSettings.subagents[0]?.id ?? null
    );
    setSelectedSkillPackageId((current) =>
      draftAgentRuntimeSettings.skillPackages.some((skillPackage) => skillPackage.id === current)
        ? current
        : draftAgentRuntimeSettings.skillPackages[0]?.id ?? null
    );
  }, [draftAgentRuntimeSettings]);

  useEffect(() => {
    const root = workspaceRoot ?? workspaceSettings?.root ?? '';
    if (!root || equalAgentRuntimeSettings(draftAgentRuntimeSettings, savedAgentRuntimeSettings)) {
      return;
    }

    const timer = window.setTimeout(() => {
      const nextSettings = normalizeAgentRuntimeSettings(draftAgentRuntimeSettings);
      void saveAgentRuntimeSettings(root, nextSettings)
        .then(() => {
          setSavedAgentRuntimeSettings(nextSettings);
          announceAutoSave('Agent 与 Skill 设置已更新。');
        })
        .catch((caught) => {
          notify({
            tone: 'danger',
            title: 'Agent 设置保存失败',
            description: caught instanceof Error ? caught.message : String(caught)
          });
        });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [draftAgentRuntimeSettings, savedAgentRuntimeSettings, workspaceRoot, workspaceSettings?.root]);

  const applySettings = (nextSettings: LlmSettingsState) => {
    setSettings(nextSettings);
    setDraftAssistantProfileId(nextSettings.assistant_profile_id);
    setDraftTranslationProfileId(nextSettings.translation_profile_id);
    onSettingsChanged?.(nextSettings);
  };

  const saveTranslationAutomation = (nextSettings: TranslationAutomationSettings) => {
    setTranslationAutomation(nextSettings);
    void updateTranslationAutomationSettings(
      nextSettings.auto_translate_pdf,
      nextSettings.segment_types
    )
      .then((nextWorkspaceSettings) => {
        setWorkspaceSettings(nextWorkspaceSettings);
        setTranslationAutomation(nextWorkspaceSettings.translation_automation);
        announceAutoSave('PDF 自动翻译设置已更新。');
      })
      .catch((caught) => notifyFailure('自动保存失败', caught));
  };

  const fillForm = (profile: LlmProfile) => {
    setEditingId(profile.id);
    setName(profile.name);
    setBaseUrl(profile.base_url);
    setModel(profile.model);
    setApiKey(profile.api_key ?? '');
    setMaxContextLength(String(profile.max_context_length ?? 8192));
    setTemperature(profile.temperature == null ? '0.2' : String(profile.temperature));
    setTopP(profile.top_p == null ? '' : String(profile.top_p));
    setMaxOutputTokens(profile.max_output_tokens == null ? '' : String(profile.max_output_tokens));
    savedProfileFingerprintRef.current = profileFingerprint(profile);
  };

  useEffect(() => {
    if (!editingId || !baseUrl.trim() || !model.trim()) {
      return;
    }

    const fingerprint = profileFingerprint({
      api_key: apiKey || null,
      base_url: baseUrl,
      id: editingId,
      max_context_length: Number(maxContextLength) || null,
      max_output_tokens: Number(maxOutputTokens) || null,
      model,
      name: name || model,
      temperature: parseOptionalNumber(temperature) ?? null,
      top_p: parseOptionalNumber(topP) ?? null
    });
    if (fingerprint === savedProfileFingerprintRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      const requestId = profileSaveRequestRef.current + 1;
      profileSaveRequestRef.current = requestId;
      void saveLlmSettings({
        profileId: editingId,
        name: name || model,
        baseUrl,
        model,
        apiKey,
        maxContextLength: Number(maxContextLength) || undefined,
        temperature: parseOptionalNumber(temperature),
        topP: parseOptionalNumber(topP),
        maxOutputTokens: Number(maxOutputTokens) || undefined
      })
        .then((nextSettings) => {
          if (requestId !== profileSaveRequestRef.current) {
            return;
          }
          savedProfileFingerprintRef.current = fingerprint;
          applySettings(nextSettings);
          announceAutoSave('模型配置已更新。');
        })
        .catch((caught) => notifyFailure('模型配置自动保存失败', caught));
    }, 600);

    return () => window.clearTimeout(timer);
  }, [
    apiKey,
    baseUrl,
    editingId,
    maxContextLength,
    maxOutputTokens,
    model,
    name,
    temperature,
    topP
  ]);

  const updateAgentRuntimeSettings = (nextSettings: AgentRuntimeSettings) => {
    setDraftAgentRuntimeSettings(normalizeAgentRuntimeSettings(nextSettings));
  };

  const updateAgent = (nextAgent: AgentProfile) => {
    if (nextAgent.kind === 'main_assistant') {
      updateAgentRuntimeSettings({
        ...draftAgentRuntimeSettings,
        mainAssistant: nextAgent
      });
      return;
    }
    updateAgentRuntimeSettings({
      ...draftAgentRuntimeSettings,
      subagents: draftAgentRuntimeSettings.subagents.map((agent) =>
        agent.id === nextAgent.id ? nextAgent : agent
      )
    });
  };

  const updateSkillPackage = (nextSkillPackage: SkillPackage) => {
    updateAgentRuntimeSettings({
      ...draftAgentRuntimeSettings,
      skillPackages: draftAgentRuntimeSettings.skillPackages.map((skillPackage) =>
        skillPackage.id === nextSkillPackage.id ? nextSkillPackage : skillPackage
      )
    });
  };

  const importSkillPackage = async () => {
    const selected = await open({
      filters: [{ name: 'Skill Package', extensions: ['zip'] }],
      multiple: false
    });
    if (typeof selected !== 'string') {
      return;
    }
    setBusy(true);
    try {
      const currentRoot = workspaceRoot ?? workspaceSettings?.root ?? '';
      if (!currentRoot) {
        notify({ title: '无法导入 Skill', description: '请先打开或配置工作区。' });
        return;
      }
      const nextSkillPackage = await importSkillPackageArchive(currentRoot, selected);
      updateAgentRuntimeSettings({
        ...draftAgentRuntimeSettings,
        skillPackages: [
          ...draftAgentRuntimeSettings.skillPackages.filter(
            (skillPackage) => skillPackage.id !== nextSkillPackage.id
          ),
          nextSkillPackage
        ]
      });
      setSelectedSkillPackageId(nextSkillPackage.id);
      setActiveSettingsTab('skills');
      notify({ tone: 'success', title: '技能包已导入', description: '设置将自动保存。' });
    } catch (caught) {
      notifyFailure('导入 Skill 失败', caught);
    } finally {
      setBusy(false);
    }
  };

  const newProfile = () => {
    setEditingId(null);
    setName('');
    setBaseUrl('http://localhost:11434/v1');
    setModel('');
    setApiKey('');
    setMaxContextLength('8192');
    setTemperature('0.2');
    setTopP('');
    setMaxOutputTokens('');
  };

  const createProfile = async () => {
    if (!baseUrl.trim() || !model.trim()) {
      notify({ tone: 'danger', title: '无法创建模型配置', description: '请先填写 Base URL 和模型 ID。' });
      return;
    }
    setBusy(true);
    try {
      profileSaveRequestRef.current += 1;
      const previousProfileIds = new Set(settings.profiles.map((profile) => profile.id));
      const nextSettings = await saveLlmSettings({
        name: name || model,
        baseUrl,
        model,
        apiKey,
        maxContextLength: Number(maxContextLength) || undefined,
        temperature: parseOptionalNumber(temperature),
        topP: parseOptionalNumber(topP),
        maxOutputTokens: Number(maxOutputTokens) || undefined
      });
      applySettings(nextSettings);
      const createdProfile = nextSettings.profiles.find((profile) => !previousProfileIds.has(profile.id));
      if (createdProfile) {
        fillForm(createdProfile);
      }
      notify({ tone: 'success', title: '模型配置已创建', description: name || model });
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '创建模型配置失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
    } finally {
      setBusy(false);
    }
  };

  const saveCurrentProfile = async () => {
    if (!editingId || !baseUrl.trim() || !model.trim()) {
      notify({ tone: 'danger', title: '无法保存模型配置', description: '请先填写 Base URL 和模型 ID。' });
      return;
    }
    setBusy(true);
    try {
      const nextSettings = await saveLlmSettings({
        profileId: editingId,
        name: name || model,
        baseUrl,
        model,
        apiKey,
        maxContextLength: Number(maxContextLength) || undefined,
        temperature: parseOptionalNumber(temperature),
        topP: parseOptionalNumber(topP),
        maxOutputTokens: Number(maxOutputTokens) || undefined
      });
      applySettings(nextSettings);
      const savedProfile = nextSettings.profiles.find((profile) => profile.id === editingId);
      if (savedProfile) {
        fillForm(savedProfile);
      }
      notify({ tone: 'success', title: '模型配置已保存', description: name || model });
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '保存模型配置失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
    } finally {
      setBusy(false);
    }
  };

  const applyProviderPreset = (preset: ProviderPreset) => {
    setName(preset.label);
    setBaseUrl(preset.baseUrl);
    setEditingId(null);
    const cachedModels = modelCatalogCache[normalizeBaseUrl(preset.baseUrl)]?.models ?? [];
    applyModelPreset(cachedModels[0] ?? preset.models[0]);
  };

  const applyModelPreset = (preset: ModelPreset) => {
    setModel(preset.id);
    setMaxContextLength(
      preset.maxContextLength == null ? '' : String(preset.maxContextLength)
    );
    setTemperature(preset.temperature == null ? '0.2' : String(preset.temperature));
    setMaxOutputTokens(
      preset.maxOutputTokens == null ? '' : String(preset.maxOutputTokens)
    );
  };

  const selectParserSourceMode = (nextMode: ParserSourceMode, options?: { force?: boolean }) => {
    if (nextMode === 'cloud' && !cloudUnlocked && !options?.force) {
      setParserSourceIntent('cloud');
      notify({ title: '需要云端解析秘钥', description: '输入并验证秘钥后才会启用云端 MinerU。' });
      return;
    }

    setParserSourceIntent(nextMode);
    setParserSourceMode(nextMode);
    if (nextMode === 'cloud') {
      pendingSavedParserEndpointRef.current = CLOUD_PARSER_ENDPOINT;
      setSavedParserEndpoint(CLOUD_PARSER_ENDPOINT);
      onParserEndpointChange(CLOUD_PARSER_ENDPOINT);
      onParserApiKeyChange('');
      notify({ tone: 'success', title: '已切换到云端 MinerU' });
      return;
    }

    if (customParserEndpoint.trim()) {
      setSavedParserEndpoint(customParserEndpoint.trim());
      onParserEndpointChange(customParserEndpoint.trim());
      notify({ tone: 'success', title: '已切换到自定义解析服务' });
      return;
    }
    notify({ title: '缺少解析 URL', description: '请先填写自定义解析服务地址。' });
  };

  const unlockCloudParser = async () => {
    if (!unlockSecret.trim() || unlockBusy) {
      return;
    }

    try {
      setUnlockBusy(true);
      const matched = await verifyCloudParserSecret(unlockSecret);
      if (!matched) {
        notify({ tone: 'danger', title: '秘钥错误', description: '无法启用云端 MinerU。' });
        return;
      }

      persistCloudUnlockState(true);
      setCloudUnlocked(true);
      setUnlockSecret('');
      selectParserSourceMode('cloud', { force: true });
    } catch (caught) {
      notifyFailure('解锁云端解析失败', caught);
    } finally {
      setUnlockBusy(false);
    }
  };

  const refreshModels = async () => {
    setModelRefreshBusy(true);
    try {
      const models = await listOpenAiCompatibleModels({ baseUrl, apiKey });
      const nextModels = mergeModelPresets(
        models.map((model) => mergeRemoteModelPreset(model, providerPreset?.models ?? [])),
        providerPreset?.models ?? []
      );
      if (nextModels.length === 0) {
        throw new Error('模型列表为空');
      }
      const nextCache = {
        ...modelCatalogCache,
        [modelCatalogKey]: {
          models: nextModels,
          updatedAt: new Date().toISOString()
        }
      };
      setModelCatalogCache(nextCache);
      writeModelCatalogCache(nextCache);
      const synchronizedModel = nextModels.find((preset) => preset.id === model.trim());
      if (synchronizedModel) {
        applyModelPreset(synchronizedModel);
      }
      notify({
        tone: 'success',
        title: synchronizedModel ? '模型参数已同步' : '模型列表已更新',
        description: synchronizedModel
          ? `已从实时目录回填 ${synchronizedModel.id} 的上下文窗口与最大输出。`
          : `已拉取并缓存 ${nextModels.length} 个模型；当前模型 ID 未在目录中找到，可继续手动配置。`
      });
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      notify({
        tone: 'danger',
        title: '模型列表更新失败',
        description: cachedModelCatalog
          ? `${reason}；已保留上次缓存的 ${cachedModelCatalog.models.length} 个模型。`
          : `${reason}；当前没有缓存，请使用内置预设或手动填写模型 ID。`
      });
    } finally {
      setModelRefreshBusy(false);
    }
  };

  const saveAll = async () => {
    setBusy(true);
    setWorkspaceBusy(true);
    try {
      let nextSettings = settings;
      if (baseUrl.trim() && model.trim()) {
        nextSettings = await saveLlmSettings({
          profileId: editingId ?? undefined,
          name: name || model || 'Untitled model',
          baseUrl,
          model,
          apiKey,
          maxContextLength: Number(maxContextLength) || undefined,
          temperature: parseOptionalNumber(temperature),
          topP: parseOptionalNumber(topP),
          maxOutputTokens: Number(maxOutputTokens) || undefined
        });
        const savedProfile = editingId
          ? nextSettings.profiles.find((profile) => profile.id === editingId) ?? null
          : nextSettings.profiles[nextSettings.profiles.length - 1] ?? null;
        if (savedProfile) {
          fillForm(savedProfile);
          const assistantTarget = draftAssistantProfileId ?? nextSettings.assistant_profile_id;
          const translationTarget = draftTranslationProfileId ?? nextSettings.translation_profile_id;
          if (assistantTarget && assistantTarget !== nextSettings.assistant_profile_id) {
            nextSettings = await setTaskLlmProfile('assistant', assistantTarget);
          }
          if (translationTarget && translationTarget !== nextSettings.translation_profile_id) {
            nextSettings = await setTaskLlmProfile('translation', translationTarget);
          }
        }
      } else if (settings.profiles.length > 0) {
        if (draftAssistantProfileId && draftAssistantProfileId !== settings.assistant_profile_id) {
          nextSettings = await setTaskLlmProfile('assistant', draftAssistantProfileId);
        }
        if (draftTranslationProfileId && draftTranslationProfileId !== nextSettings.translation_profile_id) {
          nextSettings = await setTaskLlmProfile('translation', draftTranslationProfileId);
        }
      }

      applySettings(nextSettings);
      const normalizedRuntimeSettings = normalizeAgentRuntimeSettings(draftAgentRuntimeSettings);
      const agentRuntimeRoot = workspaceRoot ?? workspaceSettings?.root ?? '';
      if (agentRuntimeRoot) {
        await saveAgentRuntimeSettings(agentRuntimeRoot, normalizedRuntimeSettings);
      }
      setDraftAgentRuntimeSettings(normalizedRuntimeSettings);
      setSavedAgentRuntimeSettings(normalizedRuntimeSettings);
      const nextParserEndpoint =
        parserSourceMode === 'cloud' ? CLOUD_PARSER_ENDPOINT : customParserEndpoint.trim();
      const nextParserApiKey =
        parserSourceMode === 'cloud' ? '' : customParserApiKey.trim();
      pendingSavedParserEndpointRef.current = nextParserEndpoint;
      setSavedParserEndpoint(nextParserEndpoint);
      setSavedParserApiKey(nextParserApiKey);
      setSavedPopoEnhancementEnabled(draftPopoEnhancementEnabled);
      setSavedPopoEnhancementEndpoint(draftPopoEnhancementEndpoint);
      onParserEndpointChange(nextParserEndpoint);
      onParserApiKeyChange(nextParserApiKey);
      onPopoEnhancementEnabledChange(draftPopoEnhancementEnabled);
      onPopoEnhancementEndpointChange(draftPopoEnhancementEndpoint);
      onReaderPreferencesChange(draftReaderPreferences);
      setSavedReaderPreferences(draftReaderPreferences);

      notify({ tone: 'success', title: '设置已保存', description: '模型、任务和解析来源已应用。' });
    } catch (caught) {
      notifyFailure('保存设置失败', caught);
    } finally {
      setBusy(false);
      setWorkspaceBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await testOpenAiCompatibleConnection({ baseUrl, apiKey });
      notify({ tone: 'success', title: '连接测试通过' });
    } catch (caught) {
      notifyFailure('连接测试失败', caught);
    } finally {
      setBusy(false);
    }
  };

  const testProfile = async (
    profile: Pick<LlmProfile, 'base_url' | 'id' | 'name'> & { api_key?: string | null }
  ) => {
    setProfileTestStates((current) => ({
      ...current,
      [profile.id]: { status: 'testing' }
    }));
    try {
      await testOpenAiCompatibleConnection({
        baseUrl: profile.base_url,
        apiKey: profile.api_key ?? ''
      });
      setProfileTestStates((current) => ({
        ...current,
        [profile.id]: { status: 'success' }
      }));
      notify({ tone: 'success', title: '连接测试通过', description: profile.name });
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      setProfileTestStates((current) => ({
        ...current,
        [profile.id]: {
          message: reason,
          status: 'error'
        }
      }));
      notify({ tone: 'danger', title: '连接测试失败', description: reason });
    }
  };

  const deleteProfile = async (profileId: string) => {
    setBusy(true);
    try {
      const nextSettings = await deleteLlmProfile(profileId);
      applySettings(nextSettings);
      const nextProfile = nextSettings.profiles[0] ?? null;
      if (nextProfile) {
        fillForm(nextProfile);
      } else {
        newProfile();
      }
      setProfileTestStates((current) => {
        const next = { ...current };
        delete next[profileId];
        return next;
      });
      notify({ tone: 'success', title: '模型配置已删除' });
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '删除模型配置失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
    } finally {
      setBusy(false);
    }
  };

  const removeCurrent = async () => {
    if (!editingId) {
      return;
    }
    setBusy(true);
    try {
      const nextSettings = await deleteLlmProfile(editingId);
      applySettings(nextSettings);
      const target = nextSettings.profiles[0] ?? null;
      if (target) {
        fillForm(target);
      } else {
        newProfile();
      }
      notify({ tone: 'success', title: '模型配置已删除' });
    } catch (caught) {
      notifyFailure('删除模型配置失败', caught);
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      await clearLlmSettings();
      const empty = {
        assistant_profile: null,
        assistant_profile_id: null,
        profiles: [],
        translation_profile: null,
        translation_profile_id: null
      };
      applySettings(empty);
      newProfile();
      notify({ tone: 'success', title: '所有模型配置已清除' });
    } catch (caught) {
      notifyFailure('清除模型配置失败', caught);
    } finally {
      setBusy(false);
    }
  };

  const chooseWorkspaceFolder = async (intent: PendingWorkspaceAction['intent']) => {
    const selected = await open({
      directory: true,
      multiple: false
    });
    if (typeof selected !== 'string') {
      return;
    }
    setWorkspaceBusy(true);
    try {
      const inspection = await inspectWorkspacePath(selected);
      const resolution = resolveWorkspaceSelection(intent, inspection);
      if ('intent' in resolution) {
        setPendingWorkspaceAction({ intent: resolution.intent, inspection });
      } else {
        notify({ tone: 'danger', title: '无法使用所选工作区', description: resolution.message });
      }
    } catch (caught) {
      notifyFailure('检查工作区失败', caught);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const inspectAndOpenRecentWorkspace = async (root: string) => {
    setWorkspaceBusy(true);
    try {
      const inspection = await inspectWorkspacePath(root);
      if (inspection.kind === 'valid_workspace') {
        setPendingWorkspaceAction({ intent: 'switch', inspection });
      } else {
        notify({ tone: 'danger', title: '无法打开最近工作区', description: inspection.message });
      }
    } catch (caught) {
      notifyFailure('检查最近工作区失败', caught);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const confirmWorkspaceAction = async () => {
    if (!pendingWorkspaceAction) {
      return;
    }
    setWorkspaceBusy(true);
    try {
      await onBeforeWorkspaceChange?.();
      const { inspection, intent } = pendingWorkspaceAction;
      if (intent === 'switch') {
        if (!onSwitchWorkspaceRoot) {
          throw new Error('当前窗口不支持切换工作区。');
        }
        await onSwitchWorkspaceRoot(inspection.root);
        notify({ tone: 'success', title: '已切换工作区' });
      } else if (intent === 'create') {
        if (!onCreateWorkspaceRoot) {
          throw new Error('当前窗口不支持新建工作区。');
        }
        await onCreateWorkspaceRoot(inspection.root);
        notify({ tone: 'success', title: '已新建并打开工作区' });
      } else {
        await migrateWorkspaceRoot(inspection.root);
        notify({ tone: 'success', title: '工作区迁移完成', description: '工作区已复制并验证，应用正在重新打开。' });
      }
      setPendingWorkspaceAction(null);
      if (intent !== 'migrate') {
        setWorkspaceSettings(await getWorkspaceSettings());
      }
    } catch (caught) {
      notifyFailure('工作区操作失败', caught);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const resetWorkspaceRoot = async () => {
    if (!onResetWorkspaceRoot) {
      return;
    }
    setWorkspaceBusy(true);
    try {
      await onBeforeWorkspaceChange?.();
      await onResetWorkspaceRoot();
      const nextWorkspaceSettings = await getWorkspaceSettings();
      setWorkspaceSettings(nextWorkspaceSettings);
      notify({ tone: 'success', title: '已打开默认工作区' });
    } catch (caught) {
      notifyFailure('打开默认工作区失败', caught);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const workspaceActionTitle = pendingWorkspaceAction?.intent === 'switch'
    ? '切换工作区'
    : pendingWorkspaceAction?.intent === 'create'
      ? '新建工作区'
      : '迁移当前工作区';
  const workspaceActionLabel = pendingWorkspaceAction?.intent === 'switch'
    ? '切换'
    : pendingWorkspaceAction?.intent === 'create'
      ? '新建并打开'
      : '开始迁移';

  return (
    <>
      <SettingsPanelLayout
      activeSettingsTab={activeSettingsTab}
      apiKey={apiKey}
      baseUrl={baseUrl}
      busy={busy}
      cachedModelCatalog={cachedModelCatalog}
      cloudUnlocked={cloudUnlocked}
      collapsedProviderCount={PROVIDER_PRESETS.length > COLLAPSED_PROVIDER_COUNT ? PROVIDER_PRESETS.length : 0}
      customParserEndpoint={customParserEndpoint}
      customParserApiKey={customParserApiKey}
      readerPreferences={draftReaderPreferences}
      draftAssistantProfileId={draftAssistantProfileId}
      draftTranslationProfileId={draftTranslationProfileId}
      editingId={editingId}
      editingProfile={editingProfile}
      effectiveParserEndpointLabel={formatEndpointForDisplay(effectiveParserEndpoint)}
      formatCacheTime={formatCacheTime}
      formatContextLength={formatContextLength}
      maxContextLength={maxContextLength}
      maxOutputTokens={maxOutputTokens}
      model={model}
      modelPresets={modelPresets}
      modelRefreshBusy={modelRefreshBusy}
      name={name}
      onApiKeyChange={setApiKey}
      onBack={onBack}
      onBaseUrlChange={setBaseUrl}
      onOpenWorkspace={() => void chooseWorkspaceFolder('switch')}
      onCreateWorkspace={() => void chooseWorkspaceFolder('create')}
      onMigrateWorkspace={() => void chooseWorkspaceFolder('migrate')}
      onOpenCurrentWorkspace={() => {
        const root = workspaceRoot ?? workspaceSettings?.root;
        if (root) {
          void openPathInFileManager(root);
        }
      }}
      onOpenRecentWorkspace={(root) => void inspectAndOpenRecentWorkspace(root)}
      onForgetRecentWorkspace={(root) => {
        void forgetRecentWorkspace(root)
          .then((nextSettings) => {
            setWorkspaceSettings(nextSettings);
            notify({ tone: 'success', title: '已从最近工作区中移除' });
          })
          .catch((caught) => notifyFailure('移除最近工作区失败', caught));
      }}
      onClearAll={() => void clearAll()}
      onCreateProfile={() => createProfile()}
      onMaxContextLengthChange={setMaxContextLength}
      onMaxOutputTokensChange={setMaxOutputTokens}
      onModelChange={setModel}
      onModelPresetSelect={(value) => {
        const preset = modelPresets.find((item) => item.id === value);
        if (preset) {
          applyModelPreset(preset);
        }
      }}
      onNameChange={setName}
      onNewProfile={newProfile}
      onParserEndpointChange={(nextValue) => {
        setCustomParserEndpoint(nextValue);
        setParserSourceIntent('custom');
        setParserSourceMode('custom');
        setSavedParserEndpoint(nextValue);
        onParserEndpointChange(nextValue);
        announceAutoSave('解析 URL 已更新。');
      }}
      onParserApiKeyChange={(nextValue) => {
        setCustomParserApiKey(nextValue);
        setSavedParserApiKey(nextValue);
        onParserApiKeyChange(nextValue);
        announceAutoSave('解析 API Key 已更新。');
      }}
      popoEnhancementEnabled={draftPopoEnhancementEnabled}
      popoEnhancementEndpoint={draftPopoEnhancementEndpoint}
      onPopoEnhancementEnabledChange={(nextValue) => {
        setDraftPopoEnhancementEnabled(nextValue);
        setSavedPopoEnhancementEnabled(nextValue);
        onPopoEnhancementEnabledChange(nextValue);
        announceAutoSave('Popo 增强设置已更新。');
      }}
      onPopoEnhancementEndpointChange={(nextValue) => {
        setDraftPopoEnhancementEndpoint(nextValue);
        setSavedPopoEnhancementEndpoint(nextValue);
        onPopoEnhancementEndpointChange(nextValue);
        announceAutoSave('Popo 增强 URL 已更新。');
      }}
      onReaderPreferencesChange={(nextPreferences) => {
        setDraftReaderPreferences(nextPreferences);
        setSavedReaderPreferences(nextPreferences);
        onReaderPreferencesChange(nextPreferences);
        announceAutoSave('阅读设置已更新。');
      }}
      onProviderPresetSelect={(value) => {
        if (value.startsWith('__profile__')) {
          const profile = settings.profiles.find((item) => `__profile__${item.id}` === value);
          if (profile) {
            fillForm(profile);
          }
          return;
        }
        const preset = PROVIDER_PRESETS.find((item) => item.label === value);
        if (preset) {
          applyProviderPreset(preset);
        }
      }}
      onRefreshModels={() => void refreshModels()}
      onRemoveCurrent={() => void removeCurrent()}
      onDeleteProfile={(profileId) => deleteProfile(profileId)}
      onSaveProfile={() => saveCurrentProfile()}
      onResetWorkspaceRoot={() => void resetWorkspaceRoot()}
      onSelectParserSourceMode={selectParserSourceMode}
      onSetActiveSettingsTab={setActiveSettingsTab}
      onAddAgent={() => {
        notify({
          title: '暂不支持新增子 Agent',
          description: '当前版本只开放两个内置子 Agent：EvidenceAgent 和 PatchPlannerAgent。'
        });
        setActiveSettingsTab('subagents');
      }}
      onAddSkillPackage={() => {
        const nextSkillPackage = createBlankSkillPackage(
          draftAgentRuntimeSettings.skillPackages.length + 1
        );
        updateAgentRuntimeSettings({
          ...draftAgentRuntimeSettings,
          skillPackages: [...draftAgentRuntimeSettings.skillPackages, nextSkillPackage]
        });
        setSelectedSkillPackageId(nextSkillPackage.id);
        setActiveSettingsTab('skills');
      }}
      onImportSkillPackage={() => void importSkillPackage()}
      onSetTaskProfile={(task, profileId) => {
        if (task === 'assistant') {
          setDraftAssistantProfileId(profileId);
        } else {
          setDraftTranslationProfileId(profileId);
        }
        void setTaskLlmProfile(task, profileId)
          .then((nextSettings) => {
            applySettings(nextSettings);
            announceAutoSave('任务模型已更新。');
          })
          .catch((caught) => notifyFailure('任务模型自动保存失败', caught));
      }}
      onSetUnlockSecret={setUnlockSecret}
      onTemperatureChange={setTemperature}
      onTest={() => void test()}
      onTestProfile={(profile) => void testProfile(profile)}
      profileTestStates={profileTestStates}
      onToggleProvidersExpanded={() => setProvidersExpanded((value) => !value)}
      onTopPChange={setTopP}
      onTranslationAutomationChange={saveTranslationAutomation}
      onUnlockCloudParser={() => void unlockCloudParser()}
      parserSourceIntent={parserSourceIntent}
      parserSourceMode={parserSourceMode}
      providerLogo={(preset) => <ProviderLogo preset={preset} />}
      providerPreset={providerPreset}
      providerPresets={visibleProviderPresets}
      providersExpanded={providersExpanded}
      settings={settings}
      sidebarMode={sidebarMode}
      temperature={temperature}
      themePreset={themePreset}
      themePresets={themePresets}
      uiScale={uiScale}
      topP={topP}
      unlockBusy={unlockBusy}
      unlockSecret={unlockSecret}
      workspaceCurrentLabel={formatPathForDisplay(workspaceRoot ?? workspaceSettings?.root ?? '')}
      workspaceDefaultLabel={formatPathForDisplay(workspaceSettings?.default_root ?? '')}
      workspaceBusy={workspaceBusy}
      workspaceRoot={workspaceRoot}
      workspaceSettings={workspaceSettings}
      translationAutomation={translationAutomation}
      onThemePresetChange={onThemePresetChange}
      onUiScaleChange={onUiScaleChange}
      onRemoveAgent={(agentId) => {
        void agentId;
        notify({ title: '内置子 Agent 不能删除', description: '可以在 Agent 设置中将其停用。' });
      }}
      onRemoveSkillPackage={(skillPackageId) => {
        updateAgentRuntimeSettings({
          ...draftAgentRuntimeSettings,
          mainAssistant: {
            ...draftAgentRuntimeSettings.mainAssistant,
            allowedSkillPackageIds: draftAgentRuntimeSettings.mainAssistant.allowedSkillPackageIds.filter(
              (id) => id !== skillPackageId
            )
          },
          subagents: draftAgentRuntimeSettings.subagents.map((agent) => ({
            ...agent,
            allowedSkillPackageIds: agent.allowedSkillPackageIds.filter(
              (id) => id !== skillPackageId
            )
          })),
          skillPackages: draftAgentRuntimeSettings.skillPackages.filter(
            (skillPackage) => skillPackage.id !== skillPackageId
          )
        });
      }}
      onOpenSkillPackageFolder={(skillPackage) => {
        const path = skillPackage.packagePath ?? skillPackage.skillMarkdownPath;
        if (!path) {
          notify({ title: '无法打开 Skill 目录', description: '这个 Skill 还没有本地安装目录。' });
          return;
        }
        void openPathInFileManager(path).catch((caught) => {
          notifyFailure('打开 Skill 目录失败', caught);
        });
      }}
      onSelectAgent={setSelectedAgentId}
      onSelectSkillPackage={setSelectedSkillPackageId}
      onUpdateAgent={updateAgent}
      onUpdateRuntimeSettings={updateAgentRuntimeSettings}
      onUpdateSkillPackage={updateSkillPackage}
      runtimeSettings={draftAgentRuntimeSettings}
      selectedAgentId={selectedAgentId}
      selectedSkillPackageId={selectedSkillPackageId}
      />
      <Dialog
        open={Boolean(pendingWorkspaceAction)}
        onOpenChange={(open) => {
          if (!open && !workspaceBusy) {
            setPendingWorkspaceAction(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{workspaceActionTitle}</DialogTitle>
            <DialogDescription>
              {pendingWorkspaceAction?.intent === 'switch'
                ? `将打开包含 ${pendingWorkspaceAction.inspection.entry_count} 个条目的工作区。`
                : pendingWorkspaceAction?.intent === 'create'
                  ? '所选位置是空目录，将在这里创建一个新的 Neuink 工作区。'
                  : '将复制当前工作区到新位置，验证成功后切换。原位置会保留。'}
            </DialogDescription>
          </DialogHeader>
          <div className="break-all rounded-md border bg-muted/30 px-3 py-2 text-xs">
            {formatPathForDisplay(pendingWorkspaceAction?.inspection.root ?? '')}
          </div>
          <DialogFooter>
            <Button disabled={workspaceBusy} variant="outline" onClick={() => setPendingWorkspaceAction(null)}>
              取消
            </Button>
            <Button disabled={workspaceBusy} onClick={() => void confirmWorkspaceAction()}>
              {workspaceBusy ? '处理中…' : workspaceActionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatPathForDisplay(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${trimmed.slice('\\\\?\\UNC\\'.length)}`;
  }
  if (trimmed.startsWith('\\\\?\\')) {
    return trimmed.slice('\\\\?\\'.length);
  }
  return trimmed;
}

function formatEndpointForDisplay(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '未填写解析服务 URL';
  }
  if (isCloudParserEndpoint(trimmed)) {
    return 'NeuLab 云端解析服务';
  }
  return trimmed;
}

type PendingSettingsDraft = {
  baseUrl: string;
  customParserEndpoint: string;
  customParserApiKey: string;
  draftAgentRuntimeSettings: AgentRuntimeSettings;
  draftAssistantProfileId: string | null;
  draftTranslationProfileId: string | null;
  draftPopoEnhancementEnabled: boolean;
  draftPopoEnhancementEndpoint: string;
  effectiveParserEndpoint: string;
  editingId: string | null;
  name: string;
  apiKey: string;
  maxContextLength: string;
  maxOutputTokens: string;
  model: string;
  readerPreferences: ReaderPreferences;
  savedParserEndpoint: string;
  savedParserApiKey: string;
  savedPopoEnhancementEnabled: boolean;
  savedPopoEnhancementEndpoint: string;
  savedReaderPreferences: ReaderPreferences;
  parserSourceMode: ParserSourceMode;
  savedAgentRuntimeSettings: AgentRuntimeSettings;
  settings: LlmSettingsState;
  temperature: string;
  topP: string;
};

function profileFingerprint(profile: {
  api_key: string | null;
  base_url: string;
  id: string;
  max_context_length: number | null;
  max_output_tokens: number | null;
  model: string;
  name: string;
  temperature: number | null;
  top_p: number | null;
}) {
  return JSON.stringify({
    apiKey: profile.api_key ?? '',
    baseUrl: profile.base_url.trim(),
    maxContextLength: profile.max_context_length,
    maxOutputTokens: profile.max_output_tokens,
    model: profile.model.trim(),
    name: profile.name.trim(),
    temperature: profile.temperature,
    topP: profile.top_p
  });
}

function hasPendingChanges(draft: PendingSettingsDraft) {
  const editingProfile = draft.settings.profiles.find((profile) => profile.id === draft.editingId) ?? null;
  const isEditingNewProfile = !draft.editingId && draft.baseUrl.trim() && draft.model.trim();
  const modelChanged = editingProfile
    ? editingProfile.name !== (draft.name || draft.model || 'Untitled model') ||
      editingProfile.base_url !== normalizeBaseUrl(draft.baseUrl) ||
      editingProfile.model !== draft.model.trim() ||
      (editingProfile.api_key ?? '') !== draft.apiKey.trim() ||
      String(editingProfile.max_context_length ?? 8192) !== String(Number(draft.maxContextLength) || 8192) ||
      String(editingProfile.temperature ?? 0.2) !== String(parseOptionalNumber(draft.temperature) ?? 0.2) ||
      String(editingProfile.top_p ?? '') !== String(parseOptionalNumber(draft.topP) ?? '') ||
      String(editingProfile.max_output_tokens ?? '') !== String(Number(draft.maxOutputTokens) || '')
    : Boolean(isEditingNewProfile);

  const assistantChanged =
    draft.draftAssistantProfileId != null &&
    draft.draftAssistantProfileId !== draft.settings.assistant_profile_id;
  const translationChanged =
    draft.draftTranslationProfileId != null &&
    draft.draftTranslationProfileId !== draft.settings.translation_profile_id;
  const parserChanged =
    draft.effectiveParserEndpoint.trim() !== draft.savedParserEndpoint.trim() ||
    (draft.parserSourceMode === 'custom' && draft.customParserApiKey !== draft.savedParserApiKey);
  const popoChanged =
    draft.draftPopoEnhancementEnabled !== draft.savedPopoEnhancementEnabled ||
    draft.draftPopoEnhancementEndpoint.trim() !== draft.savedPopoEnhancementEndpoint.trim();
  const readerPreferencesChanged = !equalReaderPreferences(
    draft.readerPreferences,
    draft.savedReaderPreferences
  );
  const agentRuntimeChanged = !equalAgentRuntimeSettings(
    normalizeAgentRuntimeSettings(draft.draftAgentRuntimeSettings),
    normalizeAgentRuntimeSettings(draft.savedAgentRuntimeSettings)
  );

  return (
    modelChanged ||
    assistantChanged ||
    translationChanged ||
    parserChanged ||
    popoChanged ||
    agentRuntimeChanged ||
    readerPreferencesChanged
  );
}
function readModelCatalogCache(): ModelCatalogCache {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(MODEL_CATALOG_CACHE_STORAGE_KEY) ?? '{}'
    ) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const cache: ModelCatalogCache = {};
    for (const [key, value] of Object.entries(parsed as ModelCatalogCache)) {
      const models = Array.isArray(value.models)
        ? value.models.filter((model) => model && typeof model.id === 'string')
        : [];
      if (models.length === 0) {
        continue;
      }
      cache[normalizeBaseUrl(key)] = {
        models,
        updatedAt:
          typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString()
      };
    }
    return cache;
  } catch {
    return {};
  }
}

function writeModelCatalogCache(cache: ModelCatalogCache) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(MODEL_CATALOG_CACHE_STORAGE_KEY, JSON.stringify(cache));
}

function sameBaseUrl(left: string, right: string) {
  return normalizeBaseUrl(left) === normalizeBaseUrl(right);
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function mergeRemoteModelPreset(model: ProviderModelInfo, staticPresets: ModelPreset[]) {
  const fallback = staticPresets.find((preset) => preset.id === model.id);
  return {
    id: model.id,
    label: model.name && model.name !== model.id ? model.name : undefined,
    maxContextLength: model.maxContextLength,
    maxOutputTokens: model.maxOutputTokens,
    metadataSource: model.metadataSource ?? fallback?.metadataSource ?? 'built_in',
    modelContextLength: model.modelContextLength,
    providerContextLength: model.providerContextLength,
    temperature: fallback?.temperature ?? 0.2
  };
}

function mergeModelPresets(primary: ModelPreset[], fallback: ModelPreset[]) {
  const seen = new Set<string>();
  return [...primary, ...fallback].filter((preset) => {
    if (seen.has(preset.id)) {
      return false;
    }
    seen.add(preset.id);
    return true;
  });
}

function formatContextLength(value?: number) {
  if (value == null) {
    return '仅模型 ID';
  }
  if (value >= 1000000) {
    return `${Math.round(value / 10000) / 100}M ctx`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)}K ctx`;
  }
  return `${value} ctx`;
}

function formatCacheTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '未知时间';
  }
  return date.toLocaleString();
}

function ProviderLogo({ preset }: { preset: ProviderPreset }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-semibold leading-none"
      style={{
        backgroundColor: preset.brand.background,
        color: preset.brand.foreground
      }}
    >
      {preset.brand.mark}
    </span>
  );
}
