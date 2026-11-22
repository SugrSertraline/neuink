// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RerankSettingsSection } from './RerankSettingsSection';
import {
  getRerankSettings,
  listInstalledRerankModels,
  saveRerankSettings
} from '@/shared/ipc/workspaceApi';

vi.mock('@/shared/ipc/workspaceApi', () => ({
  getRerankSettings: vi.fn(),
  listInstalledRerankModels: vi.fn(),
  saveRerankSettings: vi.fn()
}));

const base = {
  mode: 'off' as const,
  model_dir: null,
  max_candidates: 20,
  fallback_heuristic: true,
  transport: 'local' as const,
  api_endpoint: null,
  api_model: null,
  api_style: 'protocol' as const,
  model_present: false,
  has_api_key: false,
};

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(getRerankSettings).mockReset();
  vi.mocked(listInstalledRerankModels).mockReset();
  vi.mocked(listInstalledRerankModels).mockResolvedValue([]);
  vi.mocked(saveRerankSettings).mockReset();
});

describe('RerankSettingsSection', () => {
  it('loads only while the tab is active', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue(base);
    const { rerender } = render(<RerankSettingsSection active={false} />);
    expect(getRerankSettings).not.toHaveBeenCalled();
    rerender(<RerankSettingsSection active />);
    await waitFor(() => expect(getRerankSettings).toHaveBeenCalledTimes(1));
  });

  it('shows that no model is needed for the default mode', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue(base);
    render(<RerankSettingsSection active />);
    await waitFor(() =>
      expect(screen.getByTestId('rerank-model-status').textContent).toContain('当前不需要本地模型')
    );
    expect(screen.queryByRole('switch', { name: '启用尾部范围精排（v6）' })).toBeNull();
  });

  it('warns when the cross-encoder is selected but no model is installed', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({
      ...base,
      mode: 'cross_encoder',
      model_present: false,
  has_api_key: false,
    });
    render(<RerankSettingsSection active />);
    await waitFor(() =>
      expect(screen.getByTestId('rerank-model-status').textContent).toContain('当前会退回字段覆盖排序')
    );
    // The model directory row only exists for the model-backed rung.
    expect(screen.getByRole('textbox', { name: '重排模型目录' })).toBeDefined();
  });

  it('saves the heuristic mode and reports a model that is actually present', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({ ...base, model_present: true });
    vi.mocked(saveRerankSettings).mockImplementation(async (settings) => ({
      ...settings,
      model_present: true,
      has_api_key: false,
      scope_refine: undefined
    }) as Awaited<ReturnType<typeof saveRerankSettings>>);
    render(<RerankSettingsSection active />);
    await waitFor(() => expect(getRerankSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('switch', { name: '模型不可用时退回字段覆盖' }));
    await waitFor(() => expect(saveRerankSettings).toHaveBeenCalled());
    expect(vi.mocked(saveRerankSettings).mock.calls[0][0]).toMatchObject({
      mode: 'off',
      fallback_heuristic: false
    });
  });

  it('turns listwise on and turns scope refine off', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({
      ...base,
      mode: 'cross_encoder',
      scope_refine: {
        enabled: true,
        use_assistant_llm: true,
        api_endpoint: null,
        api_model: null,
        timeout_ms: 30_000,
        max_concurrency: 8,
        has_api_key: true
      }
    });
    vi.mocked(saveRerankSettings).mockImplementation(async (settings) => ({
      ...base,
      ...settings,
      model_present: false,
      has_api_key: false,
      listwise: settings.listwise
        ? { ...settings.listwise, has_api_key: Boolean(settings.listwise.api_key) }
        : undefined
    }) as Awaited<ReturnType<typeof saveRerankSettings>>);
    render(<RerankSettingsSection active />);
    await waitFor(() => expect(screen.getByRole('switch', { name: '启用无锁 Top-25 Listwise 精排（单次调用）' })).toBeDefined());
    fireEvent.click(screen.getByRole('switch', { name: '启用无锁 Top-25 Listwise 精排（单次调用）' }));
    await waitFor(() => expect(saveRerankSettings).toHaveBeenCalled());
    const calls = vi.mocked(saveRerankSettings).mock.calls;
    expect(calls[calls.length - 1]?.[0]).toMatchObject({
      listwise: { enabled: true },
      scope_refine: { enabled: false }
    });
  });

  it('keeps a blank listwise key as an empty placeholder', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({
      ...base,
      listwise: {
        enabled: true,
        use_assistant_llm: true,
        api_endpoint: null,
        api_model: null,
        top_n: 25,
        fuse_rrf: true,
        timeout_ms: 60_000,
        has_api_key: true
      }
    });
    render(<RerankSettingsSection active />);
    await waitFor(() =>
      expect(screen.getByLabelText('Listwise API 密钥').getAttribute('placeholder')).toContain('已保存')
    );
  });

  it('keeps the backend message when saving is rejected', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue(base);
    vi.mocked(saveRerankSettings).mockRejectedValue(new Error('重排候选上限必须在 1 到 200 之间'));
    render(<RerankSettingsSection active />);
    await waitFor(() => expect(getRerankSettings).toHaveBeenCalled());

    const candidates = screen.getByRole('spinbutton', { name: '重排候选上限' });
    fireEvent.change(candidates, { target: { value: '0' } });
    fireEvent.blur(candidates);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('重排候选上限必须在 1 到 200 之间')
    );
  });

  it('auto-selects an installed reranker when no directory is configured', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({ ...base, mode: 'cross_encoder' });
    vi.mocked(listInstalledRerankModels).mockResolvedValue([
      {
        id: 'rerank-base-int8-xenova',
        path: 'D:/models/rerank',
        label: 'bge-reranker-base int8（Xenova）'
      }
    ]);
    vi.mocked(saveRerankSettings).mockImplementation(async (settings) => ({
      ...settings,
      model_present: true,
      has_api_key: false,
      scope_refine: undefined
    }) as Awaited<ReturnType<typeof saveRerankSettings>>);
    render(<RerankSettingsSection active />);
    await waitFor(() =>
      expect(saveRerankSettings).toHaveBeenCalledWith(
        expect.objectContaining({ model_dir: 'D:/models/rerank' })
      )
    );
  });

  it('keeps tail refine off until enabled, then saves reuse or an override', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({ ...base, mode: 'cross_encoder' });
    vi.mocked(saveRerankSettings).mockImplementation(async (settings) => ({
      ...base,
      ...settings,
      mode: 'cross_encoder',
      model_present: false,
      has_api_key: false,
      scope_refine: {
        enabled: settings.scope_refine?.enabled ?? false,
        use_assistant_llm: settings.scope_refine?.use_assistant_llm ?? true,
        api_endpoint: settings.scope_refine?.api_endpoint ?? null,
        api_model: settings.scope_refine?.api_model ?? null,
        has_api_key: Boolean(settings.scope_refine?.api_key),
        timeout_ms: settings.scope_refine?.timeout_ms ?? 30000,
        max_concurrency: settings.scope_refine?.max_concurrency ?? 8
      }
    }) as Awaited<ReturnType<typeof saveRerankSettings>>);
    render(<RerankSettingsSection active />);
    const scopeSwitch = await screen.findByRole('switch', { name: '启用尾部范围精排（v6）' });
    expect(scopeSwitch.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(scopeSwitch);
    await waitFor(() =>
      expect(saveRerankSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          scope_refine: expect.objectContaining({ enabled: true, use_assistant_llm: true, api_key: null })
        })
      )
    );

    expect(screen.getByText(/留空则沿用助手的 OpenAI 兼容配置/)).toBeDefined();
    fireEvent.click(screen.getByRole('switch', { name: '复用助手 OpenAI 兼容模型' }));
    await waitFor(() => {
      const calls = vi.mocked(saveRerankSettings).mock.calls;
      expect(calls[calls.length - 1]?.[0].scope_refine).toMatchObject({
        use_assistant_llm: false
      });
      expect(screen.getByText('使用下方填写的地址、模型和密钥。密钥只保存在本机，留空表示保持已保存的密钥。')).toBeDefined();
      expect(screen.queryByText(/留空则沿用助手的 OpenAI 兼容配置/)).toBeNull();
    });
    fireEvent.change(screen.getByRole('textbox', { name: '尾部范围精排 API 地址' }), {
      target: { value: 'https://api.siliconflow.cn/v1' }
    });
    fireEvent.change(screen.getByRole('textbox', { name: '尾部范围精排模型' }), {
      target: { value: 'deepseek-ai/DeepSeek-V4.1-Flash' }
    });
    fireEvent.blur(screen.getByRole('textbox', { name: '尾部范围精排模型' }));
    await waitFor(() => {
      const calls = vi.mocked(saveRerankSettings).mock.calls;
      expect(calls[calls.length - 1]?.[0].scope_refine).toMatchObject({
        api_endpoint: 'https://api.siliconflow.cn/v1',
        api_model: 'deepseek-ai/DeepSeek-V4.1-Flash',
        api_key: null
      });
    });

    fireEvent.change(screen.getByLabelText('尾部范围精排 API 密钥'), {
      target: { value: 'secret-token' }
    });
    fireEvent.blur(screen.getByLabelText('尾部范围精排 API 密钥'));
    await waitFor(() => {
      const calls = vi.mocked(saveRerankSettings).mock.calls;
      expect(calls[calls.length - 1]?.[0].scope_refine).toMatchObject({
        api_key: 'secret-token'
      });
    });
  });

  it('persists structured input, offline structural soft demotion, and single-paper listwise mode', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({
      ...base,
      mode: 'cross_encoder',
      listwise: {
        enabled: true,
        use_assistant_llm: true,
        api_endpoint: null,
        api_model: null,
        top_n: 25,
        fuse_rrf: true,
        single_paper_mode: true,
        timeout_ms: 60_000,
        has_api_key: false
      }
    });
    vi.mocked(saveRerankSettings).mockImplementation(async (settings) => ({
      ...base,
      ...settings,
      model_present: false,
      has_api_key: false,
      listwise: settings.listwise
        ? { ...settings.listwise, has_api_key: Boolean(settings.listwise.api_key) }
        : undefined
    }) as Awaited<ReturnType<typeof saveRerankSettings>>);

    render(<RerankSettingsSection active />);
    const structured = await screen.findByRole('switch', { name: '重排输入附带章节与类型标签' });
    const soft = screen.getByRole('switch', { name: '离线结构软降权' });
    const singlePaper = screen.getByRole('switch', { name: '单篇检索启用证据直出模式' });
    expect(structured.getAttribute('aria-checked')).toBe('true');
    expect(soft.getAttribute('aria-checked')).toBe('true');
    expect(singlePaper.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(structured);
    await waitFor(() =>
      expect(saveRerankSettings).toHaveBeenCalledWith(
        expect.objectContaining({ structured_input: false })
      )
    );

    fireEvent.click(soft);
    await waitFor(() =>
      expect(saveRerankSettings).toHaveBeenCalledWith(
        expect.objectContaining({ structural_soft_demotion: false })
      )
    );

    fireEvent.click(singlePaper);
    await waitFor(() => {
      const calls = vi.mocked(saveRerankSettings).mock.calls;
      expect(calls[calls.length - 1]?.[0].listwise).toMatchObject({
        single_paper_mode: false
      });
    });
  });

  it('preserves dashscope api_style when backend state returns it', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({
      ...base,
      mode: 'cross_encoder',
      transport: 'api',
      api_style: 'dashscope'
    });
    vi.mocked(saveRerankSettings).mockImplementation(async (settings) => ({
      ...base,
      ...settings,
      model_present: true,
      has_api_key: false
    }) as Awaited<ReturnType<typeof saveRerankSettings>>);
    render(<RerankSettingsSection active />);
    const styleSelect = await screen.findByLabelText('接口风格');
    expect(styleSelect.textContent).toContain('dashscope');
    fireEvent.click(screen.getByRole('switch', { name: '重排输入附带章节与类型标签' }));
    await waitFor(() =>
      expect(saveRerankSettings).toHaveBeenCalledWith(
        expect.objectContaining({ api_style: 'dashscope', structured_input: false })
      )
    );
  });
});

