// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SciverseSettingsSection } from './SciverseSettingsSection';
import { hasUnsavedSegmentEditors } from '@/modules/reader/components/segmentEditorDirtyRegistry';

const apiMocks = vi.hoisted(() => ({
  getSciverseSettings: vi.fn(),
  revealSciverseApiToken: vi.fn(),
  saveSciverseSettings: vi.fn(),
  testSciverseConnection: vi.fn()
}));
const notify = vi.hoisted(() => vi.fn());
const writeClipboardText = vi.hoisted(() => vi.fn());

vi.mock('../api/sciverseApi', () => apiMocks);
vi.mock('@/shared/hooks/useToast', () => ({
  useToast: () => ({ notify })
}));

const configuredSettings = {
  enabled: true,
  base_url: 'https://api.sciverse.space',
  has_api_token: true,
  token_source: 'credential_store' as const
};

const disabledConfiguredSettings = {
  ...configuredSettings,
  enabled: false
};

const emptySettings = {
  enabled: false,
  base_url: 'https://api.sciverse.space',
  has_api_token: false,
  token_source: null
};

describe('SciverseSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeClipboardText }
    });
    writeClipboardText.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('does not read credentials before the external-tools tab is active', () => {
    render(<SciverseSettingsSection active={false} />);

    expect(apiMocks.getSciverseSettings).not.toHaveBeenCalled();
  });

  it('reveals and copies a saved Token without turning it into a replacement draft', async () => {
    apiMocks.getSciverseSettings.mockResolvedValue(configuredSettings);
    apiMocks.revealSciverseApiToken.mockResolvedValue('saved-sciverse-token');
    const view = render(<SciverseSettingsSection active />);

    const input = await waitFor(
      () => view.getByLabelText('Sciverse API Token') as HTMLInputElement
    );
    expect(input.value).toBe('••••••••••••••••');

    fireEvent.click(view.getByRole('button', { name: '显示 Sciverse Token' }));
    await waitFor(() => {
      expect(input.value).toBe('saved-sciverse-token');
      expect(apiMocks.revealSciverseApiToken).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(view.getByRole('button', { name: '复制当前显示的 Token' }));
    await waitFor(() => {
      expect(writeClipboardText).toHaveBeenCalledWith('saved-sciverse-token');
      expect(apiMocks.saveSciverseSettings).not.toHaveBeenCalled();
    });
  });

  it('can enable a configured service without replacing its Token', async () => {
    apiMocks.getSciverseSettings.mockResolvedValue(disabledConfiguredSettings);
    apiMocks.saveSciverseSettings.mockResolvedValue(configuredSettings);
    const view = render(<SciverseSettingsSection active />);

    const toggle = await waitFor(() =>
      view.getByRole('switch', { name: '允许助手调用 Sciverse' })
    );
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(apiMocks.saveSciverseSettings).toHaveBeenCalledWith({
        baseUrl: 'https://api.sciverse.space',
        enabled: true
      });
    });
  });

  it('tests only the saved credential and does not call save first', async () => {
    apiMocks.getSciverseSettings.mockResolvedValue(configuredSettings);
    apiMocks.testSciverseConnection.mockResolvedValue({
      ok: true,
      base_url: 'https://api.sciverse.space',
      field_count: 12
    });
    const view = render(<SciverseSettingsSection active />);

    const testButton = await waitFor(() =>
      view.getByRole('button', { name: '测试 Sciverse 连接' })
    );
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(apiMocks.testSciverseConnection).toHaveBeenCalledTimes(1);
      expect(apiMocks.saveSciverseSettings).not.toHaveBeenCalled();
      expect(view.getByText('连接正常，服务返回 12 个可用元数据字段。')).toBeTruthy();
    });
  });

  it('saves a new Token without silently enabling the service', async () => {
    apiMocks.getSciverseSettings.mockResolvedValue(emptySettings);
    apiMocks.saveSciverseSettings.mockResolvedValue({
      ...emptySettings,
      has_api_token: true,
      token_source: 'credential_store'
    });
    const view = render(<SciverseSettingsSection active />);

    const input = await waitFor(() => view.getByLabelText('Sciverse API Token'));
    fireEvent.change(input, { target: { value: 'new-sciverse-token' } });
    fireEvent.click(view.getByRole('button', { name: '保存 Token' }));

    await waitFor(() => {
      expect(apiMocks.saveSciverseSettings).toHaveBeenCalledWith({
        apiToken: 'new-sciverse-token',
        baseUrl: 'https://api.sciverse.space',
        enabled: false
      });
    });
    expect((view.getByLabelText('Sciverse API Token') as HTMLInputElement).value)
      .toBe('••••••••••••••••');
    expect(view.getAllByRole('button', { name: '显示 Sciverse Token' })).toHaveLength(1);
  });

  it('does not report success when the saved credential cannot be read back', async () => {
    apiMocks.getSciverseSettings.mockResolvedValue(emptySettings);
    apiMocks.saveSciverseSettings.mockResolvedValue(emptySettings);
    const view = render(<SciverseSettingsSection active />);

    const input = await waitFor(
      () => view.getByLabelText('Sciverse API Token') as HTMLInputElement
    );
    fireEvent.change(input, { target: { value: 'unpersisted-token' } });
    fireEvent.click(view.getByRole('button', { name: '保存 Token' }));

    expect((await view.findByRole('alert')).textContent).toContain('保存 Sciverse Token 失败');
    expect(notify).not.toHaveBeenCalled();
    expect(input.value).toBe('unpersisted-token');
  });

  it('keeps a replacement draft through category changes and releases the close guard on discard or unmount', async () => {
    apiMocks.getSciverseSettings.mockResolvedValue(configuredSettings);
    const view = render(<SciverseSettingsSection active />);
    fireEvent.click(await view.findByRole('button', { name: '替换 Token' }));
    fireEvent.change(view.getByLabelText('Sciverse API Token'), { target: { value: 'draft-only' } });
    expect(hasUnsavedSegmentEditors('settings')).toBe(true);
    expect((view.getByRole('button', { name: '清除 Sciverse Token' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<SciverseSettingsSection active={false} />);
    view.rerender(<SciverseSettingsSection active />);
    expect((view.getByLabelText('Sciverse API Token') as HTMLInputElement).value).toBe('draft-only');
    fireEvent.click(view.getByRole('button', { name: '取消替换' }));
    expect(hasUnsavedSegmentEditors('settings')).toBe(false);
    view.unmount();
    expect(hasUnsavedSegmentEditors('settings')).toBe(false);
  });

  it('keeps environment credentials read-only and requires confirmation before clearing saved credentials', async () => {
    apiMocks.getSciverseSettings.mockResolvedValue({ ...configuredSettings, token_source: 'environment' });
    const view = render(<SciverseSettingsSection active />);
    expect((await view.findByLabelText('Sciverse API Token') as HTMLInputElement).readOnly).toBe(true);
    expect(view.queryByRole('button', { name: '替换 Token' })).toBeNull();
    expect(view.queryByRole('button', { name: '清除 Sciverse Token' })).toBeNull();
    view.unmount();
    apiMocks.getSciverseSettings.mockResolvedValue(configuredSettings);
    apiMocks.saveSciverseSettings.mockResolvedValue(emptySettings);
    const clear = render(<SciverseSettingsSection active />);
    fireEvent.click(await clear.findByRole('button', { name: '清除 Sciverse Token' }));
    expect(apiMocks.saveSciverseSettings).not.toHaveBeenCalled();
    fireEvent.click(clear.getByRole('button', { name: '确认清除' }));
    await waitFor(() => expect(apiMocks.saveSciverseSettings).toHaveBeenCalledWith({ baseUrl: configuredSettings.base_url, clearApiToken: true, enabled: false }));
  });
});
