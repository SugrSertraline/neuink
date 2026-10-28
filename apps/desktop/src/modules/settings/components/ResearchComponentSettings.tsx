import { Button } from '@/components/ui/button';
import { useResearchTasks, type ResearchModel } from '@/modules/assistant/research/useResearchTasks';
import { SettingsServiceSection } from './SettingsPrimitives';

/** Native controller owns installation; the existing settings viewport owns scroll.
 * Leaving this page only stops observation, never installation. Standard button keys apply. */
export function ResearchComponentSettings({ active, workspaceRoot }: { active: boolean; workspaceRoot?: string | null }) {
  const model = useResearchTasks(active ? workspaceRoot ?? null : null);
  const status = !workspaceRoot ? '未就绪'
    : model.status?.active?.installation ? '安装中…'
    : model.busy ? '处理中…'
    : model.error || model.status?.error ? '需处理'
    : model.status?.ready ? '已安装'
    : model.status ? '未安装' : '检查中…';
  return <SettingsServiceSection id="tools-deep-research" title="深度研究 · Research" status={status}
    description="按需安装，用于自动查找论文、比较方法并生成带引用的报告。">
    <ResearchComponentControls model={model} hasWorkspace={Boolean(workspaceRoot)} />
  </SettingsServiceSection>;
}

export function ResearchComponentControls({ model, hasWorkspace }: { model: ResearchModel; hasWorkspace: boolean }) {
  const { status, busy } = model;
  const active = status?.active;
  const error = model.error ?? status?.error;
  if (!hasWorkspace) return <p className="text-sm text-muted-foreground">打开资料库后即可安装研究组件。</p>;
  return <div className="grid min-w-0 gap-3">
    {!status ? <div className="flex flex-wrap items-center gap-2">
      {error ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void model.refresh()}>重新读取状态</Button>
        : <p role="status" className="text-sm text-muted-foreground">正在检查研究组件…</p>}
    </div> : active?.installation ? <>
      <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{active.stage}</span>
        {active.progress != null && <span className="tabular-nums text-muted-foreground">{active.progress}%</span>}
        <Button size="sm" variant="outline" disabled={busy || !active.id} onClick={() => void model.command({ kind: 'cancel' })}>取消安装</Button>
      </div>
      {active.progress != null && <progress aria-label="研究组件安装进度" value={active.progress} max={100} className="h-2 w-full accent-primary" />}
      <p className="text-xs text-muted-foreground">可以离开此页面，安装会继续进行。</p>
    </> : <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 text-sm">
        <p role="status">{status.ready ? '已安装，可在聊天中开启深度研究' : '尚未安装'}</p>
        {!status.ready && <p className="mt-1 text-xs leading-5 text-muted-foreground">从安装包准备组件，约需 810 MB 空间。普通聊天、阅读和翻译不受影响。</p>}
      </div>
      <Button size="sm" variant={status.ready ? 'outline' : 'default'} disabled={busy || Boolean(active) || status.pending_save}
        onClick={() => void model.command({ kind: 'install' })}>{busy ? '正在准备…' : status.ready ? '检查组件' : error ? '重试安装' : '安装并启用'}</Button>
      {active && <p className="w-full text-xs text-muted-foreground">研究任务完成后可管理组件。</p>}
      {status.pending_save && <p className="w-full text-xs text-muted-foreground">请先在聊天中保存未完成的研究报告。</p>}
    </div>}
    {error && <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>}
  </div>;
}
