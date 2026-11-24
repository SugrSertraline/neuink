// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RerankSettingsSection } from './RerankSettingsSection';
import {
  getRerankSettings,
  installRecommendedRerankModel,
  listInstalledRerankModels,
  listRecommendedRerankModels,
  saveRerankSettings
} from '@/shared/ipc/workspaceApi';

vi.mock('@/shared/ipc/workspaceApi', () => ({
  getRerankSettings: vi.fn(),
  listInstalledRerankModels: vi.fn(),
  listRecommendedRerankModels: vi.fn(),
  installRecommendedRerankModel: vi.fn(),
  saveRerankSettings: vi.fn()
}));

const base = {
  mode: 'off' as const,
  model_dir: null,
  max_candidates: 40,
  fallback_heuristic: true,
  transport: 'local' as const,
  api_endpoint: null,
  api_model: null,
  api_style: 'protocol' as const,
  structured_input: true,
  fuse_with_pool: false,
  structural_soft_demotion: true,
  model_present: false,
  has_api_key: false
};

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(getRerankSettings).mockReset();
  vi.mocked(listInstalledRerankModels).mockReset();
  vi.mocked(listInstalledRerankModels).mockResolvedValue([]);
  vi.mocked(listRecommendedRerankModels).mockReset();
  vi.mocked(listRecommendedRerankModels).mockResolvedValue([]);
  vi.mocked(installRecommendedRerankModel).mockReset();
  vi.mocked(saveRerankSettings).mockReset();
});

describe('RerankSettingsSection', () => {
  it('loads only while active and hides internal engineering switches', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({ ...base, mode: 'cross_encoder' });
    const { rerender } = render(<RerankSettingsSection active={false} />);
    expect(getRerankSettings).not.toHaveBeenCalled();
    rerender(<RerankSettingsSection active />);
    await waitFor(() => expect(getRerankSettings).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole('spinbutton', { name: '重排候选上限' })).toBeNull();
    expect(screen.queryByRole('switch', { name: /尾部范围精排/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: /Listwise/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: /离线结构软降权/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: /退回字段覆盖/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: /RRF/ })).toBeNull();
  });

  it('reports disabled state cleanly when reranker is off', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue(base);
    render(<RerankSettingsSection active />);
    await waitFor(() =>
      expect(screen.getByTestId('rerank-model-status').textContent).toContain('未启用 Reranker')
    );
  });

  it('auto-selects an installed local reranker while preserving untouched engineering fields', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({ ...base, mode: 'cross_encoder', max_candidates: 40 });
    vi.mocked(listInstalledRerankModels).mockResolvedValue([
      {
        id: 'rerank-base-int8-xenova',
        path: 'D:/models/rerank',
        label: 'bge-reranker-base int8（Xenova）'
      }
    ]);
    vi.mocked(saveRerankSettings).mockImplementation(async (settings) => ({
      ...base,
      ...settings,
      model_present: true,
      has_api_key: false
    }) as Awaited<ReturnType<typeof saveRerankSettings>>);

    render(<RerankSettingsSection active />);
    await waitFor(() =>
      expect(saveRerankSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'cross_encoder',
          transport: 'local',
          model_dir: 'D:/models/rerank',
          max_candidates: 40,
          structural_soft_demotion: true
        })
      )
    );
  });

  it('installs a recommended local rerank model directly from the Reranker section', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({ ...base, mode: 'cross_encoder' });
    vi.mocked(listRecommendedRerankModels).mockResolvedValue([
      {
        model: {
          id: 'rerank-base-int8-xenova',
          display_name: 'bge-reranker-base int8（Xenova）',
          repository: 'Xenova/bge-reranker-base',
          onnx_megabytes: 279,
          note: '默认本地重排模型',
          homepage: 'https://huggingface.co/Xenova/bge-reranker-base'
        },
        installed: false,
        installed_dir: null
      }
    ]);
    vi.mocked(installRecommendedRerankModel).mockResolvedValue({} as never);

    render(<RerankSettingsSection active />);
    const installBtn = await screen.findByRole('button', { name: '一键安装' });
    fireEvent.click(installBtn);
    await waitFor(() => expect(installRecommendedRerankModel).toHaveBeenCalledWith('rerank-base-int8-xenova'));
  });

  it('saves remote API fields without exposing api_instruction or listwise inputs', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({
      ...base,
      mode: 'cross_encoder',
      transport: 'api',
      api_endpoint: 'https://api.jina.ai/v1/rerank',
      api_model: 'jina-reranker-v2-base-multilingual',
      has_api_key: true
    });
    vi.mocked(saveRerankSettings).mockImplementation(async (settings) => ({
      ...base,
      ...settings,
      model_present: false,
      has_api_key: true
    }) as Awaited<ReturnType<typeof saveRerankSettings>>);

    render(<RerankSettingsSection active />);
    const modelInput = await screen.findByLabelText('重排 API 模型');
    expect(screen.queryByLabelText('重排任务指令')).toBeNull();
    fireEvent.change(modelInput, { target: { value: 'bge-reranker-v2-m3' } });
    fireEvent.blur(modelInput);
    await waitFor(() =>
      expect(saveRerankSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'cross_encoder',
          transport: 'api',
          api_model: 'bge-reranker-v2-m3'
        })
      )
    );
  });

  it('surfaces backend validation errors on rejected save', async () => {
    vi.mocked(getRerankSettings).mockResolvedValue({ ...base, mode: 'cross_encoder', model_dir: 'D:/bad' });
    vi.mocked(saveRerankSettings).mockRejectedValue(new Error('模型目录不可用'));
    render(<RerankSettingsSection active />);
    const dirInput = await screen.findByLabelText('重排模型目录');
    fireEvent.change(dirInput, { target: { value: 'D:/broken' } });
    fireEvent.blur(dirInput);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('模型目录不可用'));
  });
});
