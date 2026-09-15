import { Highlighter, Link2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { WorkspaceReaderSurfaceKind } from '@/app/workspaceSurfacePairing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { ReadingExportScope } from '@/shared/ipc/readingExportApi';
import { ReadingExportButton } from '../export/ReadingExportButton';
import { EntryContentHeader } from './EntryContentHeader';
import { LocateSourceButton } from './LocateSourceButton';

export type SegmentRecordFilter = 'all' | 'note' | 'annotation' | 'highlight';

export function SegmentRecordsHeader({ entryId, entryTitle, workspaceRoot, noteCount, annotationCount, linkedReaderKind, follow, collapsed, filter, pageIndex, loading, busy, exportScope,
  onFollowChange, onToggleList, onFilterChange, onLocate }: {
  entryId: string;
  entryTitle: string;
  workspaceRoot: string | null;
  noteCount: number;
  annotationCount: number;
  linkedReaderKind: WorkspaceReaderSurfaceKind | null;
  follow: boolean;
  collapsed: boolean;
  filter: SegmentRecordFilter;
  pageIndex: number | null;
  loading: boolean;
  busy: boolean;
  exportScope: ReadingExportScope;
  onFollowChange: (follow: boolean) => void;
  onToggleList: () => void;
  onFilterChange: (filter: SegmentRecordFilter) => void;
  onLocate: () => void;
}) {
  const readerLabel = linkedReaderKind === 'reflow' ? '重排视图' : 'PDF';
  const exportLabel = { all: '导出片段记录', note: '导出片段笔记', annotation: '导出批注', highlight: '导出高亮' }[filter];
  return <>
    <EntryContentHeader contentTitle="片段记录" entryTitle={entryTitle}>
      <ReadingExportButton entryId={entryId} entryTitle={entryTitle} workspaceRoot={workspaceRoot} scope={exportScope}
        label="导出记录" scopeLabel={exportLabel} disabled={loading || busy || (noteCount === 0 && annotationCount === 0)} />
      <LocateSourceButton disabled={loading || pageIndex === null} label={linkedReaderKind ? '定位原文' : '在 PDF 中打开'}
        title={pageIndex === null ? '请先选择有原文的记录' : `在${linkedReaderKind ? '配对的' : ''}${readerLabel}中定位第 ${pageIndex + 1} 页`}
        onClick={onLocate} />
    </EntryContentHeader>
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Button aria-label={collapsed ? '展开片段列表' : '折叠片段列表'} title={collapsed ? '展开片段列表' : '折叠片段列表'} size="icon-xs" variant="ghost" onClick={onToggleList}>
          {collapsed ? <PanelLeftOpen aria-hidden="true" size={14} /> : <PanelLeftClose aria-hidden="true" size={14} />}
        </Button>
        {([['all', '全部'], ['note', '有笔记'], ['annotation', '有批注'], ['highlight', '仅高亮']] as const).map(([value, label]) =>
          <Button key={value} aria-pressed={filter === value} size="xs" variant={filter === value ? 'secondary' : 'ghost'} onClick={() => onFilterChange(value)}>
            {value === 'highlight' ? <Highlighter aria-hidden="true" size={13} /> : null}{label}
          </Button>)}
      </div>
      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>笔记 {noteCount} · 批注 {annotationCount}</span>
        <Badge variant={linkedReaderKind ? 'secondary' : 'outline'} className="gap-1">
          <Link2 aria-hidden="true" size={12} />{linkedReaderKind ? `已联动${readerLabel}` : '未联动'}
        </Badge>
        <label className="flex items-center gap-1.5" title={linkedReaderKind ? `跟随${readerLabel}当前片段` : '打开配对阅读器后可跟随当前片段'}>
          <Switch aria-label={`跟随${readerLabel}当前片段`} disabled={!linkedReaderKind} checked={Boolean(linkedReaderKind) && follow} onCheckedChange={onFollowChange} />跟随
        </label>
      </div>
    </div>
  </>;
}
