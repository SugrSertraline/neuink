import { useEffect, useState } from 'react';
import {
  getRerankSettings,
  listInstalledRerankModels,
  saveRerankSettings,
  type InstalledRerankModel,
  type RerankMode,
  type RerankSettings,
  type RerankSettingsState
} from '@/shared/ipc/workspaceApi';
import { Input } from '@/components/ui/input';
import { SettingsGroup, SettingRow, SettingSelect, SettingSwitch } from './SettingsPrimitives';

const MODE_OPTIONS: ReadonlyArray<{ value: RerankMode; label: string }> = [
  { value: 'off', label: '不重排（默认）' },
  { value: 'heuristic', label: '字段覆盖（无模型）' },
  { value: 'cross_encoder', label: '本地交叉编码器' }
];

/**
 * Rerank ladder settings. The ladder is `cross-encoder -> field coverage -> fused order`,
 * so the screen has to answer three questions honestly: which rung is selected, whether a
 * model is actually installed, and what happens when it is not.
 */
export function RerankSettingsSection({ active }: { active: boolean }) {
  const [saved, setSaved] = useState<RerankSettingsState | null>(null);
  const [draft, setDraft] = useState<RerankSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [installedModels, setInstalledModels] = useState<InstalledRerankModel[]>([]);

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
        if (!cancelled) setError('未能读取重排设置。');
      });
    return () => {
      cancelled = true;
    };
  }, [active, saved]);

  // Rescan installed reranker directories on every activation, so a model installed from
  // the other settings group appears here without a hand-typed path.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void listInstalledRerankModels()
      .then((models) => {
        if (cancelled) return;
        setInstalledModels(models);
      })
      .catch(() => {
        if (!cancelled) setInstalledModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);
  const persist = async (next: RerankSettings) => {
    setDraft(next);
    setBusy(true);
    setError(null);
    try {
      const result = await saveRerankSettings(next);
      setSaved(result);
      setDraft(result);
    } catch (cause) {
      // The backend validates before writing, so its message is the actionable one.
      setError(cause instanceof Error ? cause.message : '未能保存重排设置。');
    } finally {
      setBusy(false);
    }
  };

  // A downloaded reranker should never require typing its path: once both the settings and
  // the scanned directories are known, fill an empty directory with the first installed one.
  useEffect(() => {
    const settings = draft ?? saved;
    if (!settings || settings.model_dir?.trim() || installedModels.length === 0) return;
    void persist({ ...settings, model_dir: installedModels[0].path });
  }, [draft, saved, installedModels]);
  const current = draft ?? saved;
  const needsModel = current?.mode === 'cross_encoder';
  const usesApi = current?.transport === 'api';
  const modelMissing = needsModel && saved !== null && !saved.model_present;

  return (
    <SettingsGroup
      id="tools-rerank"
      title="重排"
      description="检索结果出来后的第三段：先用本地交叉编码器，模型缺失或出错时退回无模型的字段覆盖，再退化到融合顺序。"
    >
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-destructive">{error}</p>}
      <SettingSelect
        id="tools-rerank-mode"
        label="重排方式"
        description="交叉编码器只判头部候选；字段覆盖不需要模型，数字与指标词权重更高。"
        disabled={!current || busy}
        value={current?.mode ?? 'off'}
        options={MODE_OPTIONS}
        onValueChange={(value) => {
          if (!current) return;
          void persist({ ...current, mode: value as RerankMode });
        }}
      />
      <SettingSelect
        id="tools-rerank-transport"
        label="模型后端"
        description="本地：应用内 ONNX 交叉编码器；API：托管 rerank 接口（Jina、Cohere 或同形接口）。"
        disabled={busy}
        value={current?.transport ?? "local"}
        options={[
          { value: "local", label: "本地 ONNX 模型" },
          { value: "api", label: "远程 API（Jina / Cohere）" }
        ]}
        onValueChange={(value) => {
          if (!current) return;
          void persist({ ...current, transport: value as "local" | "api" });
        }}
      />
      {needsModel && usesApi && (
        <SettingRow
          id="tools-rerank-api"
          label="远程重排配置"
          description="地址必须是 https；密钥只保存在本机，状态查询只回报是否已保存。"
        >
          <div className="flex flex-col gap-2">
            <Input
              aria-label="重排 API 地址"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              placeholder="https://api.jina.ai/v1/rerank"
              value={current?.api_endpoint ?? ""}
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
              value={current?.api_model ?? ""}
              onChange={(event) => setDraft({ ...current!, api_model: event.target.value || null })}
              onBlur={() => {
                if (current) void persist(current);
              }}
            />
            <Input
              aria-label="重排 API 密钥"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              type="password"
              placeholder={saved?.has_api_key ? "已保存（留空保持不变）" : "粘贴 API 密钥"}
              value={current?.api_key ?? ""}
              onChange={(event) => setDraft({ ...current!, api_key: event.target.value })}
              onBlur={() => {
                if (current) void persist(current);
              }}
            />
          </div>
        </SettingRow>
      )}
      {needsModel && !usesApi && (
        <SettingSelect
          id="tools-rerank-installed"
          label="已安装的重排模型"
          description={
            installedModels.length > 0
              ? "安装完成的模型目录，选择即写入下方目录。"
              : "还没有检测到已安装的重排模型；可在「模型与接入」一键安装。"
          }
          disabled={busy || installedModels.length === 0}
          value={current?.model_dir ?? ""}
          options={installedModels.map((entry) => ({ value: entry.path, label: entry.label }))}
          placeholder={installedModels.length > 0 ? "选择已安装模型" : "尚未安装"}
          onValueChange={(value) => {
            if (!current) return;
            void persist({ ...current, model_dir: value });
          }}
        />
      )}
      {needsModel && (
        <SettingRow
          id="tools-rerank-model"
          label="模型目录"
          description="目录内需有 onnx/model_int8.onnx（或 onnx/model.onnx、model.onnx）以及 tokenizer.json、config.json、special_tokens_map.json、tokenizer_config.json。留空使用内置资源路径。"
          className="settings-row-model"
        >
          <Input
            aria-label="重排模型目录"
            className="w-full min-w-0"
            disabled={busy}
            value={current?.model_dir ?? ''}
            onChange={(event) => setDraft({ ...current!, model_dir: event.target.value || null })}
            onBlur={() => {
              if (current) void persist(current);
            }}
          />
        </SettingRow>
      )}
      <SettingRow
        id="tools-rerank-candidates"
        label="重排候选上限"
        description="交叉编码器只给前 N 条打分，其余保持原顺序。每对一次前向，20 条在 CPU 上约 1 秒。"
      >
        <Input
          aria-label="重排候选上限"
          type="number"
          min={1}
          max={200}
          className="w-24"
          disabled={!current || busy}
          value={current?.max_candidates ?? 20}
          onChange={(event) => {
            if (!current) return;
            const parsed = Number(event.target.value);
            if (!Number.isFinite(parsed)) return;
            setDraft({ ...current, max_candidates: Math.min(200, Math.max(1, Math.round(parsed))) });
          }}
          onBlur={() => {
            if (current) void persist(current);
          }}
        />
      </SettingRow>
      <SettingSwitch
        id="tools-rerank-fallback"
        label="模型不可用时退回字段覆盖"
        description="关闭后，模型缺失或调用失败会直接保持融合顺序，不再做无模型重排。"
        disabled={!current || busy}
        checked={current?.fallback_heuristic ?? true}
        onCheckedChange={(value) => {
          if (!current) return;
          void persist({ ...current, fallback_heuristic: value });
        }}
      />
      {saved && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="rerank-model-status">
          {modelMissing
            ? '未检测到本地重排模型：当前会退回字段覆盖排序。'
            : saved.model_present
              ? '已检测到本地重排模型。'
              : '当前不需要本地模型。'}
        </p>
      )}
    </SettingsGroup>
  );
}


