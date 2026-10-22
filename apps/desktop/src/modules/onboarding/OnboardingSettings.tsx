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
  return <section data-setting-id="data-onboarding" tabIndex={-1} className="settings-group grid gap-2">
    <h3 className="text-sm font-semibold">新手引导</h3>
    <p className="text-xs leading-5 text-muted-foreground">使用示例论文练习阅读、翻译、分屏、笔记、批注与助手。已完成 {progress.completed.length}/{GUIDE_STEPS.length} 步，跳过 {progress.skipped.length} 步。</p>
    <p className="text-xs leading-5 text-muted-foreground">打开引导时会补齐缺少的演示资料；回放不会覆盖你的修改。若当前版本未附带演示资料，引导无法演示，但不影响正常阅读。</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openOnboarding()}>继续新手引导</Button>
      <Button size="sm" variant="ghost" onClick={() => openOnboarding(true)}>从头回放</Button></div>
  </section>;
}
