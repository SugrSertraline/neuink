// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VisualSettingsSection } from './VisualSettingsSection';
import {
  downloadVisualWeights,
  getVisualEmbeddingSettings,
  getVisualRuntimeState,
  getVisualServiceStatus,
  installVisualRuntime,
  listRecommendedVisualModels,
  prepareVisualSearchIndex,
  saveVisualEmbeddingSettings,
  startVisualService
} from '@/shared/ipc/workspaceApi';

vi.mock('@/shared/ipc/workspaceApi', () => ({
  getVisualEmbeddingSettings: vi.fn(),
  saveVisualEmbeddingSettings: vi.fn(),
  prepareVisualSearchIndex: vi.fn(),
  listRecommendedVisualModels: vi.fn(),
  getVisualRuntimeState: vi.fn(),
  getVisualServiceStatus: vi.fn(),
  installVisualRuntime: vi.fn(),
  downloadVisualWeights: vi.fn(),
  startVisualService: vi.fn()
}));

const base = {
  provider: 'qwen_local' as const,
  has_api_key: false,
  endpoint: 'http://127.0.0.1:8765',
  timeout_ms: 60000,
  fusion: {
    mode: 'append_gated' as const,
    text_weight: 1,
    visual_weight: 0.5,
    rrf_k: 60,
    gate: { min_head_entries: 3, max_snippet_overlap: 2 }
  },
  startup: 'on_demand' as const
};

const qwenModel = {
  id: 'qwen3-vl-embedding-2b',
  display_name: 'Qwen3-VL-Embedding-2B（当前默认）',
  repository: 'Qwen/Qwen3-VL-Embedding-2B',
  homepage: 'https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B',
  weights_megabytes: 4255,
  dimensions: 2048,
  note: '默认视觉编码模型',
  install_path: '%USERPROFILE%\\neuink-visual-models\\qwen3-vl-embedding-2b',
  install_commands: ['python service.py --port 8765'],
  current_default: true
};

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(getVisualEmbeddingSettings).mockReset();
  vi.mocked(saveVisualEmbeddingSettings).mockReset();
  vi.mocked(prepareVisualSearchIndex).mockReset();
  vi.mocked(listRecommendedVisualModels).mockReset();
  vi.mocked(listRecommendedVisualModels).mockResolvedValue([qwenModel]);
  vi.mocked(getVisualRuntimeState).mockReset();
  vi.mocked(getVisualRuntimeState).mockResolvedValue(null);
  vi.mocked(getVisualServiceStatus).mockReset();
  vi.mocked(getVisualServiceStatus).mockResolvedValue({
    running: false,
    model: null,
    dimensions: null,
    endpoint: null,
    message: null
  });
  vi.mocked(installVisualRuntime).mockReset();
  vi.mocked(downloadVisualWeights).mockReset();
  vi.mocked(startVisualService).mockReset();
});

describe('VisualSettingsSection', () => {
  it('shows the stored provider without blocking inactive tabs and hides internal fusion knobs', async () => {
    vi.mocked(getVisualEmbeddingSettings).mockResolvedValue(base);
    const { rerender } = render(<VisualSettingsSection active={false} root="/lib" />);
    expect(getVisualEmbeddingSettings).not.toHaveBeenCalled();
    rerender(<VisualSettingsSection active root="/lib" />);
    await waitFor(() => expect(screen.getByTestId('visual-status').textContent).toContain('本地服务'));
    expect(screen.queryByRole('spinbutton', { name: '视觉通道权重' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: '视觉编码超时' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: '门控头部条目下限' })).toBeNull();
  });

  it('preserves untouched backend fusion/startup/timeout settings when saving endpoint changes', async () => {
    const customSaved = {
      ...base,
      has_api_key: true,
      timeout_ms: 90000,
      startup: 'manual' as const,
      fusion: { ...base.fusion, visual_weight: 0.8 }
    };
    vi.mocked(getVisualEmbeddingSettings).mockResolvedValue(customSaved);
    vi.mocked(saveVisualEmbeddingSettings).mockResolvedValue({
      ...customSaved,
      endpoint: 'http://127.0.0.1:8766'
    });
    render(<VisualSettingsSection active root="/lib" />);
    await waitFor(() => expect(getVisualEmbeddingSettings).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('视觉服务地址'), {
      target: { value: 'http://127.0.0.1:8766' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存视觉设置' }));
    await waitFor(() => expect(saveVisualEmbeddingSettings).toHaveBeenCalled());
    const sent = vi.mocked(saveVisualEmbeddingSettings).mock.calls[0][0];
    expect(sent.endpoint).toBe('http://127.0.0.1:8766');
    expect(sent.timeout_ms).toBe(90000);
    expect(sent.startup).toBe('manual');
    expect(sent.fusion.visual_weight).toBe(0.8);
    expect(sent.api_key).toBeUndefined();
  });

  it('sends a typed key so a remote endpoint can be configured', async () => {
    vi.mocked(getVisualEmbeddingSettings).mockResolvedValue({
      ...base,
      provider: 'qwen_api',
      endpoint: 'https://example.invalid/v1',
      has_api_key: false
    });
    vi.mocked(saveVisualEmbeddingSettings).mockResolvedValue({
      ...base,
      provider: 'qwen_api',
      endpoint: 'https://example.invalid/v1',
      has_api_key: true
    });
    render(<VisualSettingsSection active root="/lib" />);
    await waitFor(() => expect(getVisualEmbeddingSettings).toHaveBeenCalled());

    const key = await screen.findByLabelText('视觉服务密钥');
    fireEvent.change(key, { target: { value: 'secret-token' } });
    fireEvent.click(screen.getByRole('button', { name: '保存视觉设置' }));
    await waitFor(() => expect(saveVisualEmbeddingSettings).toHaveBeenCalled());
    expect(vi.mocked(saveVisualEmbeddingSettings).mock.calls[0][0].api_key).toBe('secret-token');
  });

  it('lets the user start a prepared local visual service directly inside the visual section', async () => {
    vi.mocked(getVisualEmbeddingSettings).mockResolvedValue(base);
    vi.mocked(getVisualRuntimeState).mockResolvedValue({
      model_id: 'qwen3-vl-embedding-2b',
      env_dir: 'D:/env',
      model_dir: 'D:/model',
      python: 'D:/env/python.exe',
      dependencies_installed: true,
      model_present: true,
      model_error: null
    });
    vi.mocked(startVisualService).mockResolvedValue(12345);
    vi.mocked(getVisualServiceStatus)
      .mockResolvedValueOnce({ running: false, model: null, dimensions: null, endpoint: null, message: null })
      .mockResolvedValueOnce({ running: true, model: 'model', dimensions: 2048, endpoint: 'http://127.0.0.1:8765', message: null });

    render(<VisualSettingsSection active root="/lib" />);
    const startBtn = await screen.findByRole('button', { name: '启动服务' });
    fireEvent.click(startBtn);
    await waitFor(() => expect(startVisualService).toHaveBeenCalledWith('qwen3-vl-embedding-2b'));
    await waitFor(() => expect(screen.getByTestId('visual-service-status').textContent).toContain('服务运行中'));
  });

  it('reports the prepared index counts and handles empty library cleanly', async () => {
    vi.mocked(getVisualEmbeddingSettings).mockResolvedValue(base);
    vi.mocked(prepareVisualSearchIndex)
      .mockResolvedValueOnce({
        provider: 'qwen-service',
        model_name: 'Qwen3-VL-Embedding-2B',
        dimensions: 2048,
        identity: 'id',
        namespace: 'ns',
        entry_count: 2,
        asset_count: 5,
        document_count: 15,
        embedded_count: 15
      })
      .mockResolvedValueOnce({
        provider: 'qwen-service',
        model_name: null,
        dimensions: 2048,
        identity: 'id',
        namespace: 'ns',
        entry_count: 0,
        asset_count: 0,
        document_count: 0,
        embedded_count: 0
      });
    render(<VisualSettingsSection active root="/lib" />);
    await waitFor(() => expect(getVisualEmbeddingSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '准备视觉索引' }));
    await waitFor(() =>
      expect(screen.getByTestId('visual-prepare-result').textContent).toContain('2 篇 / 5 个图表资产 / 15 个向量源')
    );

    fireEvent.click(screen.getByRole('button', { name: '准备视觉索引' }));
    await waitFor(() =>
      expect(screen.getByTestId('visual-prepare-result').textContent).toContain('未生成索引')
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces a rejected save with the backend message', async () => {
    vi.mocked(getVisualEmbeddingSettings).mockResolvedValue(base);
    vi.mocked(saveVisualEmbeddingSettings).mockRejectedValue(
      new Error('远程视觉编码 API 必须使用 https://，避免密钥明文传输')
    );
    render(<VisualSettingsSection active root="/lib" />);
    await waitFor(() => expect(getVisualEmbeddingSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '保存视觉设置' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('必须使用 https://')
    );
  });
});
