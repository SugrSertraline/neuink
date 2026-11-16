import { useEffect, useState } from 'react';
import {
  getTextModelSettings,
  getVisualRuntimeState,
  getVisualServiceStatus,
  installRecommendedRerankModel,
  installRecommendedTextModel,
  downloadVisualWeights,
  installVisualRuntime,
  listRecommendedRerankModels,
  listRecommendedTextModels,
  listRecommendedVisualModels,
  listTextModels,
  rebuildSearchIndex,
  runRetrievalSelfCheck,
  saveTextModelSettings,
  startVisualService,
  testTextEmbeddingConnection,
  type RecommendedRerankModelState,
  type RecommendedTextModelState,
  type RecommendedVisualModel,
  type VisualRuntimeState,
  type VisualServiceStatus,
  type RetrievalCheck,
  type TextEmbeddingProbeState,
  type TextEmbeddingProviderKind,
  type TextModelChoice,
  type TextModelSettingsInput,
  type TextModelSettingsState
} from '@/shared/ipc/workspaceApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsGroup, SettingRow, SettingSelect } from './SettingsPrimitives';

const VISUAL_MODEL = {
  label: 'Qwen3-VL-Embedding-2B',
  href: 'https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B'
};

const CHECK_LABEL: Record<RetrievalCheck['name'], string> = {
  text_model: '文本嵌入模型',
  library: '资料库',
  visual_model: '视觉编码服务',
  rerank: '重排'
};

/**
 * Model access in three blocks — text, visual, rerank — plus one button that answers the
 * only question that matters on a fresh machine: does retrieval actually work here.
 */
export function ModelAccessSettings({ active, root }: { active: boolean; root: string }) {
  const [choices, setChoices] = useState<TextModelChoice[]>([]);
  const [state, setState] = useState<TextModelSettingsState | null>(null);
  const [recommended, setRecommended] = useState<RecommendedTextModelState[]>([]);
  const [rerankModels, setRerankModels] = useState<RecommendedRerankModelState[]>([]);
  const [visualModels, setVisualModels] = useState<RecommendedVisualModel[]>([]);
  const [runtimes, setRuntimes] = useState<Record<string, VisualRuntimeState | null>>({});
  const [serviceStatus, setServiceStatus] = useState<VisualServiceStatus | null>(null);
  const [startingService, setStartingService] = useState(false);
  const [reuseDirs, setReuseDirs] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [provider, setProvider] = useState<TextEmbeddingProviderKind>('local_onnx');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [apiDimensions, setApiDimensions] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('60000');
  const [probe, setProbe] = useState<TextEmbeddingProbeState | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [rebuildNote, setRebuildNote] = useState<string | null>(null);
  const [checks, setChecks] = useState<RetrievalCheck[] | null>(null);
  const [checking, setChecking] = useState(false);

  const reload = async () => {
    const [models, current, textRecommended, rerankRecommended, visualRecommended, service] = await Promise.all([
      listTextModels(),
      getTextModelSettings(),
      listRecommendedTextModels(),
      listRecommendedRerankModels(),
      listRecommendedVisualModels(),
      getVisualServiceStatus().catch(() => null)
    ]);
    const runtimeStates = await Promise.all(
      visualRecommended.map(async (model) => [model.id, await getVisualRuntimeState(model.id)] as const)
    );
    setChoices(models);
    setState(current);
    setRecommended(textRecommended);
    setRerankModels(rerankRecommended);
    setVisualModels(visualRecommended);
    setRuntimes(Object.fromEntries(runtimeStates));
    setServiceStatus(service);
    setSelected(current.model_dir ?? models.find((model) => model.bundled)?.path ?? '');
    setCustom(current.model_dir ?? '');
    setProvider(current.provider);
    setEndpoint(current.endpoint ?? '');
    setApiModel(current.model ?? '');
    setApiDimensions(current.dimensions ? String(current.dimensions) : '');
    setTimeoutMs(String(current.timeout_ms));
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
      // Tauri rejects command errors with the backend string, not an Error instance;
      // showing the generic copy would hide why the install stopped.
      setError(cause instanceof Error ? cause.message : String(cause) || '未能安装推荐模型。');
    } finally {
      setInstalling(null);
    }
  };

  const installRerank = async (id: string) => {
    setInstalling(id);
    setError(null);
    try {
      await installRecommendedRerankModel(id);
      await reload();
      setRebuildNote('重排模型已下载并验证打分；在“重排”设置里选择它即可。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause) || '未能安装重排模型。');
    } finally {
      setInstalling(null);
    }
  };

  /** One payload shape for both saving and the live probe. */
  const textModelPayload = (): TextModelSettingsInput => ({
    provider,
    model_dir: provider === 'local_onnx' ? selected || null : state?.model_dir ?? null,
    endpoint: provider === 'api' ? endpoint.trim() || null : state?.endpoint ?? null,
    // Write-only: omit the key to keep the stored one; the backend merges it back in.
    ...(provider === 'api' && apiKey ? { api_key: apiKey } : {}),
    model: provider === 'api' ? apiModel.trim() || null : state?.model ?? null,
    dimensions: provider === 'api' ? Number(apiDimensions) || null : state?.dimensions ?? null,
    timeout_ms: Math.min(600000, Math.max(1, Math.round(Number(timeoutMs) || 60000)))
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

  const installRuntime = async (id: string) => {
    setInstalling(id);
    setError(null);
    setRebuildNote(null);
    try {
      const reuse = reuseDirs[id]?.trim();
      const state = await installVisualRuntime(id, reuse ? reuse : null);
      setRuntimes({ ...runtimes, [id]: state });
      setRebuildNote(
        state.dependencies_installed && state.model_present
          ? '视觉服务已就绪：' + state.model_dir + '。点“启动服务”即可。'
          : '依赖已安装，但权重缺失' + (state.model_error ? '：' + state.model_error : '') + '。'
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        message.includes("uv_missing")
          ? "未找到 uv（Python 环境管理器），请先安装 uv 后重试。"
          : `安装失败：${message}`
      );
    } finally {
      setInstalling(null);
    }
  };

  const downloadWeights = async (id: string) => {
    setInstalling(id);
    setError(null);
    setRebuildNote(null);
    try {
      const reuse = reuseDirs[id]?.trim();
      const state = await downloadVisualWeights(id, reuse ? reuse : null);
      setRuntimes({ ...runtimes, [id]: state });
      setRebuildNote('权重已下载：' + state.model_dir + '。点“启动服务”即可。');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError('权重下载失败：' + message);
      const fresh = await getVisualRuntimeState(id).catch(() => null);
      if (fresh) setRuntimes({ ...runtimes, [id]: fresh });
    } finally {
      setInstalling(null);
    }
  };
  const startService = async (id: string) => {
    setError(null);
    setStartingService(true);
    try {
      const pid = await startVisualService(id);
      const status = await getVisualServiceStatus().catch(() => null);
      if (status) setServiceStatus(status);
      setRebuildNote(
        status?.running
          ? '视觉服务运行中' + (status.dimensions ? '（' + status.dimensions + ' 维）' : '') + '，地址 http://127.0.0.1:8765。'
          : pid === 0
            ? '视觉服务已在运行（http://127.0.0.1:8765）。'
            : '视觉服务已启动（进程 ' + pid + '），地址 http://127.0.0.1:8765。'
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "未能启动视觉服务。");
    } finally {
      setStartingService(false);
    }
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      setChecks(await runRetrievalSelfCheck(root));
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
      title="模型与接入"
      description="文本、视觉、重排三条通道各自的模型来源与一键安装，以及一次点击完成的本机自检。"
    >
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-destructive">{error}</p>}

      <p className="mt-1 text-xs font-medium text-muted-foreground">文本嵌入模型</p>
      <SettingSelect
        id="tools-text-provider"
        label="编码方式"
        description="本地 ONNX 权重，或 OpenAI 兼容的 /embeddings 接口；两种方式共用同一套向量索引与检索管线。"
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
            description="目录内需有 neuink-embedding.json 与任一 ONNX 权重文件（model.onnx / model_int8.onnx / model_quantized.onnx）。"
          >
            <Input
              aria-label="文本嵌入模型目录"
              className="w-full min-w-0"
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
              className="w-full min-w-0"
              disabled={busy}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </SettingRow>
          <SettingRow
            id="tools-text-api-key"
            label="访问密钥"
            description="只写字段：不填则保留已保存的密钥；保存后不再回传明文。"
          >
            <Input
              aria-label="文本嵌入 API 密钥"
              type="password"
              className="w-full min-w-0"
              disabled={busy}
              placeholder={state?.has_api_key ? "已保存（留空不修改）" : "尚未设置"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </SettingRow>
          <SettingRow
            id="tools-text-api-model"
            label="模型名称"
            description="请求体中的 model 字段，例如 text-embedding-3-small；不写死任何厂商模型。"
          >
            <Input
              aria-label="文本嵌入 API 模型"
              className="w-full min-w-0"
              disabled={busy}
              value={apiModel}
              onChange={(event) => setApiModel(event.target.value)}
            />
          </SettingRow>
          <SettingRow
            id="tools-text-api-dimensions"
            label="向量维度"
            description="服务端输出的维度；返回向量会按该维度校验，不匹配即报错。"
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
          <SettingRow
            id="tools-text-api-timeout"
            label="超时（毫秒）"
            description="单次请求超时，上限 600000。"
          >
            <Input
              aria-label="文本嵌入 API 超时"
              type="number"
              min={1}
              max={600000}
              className="w-28"
              disabled={busy}
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(event.target.value)}
            />
          </SettingRow>
        </>
      )}
      {state && (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="text-model-status">
          {state.available
            ? '当前加载：' + (state.loaded_model_name ?? '未知模型') + (state.loaded_dimensions ? '，' + state.loaded_dimensions + ' 维' : '') + '（' + state.resolved_dir + '）'
            : '模型不可用：' + (state.message ?? '未检测到可用模型')}
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
      {provider === 'local_onnx' && recommended.length > 0 && (
        <ul className="mt-2 space-y-1">
          {recommended.map((entry) => (
            <li
              key={entry.model.id}
              className="flex flex-wrap items-baseline gap-x-2 text-xs leading-5 text-muted-foreground"
              data-testid={`recommended-${entry.model.id}`}
            >
              <span className="font-medium text-foreground">{entry.model.display_name}</span>
              <span>
                {entry.model.dimensions} 维 · {entry.model.onnx_megabytes} MB ·{" "}
                {entry.model.pooling.toUpperCase()} 池化 · {entry.model.languages} · {entry.model.license}
              </span>
              {entry.installed ? (
                <span className="text-foreground">已安装</span>
              ) : entry.model.directly_installable ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={installing !== null}
                  onClick={() => void installText(entry.model.id)}
                >
                  {installing === entry.model.id ? '下载中…' : '一键安装'}
                </Button>
              ) : (
                <span>需自行导出</span>
              )}
              <a className="underline" href={entry.model.homepage} target="_blank" rel="noreferrer">
                模型页
              </a>
              <span className="basis-full">{entry.model.note}</span>
              {entry.model.export_hint && (
                <code className="basis-full select-all font-mono text-[11px] leading-4 text-muted-foreground">
                  {entry.model.export_hint}
                </code>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-border pt-2">
        <p className="text-xs font-medium text-muted-foreground">视觉编码模型</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          视觉通道是一个本机 Python 服务，需要 torch 与 PyMuPDF，因此不随安装包下载：按下面每条给出的路径与命令准备权重并启动服务，再回到本页填地址与密钥。
        </p>
        <ul className="mt-1 space-y-1">
          {visualModels.map((model) => (
            <li
              key={model.id}
              className="flex flex-wrap items-baseline gap-x-2 text-xs leading-5 text-muted-foreground"
              data-testid={`recommended-visual-${model.id}`}
            >
              <span className="font-medium text-foreground">{model.display_name}</span>
              <span>
                {model.dimensions} 维 · {model.weights_megabytes} MB
              </span>
              <a className="underline" href={model.homepage} target="_blank" rel="noreferrer">
                模型页
              </a>
              <span className="basis-full">{model.note}</span>
              <span className="basis-full">
                建议安装路径：<code className="select-all font-mono text-[11px]">{model.install_path}</code>
              </span>
              <span className="basis-full flex flex-wrap items-center gap-x-2 gap-y-1">
                <Input
                  aria-label={`${model.display_name} 本地模型目录（可选）`}
                  className="h-7 w-72 min-w-0 font-mono text-[11px]"
                  placeholder="已有权重目录（留空则下载）"
                  value={reuseDirs[model.id] ?? ""}
                  onChange={(event) =>
                    setReuseDirs({ ...reuseDirs, [model.id]: event.target.value })
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={installing !== null}
                  onClick={() => void installRuntime(model.id)}
                >
                  {installing === model.id ? "安装中…" : "一键安装依赖与模型"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!runtimes[model.id]?.dependencies_installed || checking || startingService || (model.id === 'qwen3-vl-embedding-2b' && serviceStatus?.running)}
                  onClick={() => void startService(model.id)}
                >
                  {startingService
                    ? '启动中…'
                    : model.id === 'qwen3-vl-embedding-2b' && serviceStatus?.running
                      ? '服务运行中'
                      : '启动服务'}
                </Button>
                {model.id === 'qwen3-vl-embedding-2b' && (serviceStatus || startingService) && (
                  <span data-testid="visual-service-status">
                    {startingService
                      ? '服务启动中…'
                      : serviceStatus?.running
                        ? '服务运行中' +
                          (serviceStatus.dimensions ? '（' + serviceStatus.dimensions + ' 维）' : '')
                        : '服务未运行'}
                  </span>
                )}
                {runtimes[model.id]?.dependencies_installed && !runtimes[model.id]?.model_present && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={installing !== null}
                    onClick={() => void downloadWeights(model.id)}
                  >
                    {installing === model.id ? '下载中…' : '下载权重'}
                  </Button>
                )}
                <span data-testid={`visual-runtime-${model.id}`}>
                  {runtimes[model.id]?.dependencies_installed
                    ? runtimes[model.id]?.model_present
                      ? '已就绪：' + runtimes[model.id]?.model_dir
                      : '依赖已装，权重缺失' +
                        (runtimes[model.id]?.model_error
                          ? '：' + runtimes[model.id]?.model_error
                          : '')
                    : "未安装"}
                </span>
              </span>
              {model.install_commands.length > 0 && (
                <details className="basis-full">
                  <summary className="cursor-pointer select-none">手动步骤（备用）</summary>
                  <code className="mt-1 block select-all whitespace-pre-wrap font-mono text-[11px] leading-4">
                    {model.install_commands.join("\n")}
                  </code>
                </details>
              )}
            </li>
          ))}
        </ul>
      </div>

      {rerankModels.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="text-xs font-medium text-muted-foreground">重排模型</p>
          <ul className="mt-1 space-y-1">
            {rerankModels.map((entry) => (
              <li
                key={entry.model.id}
                className="flex flex-wrap items-baseline gap-x-2 text-xs leading-5 text-muted-foreground"
                data-testid={`recommended-rerank-${entry.model.id}`}
              >
                <span className="font-medium text-foreground">{entry.model.display_name}</span>
                <span>{entry.model.onnx_megabytes} MB</span>
                {entry.installed ? (
                  <span className="text-foreground">已安装</span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={installing !== null}
                    onClick={() => void installRerank(entry.model.id)}
                  >
                    {installing === entry.model.id ? '下载中…' : '一键安装'}
                  </Button>
                )}
                <a className="underline" href={entry.model.homepage} target="_blank" rel="noreferrer">
                  模型页
                </a>
                <span className="basis-full">{entry.model.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 border-t border-border pt-2">
        <p className="text-xs font-medium text-muted-foreground">本机检索配置</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={checking || !root} onClick={() => void check()}>
            {checking ? '检测中…' : '一键测试能否使用'}
          </Button>
          <span className="text-xs leading-5 text-muted-foreground">
            依次验证文本模型、资料库、视觉服务与重排，逐条给出结论与耗时。
          </span>
        </div>
        {checks && (
          <ul className="mt-1 space-y-1" data-testid="self-check-results">
            {checks.map((result) => (
              <li key={result.name} className="text-xs leading-5 text-muted-foreground">
                <span className={result.ok ? 'text-foreground' : 'text-destructive'}>
                  {result.ok ? '通过' : '未通过'}
                </span>
                <span className="mx-2 font-medium">{CHECK_LABEL[result.name]}</span>
                <span>{result.detail}</span>
                <span className="ml-2">{result.ms} ms</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {rebuildNote && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground" data-testid="text-model-note">
          {rebuildNote}
        </p>
      )}
    </SettingsGroup>
  );
}






