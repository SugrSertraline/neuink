import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GUIDE_PROGRESS_EVENT, openOnboarding, readProgress } from './progress';
import { GUIDE_STEPS } from './catalog';
export function OnboardingSettings({ storageKey }: { storageKey?:string }) {
  const [progress, setProgress] = useState(() => readProgress(storageKey));
  useEffect(() => {
    const refresh = () => setProgress(readProgress(storageKey));
    window.addEventListener(GUIDE_PROGRESS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(GUIDE_PROGRESS_EVENT, refresh); window.removeEventListener('storage', refresh); };
  }, [storageKey]);
  return <section data-setting-id="data-onboarding" tabIndex={-1} className="grid gap-2 border-t pt-4">
    <h3 className="text-sm font-semibold">新手引导</h3>
    <p className="text-xs leading-5 text-muted-foreground">使用 Attention Is All You Need（演示版）学习阅读、翻译、分屏、笔记、批注与助手。每次打开会校验本地演示素材，完整时自动添加缺少的演示条目、解析结果和示例笔记；回放不覆盖修改。未附带演示素材的版本无法演示，不影响正常阅读。{progress.completed.length}/{GUIDE_STEPS.length} 步完成，{progress.skipped.length} 步跳过。</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openOnboarding()}>继续新手引导</Button>
      <Button size="sm" variant="ghost" onClick={() => openOnboarding(true)}>从头回放</Button></div>
  </section>;
}
