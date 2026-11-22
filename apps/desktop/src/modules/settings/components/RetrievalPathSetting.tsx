import { useEffect, useState } from 'react';
import { SettingsGroup, SettingSelect, SettingSwitch } from './SettingsPrimitives';
import {
  DEFAULT_MULTIVECTOR,
  readRetrievalSettings,
  readUnifiedRetrieval,
  writeRetrievalSettings,
  writeUnifiedRetrieval
} from '@/shared/lib/retrievalMode';
import { getTextModelSettings, type MultivectorPoolSettings } from '@/shared/ipc/workspaceApi';

/**
 * The single switch that decides whether the assistant uses the composed retrieval path.
 *
 * It sits on its own instead of being folded into the visual or rerank card, because it
 * governs both: enabling it changes document routing and applies both optional stages.
 */
export function RetrievalPathSetting({ active }: { active: boolean }) {
  const [unified, setUnified] = useState<boolean | null>(null);
  const [pool, setPool] = useState<MultivectorPoolSettings>(DEFAULT_MULTIVECTOR);
  const [heads, setHeads] = useState('投影权重尚未检查');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void readUnifiedRetrieval().then((value) => {
      if (!cancelled) setUnified(value);
    });
    void readRetrievalSettings()
      .then((settings) => {
        if (!cancelled) setPool(settings.multivector ?? DEFAULT_MULTIVECTOR);
      })
      .catch(() => undefined);
    void getTextModelSettings()
      .then((status) => {
        if (cancelled) return;
        if (status.colbert_head_present && status.sparse_head_present) setHeads('就绪');
        else if (!status.colbert_head_present) setHeads('缺少 colbert_linear.bin，查询时自动回退单向量');
        else setHeads('缺少 sparse_linear.bin，混合模式会回退单向量');
      })
      .catch(() => {
        if (!cancelled) setHeads('缺少 colbert_linear.bin，查询时自动回退单向量');
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const toggle = (value: boolean) => {
    setUnified(value);
    setError(null);
    void writeUnifiedRetrieval(value)
      .then((saved) => setUnified(saved))
      .catch(() => {
        // A rejected save must not look saved: put the switch back where it was.
        setUnified(!value);
        setError('未能保存检索路径设置。');
      });
  };

  return (
    <SettingsGroup
      id="tools-retrieval-path"
      title="检索路径"
      description="默认使用批次检索。开启后改为一次组合检索：先路由论文，再看视觉投票与重排阶梯，最后取证据。"
    >
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-destructive">{error}</p>}
      <SettingSwitch
        id="tools-retrieval-unified"
        label="使用组合检索"
        description="会改变论文路由与证据顺序；视觉与重排设置只在这条路径生效。模型或索引缺失时自动退回文本通道。"
        disabled={unified === null}
        checked={unified === true}
        onCheckedChange={toggle}
      />
      <SettingSwitch
        id="tools-retrieval-multivector"
        label="启用多向量召回池（BGE-M3，实验）"
        description="默认关闭。缺投影权重或不是本地 BGE-M3 时，查询自动退回单向量，搜索不会中断。"
        disabled={unified === null}
        checked={pool.enabled}
        onCheckedChange={(value) => {
          const next = { ...pool, enabled: value };
          setPool(next);
          setError(null);
          void writeRetrievalSettings({ unified: unified === true, multivector: next })
            .then((saved) => setPool(saved.multivector ?? next))
            .catch(() => {
              setPool(pool);
              setError('未能保存检索路径设置。');
            });
        }}
      />
      {pool.enabled && (
        <SettingSelect
          id="tools-retrieval-multivector-mode"
          label="多向量模式"
          description={heads}
          value={pool.mode}
          options={[
            { value: 'bge_m3_hybrid', label: 'BGE-M3 三路混合（推荐）' },
            { value: 'colbert', label: '纯 ColBERT 多向量' }
          ]}
          onValueChange={(value) => {
            const next = { ...pool, mode: value as MultivectorPoolSettings['mode'] };
            setPool(next);
            void writeRetrievalSettings({ unified: unified === true, multivector: next })
              .then((saved) => setPool(saved.multivector ?? next))
              .catch(() => {
                setPool(pool);
                setError('未能保存检索路径设置。');
              });
          }}
        />
      )}
    </SettingsGroup>
  );
}
