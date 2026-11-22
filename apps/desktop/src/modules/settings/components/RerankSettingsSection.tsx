import { useEffect, useState } from 'react';
import {
  getRerankSettings,
  listInstalledRerankModels,
  saveRerankSettings,
  type InstalledRerankModel,
  type RerankMode,
  type RerankSettings,
  type RerankSettingsState,
  type ListwiseRefineSettings,
  type ScopeRefineSettings
} from '@/shared/ipc/workspaceApi';
import { Input } from '@/components/ui/input';
import { SettingsGroup, SettingRow, SettingSelect, SettingSwitch } from './SettingsPrimitives';

const EMPTY_SCOPE: ScopeRefineSettings = {
  enabled: false,
  use_assistant_llm: true,
  api_endpoint: null,
  api_model: null,
  api_key: null,
  timeout_ms: 30_000,
  max_concurrency: 8
};

const EMPTY_LISTWISE: ListwiseRefineSettings = {
  enabled: false,
  use_assistant_llm: true,
  api_endpoint: null,
  api_model: null,
  api_key: null,
  top_n: 25,
  fuse_rrf: true,
  single_paper_mode: true,
  timeout_ms: 60_000
};

function listwiseSettings(current: RerankSettings, patch: Partial<ListwiseRefineSettings>): ListwiseRefineSettings {
  const next: ListwiseRefineSettings = { ...EMPTY_LISTWISE, ...current.listwise, ...patch };
  if (!next.api_key?.trim()) next.api_key = null;
  return next;
}

function scopeSettings(current: RerankSettings, patch: Partial<ScopeRefineSettings>): ScopeRefineSettings {
  const next: ScopeRefineSettings = { ...EMPTY_SCOPE, ...current.scope_refine, ...patch };
  if (!next.api_key?.trim()) next.api_key = null;
  return next;
}

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
      description="检索结果出来后的第三段：交叉编码器，可选尾部范围精排；模型缺失或出错时退回字段覆盖，再退化到融合顺序。"
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
        <SettingSelect
          id="tools-rerank-api-style"
          label="接口风格"
          description="protocol：Jina / Cohere 形状（results[]）；dashscope：百炼原生形状（output.results[]，query 与 documents 嵌套在 input 内）。"
          disabled={busy}
          value={current?.api_style ?? "protocol"}
          options={[
            { value: "protocol", label: "protocol（Jina / Cohere）" },
            { value: "dashscope", label: "dashscope（阿里百炼）" }
          ]}
          onValueChange={(value) => {
            if (!current) return;
            void persist({ ...current, api_style: value as "protocol" | "dashscope" });
          }}
        />
      )}
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
            <Input
              aria-label="重排任务指令"
              className="w-full min-w-0 text-xs"
              disabled={busy}
              placeholder="Given a question about a research paper, retrieve passages that directly provide the concrete answer, specific numbers, experimental findings, dataset specifications, or exact method details."
              value={current?.api_instruction ?? ''}
              onChange={(event) => setDraft({ ...current!, api_instruction: event.target.value || null })}
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
        description={
          current?.scope_refine?.enabled
            ? '交叉编码器给前 N 条打分。尾部范围精排开启时至少打分前 20 条，其余保持原顺序。'
            : '交叉编码器只给前 N 条打分，其余保持原顺序。每对一次前向，20 条在 CPU 上约 1 秒。'
        }
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
      {needsModel && (
        <SettingSwitch
          id="tools-rerank-structured-input"
          label="重排输入附带章节与类型标签"
          description="仅附带 [Section] [Type] 结构标签，不拼接相邻段落。默认开启。"
          disabled={!current || busy}
          checked={current?.structured_input ?? true}
          onCheckedChange={(value) => {
            if (!current) return;
            void persist({ ...current, structured_input: value });
          }}
        />
      )}
      {needsModel && (
        <SettingSwitch
          id="tools-rerank-fuse-pool"
          label="与第一阶段检索池 RRF 融合"
          description="交叉编码器成功后，与进入重排前的顺序做 k=60 融合。默认关闭。"
          disabled={!current || busy}
          checked={current?.fuse_with_pool ?? false}
          onCheckedChange={(value) => {
            if (!current) return;
            void persist({ ...current, fuse_with_pool: value });
          }}
        />
      )}
      {needsModel && (
        <SettingSwitch
          id="tools-rerank-scope"
          label="启用尾部范围精排（v6）"
          description="只调整第 9、10 名。未配置、引用不合格或调用失败时保留交叉编码器排序。"
          disabled={!current || busy}
          checked={current?.scope_refine?.enabled ?? false}
          onCheckedChange={(value) => {
            if (!current) return;
            void persist({
              ...current,
              scope_refine: scopeSettings(current, { enabled: value }),
              listwise: value ? listwiseSettings(current, { enabled: false }) : listwiseSettings(current, {})
            });
          }}
        />
      )}
      {needsModel && current?.scope_refine?.enabled && (
        <SettingSwitch
          id="tools-rerank-scope-assistant"
          label="复用助手 OpenAI 兼容模型"
          description={
            current.scope_refine.use_assistant_llm
              ? '地址、模型或密钥留空时使用当前助手配置。Anthropic 与 Google 协议不会被改写。'
              : '已关闭。只使用下方填写的地址、模型和密钥，不再读取助手配置。'
          }
          disabled={busy}
          checked={current.scope_refine.use_assistant_llm}
          onCheckedChange={(value) => {
            void persist({ ...current, scope_refine: scopeSettings(current, { use_assistant_llm: value }) });
          }}
        />
      )}
      {needsModel && current?.scope_refine?.enabled && (
        <SettingRow
          id="tools-rerank-scope-endpoint"
          label="尾部范围精排"
          description={
            current.scope_refine.use_assistant_llm
              ? '留空则沿用助手的 OpenAI 兼容配置。密钥只保存在本机，留空表示保持已保存的密钥。'
              : '使用下方填写的地址、模型和密钥。密钥只保存在本机，留空表示保持已保存的密钥。'
          }
        >
          <div className="flex flex-col gap-2">
            <Input
              aria-label="尾部范围精排 API 地址"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              placeholder="https://api.siliconflow.cn/v1"
              value={current.scope_refine.api_endpoint ?? ''}
              onChange={(event) =>
                setDraft({
                  ...current,
                  scope_refine: { ...scopeSettings(current, {}), api_endpoint: event.target.value || null }
                })
              }
              onBlur={() => void persist({ ...current, scope_refine: scopeSettings(current, {}) })}
            />
            <Input
              aria-label="尾部范围精排模型"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              placeholder="deepseek-ai/DeepSeek-V4.1-Flash"
              value={current.scope_refine.api_model ?? ''}
              onChange={(event) =>
                setDraft({
                  ...current,
                  scope_refine: { ...scopeSettings(current, {}), api_model: event.target.value || null }
                })
              }
              onBlur={() => void persist({ ...current, scope_refine: scopeSettings(current, {}) })}
            />
            <Input
              aria-label="尾部范围精排 API 密钥"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              type="password"
              placeholder={saved?.scope_refine?.has_api_key ? '已保存（留空保持不变）' : '粘贴 API 密钥'}
              value={current.scope_refine.api_key ?? ''}
              onChange={(event) =>
                setDraft({
                  ...current,
                  scope_refine: { ...scopeSettings(current, {}), api_key: event.target.value }
                })
              }
              onBlur={() => void persist({ ...current, scope_refine: scopeSettings(current, {}) })}
            />
          </div>
        </SettingRow>
      )}
      <SettingSwitch
        id="tools-rerank-listwise"
        label="启用无锁 Top-25 Listwise 精排（单次调用）"
        description={
          current?.scope_refine?.enabled
            ? '与尾部范围精排互斥。打开后会关闭 v6，只对前 25 条做一次排序。'
            : '每次查询只调用一次模型。失败或有效标签不足 10 条时保留上游排序。'
        }
        disabled={!current || busy}
        checked={current?.listwise?.enabled ?? false}
        onCheckedChange={(value) => {
          if (!current) return;
          void persist({
            ...current,
            listwise: listwiseSettings(current, { enabled: value }),
            scope_refine: value ? scopeSettings(current, { enabled: false }) : scopeSettings(current, {})
          });
        }}
      />
      {current?.listwise?.enabled && (
        <SettingSwitch
          id="tools-rerank-listwise-rrf"
          label="Listwise 与上游 RRF 融合"
          description="多篇检索时同分按进入 Listwise 之前的顺序破平。"
          disabled={busy}
          checked={current.listwise.fuse_rrf}
          onCheckedChange={(value) => {
            void persist({ ...current, listwise: listwiseSettings(current, { fuse_rrf: value }) });
          }}
        />
      )}
      {current?.listwise?.enabled && (
        <SettingSwitch
          id="tools-rerank-listwise-single-paper"
          label="单篇检索启用证据直出模式"
          description="单篇范围内使用章节+类型实质证据提示词并直出 L1 顺序，避免 RRF 拉回摘要假阳性。"
          disabled={busy}
          checked={current.listwise.single_paper_mode ?? true}
          onCheckedChange={(value) => {
            void persist({ ...current, listwise: listwiseSettings(current, { single_paper_mode: value }) });
          }}
        />
      )}
      {current?.listwise?.enabled && (
        <SettingRow
          id="tools-rerank-listwise-endpoint"
          label="Listwise 模型"
          description="留空则复用助手的 OpenAI 兼容配置。密钥只保存在本机，留空表示保持已保存的密钥。"
        >
          <div className="flex flex-col gap-2">
            <Input
              aria-label="Listwise API 地址"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              placeholder="https://api.siliconflow.cn/v1"
              value={current.listwise.api_endpoint ?? ''}
              onChange={(event) =>
                setDraft({
                  ...current,
                  listwise: { ...listwiseSettings(current, {}), api_endpoint: event.target.value || null }
                })
              }
              onBlur={() => void persist({ ...current, listwise: listwiseSettings(current, {}) })}
            />
            <Input
              aria-label="Listwise 模型"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              placeholder="deepseek-ai/DeepSeek-V4.1-Flash"
              value={current.listwise.api_model ?? ''}
              onChange={(event) =>
                setDraft({
                  ...current,
                  listwise: { ...listwiseSettings(current, {}), api_model: event.target.value || null }
                })
              }
              onBlur={() => void persist({ ...current, listwise: listwiseSettings(current, {}) })}
            />
            <Input
              aria-label="Listwise API 密钥"
              className="w-full min-w-0 font-mono text-xs"
              disabled={busy}
              type="password"
              placeholder={saved?.listwise?.has_api_key ? '已保存（留空保持不变）' : '粘贴 API 密钥'}
              value={current.listwise.api_key ?? ''}
              onChange={(event) =>
                setDraft({
                  ...current,
                  listwise: { ...listwiseSettings(current, {}), api_key: event.target.value }
                })
              }
              onBlur={() => void persist({ ...current, listwise: listwiseSettings(current, {}) })}
            />
          </div>
        </SettingRow>
      )}
      <SettingSwitch
        id="tools-rerank-structural-soft"
        label="离线结构软降权"
        description="零 API / 零延迟：非摘要意图下温和压低 Abstract 与短标题片段。默认开启。"
        disabled={!current || busy}
        checked={current?.structural_soft_demotion ?? true}
        onCheckedChange={(value) => {
          if (!current) return;
          void persist({ ...current, structural_soft_demotion: value });
        }}
      />
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


