// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { readStoredReaderPreferences } from '@/shared/lib/readerPreferences';
import { APP_THEME_PRESETS } from '@/shared/lib/themePresets';
import { ToastContext } from '@/shared/hooks/useToast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SETTINGS_CATALOG, type SettingsNavigationTarget } from '../settingsCatalog';
import { SettingsPanel } from './SettingsPanel';
import { loadPublicModelCatalog, readPublicModelCatalog } from '@/modules/assistant/sdk/modelCatalogStore';
import type { PublicModelCatalog } from '@/modules/assistant/sdk/modelCatalog';
import { listOpenAiCompatibleModels } from '@/modules/assistant/sdk/provider';
vi.mock('@/modules/assistant/sdk/provider', async original => ({ ...await original<typeof import('@/modules/assistant/sdk/provider')>(), listOpenAiCompatibleModels: vi.fn() }));
vi.mock('@/modules/assistant/sdk/modelCatalogStore', () => ({ loadPublicModelCatalog: vi.fn(), readPublicModelCatalog: vi.fn() }));
vi.mock('@/shared/ipc/researchApi', () => ({ getResearchSettings: vi.fn(async () => ({ papers_enabled: true, web_enabled: true, use_tavily: false, has_web_key: false })), saveResearchSettings: vi.fn() }));
vi.mock('@/modules/sciverse/api/sciverseApi', () => ({ getSciverseSettings: vi.fn(async () => ({ enabled: false, base_url: 'https://api.sciverse.space', has_api_token: false, token_source: null })), saveSciverseSettings: vi.fn(), revealSciverseApiToken: vi.fn(), testSciverseConnection: vi.fn() }));
const catalog: PublicModelCatalog = { version: 1, updatedAt: '2026-09-25T00:00:00Z', warnings: [], models: [
  { id: 'catalog-chat', label: 'Catalog Chat', providerId: 'local', providerName: 'Local', providerApi: 'http://localhost:11434/v1', maxContextLength: 128000, maxOutputTokens: 8192, supportsTemperature: false, metadataSource: 'models_dev' },
  { id: 'test-model', providerId: 'local', providerName: 'Local', providerApi: 'http://localhost:11434/v1', maxContextLength: 64000, maxOutputTokens: 4096, metadataSource: 'models_dev' }
] };

const mocks = vi.hoisted(() => ({ getLlmSettings: vi.fn(), getWorkspaceSettings: vi.fn(), saveLlmSettings: vi.fn(), saveAgentRuntimeSettings: vi.fn(), loadAgentRuntimeSettings: vi.fn(), updateTranslationAutomationSettings: vi.fn(), setTaskLlmProfile: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  getLlmSettings: mocks.getLlmSettings, saveLlmSettings: mocks.saveLlmSettings, saveAgentRuntimeSettings: mocks.saveAgentRuntimeSettings, setTaskLlmProfile: mocks.setTaskLlmProfile,
  loadAgentRuntimeSettings: mocks.loadAgentRuntimeSettings }));
vi.mock('@/shared/ipc/workspaceApi', async original => ({ ...await original<typeof import('@/shared/ipc/workspaceApi')>(),
  getWorkspaceSettings: mocks.getWorkspaceSettings, updateTranslationAutomationSettings: mocks.updateTranslationAutomationSettings }));
const llm = { profiles: [{ id: 'model', name: '测试连接', model: 'test-model', base_url: 'http://localhost:11434/v1' }], assistant_profile_id: 'model', translation_profile_id: 'model', assistant_profile: null, translation_profile: null };
beforeEach(() => {
  vi.clearAllMocks(); window.localStorage.clear();
  vi.mocked(listOpenAiCompatibleModels).mockReset().mockResolvedValue([{ id: 'synced-model' }]);
  vi.mocked(readPublicModelCatalog).mockReturnValue(undefined);
  vi.mocked(loadPublicModelCatalog).mockResolvedValue(catalog);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(callback, 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(256);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(416);
  mocks.getLlmSettings.mockResolvedValue(llm);
  mocks.getWorkspaceSettings.mockResolvedValue({ root: 'fixture', default_root: 'fixture', recent_workspaces: [], translation_automation: { auto_translate_pdf: false, segment_types: ['paragraph'] } });
  mocks.saveLlmSettings.mockResolvedValue(llm);
  mocks.loadAgentRuntimeSettings.mockResolvedValue(DEFAULT_AGENT_RUNTIME_SETTINGS);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Harness({ target }: { target?: SettingsNavigationTarget }) {
  const [reader, setReader] = useState(readStoredReaderPreferences);
  return <TooltipProvider><ToastContext.Provider value={{ notify: vi.fn(() => 'toast'), dismiss: vi.fn() }}><SettingsPanel
    navigationTarget={target} parserEndpoint="" parserApiKey="" readerPreferences={reader} onReaderPreferencesChange={setReader}
    themePreset="blue" themePresets={APP_THEME_PRESETS} uiScale={1} onThemePresetChange={vi.fn()} onUiScaleChange={vi.fn()}
    onParserApiKeyChange={vi.fn()} onParserEndpointChange={vi.fn()} workspaceRoot="fixture" />
  </ToastContext.Provider></TooltipProvider>;
}

describe('settings information architecture and navigation', () => {
  it('opens new configurations without focusing inputs or opening suggestions, including after reopening', async () => {
    render(<Harness target={{ id: 'models-connections', nonce: 1 }} />);
    await screen.findByRole('button', { name: '编辑' });
    for (let attempt = 0; attempt < 2; attempt++) {
      fireEvent.click(screen.getByRole('button', { name: '新增配置' }));
      const dialog = await screen.findByRole('dialog', { name: '新增模型配置' });
      await waitFor(() => expect(document.activeElement).toBe(dialog));
      const provider = within(dialog).getByRole('combobox', { name: '搜索提供商' });
      expect(provider.getAttribute('aria-expanded')).toBe('false');
      expect(within(dialog).getByLabelText('模型 ID').getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('listbox')).toBeNull();
      fireEvent.click(provider);
      expect(await screen.findByRole('listbox')).toBeTruthy();
      fireEvent.keyDown(provider, { key: 'Escape' });
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(screen.getByRole('dialog')).toBe(dialog);
      fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(mocks.saveLlmSettings).not.toHaveBeenCalled();
  });
  it('shares page and group layout and puts default model selection before connection management', async () => {
    const view = render(<Harness target={{ id: 'models-assistant', nonce: 1 }} />);
    await screen.findByRole('button', { name: '编辑' });
    const page = screen.getByRole('heading', { level: 2, name: '模型与助手' }).closest('.settings-form')!;
    expect(page).toBeTruthy();
    expect(within(page as HTMLElement).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['默认模型', '模型连接']);
    expect(screen.queryByRole('heading', { name: '模型高级参数' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '设置阅读翻译模型 →' }));
    expect(screen.getByRole('combobox', { name: '阅读翻译模型' })).toBeTruthy();
    view.rerender(<Harness target={{ id: 'tools-services', nonce: 2 }} />);
    const service = view.container.querySelector<HTMLDetailsElement>('[data-setting-id="tools-services"]')!;
    await waitFor(() => expect(service.open).toBe(true));
    expect(service.querySelector('summary')).toBe(document.activeElement);
    expect(screen.getByRole('heading', { level: 2, name: '工具与扩展' }).closest('.settings-form')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '基础检索' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '可选服务' })).toBeTruthy();
    expect(view.container.querySelectorAll('.settings-service')).toHaveLength(2);
  });
  it('selects incomplete providers, shows their models, and requires an explicit protocol before syncing or saving', async () => {
    vi.mocked(loadPublicModelCatalog).mockResolvedValue({ ...catalog, models: [{ id: 'remote-chat', providerId: 'remote-demo', providerName: 'Remote Demo' }] });
    render(<Harness target={{ id: 'models-connections', nonce: 1 }} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    await waitFor(() => expect(loadPublicModelCatalog).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '搜索模型提供商' }));
    fireEvent.change(screen.getByRole('combobox', { name: '搜索提供商' }), { target: { value: 'Remote Demo' } });
    fireEvent.click(await screen.findByRole('option', { name: /Remote Demo/ }));
    expect((screen.getByRole('combobox', { name: '搜索提供商' }) as HTMLInputElement).value).toBe('Remote Demo');
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('Remote Demo');
    fireEvent.click(screen.getByRole('button', { name: '从模型列表选择' }));
    fireEvent.click(screen.getByRole('option', { name: /remote-chat/ }));
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://remote.example/v1' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'synthetic-key' } });
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)); });
    expect(listOpenAiCompatibleModels).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('combobox', { name: '接口类型' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'OpenAI 兼容' }));
    await screen.findByText('接口模型已同步', {}, { timeout: 2000 });
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false);
    const fields = document.querySelector('[data-ui="model-connection-fields"]')!;
    expect(fields.contains(document.getElementById('model-protocol-help'))).toBe(false);
    expect(mocks.saveLlmSettings).not.toHaveBeenCalled();
  }, 15000); // Exercises the real debounce twice alongside full-suite UI rendering.
  it('syncs automatically after key entry, preserves the selected model, and exposes retry only on failure', async () => {
    render(<Harness target={{ id: 'models-connections', nonce: 1 }} />);
    await screen.findByRole('button', { name: '编辑' });
    expect(listOpenAiCompatibleModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://provider.example/v1' } });
    expect(screen.queryByRole('button', { name: '同步接口模型' })).toBeNull();
    expect(screen.getByText(/填写 API Key 后自动同步/)).toBeTruthy();
    vi.mocked(listOpenAiCompatibleModels).mockRejectedValueOnce(new Error('模型列表拉取失败：HTTP 403'));
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'synthetic-key' } });
    const retry = await screen.findByRole('button', { name: '重试同步' }, { timeout: 2000 });
    expect(screen.getByText(/同步失败（HTTP 403）/)).toBeTruthy();
    fireEvent.click(retry);
    await screen.findByText('接口模型已同步', {}, { timeout: 2000 });
    expect((screen.getByLabelText('模型 ID') as HTMLInputElement).value).toBe('test-model');
    expect(screen.queryByRole('button', { name: '重试同步' })).toBeNull();
    expect(mocks.saveLlmSettings).not.toHaveBeenCalled();
    expect(listOpenAiCompatibleModels).toHaveBeenCalledTimes(2);
  });
  it('keeps editing identity and clears the old key when switching providers, without saving automatically', async () => {
    render(<Harness target={{ id: 'models-connections', nonce: 1 }} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('API Key'), { target: { value: 'synthetic-old-key' } });
    fireEvent.click(dialog.getByRole('button', { name: '搜索模型提供商' }));
    fireEvent.change(screen.getByRole('combobox', { name: '搜索提供商' }), { target: { value: 'deepseek' } });
    fireEvent.click(screen.getByRole('option', { name: /DeepSeek/ }));
    expect((dialog.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
    expect((dialog.getByLabelText('Base URL') as HTMLInputElement).value).toBe('https://api.deepseek.com');
    expect(mocks.saveLlmSettings).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.saveLlmSettings).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'model' })));
  });
  it('does not mount hidden editors, read their configuration, or show an idle saved footer', async () => {
    const { container, rerender } = render(<Harness target={{ id: 'models-connections', nonce: 1 }} />);
    await screen.findByRole('button', { name: '编辑' });
    await waitFor(() => expect(screen.queryByText('正在读取配置…')).toBeNull());
    expect(container.querySelector('.settings-feedback')).toBeNull();
    for (const id of ['agent-main', 'agent-subagents', 'tools-mcp']) {
      expect(container.querySelector(`[data-setting-id="${id}"]`)).toBeNull();
    }
    rerender(<Harness target={{ id: 'agent-main', nonce: 2 }} />);
    expect(screen.getByRole('heading', { name: '模型连接' })).toBeTruthy();
    expect(mocks.loadAgentRuntimeSettings).not.toHaveBeenCalled();
    expect(mocks.saveAgentRuntimeSettings).not.toHaveBeenCalled();
  });
  it('has seven categories and keeps every searchable target mounted at a stable address', async () => {
    const { container } = render(<Harness />);
    expect(within(screen.getByRole('navigation', { name: '设置分类' })).getAllByRole('button')).toHaveLength(7);
    for (const item of SETTINGS_CATALOG) expect(container.querySelectorAll(`[data-setting-id="${item.id}"]`).length, item.id).toBe(1);
    await waitFor(() => expect(screen.queryByText('正在读取配置…')).toBeNull());
  });
  it('locates and expands advanced settings, including repeated requests', async () => {
    const { rerender, container } = render(<Harness target={{ id: 'reader-preview-size', nonce: 1 }} />);
    await waitFor(() => expect(container.querySelector('details[data-setting-id="reader-preview-size"]')?.hasAttribute('open')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '翻译' }));
    rerender(<Harness target={{ id: 'reader-preview-size', nonce: 2 }} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '阅读与批注' })).toBeTruthy());
    expect(container.querySelector('[data-setting-highlight="true"]')).toBeTruthy();
  });
  it('searches settings even if application settings failed to load', async () => {
    mocks.getLlmSettings.mockRejectedValue(new Error('offline'));
    mocks.getWorkspaceSettings.mockRejectedValue(new Error('offline'));
    render(<Harness />);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索设置' }), { target: { value: '字体太小' } });
    fireEvent.click(screen.getByRole('button', { name: /界面缩放 设置/ }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: '界面缩放' })).toBe(document.activeElement));
    expect(await screen.findByText(/模型配置加载失败/)).toBeTruthy();
  });
  it('retains shared preview content when PDF preview is off but reflow preview is on', async () => {
    render(<Harness target={{ id: 'reader-preview', nonce: 1 }} />);
    const pdf = await screen.findByRole('switch', { name: 'PDF 悬停预览' });
    fireEvent.click(pdf);
    const original = screen.getByRole('checkbox', { name: '解析后原文' });
    expect(original.hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('switch', { name: '重排悬停预览' }));
    expect(original.hasAttribute('disabled')).toBe(true);
    expect(original.getAttribute('aria-checked')).toBe('true');
  });
  it('finds and changes the entry PDF preference without changing other reader settings', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索设置' }), { target: { value: '默认打开PDF' } });
    fireEvent.click(screen.getByRole('button', { name: /有 PDF 时直接打开 PDF 设置/ }));
    const toggle = await screen.findByRole('switch', { name: '有 PDF 时直接打开 PDF' });
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: 'PDF 悬停预览' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '翻译' }));
    fireEvent.click(screen.getByRole('button', { name: '阅读与批注' }));
    expect(screen.getByRole('switch', { name: '有 PDF 时直接打开 PDF' }).getAttribute('aria-checked')).toBe('false');
  });
  it('never saves a model on cancel, and keeps failed edits open for retry', async () => {
    render(<Harness target={{ id: 'models-connections', nonce: 1 }} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    let dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('名称'), { target: { value: '未保存的名称' } });
    fireEvent.click(dialog.getByRole('button', { name: '取消' }));
    expect(mocks.saveLlmSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    dialog = within(screen.getByRole('dialog'));
    expect((dialog.getByLabelText('名称') as HTMLInputElement).value).toBe('测试连接');
    mocks.saveLlmSettings.mockRejectedValueOnce(new Error('save failed'));
    fireEvent.change(dialog.getByLabelText('名称'), { target: { value: '保留草稿' } });
    fireEvent.click(dialog.getByRole('button', { name: '保存' }));
    expect(await dialog.findByRole('alert')).toBeTruthy();
    expect((dialog.getByLabelText('名称') as HTMLInputElement).value).toBe('保留草稿');
    fireEvent.click(dialog.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('fills public model limits only on selection, preserves credentials and requires explicit save', async () => {
    render(<Harness target={{ id: 'models-connections', nonce: 1 }} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    await screen.findByText(/2 条记录/);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('heading', { name: '高级参数' })).toBeTruthy();
    expect(dialog.getByLabelText('Temperature').closest('details')).toBeNull();
    fireEvent.change(dialog.getByLabelText('API Key'), { target: { value: 'test-secret-do-not-send' } });
    fireEvent.change(dialog.getByLabelText('Temperature'), { target: { value: '0.5' } });
    fireEvent.change(dialog.getByLabelText('Top P'), { target: { value: '0.8' } });
    fireEvent.change(dialog.getByLabelText('模型 ID'), { target: { value: 'Catalog Chat' } });
    fireEvent.click(await screen.findByRole('option', { name: /^Catalog Chat/ }));
    expect((dialog.getByLabelText('上下文窗口（Token）') as HTMLInputElement).value).toBe('128000');
    expect((dialog.getByLabelText('最大输出（Token）') as HTMLInputElement).value).toBe('8192');
    expect((dialog.getByLabelText('Temperature') as HTMLInputElement).value).toBe('');
    expect((dialog.getByLabelText('Top P') as HTMLInputElement).value).toBe('');
    expect((dialog.getByLabelText('Base URL') as HTMLInputElement).value).toBe('http://localhost:11434/v1');
    expect((dialog.getByLabelText('API Key') as HTMLInputElement).value).toBe('test-secret-do-not-send');
    expect(mocks.saveLlmSettings).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(mocks.saveLlmSettings).toHaveBeenCalledWith(expect.objectContaining({ model: 'catalog-chat', maxContextLength: 128000, maxOutputTokens: 8192, temperature: undefined, topP: undefined })));
  });
  it('never overwrites a draft when the catalog arrives, but offers an explicit apply button', async () => {
    let resolve!: (value: PublicModelCatalog) => void;
    vi.mocked(loadPublicModelCatalog).mockReturnValue(new Promise(done => { resolve = done; }));
    render(<Harness target={{ id: 'models-connections', nonce: 1 }} />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('上下文窗口（Token）').closest('details')).toBeNull();
    fireEvent.change(dialog.getByLabelText('上下文窗口（Token）'), { target: { value: '12000' } });
    await act(async () => resolve(catalog));
    expect((dialog.getByLabelText('上下文窗口（Token）') as HTMLInputElement).value).toBe('12000');
    fireEvent.click(dialog.getByRole('button', { name: '使用以上参考参数' }));
    expect((dialog.getByLabelText('上下文窗口（Token）') as HTMLInputElement).value).toBe('64000');
    fireEvent.change(dialog.getByLabelText('模型 ID'), { target: { value: 'unknown-model' } });
    expect((dialog.getByLabelText('上下文窗口（Token）') as HTMLInputElement).value).toBe('');
    expect((dialog.getByLabelText('最大输出（Token）') as HTMLInputElement).value).toBe('');
    expect(dialog.getByText(/暂无精确匹配/)).toBeTruthy();
  });
  it('loads only inside the editor, cancels on close and keeps the form usable offline', async () => {
    vi.mocked(loadPublicModelCatalog).mockRejectedValue(new Error('offline'));
    render(<Harness target={{ id: 'models-connections', nonce: 1 }} />);
    const edit = await screen.findByRole('button', { name: '编辑' });
    expect(loadPublicModelCatalog).not.toHaveBeenCalled();
    fireEvent.click(edit);
    expect(await screen.findByRole('alert')).toBeTruthy();
    const dialog = within(screen.getByRole('dialog'));
    expect((dialog.getByLabelText('模型 ID') as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(dialog.getByRole('button', { name: '取消' }));
    expect(vi.mocked(loadPublicModelCatalog).mock.calls[0][0]?.aborted).toBe(true);
    expect(mocks.saveLlmSettings).not.toHaveBeenCalled();
  });
});
