// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelAccessSettings } from './ModelAccessSettings';
import {
  getRerankSettings,
  getTextModelSettings,
  getVisualEmbeddingSettings,
  getVisualRuntimeState,
  getVisualServiceStatus,
  listRecommendedRerankModels,
  listRecommendedTextModels,
  listRecommendedVisualModels,
  listTextModels,
  rebuildSearchIndex,
  saveTextModelSettings,
  testTextEmbeddingConnection,
  type TextModelSettingsState
} from '@/shared/ipc/workspaceApi';

vi.mock('@/shared/ipc/workspaceApi', () => ({
  getTextModelSettings: vi.fn(),
  listTextModels: vi.fn(),
  listRecommendedTextModels: vi.fn(),
  listRecommendedRerankModels: vi.fn(),
  listRecommendedVisualModels: vi.fn(),
  getVisualRuntimeState: vi.fn(),
  getRerankSettings: vi.fn(),
  applyQwenPreset: vi.fn(),
  getVisualEmbeddingSettings: vi.fn(),
  getVisualServiceStatus: vi.fn(),
  installVisualRuntime: vi.fn(),
  downloadVisualWeights: vi.fn(),
  startVisualService: vi.fn(),
  installRecommendedRerankModel: vi.fn(),
  runRetrievalSelfCheck: vi.fn(),
  installRecommendedTextModel: vi.fn(),
  saveTextModelSettings: vi.fn(),
  rebuildSearchIndex: vi.fn(),
  testTextEmbeddingConnection: vi.fn()
}));

const choices = [
  {
    id: 'default',
    model_name: 'BAAI/bge-m3',
    dimensions: 1024,
    pooling: 'cls',
    path: 'D:/models/default',
    bundled: true
  },
  {
    id: 'default-e5-small',
    model_name: 'intfloat/multilingual-e5-small',
    dimensions: 384,
    pooling: 'mean',
    path: 'D:/models/e5',
    bundled: false
  }
];

const current: TextModelSettingsState = {
  provider: 'local_onnx',
  model_dir: null,
  endpoint: null,
  has_api_key: false,
  model: null,
  dimensions: null,
  timeout_ms: 60000,
  resolved_dir: 'D:/models/default',
  loaded_model_name: 'BAAI/bge-m3',
  loaded_dimensions: 1024,
  available: true,
  message: null
};

const currentApi: TextModelSettingsState = {
  provider: 'api',
  model_dir: null,
  endpoint: 'https://api.example.com/v1',
  has_api_key: true,
  model: 'text-embedding-x',
  dimensions: 1024,
  timeout_ms: 60000,
  resolved_dir: 'https://api.example.com/v1',
  loaded_model_name: 'text-embedding-x',
  loaded_dimensions: 1024,
  available: true,
  message: null
};

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(getTextModelSettings).mockReset();
  vi.mocked(listTextModels).mockReset();
  vi.mocked(listRecommendedTextModels).mockReset();
  vi.mocked(listRecommendedTextModels).mockResolvedValue([]);
  vi.mocked(listRecommendedRerankModels).mockReset();
  vi.mocked(listRecommendedRerankModels).mockResolvedValue([]);
  vi.mocked(listRecommendedVisualModels).mockReset();
  vi.mocked(getVisualRuntimeState).mockReset();
  vi.mocked(getVisualServiceStatus).mockReset();
  vi.mocked(getVisualServiceStatus).mockResolvedValue({
    running: false,
    model: null,
    dimensions: null,
    endpoint: null,
    message: null
  });
  vi.mocked(getVisualRuntimeState).mockResolvedValue(null);
  vi.mocked(getRerankSettings).mockReset();
  vi.mocked(getRerankSettings).mockResolvedValue({
    mode: 'off',
    model_dir: null,
    max_candidates: 20,
    fallback_heuristic: true,
    transport: 'local',
    api_endpoint: null,
    api_model: null,
    has_api_key: false,
    model_present: false
  } as never);
  vi.mocked(getVisualEmbeddingSettings).mockReset();
  vi.mocked(getVisualEmbeddingSettings).mockResolvedValue({
    provider: 'qwen_local',
    has_api_key: false,
    endpoint: 'http://127.0.0.1:8765',
    timeout_ms: 60000,
    fusion: {
      mode: 'append_gated',
      text_weight: 1,
      visual_weight: 0.5,
      rrf_k: 60,
      gate: { min_head_entries: 3, max_snippet_overlap: 2 }
    },
    startup: 'on_demand'
  } as never);
  vi.mocked(listRecommendedVisualModels).mockResolvedValue([
    {
      id: 'siglip2-base-patch16-224',
      display_name: 'SigLIP2 base（更小）',
      repository: 'google/siglip2-base-patch16-224',
      homepage: 'https://huggingface.co/google/siglip2-base-patch16-224',
      weights_megabytes: 1501,
      dimensions: 768,
      note: '测试用视觉模型',
      install_path: '%USERPROFILE%\\neuink-visual-models\\siglip2-base-patch16-224',
      install_commands: ['huggingface-cli download google/siglip2-base-patch16-224'],
      current_default: false
    }
  ]);
  vi.mocked(saveTextModelSettings).mockReset();
  vi.mocked(rebuildSearchIndex).mockReset();
});

describe('ModelAccessSettings', () => {
  it('stays idle until its tab is active', () => {
    render(<ModelAccessSettings active={false} root="/lib" />);
    expect(listTextModels).not.toHaveBeenCalled();
  });

  it('shows the loaded model with its dimension and directory', async () => {
    vi.mocked(listTextModels).mockResolvedValue(choices);
    vi.mocked(getTextModelSettings).mockResolvedValue(current);
    render(<ModelAccessSettings active root="/lib" />);
    await waitFor(() =>
      expect(screen.getByTestId('text-model-status').textContent).toContain('BAAI/bge-m3，1024 维')
    );
  });

  it('offers the model pages so a missing model can be obtained', async () => {
    vi.mocked(listTextModels).mockResolvedValue(choices);
    vi.mocked(listRecommendedTextModels).mockResolvedValue([
      {
        model: {
          id: 'bge-m3-int8-xenova',
          display_name: 'bge-m3 int8（Xenova 单文件）',
          repository: 'Xenova/bge-m3',
          dimensions: 1024,
          pooling: 'cls',
          onnx_path: 'onnx/model_int8.onnx',
          onnx_megabytes: 569,
          languages: '中英 + 100 语种',
          license: 'MIT',
          note: '测试用条目',
          directly_installable: true,
          homepage: 'https://huggingface.co/Xenova/bge-m3',
          export_hint: ''
        },
        installed_dir: null,
        installed: false
      }
    ]);
    vi.mocked(getTextModelSettings).mockResolvedValue(current);
    render(<ModelAccessSettings active root="/lib" />);
    await waitFor(() => expect(screen.getByTestId('text-model-status')).toBeDefined());
    const links = screen
      .getAllByRole('link')
      .map((element) => element.getAttribute('href') ?? '');
    expect(links).toContain('https://huggingface.co/Xenova/bge-m3');
    expect(links).toContain('https://huggingface.co/google/siglip2-base-patch16-224');
    expect(links).toContain('https://huggingface.co/google/siglip2-base-patch16-224');
  });

  it('saves a custom directory and warns that the index must be rebuilt', async () => {
    vi.mocked(listTextModels).mockResolvedValue(choices);
    vi.mocked(getTextModelSettings).mockResolvedValue(current);
    vi.mocked(saveTextModelSettings).mockResolvedValue({ ...current, model_dir: 'D:/models/e5' });
    render(<ModelAccessSettings active root="/lib" />);
    await waitFor(() => expect(getTextModelSettings).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('文本嵌入模型目录'), { target: { value: 'D:/models/e5' } });
    fireEvent.click(screen.getByRole('button', { name: '应用模型' }));
    await waitFor(() =>
      expect(saveTextModelSettings).toHaveBeenCalledWith({
        provider: 'local_onnx',
        model_dir: 'D:/models/e5',
        endpoint: null,
        model: null,
        dimensions: null,
        timeout_ms: 60000
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('text-model-note').textContent).toContain('请重建')
    );
  });

  it('rebuilds the index and reports the vector count', async () => {
    vi.mocked(listTextModels).mockResolvedValue(choices);
    vi.mocked(getTextModelSettings).mockResolvedValue(current);
    vi.mocked(rebuildSearchIndex).mockResolvedValue({
      status: { scope: 'segments', semantic_status: 'ready_memory' } as never,
      rebuilt_vector_count: 331
    });
    render(<ModelAccessSettings active root="/lib" />);
    await waitFor(() => expect(getTextModelSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '重建检索索引' }));
    await waitFor(() =>
      expect(screen.getByTestId('text-model-note').textContent).toContain('331 个向量')
    );
  });

  it('keeps the backend rejection message', async () => {
    vi.mocked(listTextModels).mockResolvedValue(choices);
    vi.mocked(getTextModelSettings).mockResolvedValue(current);
    vi.mocked(saveTextModelSettings).mockRejectedValue(
      new Error('该目录不是可用的文本嵌入模型（需 neuink-embedding.json 与 ONNX 权重）')
    );
    render(<ModelAccessSettings active root="/lib" />);
    await waitFor(() => expect(getTextModelSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '应用模型' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('不是可用的文本嵌入模型')
    );
  });

  it('saves an OpenAI-compatible API configuration with a write-only key', async () => {
    vi.mocked(listTextModels).mockResolvedValue(choices);
    vi.mocked(getTextModelSettings).mockResolvedValue(currentApi);
    vi.mocked(saveTextModelSettings).mockResolvedValue(currentApi);
    render(<ModelAccessSettings active root="/lib" />);
    await waitFor(() => expect(getTextModelSettings).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('文本嵌入 API 密钥'), {
      target: { value: 'secret-token' }
    });
    fireEvent.click(screen.getByRole('button', { name: '应用模型' }));

    await waitFor(() =>
      expect(saveTextModelSettings).toHaveBeenCalledWith({
        provider: 'api',
        model_dir: null,
        endpoint: 'https://api.example.com/v1',
        api_key: 'secret-token',
        model: 'text-embedding-x',
        dimensions: 1024,
        timeout_ms: 60000
      })
    );
  });

  it('probes the configured API and shows the returned dimensions', async () => {
    vi.mocked(listTextModels).mockResolvedValue(choices);
    vi.mocked(getTextModelSettings).mockResolvedValue(currentApi);
    vi.mocked(testTextEmbeddingConnection).mockResolvedValue({
      provider: 'openai-compatible',
      model_name: 'text-embedding-x',
      dimensions: 1024,
      latency_ms: 42
    });
    render(<ModelAccessSettings active root="/lib" />);
    await waitFor(() => expect(getTextModelSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await waitFor(() =>
      expect(screen.getByTestId('text-model-probe').textContent).toContain('1024 维')
    );
  });
});



