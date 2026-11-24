import { useEffect, useState } from 'react';
import {
  getRerankSettings,
  getTextModelSettings,
  getVisualEmbeddingSettings,
  getVisualRuntimeState,
  getVisualServiceStatus,
  installRecommendedTextModel,
  listRecommendedTextModels,
  listTextModels,
  rebuildSearchIndex,
  runRetrievalSelfCheck,
  saveTextModelSettings,
  testTextEmbeddingConnection,
  type RecommendedTextModelState,
  type RerankSettingsState,
  type RetrievalCheck,
  type TextEmbeddingProbeState,
  type TextEmbeddingProviderKind,
  type TextModelChoice,
  type TextModelSettingsInput,
  type TextModelSettingsState,
  type VisualEmbeddingSettingsState,
  type VisualRuntimeState,
  type VisualServiceStatus
} from '@/shared/ipc/workspaceApi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsGroup, SettingRow, SettingSelect } from './SettingsPrimitives';

const CHECK_LABEL: Record<RetrievalCheck['name'], string> = {
  text_model: '文本检索器',
  library: '资料库',
  visual_model: '视觉编码服务',
  rerank: 'Reranker'
};

/**
 * Text retriever configuration plus the compact 3-channel overview and one-click self-check.
 * Visual encoding service and Reranker live in their own sibling sections below.
 */
export function ModelAccessSettings({ active, root }: { active: boolean; root: string }) {
  const [choices, setChoices] = useState<TextModelChoice[]>([]);
  const [state, setState] = useState<TextModelSettingsState | null>(null);
  const [recommended, setRecommended] = useState<RecommendedTextModelState[]>([]);
  const [visualRuntime, setVisualRuntime] = useState<VisualRuntimeState | null>(null);
  const [serviceStatus, setServiceStatus] = useState<VisualServiceStatus | null>(null);
  const [rerankState, setRerankState] = useState<RerankSettingsState | null>(null);
  const [visualState, setVisualState] = useState<VisualEmbeddingSettingsState | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [provider, setProvider] = useState<TextEmbeddingProviderKind>('local_onnx');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [apiDimensions, setApiDimensions] = useState('');
  const [probe, setProbe] = useState<TextEmbeddingProbeState | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [rebuildNote, setRebuildNote] = useState<string | null>(null);
  const [checks, setChecks] = useState<RetrievalCheck[] | null>(null);
  const [checking, setChecking] = useState(false);

  const reload = async () => {
    const [models, current, textRecommended, service, rerank, visual, runtime] = await Promise.all([
      listTextModels(),
      getTextModelSettings(),
      listRecommendedTextModels(),
      getVisualServiceStatus().catch(() => null),
      getRerankSettings().catch(() => null),
      getVisualEmbeddingSettings().catch(() => null),
      getVisualRuntimeState('qwen3-vl-embedding-2b').catch(() => null)
    ]);
    setChoices(models);
    setState(current);
    setRecommended(textRecommended);
    setServiceStatus(service);
    setRerankState(rerank);
    setVisualState(visual);
    setVisualRuntime(runtime);
    setSelected(current.model_dir ?? models.find((model) => model.bundled)?.path ?? '');
    setCustom(current.model_dir ?? '');
    setProvider(current.provider);
    setEndpoint(current.endpoint ?? '');
    setApiModel(current.model ?? '');
    setApiDimensions(current.dimensions ? String(current.dimensions) : '');
    setApiKey('');
  };

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void reload().catch(() => {
      if (!cancelled) setError('未能读取模型设置。');
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const installText = async (id: string) => {
    setInstalling(id);
    setError(null);
    setRebuildNote(null);
    try {
      const installed = await installRecommendedTextModel(id);
      await reload();
      if (installed.installed_dir) {
        setSelected(installed.installed_dir);
        setCustom(installed.installed_dir);
        setRebuildNote('模型已下载并验证；点“应用模型”后重建索引即可使用。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause) || '未能安装推荐模型。');
    } finally {
      setInstalling(null);
    }
  };

  const textModelPayload = (): TextModelSettingsInput => ({
    provider,
    model_dir: provider === 'local_onnx' ? selected || null : state?.model_dir ?? null,
    endpoint: provider === 'api' ? endpoint.trim() || null : state?.endpoint ?? null,
    ...(provider === 'api' && apiKey ? { api_key: apiKey } : {}),
    model: provider === 'api' ? apiModel.trim() || null : state?.model ?? null,
    dimensions: provider === 'api' ? Number(apiDimensions) || null : state?.dimensions ?? null,
    // Keep existing persisted timeout rather than exposing an engineering timeout field.
    timeout_ms: state?.timeout_ms ?? 60000
  });

  const apply = async () => {
    setBusy(true);
    setError(null);
    setRebuildNote(null);
    setProbe(null);
    try {
      const saved = await saveTextModelSettings(textModelPayload());
      setState(saved);
      setApiKey('');
      setRebuildNote(
        saved.provider === 'api'
          ? '已切换到远程嵌入 API。现有索引属于上一种编码，请重建后再检索。'
          : '模型已切换：现有文本索引属于上一个模型，请重建后再检索。'
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause) || '未能保存文本嵌入模型设置。');
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
      setProbe(await testTextEmbeddingConnection(textModelPayload()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause) || '连接测试失败。');
    } finally {
      setTesting(false);
    }
  };

  const rebuild = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await rebuildSearchIndex(root, { segmentsOnly: true });
      setRebuildNote(`索引已重建：${response.rebuilt_vector_count} 个向量。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能重建检索索引。');
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const results = await runRetrievalSelfCheck(root);
      setChecks(results);
      await reload().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '自检失败。');
    } finally {
      setChecking(false);
    }
  };

  const options = choices.map((choice) => ({
    value: choice.path,
    label: `${choice.bundled ? '内置：' : ''}${choice.model_name ?? choice.id}${
      choice.dimensions ? `（${choice.dimensions} 维）` : ''
    }`
  }));

  return (
    <SettingsGroup
      id="tools-model-access"
      title="文本检索器"
      description="配置本地 ONNX 或 OpenAI 兼容文本嵌入模型，并查看全部三条检索通道状态。"
      action={
        <Button size="sm" variant="outline" disabled={checking || !root} onClick={() => void check()}>
          {checking ? '自检中…' : '一键自检'}
        </Button>
      }
    >
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-destructive">{error}</p>}

      <div className="mt-2 overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse text-xs leading-5" data-testid="channel-overview">
          <thead>
            <tr className="bg-muted/40 text-left text-muted-foreground">
              <th className="w-24 px-3 py-1.5 font-medium">通道</th>
              <th className="w-24 px-3 py-1.5 font-medium">后端</th>
              <th className="px-3 py-1.5 font-medium">当前状态</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border align-top">
              <td className="px-3 py-1.5 font-medium text-foreground">文本检索器</td>
              <td className="px-3 py-1.5 text-muted-foreground">{provider === 'api' ? '远程 API' : '本地 ONNX'}</td>
              <td className={`px-3 py-1.5 ${state?.available ? 'text-muted-foreground' : 'text-warning'}`}>
                {state?.available
                  ? `${state.loaded_model_name ?? '未知模型'}${state.loaded_dimensions ? ` · ${state.loaded_dimensions} 维` : ''}`
                  : (state?.message ?? '未检测到可用模型')}
              </td>
            </tr>
            <tr className="border-t border-border align-top">
              <td className="px-3 py-1.5 font-medium text-foreground">视觉编码服务</td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {visualState?.provider === 'qwen_api' ? '远程 API' : '本地服务'}
              </td>
              <td
                className={`px-3 py-1.5 ${
                  serviceStatus?.running || visualState?.provider === 'qwen_api'
                    ? 'text-muted-foreground'
                    : 'text-warning'
                }`}
              >
                {visualState?.provider === 'qwen_api'
                  ? visualState.endpoint
                    ? `已配置 ${visualState.endpoint}`
                    : '未填写地址与密钥'
                  : serviceStatus?.running
                    ? `服务运行中${serviceStatus.dimensions ? ` · ${serviceStatus.dimensions} 维` : ''}`
                    : visualRuntime?.dependencies_installed && visualRuntime?.model_present
                      ? '已就绪（未启动）'
                      : '未安装'}
              </td>
            </tr>
            <tr className="border-t border-border align-top">
              <td className="px-3 py-1.5 font-medium text-foreground">Reranker</td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {rerankState?.mode === 'cross_encoder'
                  ? rerankState.transport === 'api'
                    ? '远程 API'
                    : '本地 ONNX'
                  : '关闭'}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {rerankState?.mode === 'cross_encoder'
                  ? rerankState.transport === 'api'
                    ? rerankState.api_endpoint
                      ? `已配置 · ${rerankState.api_model ?? '缺模型名'}`
                      : '未填写地址'
                    : rerankState.model_present
                      ? '本地模型已就绪'
                      : '未检测到本地模型'
                  : '未启用'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {checks && (
        <div className="mt-2 overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse text-xs leading-5" data-testid="self-check-results">
            <thead>
              <tr className="bg-muted/40 text-left text-muted-foreground">
                <th className="w-14 px-3 py-1.5 font-medium">结果</th>
                <th className="w-24 px-3 py-1.5 font-medium">项目</th>
                <th className="px-3 py-1.5 font-medium">说明</th>
                <th className="w-16 px-3 py-1.5 text-right font-medium">耗时</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((result) => (
                <tr key={result.name} className="border-t border-border align-top">
                  <td className={`px-3 py-1.5 font-medium ${result.ok ? 'text-foreground' : 'text-destructive'}`}>
                    {result.ok ? '通过' : '未通过'}
                  </td>
                  <td className="px-3 py-1.5 text-foreground">{CHECK_LABEL[result.name]}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{result.detail}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{result.ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SettingSelect
        id="tools-text-provider"
        label="编码方式"
        description="本地 ONNX 权重，或 OpenAI 兼容的 /embeddings 接口。"
        disabled={!state || busy}
        value={provider}
        options={[
          { value: 'local_onnx', label: '本地 ONNX 模型' },
          { value: 'api', label: '远程 API（OpenAI 兼容）' }
        ]}
        onValueChange={(value) => setProvider(value as TextEmbeddingProviderKind)}
      />
      {provider === 'local_onnx' ? (
        <>
          <SettingSelect
            id="tools-text-model"
            label="当前模型"
            description="切换后需重建索引；维度与池化由模型目录内的 neuink-embedding.json 声明。"
            disabled={!state || busy || options.length === 0}
            value={selected}
            options={options}
            placeholder="选择模型目录"
            onValueChange={(value) => {
              setSelected(value);
              setCustom(value);
            }}
          />
          <SettingRow
            id="tools-text-model-custom"
            label="自定义模型目录"
            description="目录内需有 neuink-embedding.json 与 ONNX 权重文件。"
          >
            <Input
              aria-label="文本嵌入模型目录"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              value={custom}
              onChange={(event) => {
                setCustom(event.target.value);
                setSelected(event.target.value);
              }}
            />
          </SettingRow>
        </>
      ) : (
        <>
          <SettingRow
            id="tools-text-api-endpoint"
            label="服务地址"
            description="OpenAI 兼容基址，例如 https://api.example.com/v1；仅本机回环地址允许 http://。"
          >
            <Input
              aria-label="文本嵌入 API 地址"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </SettingRow>
          <SettingRow
            id="tools-text-api-key"
            label="访问密钥"
            description="只写字段：不填则保留已保存的密钥。"
          >
            <Input
              aria-label="文本嵌入 API 密钥"
              type="password"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              placeholder={state?.has_api_key ? '已保存（留空不修改）' : '尚未设置'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </SettingRow>
          <SettingRow
            id="tools-text-api-model"
            label="模型名称"
            description="请求体中的 model 字段，例如 text-embedding-3-small。"
          >
            <Input
              aria-label="文本嵌入 API 模型"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              value={apiModel}
              onChange={(event) => setApiModel(event.target.value)}
            />
          </SettingRow>
          <SettingRow
            id="tools-text-api-dimensions"
            label="向量维度"
            description="服务端输出维度；返回向量按该维度校验。"
          >
            <Input
              aria-label="文本嵌入 API 维度"
              type="number"
              min={1}
              max={8192}
              className="w-28"
              disabled={busy}
              value={apiDimensions}
              onChange={(event) => setApiDimensions(event.target.value)}
            />
          </SettingRow>
        </>
      )}

      {state && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="text-model-status">
          {state.available
            ? `当前加载：${state.loaded_model_name ?? '未知模型'}${state.loaded_dimensions ? `，${state.loaded_dimensions} 维` : ''}（${state.resolved_dir}）`
            : `模型不可用：${state.message ?? '未检测到可用模型'}`}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !state} onClick={() => void apply()}>
          应用模型
        </Button>
        {provider === 'api' && (
          <Button size="sm" variant="outline" disabled={busy || testing} onClick={() => void testConnection()}>
            {testing ? '测试中…' : '测试连接'}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy || !root} onClick={() => void rebuild()}>
          重建检索索引
        </Button>
      </div>
      {probe && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="text-model-probe">
          连接正常：{probe.provider} · {probe.model_name ?? '未知模型'} · {probe.dimensions} 维 · {probe.latency_ms} ms
        </p>
      )}
      {rebuildNote && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="text-model-note">
          {rebuildNote}
        </p>
      )}

      {provider === 'local_onnx' && recommended.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-md border border-border">
          <div className="bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            可下载的文本嵌入模型
          </div>
          <ul className="divide-y divide-border">
            {recommended.map((entry) => (
              <li
                key={entry.model.id}
                className="px-3 py-2.5 text-xs leading-5"
                data-testid={`recommended-${entry.model.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-medium text-foreground">{entry.model.display_name}</span>
                    <span className="text-muted-foreground">
                      {entry.model.dimensions} 维 · {entry.model.onnx_megabytes} MB · {entry.model.pooling.toUpperCase()} · {entry.model.languages}
                    </span>
                    <a
                      className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      href={entry.model.homepage}
                      target="_blank"
                      rel="noreferrer"
                    >
                      模型页
                    </a>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {entry.installed ? (
                      <Badge variant="secondary">已安装</Badge>
                    ) : entry.model.directly_installable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={installing !== null}
                        onClick={() => void installText(entry.model.id)}
                      >
                        {installing === entry.model.id ? '下载中…' : '一键安装'}
                      </Button>
                    ) : (
                      <Badge variant="outline">需手动导出</Badge>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-muted-foreground">{entry.model.note}</p>
                {entry.model.export_hint && (
                  <details className="mt-1.5 text-muted-foreground">
                    <summary className="cursor-pointer select-none hover:text-foreground">查看导出命令</summary>
                    <code className="mt-1 block select-all whitespace-pre-wrap rounded bg-muted px-2 py-1.5 font-mono text-[11px] leading-4 text-foreground">
                      {entry.model.export_hint}
                    </code>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsGroup>
  );
}
