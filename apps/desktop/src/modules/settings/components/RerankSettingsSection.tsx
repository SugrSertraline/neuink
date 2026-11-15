import { useEffect, useState } from 'react';
import {
  getRerankSettings,
  saveRerankSettings,
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

  const current = draft ?? saved;
  const needsModel = current?.mode === 'cross_encoder';
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
