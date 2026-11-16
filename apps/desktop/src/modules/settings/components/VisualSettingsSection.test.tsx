// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VisualSettingsSection } from './VisualSettingsSection';
import {
  getVisualEmbeddingSettings,
  prepareVisualSearchIndex,
  saveVisualEmbeddingSettings
} from '@/shared/ipc/workspaceApi';

vi.mock('@/shared/ipc/workspaceApi', () => ({
  getVisualEmbeddingSettings: vi.fn(),
  saveVisualEmbeddingSettings: vi.fn(),
  prepareVisualSearchIndex: vi.fn()
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

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(getVisualEmbeddingSettings).mockReset();
  vi.mocked(saveVisualEmbeddingSettings).mockReset();
  vi.mocked(prepareVisualSearchIndex).mockReset();
});

describe('VisualSettingsSection', () => {
  it('shows the stored provider without blocking the tab it is not on', async () => {
    vi.mocked(getVisualEmbeddingSettings).mockResolvedValue(base);
    const { rerender } = render(<VisualSettingsSection active={false} root="/lib" />);
    expect(getVisualEmbeddingSettings).not.toHaveBeenCalled();
    rerender(<VisualSettingsSection active root="/lib" />);
    await waitFor(() => expect(screen.getByTestId('visual-status').textContent).toContain('本地服务'));
  });

  it('saves only the fields the user changed and keeps a stored key when left empty', async () => {
    vi.mocked(getVisualEmbeddingSettings).mockResolvedValue({ ...base, has_api_key: true });
    vi.mocked(saveVisualEmbeddingSettings).mockResolvedValue({ ...base, has_api_key: true });
    render(<VisualSettingsSection active root="/lib" />);
    await waitFor(() => expect(getVisualEmbeddingSettings).toHaveBeenCalled());

    fireEvent.change(screen.getByRole('spinbutton', { name: '视觉通道权重' }), {
      target: { value: '0.8' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存视觉设置' }));
    await waitFor(() => expect(saveVisualEmbeddingSettings).toHaveBeenCalled());
    const sent = vi.mocked(saveVisualEmbeddingSettings).mock.calls[0][0];
    expect(sent.fusion.visual_weight).toBe(0.8);
    // An untouched password field must not overwrite the stored secret.
    expect(sent.api_key).toBeUndefined();
  });

  it('sends a typed key so a remote endpoint can be configured', async () => {
    // The stored provider is already the remote one, so the key row renders without
    // driving the Radix select (which needs pointer events this harness does not model).
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

  it('reports the prepared index counts', async () => {
    vi.mocked(getVisualEmbeddingSettings).mockResolvedValue(base);
    vi.mocked(prepareVisualSearchIndex).mockResolvedValue({
      provider: 'qwen-service',
      model_name: 'Qwen3-VL-Embedding-2B',
      dimensions: 2048,
      identity: 'id',
      namespace: 'ns',
      entry_count: 2,
      asset_count: 5,
      document_count: 15,
      embedded_count: 15
    });
    render(<VisualSettingsSection active root="/lib" />);
    await waitFor(() => expect(getVisualEmbeddingSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '准备视觉索引' }));
    await waitFor(() =>
      expect(screen.getByTestId('visual-prepare-result').textContent).toContain('2 篇 / 5 个图表资产 / 15 个向量源')
    );
  });

  it('treats an empty library as a state, not an error', async () => {
    vi.mocked(getVisualEmbeddingSettings).mockResolvedValue(base);
    vi.mocked(prepareVisualSearchIndex).mockResolvedValue({
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

