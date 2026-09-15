import type { ReactNode } from 'react';
import { FileText, Info, CircleCheck, PanelRight, PanelRightOpen, PanelLeft, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import type { EntryReadingState } from '@/shared/types/domain';
import { formatReadingDuration, getReadingProgress } from '@/modules/reader/components/libraryReading';
import type { LibraryEntry } from './LibrarySidebar';
import { SidebarContentRow } from './SidebarContentRow';

export function SidebarPaperRow({ entry, layout, paths, state, loading, error, active, onOpen, onSplit, onDetails, previewFooter, splitPane = 'right' }: {
  entry: LibraryEntry; layout: WorkspaceSurfaceLayout; paths: Map<string, string>; state?: EntryReadingState;
  loading: boolean; error: boolean; active?: boolean; previewFooter?: ReactNode;
  splitPane?: 'left' | 'right';
  onOpen: () => void; onSplit: () => void; onDetails?: () => void;
}) {
  const left = 'entryId' in layout.left && layout.left.entryId === entry.id;
  const right = Boolean(layout.right && 'entryId' in layout.right && layout.right.entryId === entry.id);
  const splitOpen = splitPane === 'right' ? right : left;
  const splitLabel = splitPane === 'right' ? '右侧' : '左侧';
  const SplitIcon = splitPane === 'right' ? splitOpen ? PanelRight : PanelRightOpen : splitOpen ? PanelLeft : PanelLeftOpen;
  const detailsOpen = (left && layout.left.kind === 'entry-overview') || (right && layout.right?.kind === 'entry-overview');

  const progress = getReadingProgress(state);
  const readLabel = loading ? '读取进度中…' : error && !state ? '进度暂不可用'
    : !state || (state.total_active_ms <= 0 && state.current_page_idx === null) ? '未开始'
    : `${progress >= 100 ? '已读完' : `已读 ${progress}%`}${state.current_page_idx !== null && state.page_count > 0 ? ` · 第 ${state.current_page_idx + 1}/${state.page_count} 页` : ''} · ${formatReadingDuration(state.total_active_ms)}`;
  const fileLabel = [left && '左侧', right && '右侧', entry.pdfFileName ?? (entry.status === 'Parsed' ? '重排视图' : '无 PDF · 可查看详情')].filter(Boolean).join(' · ');
  const noteLabel = `${entry.contents.filter(item => item.kind === 'note').length} 篇笔记`;
  const tagLabel = entry.tagIds.map(id => paths.get(id)).filter(Boolean).join('；') || '未分类';
  const knownProgress = !loading && !(error && !state);
  const shortProgress = !knownProgress ? readLabel : readLabel === '未开始' ? '未开始' : progress >= 100 ? '已读完' : `${progress}%`;
  return <SidebarContentRow active={active ?? (left || right)} icon={<FileText size={14} aria-hidden="true" />} label={entry.title}
    meta={`${fileLabel}\n${readLabel} · ${noteLabel}\n标签：${tagLabel}`}
    metaContent={<span className="flex h-4 items-center gap-2 tabular-nums">
      <Progress aria-label={`${entry.title} 阅读进度`} value={knownProgress ? progress : null} aria-valuetext={readLabel} className="h-1 min-w-3 max-w-20 flex-1" />
      <span className="truncate">{shortProgress}</span>
    </span>}
    preview={<div className="space-y-2">
      <p className="font-medium text-foreground [overflow-wrap:anywhere]">{entry.title}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">文件</dt><dd className="[overflow-wrap:anywhere]">{fileLabel}</dd>
        <dt className="text-muted-foreground">阅读</dt><dd>{readLabel}</dd>
        <dt className="text-muted-foreground">笔记</dt><dd>{noteLabel}</dd>
        <dt className="text-muted-foreground">标签</dt><dd className="[overflow-wrap:anywhere]">{tagLabel}</dd>
      </dl>
      {previewFooter}
    </div>}
    onClick={onOpen} action={<span className="flex items-center">
      {onDetails ? <Tooltip><TooltipTrigger asChild><Button size="icon-xs" variant="ghost" aria-label={`查看详情 ${entry.title}`} aria-pressed={detailsOpen} className={detailsOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground'} onClick={onDetails}>{detailsOpen ? <CircleCheck size={13} aria-hidden="true" /> : <Info size={13} aria-hidden="true" />}</Button></TooltipTrigger><TooltipContent>{detailsOpen ? '条目详情已打开 · 点击查看' : '查看条目详情'}</TooltipContent></Tooltip> : null}
      <Tooltip><TooltipTrigger asChild><Button size="icon-xs" variant="ghost" aria-label={`在${splitLabel}打开 ${entry.title}`} aria-pressed={splitOpen} className={splitOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground'} onClick={onSplit}><SplitIcon size={13} aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>{splitOpen ? `已在${splitLabel}打开 · 点击定位` : `在${splitLabel}打开对照`}</TooltipContent></Tooltip>
    </span>} />;
}
