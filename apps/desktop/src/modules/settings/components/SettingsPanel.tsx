import { ADVANCED_ASSISTANT_SETTINGS_VISIBLE, readSettingsTab, rememberSettingsTab, visibleSettingsTab, type SettingsTab, type SettingsNavigationTarget } from '../settingsCatalog';
import { useSettingsAutosave } from '../useSettingsAutosave';
import { open } from '@tauri-apps/plugin-dialog';
import {
  ChevronDown,
  ChevronUp,
  KeyRound
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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
  loadAgentRuntimeSettings,
  openPathInFileManager,
  saveAgentRuntimeSettings,
  saveLlmSettings,
  setTaskLlmProfile,
  type LlmApiProtocol,
  type LlmProfile,
  type LlmSettingsState,
  resolveLlmApiProtocol
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
  equalAgentRuntimeSettings,
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
  AgentRuntimeSettings
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
  navigationTarget?: SettingsNavigationTarget;
  onBack?: () => void;
  parserEndpoint: string;
  parserApiKey: string;
  readerPreferences: ReaderPreferences;
  themePreset: AppThemePresetId;
  themePresets: AppThemePreset[];
  uiScale: UiScale;
  onParserEndpointChange: (value: string) => void;
  onParserApiKeyChange: (value: string) => void;
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
  navigationTarget,
  onBack,
  parserEndpoint,
  parserApiKey,
  readerPreferences,
  themePreset,
  themePresets,
  uiScale,
  onParserEndpointChange,
  onParserApiKeyChange,
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
  const [apiProtocol, setApiProtocol] = useState<LlmApiProtocol>('openai_compatible');
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
  const [customParserEndpoint, setCustomParserEndpoint] = useState(parserEndpoint);
  const [customParserApiKey, setCustomParserApiKey] = useState(parserApiKey);
  const [savedParserEndpoint, setSavedParserEndpoint] = useState(parserEndpoint);
  const [savedParserApiKey, setSavedParserApiKey] = useState(parserApiKey);
  const [draftReaderPreferences, setDraftReaderPreferences] = useState(readerPreferences);
  const [savedReaderPreferences, setSavedReaderPreferences] = useState(readerPreferences);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings | null>(null);
  const [translationAutomation, setTranslationAutomation] = useState<TranslationAutomationSettings>(
    DEFAULT_TRANSLATION_AUTOMATION
  );
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [pendingWorkspaceAction, setPendingWorkspaceAction] = useState<PendingWorkspaceAction | null>(null);
  const [profileTestStates, setProfileTestStates] = useState<Record<string, ProfileTestState>>({});

  const [modelsReady, setModelsReady] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [reloadModels, setReloadModels] = useState(0);
  const [reloadWorkspace, setReloadWorkspace] = useState(0);
  const [reloadRuntime, setReloadRuntime] = useState(0);
  const loadFailed = (key: string, error: unknown) => setLoadErrors(current => ({ ...current, [key]: error instanceof Error ? error.message : String(error) }));
  const clearLoadError = (key: string) => setLoadErrors(current => { const next = { ...current }; delete next[key]; return next; });
  const [savedTranslationAutomation, setSavedTranslationAutomation] = useState(DEFAULT_TRANSLATION_AUTOMATION);
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
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>(readSettingsTab);
  useEffect(() => rememberSettingsTab(activeSettingsTab), [activeSettingsTab]);
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
  const effectiveParserEndpoint = customParserEndpoint.trim();

  useEffect(() => {
    let cancelled = false;
    setModelsReady(false);
    clearLoadError('models');
    void getLlmSettings().then(nextSettings => {
      if (cancelled) return;
      applySettings(nextSettings);
      const target = nextSettings.profiles[0];
      if (target) { fillForm(target); setEditingId(null); }
      setModelsReady(true);
    }).catch(error => { if (!cancelled) loadFailed('models', error); });
    return () => { cancelled = true; };
  }, [reloadModels]);

  useEffect(() => {
    let cancelled = false;
    setWorkspaceReady(false);
    clearLoadError('workspace');
    void getWorkspaceSettings().then(nextSettings => {
      if (cancelled) return;
      setWorkspaceSettings(nextSettings);
      const automation = nextSettings.translation_automation ?? DEFAULT_TRANSLATION_AUTOMATION;
      setTranslationAutomation(automation);
      setSavedTranslationAutomation(automation);
      setWorkspaceReady(true);
    }).catch(error => { if (!cancelled) loadFailed('workspace', error); });
    return () => { cancelled = true; };
  }, [reloadWorkspace]);

  useEffect(() => {
    const currentRoot = workspaceRoot ?? workspaceSettings?.root ?? '';
    setRuntimeReady(false);
    clearLoadError('runtime');
    if (!currentRoot || !ADVANCED_ASSISTANT_SETTINGS_VISIBLE) return;
    let cancelled = false;
    void loadAgentRuntimeSettings(currentRoot)
      .then((workspaceRuntimeSettings) => {
        if (cancelled) {
          return;
        }
        const nextSettings = normalizeAgentRuntimeSettings(workspaceRuntimeSettings ?? readAgentRuntimeSettings());
        setDraftAgentRuntimeSettings(nextSettings);
        setSavedAgentRuntimeSettings(nextSettings);
        setRuntimeReady(true);
      })
      .catch(error => { if (!cancelled) loadFailed('runtime', error); });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, workspaceSettings?.root, reloadRuntime]);

  useEffect(() => {
    setCustomParserEndpoint(parserEndpoint);
    setSavedParserEndpoint(parserEndpoint);
  }, [parserEndpoint]);

  useEffect(() => {
    setCustomParserApiKey(parserApiKey);
    setSavedParserApiKey(parserApiKey);
  }, [parserApiKey]);

  const parserEndpointSave = useSettingsAutosave({
    closeScope: 'settings',
    value: customParserEndpoint, savedValue: savedParserEndpoint, equal: Object.is, delay: 500,
    save: onParserEndpointChange, onSaved: setSavedParserEndpoint
  });
  const parserKeySave = useSettingsAutosave({
    closeScope: 'settings',
    value: customParserApiKey, savedValue: savedParserApiKey, equal: Object.is, delay: 500,
    save: onParserApiKeyChange, onSaved: setSavedParserApiKey
  });

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
  }, [draftAgentRuntimeSettings]);

  const runtimeRoot = workspaceRoot ?? workspaceSettings?.root ?? '';
  const readerSave = useSettingsAutosave({
    closeScope: 'settings', delay: 0,
    value: draftReaderPreferences, savedValue: savedReaderPreferences, equal: equalReaderPreferences,
    save: onReaderPreferencesChange, onSaved: setSavedReaderPreferences
  });
  const runtimeSave = useSettingsAutosave({
    closeScope: 'settings',
    value: draftAgentRuntimeSettings, savedValue: savedAgentRuntimeSettings, equal: equalAgentRuntimeSettings,
    enabled: ADVANCED_ASSISTANT_SETTINGS_VISIBLE && runtimeReady && Boolean(runtimeRoot), scope: runtimeRoot,
    save: value => saveAgentRuntimeSettings(runtimeRoot, normalizeAgentRuntimeSettings(value)),
    onSaved: setSavedAgentRuntimeSettings
  });
  const translationSave = useSettingsAutosave({
    closeScope: 'settings',
    value: translationAutomation, savedValue: savedTranslationAutomation, equal: equalJson, enabled: workspaceReady,
    save: value => updateTranslationAutomationSettings(value.auto_translate_pdf, value.segment_types),
    onSaved: setSavedTranslationAutomation
  });
  const taskAssignments = useMemo(() => ({ assistant: draftAssistantProfileId, translation: draftTranslationProfileId }), [draftAssistantProfileId, draftTranslationProfileId]);
  const savedTaskAssignments = useMemo(() => ({ assistant: settings.assistant_profile_id, translation: settings.translation_profile_id }), [settings.assistant_profile_id, settings.translation_profile_id]);
  const taskSave = useSettingsAutosave({
    closeScope: 'settings',
    value: taskAssignments, savedValue: savedTaskAssignments, equal: equalJson, enabled: modelsReady && !busy,
    save: async value => {
      if (value.assistant && value.assistant !== savedTaskAssignments.assistant) await setTaskLlmProfile('assistant', value.assistant);
      if (value.translation && value.translation !== savedTaskAssignments.translation) await setTaskLlmProfile('translation', value.translation);
    },
    onSaved: value => {
      const next = { ...settings, assistant_profile_id: value.assistant, translation_profile_id: value.translation,
        assistant_profile: settings.profiles.find(profile => profile.id === value.assistant) ?? null,
        translation_profile: settings.profiles.find(profile => profile.id === value.translation) ?? null };
      setSettings(next);
      onSettingsChanged?.(next);
    }
  });
  const feedback: Array<{ key: string; message: string; error?: boolean; retry?: () => void }> = [
    ...Object.entries(loadErrors).map(([key, error]) => ({ key, error: true,
      message: `${key === 'models' ? '模型' : key === 'workspace' ? '资料库' : '助手与技能'}配置加载失败：${error}`,
      retry: () => key === 'models' ? setReloadModels(n => n + 1) : key === 'workspace' ? setReloadWorkspace(n => n + 1) : setReloadRuntime(n => n + 1) })),
    ...([['阅读偏好', readerSave], ['解析地址', parserEndpointSave], ['解析凭据', parserKeySave], ['助手与技能', runtimeSave], ['自动翻译', translationSave], ['任务模型', taskSave]] as const)
      .filter(([, status]) => status.dirty || status.error || status.saving)
      .map(([key, status]) => ({ key, error: Boolean(status.error), message: `${key}：${status.error ? '保存失败，修改已保留' : status.saving ? '保存中…' : '未保存'}`, retry: status.error ? status.retry : undefined }))
  ];
  if (!feedback.length && (!modelsReady || !workspaceReady || (ADVANCED_ASSISTANT_SETTINGS_VISIBLE && Boolean(runtimeRoot) && !runtimeReady))) {
    feedback.push({ key: 'loading', message: '正在读取配置…' });
  }

  const applySettings = (nextSettings: LlmSettingsState) => {
    setSettings(nextSettings);
    setDraftAssistantProfileId(nextSettings.assistant_profile_id);
    setDraftTranslationProfileId(nextSettings.translation_profile_id);
    onSettingsChanged?.(nextSettings);
  };

  const saveTranslationAutomation = (nextSettings: TranslationAutomationSettings) => setTranslationAutomation(nextSettings);

  const fillForm = (profile: LlmProfile) => {
    setEditingId(profile.id);
    setName(profile.name);
    setBaseUrl(profile.base_url);
    setApiProtocol(resolveLlmApiProtocol(profile.api_protocol));
    setModel(profile.model);
    setApiKey(profile.api_key ?? '');
    setMaxContextLength(String(profile.max_context_length ?? 8192));
    setTemperature(profile.temperature == null ? '0.2' : String(profile.temperature));
    setTopP(profile.top_p == null ? '' : String(profile.top_p));
    setMaxOutputTokens(profile.max_output_tokens == null ? '' : String(profile.max_output_tokens));
  };

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

  const newProfile = () => {
    setEditingId(null);
    setName('');
    setBaseUrl('');
    setApiProtocol('openai_compatible');
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
      return false;
    }
    setBusy(true);
    try {
      const previousProfileIds = new Set(settings.profiles.map((profile) => profile.id));
      const nextSettings = await saveLlmSettings({
        name: name || model,
        baseUrl,
        apiProtocol,
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
      return true;
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '创建模型配置失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveCurrentProfile = async () => {
    if (!editingId || !baseUrl.trim() || !model.trim()) {
      notify({ tone: 'danger', title: '无法保存模型配置', description: '请先填写 Base URL 和模型 ID。' });
      return false;
    }
    setBusy(true);
    try {
      const nextSettings = await saveLlmSettings({
        profileId: editingId,
        name: name || model,
        baseUrl,
        apiProtocol,
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
      return true;
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '保存模型配置失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const applyProviderPreset = (preset: ProviderPreset) => {
    setName(preset.label);
    setBaseUrl(preset.baseUrl);
    setApiProtocol(preset.protocol);
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

  const refreshModels = async () => {
    setModelRefreshBusy(true);
    try {
      const models = await listOpenAiCompatibleModels({ baseUrl, apiKey, apiProtocol });
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

  const test = async () => {
    setBusy(true);
    try {
      await testOpenAiCompatibleConnection({ baseUrl, apiKey, apiProtocol });
      notify({ tone: 'success', title: '连接测试通过' });
    } catch (caught) {
      notifyFailure('连接测试失败', caught);
    } finally {
      setBusy(false);
    }
  };

  const testProfile = async (
    profile: Pick<LlmProfile, 'base_url' | 'id' | 'name'> & {
      api_key?: string | null;
      api_protocol?: LlmProfile['api_protocol'] | null;
    }
  ) => {
    setProfileTestStates((current) => ({
      ...current,
      [profile.id]: { status: 'testing' }
    }));
    try {
      await testOpenAiCompatibleConnection({
        baseUrl: profile.base_url,
        apiKey: profile.api_key ?? '',
        apiProtocol: resolveLlmApiProtocol(profile.api_protocol)
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
      navigationTarget={navigationTarget}
      modelsUnavailable={!modelsReady}
      modelMutationBusy={taskSave.dirty || taskSave.saving}
      workspaceSettingsUnavailable={!workspaceReady}
      runtimeUnavailable={!runtimeReady}
      feedback={feedback}
      apiKey={apiKey}
      apiProtocol={apiProtocol}
      baseUrl={baseUrl}
      busy={busy}
      cachedModelCatalog={cachedModelCatalog}
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
      onApiProtocolChange={setApiProtocol}
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
      onModelChange={(value) => {
        setModel(value);
        // 手动输入/粘贴的模型 ID 命中已同步的模型目录时，自动回填上下文与输出参数；
        // 用户手动改过的值（非默认）不覆盖。
        const preset = modelPresets.find((item) => item.id === value.trim());
        if (!preset) {
          return;
        }
        const currentContext = maxContextLength.trim();
        if (
          preset.maxContextLength != null &&
          (currentContext === '' || currentContext === '8192')
        ) {
          setMaxContextLength(String(preset.maxContextLength));
        }
        if (preset.maxOutputTokens != null && maxOutputTokens.trim() === '') {
          setMaxOutputTokens(String(preset.maxOutputTokens));
        }
      }}
      onModelPresetSelect={(value) => {
        const preset = modelPresets.find((item) => item.id === value);
        if (preset) {
          applyModelPreset(preset);
        }
      }}
      onNameChange={setName}
      onNewProfile={newProfile}
      onParserEndpointChange={setCustomParserEndpoint}
      onParserApiKeyChange={setCustomParserApiKey}
      onReaderPreferencesChange={setDraftReaderPreferences}
      onProviderPresetSelect={(value) => {
        if (value === '__custom__') {
          newProfile();
          return;
        }
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
      onSetActiveSettingsTab={tab => setActiveSettingsTab(visibleSettingsTab(tab))}
      onAddAgent={() => {
        notify({
          title: '暂不支持新增子 Agent',
          description: '当前版本使用 4 个职责固定的内置子 Agent；可在子 Agent 页面配置模型、启用状态与权限。'
        });
        setActiveSettingsTab('subagents');
      }}
      onSetTaskProfile={(task, profileId) => {
        if (task === 'assistant') setDraftAssistantProfileId(profileId);
        else setDraftTranslationProfileId(profileId);
      }}
      onTemperatureChange={setTemperature}
      onTest={() => void test()}
      onTestProfile={(profile) => void testProfile(profile)}
      profileTestStates={profileTestStates}
      onToggleProvidersExpanded={() => setProvidersExpanded((value) => !value)}
      onTopPChange={setTopP}
      onTranslationAutomationChange={saveTranslationAutomation}
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
      onSelectAgent={setSelectedAgentId}
      onUpdateAgent={updateAgent}
      onUpdateRuntimeSettings={updateAgentRuntimeSettings}
      runtimeSettings={draftAgentRuntimeSettings}
      selectedAgentId={selectedAgentId}
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
  return trimmed;
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

function equalJson<T>(left: T, right: T) { return JSON.stringify(left) === JSON.stringify(right); }
