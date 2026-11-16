import { useEffect, useState } from 'react';
import { SettingsGroup, SettingSwitch } from './SettingsPrimitives';
import { readUnifiedRetrieval, writeUnifiedRetrieval } from '@/shared/lib/retrievalMode';

/**
 * The single switch that decides whether the assistant uses the composed retrieval path.
 *
 * It sits on its own instead of being folded into the visual or rerank card, because it
 * governs both: enabling it changes document routing and applies both optional stages.
 */
export function RetrievalPathSetting({ active }: { active: boolean }) {
  const [unified, setUnified] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void readUnifiedRetrieval().then((value) => {
      if (!cancelled) setUnified(value);
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
    </SettingsGroup>
  );
}
