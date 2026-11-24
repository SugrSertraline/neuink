import { useEffect, useState } from 'react';
import {
  getRerankSettings,
  installRecommendedRerankModel,
  listInstalledRerankModels,
  listRecommendedRerankModels,
  saveRerankSettings,
  type InstalledRerankModel,
  type RecommendedRerankModelState,
  type RerankSettings,
  type RerankSettingsState
} from '@/shared/ipc/workspaceApi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsGroup, SettingRow, SettingSelect } from './SettingsPrimitives';

type SimpleRerankBackend = 'off' | 'local' | 'api';

const BACKEND_OPTIONS: ReadonlyArray<{ value: SimpleRerankBackend; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'local', label: '本地 ONNX 模型' },
  { value: 'api', label: '远程 API（Jina / Cohere / 阿里百炼）' }
];

function backendFromSettings(settings: RerankSettings | null): SimpleRerankBackend {
  if (!settings || settings.mode !== 'cross_encoder') return 'off';
  return settings.transport === 'api' ? 'api' : 'local';
}

/**
 * Simplified Reranker settings: enable/disable, local ONNX model installation & selection,
 * or remote Rerank API connection. Internal engineering tuning flags stay hidden and are
 * preserved untouched on save.
 */
export function RerankSettingsSection({ active }: { active: boolean }) {
  const [saved, setSaved] = useState<RerankSettingsState | null>(null);
  const [draft, setDraft] = useState<RerankSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installedModels, setInstalledModels] = useState<InstalledRerankModel[]>([]);
  const [recommendedModels, setRecommendedModels] = useState<RecommendedRerankModelState[]>([]);

  const loadModels = async () => {
    const [installed, recommended] = await Promise.all([
      listInstalledRerankModels().catch(() => [] as InstalledRerankModel[]),
      listRecommendedRerankModels().catch(() => [] as RecommendedRerankModelState[])
    ]);
    setInstalledModels(installed);
    setRecommendedModels(recommended);
  };

  useEffect(() => {
    if (!active || saved) return;
    let cancelled = false;
    void getRerankSettings()
      .then((value) => {
        if (cancelled) return;
        setSaved(value);
        setDraft(value);
      })
      .catch(() => {
        if (!cancelled) setError('未能读取 Reranker 设置。');
      });
    return () => {
      cancelled = true;
    };
  }, [active, saved]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void loadModels().catch(() => {
      if (!cancelled) {
        setInstalledModels([]);
        setRecommendedModels([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const persist = async (next: RerankSettings) => {
    setDraft(next);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveRerankSettings(next);
      setSaved(result);
      setDraft(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause) || '未能保存 Reranker 设置。');
    } finally {
      setBusy(false);
    }
  };

  // Auto-select the first installed local reranker when local mode has no directory yet.
  useEffect(() => {
    const settings = draft ?? saved;
    if (
      !settings ||
      settings.mode !== 'cross_encoder' ||
      settings.transport === 'api' ||
      settings.model_dir?.trim() ||
      installedModels.length === 0
    ) {
      return;
    }
    void persist({ ...settings, model_dir: installedModels[0].path });
  }, [draft, saved, installedModels]);

  const installRerank = async (id: string) => {
    setInstalling(id);
    setError(null);
    setNotice(null);
    try {
      await installRecommendedRerankModel(id);
      await loadModels();
      setNotice('重排模型已下载并验证，可在上方选择启用。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause) || '未能安装重排模型。');
    } finally {
      setInstalling(null);
    }
  };

  const current = draft ?? saved;
  const backend = backendFromSettings(current);
  const isLocal = backend === 'local';
  const isApi = backend === 'api';
  const modelMissing = isLocal && saved !== null && !saved.model_present;

  return (
    <SettingsGroup
      id="tools-rerank"
      title="Reranker"
      description="对初筛候选做交叉编码重排，提升精准度；模型不可用时自动保持原检索排序。"
    >
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-destructive">{error}</p>}
      <SettingSelect
        id="tools-rerank-backend"
        label="重排服务"
        description="选择本地 ONNX 交叉编码器、托管 Rerank API，或关闭重排。"
        disabled={!current || busy}
        value={backend}
        options={BACKEND_OPTIONS}
        onValueChange={(value) => {
          if (!current) return;
          const nextBackend = value as SimpleRerankBackend;
          if (nextBackend === 'off') {
            void persist({ ...current, mode: 'off' });
          } else if (nextBackend === 'local') {
            void persist({ ...current, mode: 'cross_encoder', transport: 'local' });
          } else {
            void persist({ ...current, mode: 'cross_encoder', transport: 'api' });
          }
        }}
      />

      {isApi && (
        <>
          <SettingSelect
            id="tools-rerank-api-style"
            label="接口风格"
            description="Jina / Cohere 兼容格式，或阿里百炼原生 DashScope 格式。"
            disabled={busy}
            value={current?.api_style ?? 'protocol'}
            options={[
              { value: 'protocol', label: 'protocol（Jina / Cohere）' },
              { value: 'dashscope', label: 'dashscope（阿里百炼）' }
            ]}
            onValueChange={(value) => {
              if (!current) return;
              void persist({ ...current, api_style: value as 'protocol' | 'dashscope' });
            }}
          />
          <SettingRow
            id="tools-rerank-api"
            label="远程重排配置"
            description="地址必须是 https；密钥仅保存在本机。"
          >
            <div className="flex flex-col gap-2">
              <Input
                aria-label="重排 API 地址"
                className="w-full min-w-0 font-mono text-xs"
                disabled={busy}
                placeholder="https://api.jina.ai/v1/rerank"
                value={current?.api_endpoint ?? ''}
                onChange={(event) =>
                  setDraft({ ...current!, api_endpoint: event.target.value || null })
                }
                onBlur={() => {
                  if (current) void persist(current);
                }}
              />
              <Input
                aria-label="重排 API 模型"
                className="w-full min-w-0 font-mono text-xs"
                disabled={busy}
                placeholder="jina-reranker-v2-base-multilingual"
                value={current?.api_model ?? ''}
                onChange={(event) =>
                  setDraft({ ...current!, api_model: event.target.value || null })
                }
                onBlur={() => {
                  if (current) void persist(current);
                }}
              />
              <Input
                aria-label="重排 API 密钥"
                className="w-full min-w-0 font-mono text-xs"
                disabled={busy}
                type="password"
                placeholder={saved?.has_api_key ? '已保存（留空保持不变）' : '粘贴 API 密钥'}
                value={current?.api_key ?? ''}
                onChange={(event) => setDraft({ ...current!, api_key: event.target.value })}
                onBlur={() => {
                  if (current) void persist(current);
                }}
              />
            </div>
          </SettingRow>
        </>
      )}

      {isLocal && (
        <>
          <SettingSelect
            id="tools-rerank-installed"
            label="已安装的重排模型"
            description={
              installedModels.length > 0
                ? '选择已下载的本地模型目录。'
                : '尚未检测到已安装模型，可在下方一键安装。'
            }
            disabled={busy || installedModels.length === 0}
            value={current?.model_dir ?? ''}
            options={installedModels.map((entry) => ({ value: entry.path, label: entry.label }))}
            placeholder={installedModels.length > 0 ? '选择已安装模型' : '尚未安装'}
            onValueChange={(value) => {
              if (!current) return;
              void persist({ ...current, model_dir: value });
            }}
          />
          <SettingRow
            id="tools-rerank-model"
            label="自定义模型目录"
            description="目录内需包含 ONNX 权重与 tokenizer 配置文件；留空使用内置路径。"
            className="settings-row-model"
          >
            <Input
              aria-label="重排模型目录"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              value={current?.model_dir ?? ''}
              onChange={(event) => setDraft({ ...current!, model_dir: event.target.value || null })}
              onBlur={() => {
                if (current) void persist(current);
              }}
            />
          </SettingRow>
        </>
      )}

      {saved && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="rerank-model-status">
          {backend === 'off'
            ? '当前未启用 Reranker。'
            : isApi
              ? saved.api_endpoint
                ? `当前使用远程 API：${saved.api_model ?? saved.api_endpoint}`
                : '请填写远程 Rerank API 地址、模型与密钥。'
              : modelMissing
                ? '未检测到本地重排模型：检索将自动回退排序。'
                : '已检测到本地重排模型。'}
        </p>
      )}
      {notice && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="rerank-notice">
          {notice}
        </p>
      )}

      {!isApi && recommendedModels.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-md border border-border">
          <div className="bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            可下载的本地重排模型
          </div>
          <ul className="divide-y divide-border">
            {recommendedModels.map((entry) => (
              <li
                key={entry.model.id}
                className="px-3 py-2.5 text-xs leading-5"
                data-testid={`recommended-rerank-${entry.model.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-medium text-foreground">{entry.model.display_name}</span>
                    <span className="text-muted-foreground">{entry.model.onnx_megabytes} MB</span>
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
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={installing !== null}
                        onClick={() => void installRerank(entry.model.id)}
                      >
                        {installing === entry.model.id ? '下载中…' : '一键安装'}
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-muted-foreground">{entry.model.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsGroup>
  );
}
