import { useEffect, useState } from 'react';
import {
  getVisualEmbeddingSettings,
  prepareVisualSearchIndex,
  saveVisualEmbeddingSettings,
  type VisualEmbeddingProviderKind,
  type VisualEmbeddingSettingsState,
  type VisualFusionMode
} from '@/shared/ipc/workspaceApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsGroup, SettingRow, SettingSelect } from './SettingsPrimitives';

type Draft = {
  provider: VisualEmbeddingProviderKind;
  endpoint: string;
  timeout_ms: number;
  startup: 'on_demand' | 'manual';
  fusion: {
    mode: VisualFusionMode;
    text_weight: number;
    visual_weight: number;
    rrf_k: number;
    gate: { min_head_entries: number; max_snippet_overlap: number };
  };
};

const PROVIDER_OPTIONS: ReadonlyArray<{ value: VisualEmbeddingProviderKind; label: string }> = [
  { value: 'qwen_local', label: '本地服务（Qwen2B）' },
  { value: 'qwen_api', label: '远程 API（https）' }
];

const FUSION_OPTIONS: ReadonlyArray<{ value: VisualFusionMode; label: string }> = [
  { value: 'append_gated', label: '门控追加（默认）' },
  { value: 'weighted', label: '加权融合' }
];

function draftFrom(state: VisualEmbeddingSettingsState): Draft {
  return {
    provider: state.provider === 'qwen_api' ? 'qwen_api' : 'qwen_local',
    endpoint: state.endpoint ?? '',
    timeout_ms: state.timeout_ms,
    startup: state.startup ?? 'on_demand',
    fusion: {
      mode: state.fusion.mode,
      text_weight: state.fusion.text_weight,
      visual_weight: state.fusion.visual_weight,
      rrf_k: state.fusion.rrf_k,
      gate: {
        min_head_entries: state.fusion.gate.min_head_entries,
        max_snippet_overlap: state.fusion.gate.max_snippet_overlap
      }
    }
  };
}

/**
 * Visual channel configuration and index preparation.
 *
 * Two separate things live here on purpose: the encoder settings describe *where* vectors
 * come from, while preparing the index is the one action that spends image-encoder work.
 * Keeping them apart means the screen can explain "configured but not prepared" instead of
 * showing a single ambiguous state.
 */
export function VisualSettingsSection({ active, root }: { active: boolean; root: string }) {
  const [saved, setSaved] = useState<VisualEmbeddingSettingsState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<string | null>(null);

  useEffect(() => {
    if (!active || saved) return;
    let cancelled = false;
    void getVisualEmbeddingSettings()
      .then((value) => {
        if (cancelled) return;
        setSaved(value);
        setDraft(draftFrom(value));
      })
      .catch(() => {
        if (!cancelled) setError('未能读取视觉编码设置。');
      });
    return () => {
      cancelled = true;
    };
  }, [active, saved]);

  const persist = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveVisualEmbeddingSettings({
        provider: draft.provider,
        endpoint: draft.endpoint.trim() ? draft.endpoint.trim() : null,
        timeout_ms: draft.timeout_ms,
        startup: draft.startup,
        fusion: draft.fusion,
        // Write-only: omitting keeps the stored key, so only send when typed.
        ...(apiKey ? { api_key: apiKey } : {})
      });
      setSaved(result);
      setDraft(draftFrom(result));
      setApiKey('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能保存视觉编码设置。');
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

  const needsEndpoint = draft?.provider === 'qwen_api';
  const needsKey = draft?.provider === 'qwen_api';

  return (
    <SettingsGroup
      id="tools-visual"
      title="视觉检索"
      description="第二条召回通道：原生 PDF 的页与区域、MinerU 的图表资产编码到同一空间，只作为文档路由的投票，不产出正文摘录。"
    >
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-destructive">{error}</p>}
      <SettingSelect
        id="tools-visual-provider"
        label="编码方式"
        description="本地服务需自行启动；远程 API 必须使用 https 并填写密钥。模型不可用时，检索保持文本通道。"
        disabled={!draft || busy}
        value={draft?.provider ?? 'qwen_local'}
        options={PROVIDER_OPTIONS}
        onValueChange={(value) => {
          if (draft) setDraft({ ...draft, provider: value as VisualEmbeddingProviderKind });
        }}
      />
      <SettingRow
        id="tools-visual-endpoint"
        label="服务地址"
        description={needsEndpoint ? '远程端点，例如 https://example.com/v1' : '本地服务默认 http://127.0.0.1:8765'}
      >
        <Input
          aria-label="视觉服务地址"
          className="w-full min-w-0"
          disabled={!draft || busy}
          value={draft?.endpoint ?? ''}
          onChange={(event) => draft && setDraft({ ...draft, endpoint: event.target.value })}
        />
      </SettingRow>
      {needsKey && (
        <SettingRow
          id="tools-visual-key"
          label="访问密钥"
          description="只写字段：不填则保留已保存的密钥；保存后不再回传明文。"
        >
          <Input
            aria-label="视觉服务密钥"
            type="password"
            className="w-full min-w-0"
            disabled={!draft || busy}
            placeholder={saved?.has_api_key ? '已保存（留空不修改）' : '尚未设置'}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </SettingRow>
      )}
      <SettingRow id="tools-visual-timeout" label="超时（毫秒）" description="单次编码请求的超时，上限 600000。">
        <Input
          aria-label="视觉编码超时"
          type="number"
          min={1}
          max={600000}
          className="w-28"
          disabled={!draft || busy}
          value={draft?.timeout_ms ?? 60000}
          onChange={(event) => {
            if (!draft) return;
            const parsed = Number(event.target.value);
            if (!Number.isFinite(parsed)) return;
            setDraft({ ...draft, timeout_ms: Math.min(600000, Math.max(1, Math.round(parsed))) });
          }}
        />
      </SettingRow>
      <SettingSelect
        id="tools-visual-startup"
        label="服务启动方式"
        description="按需启动：需要视觉通道时自动拉起本机服务；手动：必须自己先启动，未运行则通道不可用。"
        disabled={!draft || busy}
        value={draft?.startup ?? "on_demand"}
        options={[
          { value: "on_demand", label: "按需自动启动（默认）" },
          { value: "manual", label: "手动启动" }
        ]}
        onValueChange={(value) => {
          if (draft) setDraft({ ...draft, startup: value as "on_demand" | "manual" });
        }}
      />
      <SettingSelect
        id="tools-visual-fusion"
        label="融合方式"
        description="门控追加保持文本顺序，仅在文本头部信号薄时把视觉候选追加在后；加权融合会重排头部。"
        disabled={!draft || busy}
        value={draft?.fusion.mode ?? 'append_gated'}
        options={FUSION_OPTIONS}
        onValueChange={(value) => {
          if (draft) setDraft({ ...draft, fusion: { ...draft.fusion, mode: value as VisualFusionMode } });
        }}
      />
      <SettingRow id="tools-visual-weights" label="文本 / 视觉权重" description="仅加权融合使用；门控追加不使用权重。">
        <div className="flex items-center gap-2">
          <Input
            aria-label="文本通道权重"
            type="number"
            step="0.1"
            min={0}
            max={10}
            className="w-20"
            disabled={!draft || busy}
            value={draft?.fusion.text_weight ?? 1}
            onChange={(event) => {
              if (!draft) return;
              const parsed = Number(event.target.value);
              if (!Number.isFinite(parsed)) return;
              setDraft({ ...draft, fusion: { ...draft.fusion, text_weight: parsed } });
            }}
          />
          <Input
            aria-label="视觉通道权重"
            type="number"
            step="0.1"
            min={0}
            max={10}
            className="w-20"
            disabled={!draft || busy}
            value={draft?.fusion.visual_weight ?? 0.5}
            onChange={(event) => {
              if (!draft) return;
              const parsed = Number(event.target.value);
              if (!Number.isFinite(parsed)) return;
              setDraft({ ...draft, fusion: { ...draft.fusion, visual_weight: parsed } });
            }}
          />
        </div>
      </SettingRow>
      <SettingRow
        id="tools-visual-gate"
        label="门控阈值"
        description="文本头部少于 N 个条目，或问题与最佳命中的词重叠不超过 M 时，才追加视觉候选。"
      >
        <div className="flex items-center gap-2">
          <Input
            aria-label="门控头部条目下限"
            type="number"
            min={1}
            max={50}
            className="w-20"
            disabled={!draft || busy}
            value={draft?.fusion.gate.min_head_entries ?? 3}
            onChange={(event) => {
              if (!draft) return;
              const parsed = Number(event.target.value);
              if (!Number.isFinite(parsed)) return;
              setDraft({
                ...draft,
                fusion: {
                  ...draft.fusion,
                  gate: { ...draft.fusion.gate, min_head_entries: Math.max(1, Math.round(parsed)) }
                }
              });
            }}
          />
          <Input
            aria-label="门控词重叠上限"
            type="number"
            min={0}
            max={20}
            className="w-20"
            disabled={!draft || busy}
            value={draft?.fusion.gate.max_snippet_overlap ?? 2}
            onChange={(event) => {
              if (!draft) return;
              const parsed = Number(event.target.value);
              if (!Number.isFinite(parsed)) return;
              setDraft({
                ...draft,
                fusion: {
                  ...draft.fusion,
                  gate: { ...draft.fusion.gate, max_snippet_overlap: Math.max(0, Math.round(parsed)) }
                }
              });
            }}
          />
        </div>
      </SettingRow>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!draft || busy} onClick={() => void persist()}>
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
      {prepared && (
        <p className="mt-1 text-xs leading-5 text-muted-foreground" data-testid="visual-prepare-result">
          {prepared}
        </p>
      )}
    </SettingsGroup>
  );
}


