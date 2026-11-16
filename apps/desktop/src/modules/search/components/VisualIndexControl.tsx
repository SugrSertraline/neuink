import { AlertTriangle, Hammer, Images, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { useToast } from '@/shared/hooks/useToast';
import {
  getVisualIndexStatus,
  prepareVisualSearchIndex,
  type VisualIndexStatus
} from '@/shared/ipc/workspaceApi';

type VisualIndexControlProps = {
  className?: string;
  enabled: boolean;
  root: string | null;
  status: 'loading' | 'ready' | 'error';
};

/**
 * Visual index belongs to the composed retrieval path, not to the cheap text index, so it is
 * built on demand: this control states whether a snapshot exists, then asks for confirmation
 * before spending a 4 GB vision model and minutes of CPU on encoding.
 */
export function VisualIndexControl({ className, enabled, root, status }: VisualIndexControlProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [indexStatus, setIndexStatus] = useState<VisualIndexStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const { notify } = useToast();

  useEffect(() => {
    setIndexStatus(null);
    setError(null);
    setSummary(null);
    if (!enabled || !root || status !== 'ready') {
      return undefined;
    }
    let cancelled = false;
    void getVisualIndexStatus(root)
      .then((value) => {
        if (!cancelled) setIndexStatus(value);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, root, status]);

  const build = async () => {
    if (!root || building) return;
    setBuilding(true);
    setError(null);
    setSummary(null);
    try {
      const result = await prepareVisualSearchIndex(root);
      setSummary(
        result.document_count > 0
          ? `已写入：${result.entry_count} 篇 / ${result.asset_count} 个图表资产 / ${result.document_count} 个向量源。`
          : '当前资料库没有可编码的页面或图表资产。'
      );
      const refreshed = await getVisualIndexStatus(root).catch(() => null);
      if (refreshed) setIndexStatus(refreshed);
      notify({
        tone: 'success',
        title: '视觉索引已构建',
        description:
          result.document_count > 0
            ? `${result.entry_count} 篇 / ${result.asset_count} 个资产`
            : '没有可编码的页面或资产。'
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      notify({ tone: 'danger', title: '构建视觉索引失败', description: message });
    } finally {
      setBuilding(false);
    }
  };

  if (!enabled) return null;

  return (
    <div className={className}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div
          className={
            error
              ? 'flex min-w-0 items-center gap-1.5 text-[11px] text-destructive'
              : indexStatus?.built
                ? 'flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground'
                : 'flex min-w-0 items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300'
          }
        >
          {building ? (
            <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <Images className="size-3 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">
            {building
              ? '正在构建视觉索引…'
              : error
                ? `视觉索引状态不可用：${error}`
                : indexStatus?.built
                  ? `视觉索引已构建 · ${indexStatus.snapshot_count} 个快照`
                  : indexStatus
                    ? '视觉索引未构建（组合检索的视觉投票不可用）'
                    : '正在检查视觉索引…'}
          </span>
        </div>
        {!building && root && status === 'ready' ? (
          <Button
            className="shrink-0"
            size="xs"
            title="编码页面、区域与 MinerU 图表资产，供组合检索的视觉投票使用"
            type="button"
            variant="ghost"
            onClick={() => setConfirmOpen(true)}
          >
            <Hammer size={12} aria-hidden="true" />
            {indexStatus?.built ? '重建视觉索引' : '构建视觉索引'}
          </Button>
        ) : null}
      </div>
      {summary ? <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{summary}</p> : null}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} aria-hidden="true" />
              构建视觉索引
            </DialogTitle>
            <DialogDescription>
              为当前资料库的页面、区域与 MinerU 图表资产生成视觉向量，组合检索的视觉投票会使用它。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm leading-6 text-amber-800 dark:text-amber-200">
            需要本地视觉服务（Qwen3-VL-Embedding-2B，约 4 GB）：首次启动加载模型约 40–85 秒；编码期间会占用大量 CPU，资料较多时可能需要数分钟。构建期间关键词搜索与文本向量搜索不受影响。
          </div>
          <DialogFooter>
            <Button disabled={building} type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button disabled={building} type="button" onClick={() => { setConfirmOpen(false); void build(); }}>
              <Hammer size={14} aria-hidden="true" />
              开始构建视觉索引
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
