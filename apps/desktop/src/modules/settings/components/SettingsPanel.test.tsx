// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { readStoredReaderPreferences } from '@/shared/lib/readerPreferences';
import { APP_THEME_PRESETS } from '@/shared/lib/themePresets';
import { ToastContext } from '@/shared/hooks/useToast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SETTINGS_CATALOG, type SettingsNavigationTarget } from '../settingsCatalog';
import { SettingsPanel } from './SettingsPanel';

const mocks = vi.hoisted(() => ({ getLlmSettings: vi.fn(), getWorkspaceSettings: vi.fn(), saveLlmSettings: vi.fn(), saveAgentRuntimeSettings: vi.fn(), loadAgentRuntimeSettings: vi.fn(), updateTranslationAutomationSettings: vi.fn(), setTaskLlmProfile: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', async original => ({ ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  getLlmSettings: mocks.getLlmSettings, saveLlmSettings: mocks.saveLlmSettings, saveAgentRuntimeSettings: mocks.saveAgentRuntimeSettings, setTaskLlmProfile: mocks.setTaskLlmProfile,
  loadAgentRuntimeSettings: mocks.loadAgentRuntimeSettings }));
vi.mock('@/shared/ipc/workspaceApi', async original => ({ ...await original<typeof import('@/shared/ipc/workspaceApi')>(),
  getWorkspaceSettings: mocks.getWorkspaceSettings, updateTranslationAutomationSettings: mocks.updateTranslationAutomationSettings }));
const llm = { profiles: [{ id: 'model', name: '测试连接', model: 'test-model', base_url: 'http://localhost:11434/v1' }], assistant_profile_id: 'model', translation_profile_id: 'model', assistant_profile: null, translation_profile: null };
beforeEach(() => {
  vi.clearAllMocks(); window.localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(callback, 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.getLlmSettings.mockResolvedValue(llm);
  mocks.getWorkspaceSettings.mockResolvedValue({ root: 'fixture', default_root: 'fixture', recent_workspaces: [], translation_automation: { auto_translate_pdf: false, segment_types: ['paragraph'] } });
  mocks.saveLlmSettings.mockResolvedValue(llm);
  mocks.loadAgentRuntimeSettings.mockResolvedValue(DEFAULT_AGENT_RUNTIME_SETTINGS);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Harness({ target }: { target?: SettingsNavigationTarget }) {
  const [reader, setReader] = useState(readStoredReaderPreferences);
  return <TooltipProvider><ToastContext.Provider value={{ notify: vi.fn(() => 'toast'), dismiss: vi.fn() }}><SettingsPanel
    navigationTarget={target} parserEndpoint="" parserApiKey="" readerPreferences={reader} onReaderPreferencesChange={setReader}
    themePreset="blue" themePresets={APP_THEME_PRESETS} uiScale={1} onThemePresetChange={vi.fn()} onUiScaleChange={vi.fn()}
    onParserApiKeyChange={vi.fn()} onParserEndpointChange={vi.fn()} workspaceRoot="fixture" />
  </ToastContext.Provider></TooltipProvider>;
}

describe('settings information architecture and navigation', () => {
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
});
