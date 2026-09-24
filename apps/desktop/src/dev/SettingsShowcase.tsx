import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { SettingsPanel } from '@/modules/settings/components/SettingsPanel';
import type { SettingsNavigationTarget } from '@/modules/settings/settingsCatalog';
import { SearchDialog } from '@/modules/search/components/SearchDialog';
import { SearchPanel } from '@/modules/search/components/SearchPanel';
import { AppearanceProvider } from '@/shared/components/AppearanceProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ToastContext } from '@/shared/hooks/useToast';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { readStoredReaderPreferences } from '@/shared/lib/readerPreferences';
import { APP_THEME_PRESETS, type AppThemePresetId } from '@/shared/lib/themePresets';
import type { UiScale } from '@/shared/lib/uiScale';
import type { LlmSettingsState } from '@/shared/ipc/assistantApi';
import '../styles/globals.css';

const params = new URLSearchParams(location.search);
const state = params.get('state');
let llm: LlmSettingsState = { profiles: [{ id: 'example', name: '本地模型（示例）', model: 'example-model', base_url: 'http://localhost:11434/v1', api_key: null, api_protocol: 'openai_compatible', max_context_length: 8192, temperature: 0.2, top_p: null, max_output_tokens: null }],
  assistant_profile: null, assistant_profile_id: 'example', translation_profile: null, translation_profile_id: 'example' };
if (params.has('longModels')) llm.profiles.push(
  { ...llm.profiles[0], id: 'long', name: '论文阅读与复杂研究问题分析专用模型（长名称测试）', model: 'research-model-with-an-extremely-long-version-name-2026-09-19', base_url: 'https://example.invalid/research/compatible/endpoint/v1', max_context_length: 131072, max_output_tokens: 32768 },
  { ...llm.profiles[0], id: 'other', name: '备用模型', model: 'example-reasoning', api_protocol: 'anthropic', max_context_length: 200000 },
);
if (state === 'empty') llm = { ...llm, profiles: [], assistant_profile_id: null, translation_profile_id: null };
let workspace = { root: 'settings-showcase', default_root: 'settings-showcase', recent_workspaces: [], translation_automation: { auto_translate_pdf: false, segment_types: ['paragraph', 'heading'] } };
// Every IPC is intercepted. This page cannot read or write an actual library.
mockIPC(async (command, payload) => {
  if (state === 'loading' && command.startsWith('get_')) return new Promise(() => undefined);
  if (state === 'error' && (command.startsWith('get_') || command.startsWith('save_') || command.startsWith('update_'))) throw new Error('示例：暂时无法读取或保存配置');
  if (command === 'get_llm_settings') return structuredClone(llm);
  if (command === 'get_workspace_settings') return structuredClone(workspace);
  if (command === 'load_agent_runtime_settings') return structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
  if (command === 'save_agent_runtime_settings') return null;
  if (command === 'update_translation_automation_settings') {
    workspace = { ...workspace, translation_automation: (payload as { request: typeof workspace.translation_automation }).request };
    return structuredClone(workspace);
  }
  if (command === 'get_sciverse_settings') return { enabled: false, base_url: 'https://api.sciverse.space', has_api_token: false, token_source: 'none' };
  if (command === 'get_embedding_status') return { available: false, provider: 'showcase' };
  if (command === 'set_task_llm_profile') return structuredClone(llm);
  if (command === 'save_llm_settings') return structuredClone(llm);
  return null;
}, { shouldMockEvents: true });

function SettingsShowcase() {
  const [reader, setReader] = useState(readStoredReaderPreferences);
  const [theme, setTheme] = useState<AppThemePresetId>('blue');
  const [scale, setScale] = useState<UiScale>(Number(params.get('scale') ?? 1) as UiScale);
  const [endpoint, setEndpoint] = useState('http://localhost:18000');
  const [key, setKey] = useState('');
  const [search, setSearch] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [target, setTarget] = useState<SettingsNavigationTarget>();
  const nonce = useRef(0);
  const navigate = (id: string) => setTarget({ id, nonce: ++nonce.current });
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return <TooltipProvider><ToastContext.Provider value={{ notify: () => 'showcase', dismiss: () => undefined }}><AppearanceProvider>
    <div className="flex flex-wrap gap-2 border-b bg-card p-2"><span className="text-xs">设置检查 · 隔离示例</span>
      <Button size="xs" variant="outline" onClick={() => setSearch(true)}>全局搜索</Button>
      <Button size="xs" variant="outline" onClick={() => setSidebar(value => !value)}>侧栏搜索</Button></div>
    <div style={{ display: 'flex', width: '100%', height: 'calc(100vh - 42px)' }}>
      {sidebar && <div style={{ width: 300, minWidth: 220 }}><SearchPanel root={null} status="ready" onOpenResult={() => undefined} onOpenSetting={navigate} /></div>}
      <div style={{ minWidth: 0, width: params.has('width') ? `min(100%, ${Number(params.get('width'))}px)` : '100%', height: `calc((100vh - 42px) / ${scale})`, zoom: scale }}>
        <SettingsPanel navigationTarget={target} parserEndpoint={endpoint} parserApiKey={key} readerPreferences={reader} themePreset={theme} themePresets={APP_THEME_PRESETS} uiScale={scale}
          onParserEndpointChange={setEndpoint} onParserApiKeyChange={setKey} onReaderPreferencesChange={setReader} onThemePresetChange={setTheme} onUiScaleChange={setScale} workspaceRoot="settings-showcase" />
      </div>
    </div>
    <SearchDialog open={search} root={null} status="ready" onOpenChange={setSearch} onOpenResult={() => undefined} onOpenSetting={navigate} />
  </AppearanceProvider></ToastContext.Provider></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<SettingsShowcase />);
