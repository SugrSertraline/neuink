import { useEffect, useState } from 'react';
import {
  downloadVisualWeights,
  getVisualEmbeddingSettings,
  getVisualRuntimeState,
  getVisualServiceStatus,
  installVisualRuntime,
  listRecommendedVisualModels,
  prepareVisualSearchIndex,
  saveVisualEmbeddingSettings,
  startVisualService,
  type RecommendedVisualModel,
  type VisualEmbeddingProviderKind,
  type VisualEmbeddingSettingsState,
  type VisualRuntimeState,
  type VisualServiceStatus
} from '@/shared/ipc/workspaceApi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsGroup, SettingRow, SettingSelect } from './SettingsPrimitives';

const PROVIDER_OPTIONS: ReadonlyArray<{ value: VisualEmbeddingProviderKind; label: string }> = [
  { value: 'qwen_local', label: '本地服务（Qwen2B）' },
  { value: 'qwen_api', label: '远程 API（https）' }
];

/**
 * Unified Visual Encoding Service section: connection settings, local model/runtime
 * installation & service startup, and visual index preparation.
 * Internal fusion/gating/timeout/startup engineering settings stay untouched and hidden.
 */
export function VisualSettingsSection({ active, root }: { active: boolean; root: string }) {
  const [saved, setSaved] = useState<VisualEmbeddingSettingsState | null>(null);
  const [provider, setProvider] = useState<VisualEmbeddingProviderKind>('qwen_local');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [visualModels, setVisualModels] = useState<RecommendedVisualModel[]>([]);
  const [runtimes, setRuntimes] = useState<Record<string, VisualRuntimeState | null>>({});
  const [serviceStatus, setServiceStatus] = useState<VisualServiceStatus | null>(null);
  const [reuseDirs, setReuseDirs] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [startingService, setStartingService] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<string | null>(null);

  const loadAll = async () => {
    const [settings, models, status] = await Promise.all([
      getVisualEmbeddingSettings(),
      listRecommendedVisualModels().catch(() => [] as RecommendedVisualModel[]),
      getVisualServiceStatus().catch(() => null)
    ]);
    const runtimePairs = await Promise.all(
      models.map(async (model) => [model.id, await getVisualRuntimeState(model.id).catch(() => null)] as const)
    );
    setSaved(settings);
    setProvider(settings.provider === 'qwen_api' ? 'qwen_api' : 'qwen_local');
    setEndpoint(settings.endpoint ?? '');
    setApiKey('');
    setVisualModels(models);
    setRuntimes(Object.fromEntries(runtimePairs));
    setServiceStatus(status);
  };

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void loadAll().catch(() => {
      if (!cancelled) setError('未能读取视觉编码设置。');
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const persist = async () => {
    if (!saved) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveVisualEmbeddingSettings({
        provider,
        endpoint: endpoint.trim() ? endpoint.trim() : null,
        // Preserve untouched engineering settings on save.
        timeout_ms: saved.timeout_ms,
        startup: saved.startup ?? 'on_demand',
        fusion: saved.fusion,
        ...(apiKey ? { api_key: apiKey } : {})
      });
      setSaved(result);
      setProvider(result.provider === 'qwen_api' ? 'qwen_api' : 'qwen_local');
      setEndpoint(result.endpoint ?? '');
      setApiKey('');
      setNotice('视觉编码服务设置已保存。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause) || '未能保存视觉编码设置。');
    } finally {
      setBusy(false);
    }
  };

  const prepare = async () => {
    setPreparing(true);
    setError(null);
    setPrepared(null);
    try {
      const result = await prepareVisualSearchIndex(root);
      setPrepared(
        result.document_count === 0
          ? '当前资料库还没有可编码的图片或页面，未生成索引。'
          : `已写入索引：${result.entry_count} 篇 / ${result.asset_count} 个图表资产 / ${result.document_count} 个向量源（本次用到 ${result.embedded_count} 个）。`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause) || '未能准备视觉索引。');
    } finally {
      setPreparing(false);
    }
  };

  const installRuntime = async (id: string) => {
    setInstalling(id);
    setError(null);
    setNotice(null);
    try {
      const reuse = reuseDirs[id]?.trim();
      const state = await installVisualRuntime(id, reuse ? reuse : null);
      setRuntimes((prev) => ({ ...prev, [id]: state }));
      setNotice(
        state.dependencies_installed && state.model_present
          ? `视觉服务已就绪：${state.model_dir}。点击“启动服务”即可。`
          : `依赖已安装，但权重缺失${state.model_error ? `：${state.model_error}` : ''}。`
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        message.includes('uv_missing')
          ? '未找到 uv（Python 环境管理器），请先安装 uv 后重试。'
          : `安装失败：${message}`
      );
    } finally {
      setInstalling(null);
    }
  };

  const downloadWeights = async (id: string) => {
    setInstalling(id);
    setError(null);
    setNotice(null);
    try {
      const reuse = reuseDirs[id]?.trim();
      const state = await downloadVisualWeights(id, reuse ? reuse : null);
      setRuntimes((prev) => ({ ...prev, [id]: state }));
      setNotice(`权重已下载：${state.model_dir}。点击“启动服务”即可。`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(`权重下载失败：${message}`);
      const fresh = await getVisualRuntimeState(id).catch(() => null);
      if (fresh) setRuntimes((prev) => ({ ...prev, [id]: fresh }));
    } finally {
      setInstalling(null);
    }
  };

  const startService = async (id: string) => {
    setError(null);
    setNotice(null);
    setStartingService(true);
    try {
      const pid = await startVisualService(id);
      const status = await getVisualServiceStatus().catch(() => null);
      if (status) setServiceStatus(status);
      setNotice(
        status?.running
          ? `视觉服务运行中${status.dimensions ? `（${status.dimensions} 维）` : ''}，地址 ${endpoint || 'http://127.0.0.1:8765'}。`
          : pid === 0
            ? '视觉服务已在运行。'
            : `视觉服务已启动（进程 ${pid}）。`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause) || '未能启动视觉服务。');
    } finally {
      setStartingService(false);
    }
  };

  const isApi = provider === 'qwen_api';

  return (
    <SettingsGroup
      id="tools-visual"
      title="视觉编码服务"
      description="将 PDF 页面与图表编码到视觉空间用于图文召回；模型未启动或未建索引时自动降级纯文本检索。"
    >
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-destructive">{error}</p>}
      <SettingSelect
        id="tools-visual-provider"
        label="编码方式"
        description="选择本机 Qwen 视觉服务，或兼容的远程 HTTPS 接口。"
        disabled={!saved || busy}
        value={provider}
        options={PROVIDER_OPTIONS}
        onValueChange={(value) => setProvider(value as VisualEmbeddingProviderKind)}
      />
      <SettingRow
        id="tools-visual-endpoint"
        label="服务地址"
        description={isApi ? '远程端点，例如 https://example.com/v1' : '本地服务默认 http://127.0.0.1:8765'}
      >
        <Input
          aria-label="视觉服务地址"
          className="w-full min-w-0 font-mono text-xs"
          disabled={!saved || busy}
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
        />
      </SettingRow>
      {isApi && (
        <SettingRow
          id="tools-visual-key"
          label="访问密钥"
          description="只写字段：不填则保留已保存的密钥。"
        >
          <Input
            aria-label="视觉服务密钥"
            type="password"
            className="w-full min-w-0 font-mono text-xs"
            disabled={!saved || busy}
            placeholder={saved?.has_api_key ? '已保存（留空不修改）' : '尚未设置'}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </SettingRow>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!saved || busy} onClick={() => void persist()}>
          保存视觉设置
        </Button>
        <Button size="sm" variant="outline" disabled={preparing || !root} onClick={() => void prepare()}>
          {preparing ? '正在编码…' : '准备视觉索引'}
        </Button>
      </div>

      {saved && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground" data-testid="visual-status">
          {saved.provider === 'retired'
            ? '当前视觉编码方式已停用，请改选本地服务或远程 API。'
            : `当前：${saved.provider === 'qwen_api' ? '远程 API' : '本地服务'}${saved.has_api_key ? '（已保存密钥）' : ''}。`}
        </p>
      )}
      {notice && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="visual-notice">
          {notice}
        </p>
      )}
      {prepared && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="visual-prepare-result">
          {prepared}
        </p>
      )}

      {!isApi && visualModels.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-md border border-border">
          <div className="bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            本机视觉模型与服务
          </div>
          <ul className="divide-y divide-border">
            {visualModels.map((model) => {
              const runtime = runtimes[model.id];
              const isInstalled = Boolean(runtime?.dependencies_installed && runtime?.model_present);
              const needsWeightsOnly = Boolean(runtime?.dependencies_installed && !runtime?.model_present);
              const isDefaultRunning = model.id === 'qwen3-vl-embedding-2b' && Boolean(serviceStatus?.running);
              return (
                <li
                  key={model.id}
                  className="px-3 py-2.5 text-xs leading-5"
                  data-testid={`recommended-visual-${model.id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-[13px] font-medium text-foreground">{model.display_name}</span>
                      <span className="text-muted-foreground">
                        {model.dimensions} 维 · {model.weights_megabytes} MB
                      </span>
                      <a
                        className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        href={model.homepage}
                        target="_blank"
                        rel="noreferrer"
                      >
                        模型页
                      </a>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        variant={isDefaultRunning || isInstalled ? 'secondary' : 'outline'}
                        data-testid={model.id === 'qwen3-vl-embedding-2b' ? 'visual-service-status' : `visual-runtime-${model.id}`}
                      >
                        {startingService && model.id === 'qwen3-vl-embedding-2b'
                          ? '服务启动中…'
                          : isDefaultRunning
                            ? `服务运行中${serviceStatus?.dimensions ? ` · ${serviceStatus.dimensions} 维` : ''}`
                            : isInstalled
                              ? '已就绪'
                              : needsWeightsOnly
                                ? '缺少权重'
                                : '未安装'}
                      </Badge>
                      {isInstalled ? (
                        <Button
                          size="sm"
                          variant={isDefaultRunning ? 'outline' : 'default'}
                          disabled={startingService || isDefaultRunning}
                          onClick={() => void startService(model.id)}
                        >
                          {startingService ? '启动中…' : isDefaultRunning ? '服务运行中' : '启动服务'}
                        </Button>
                      ) : needsWeightsOnly ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={installing !== null}
                          onClick={() => void downloadWeights(model.id)}
                        >
                          {installing === model.id ? '下载中…' : '下载权重'}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={installing !== null}
                          onClick={() => void installRuntime(model.id)}
                        >
                          {installing === model.id ? '安装中…' : '一键安装'}
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-muted-foreground">{model.note}</p>
                  {needsWeightsOnly && runtime?.model_error && (
                    <p className="mt-1 text-destructive">{runtime.model_error}</p>
                  )}
                  <details className="mt-1.5 text-muted-foreground">
                    <summary className="cursor-pointer select-none hover:text-foreground">
                      复用本地权重 / 手动步骤
                    </summary>
                    <div className="mt-2 space-y-2 rounded bg-muted/40 p-2.5">
                      <p className="text-[11px] leading-4">
                        建议安装路径：<code className="select-all font-mono text-foreground">{model.install_path}</code>
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          aria-label={`${model.display_name} 本地模型目录（可选）`}
                          className="h-7 min-w-0 flex-1 font-mono text-[11px]"
                          placeholder="已有权重目录（留空则自动下载）"
                          value={reuseDirs[model.id] ?? ''}
                          onChange={(event) =>
                            setReuseDirs({ ...reuseDirs, [model.id]: event.target.value })
                          }
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={installing !== null}
                          onClick={() => void installRuntime(model.id)}
                        >
                          {installing === model.id ? '安装中…' : isInstalled ? '重新安装' : '使用此目录安装'}
                        </Button>
                      </div>
                      {model.install_commands.length > 0 && (
                        <code className="block select-all whitespace-pre-wrap rounded bg-muted px-2 py-1.5 font-mono text-[11px] leading-4 text-foreground">
                          {model.install_commands.join('\n')}
                        </code>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </SettingsGroup>
  );
}
