import { Columns3, FolderTree, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ENTRY_LIBRARY_COLUMNS } from './LibraryPaperTable';
import type { EntryLibraryColumnId } from './useEntryLibraryColumnWidths';

type PaperScope = 'all' | 'unclassified' | 'direct' | 'descendants';
const rootScopes = [
  { value: 'all', label: '全部论文', title: '显示当前资料库范围内的全部论文' },
  { value: 'unclassified', label: '未分类', title: '没有关联任何标签的论文' }
] as const;
const tagScopes = [
  { value: 'direct', label: '仅当前标签', title: '只显示直接归入当前标签的论文' },
  { value: 'descendants', label: '含子标签', title: '显示当前标签及所有子标签中的论文，每篇只出现一次' }
] as const;

/** Display controls never change the paper collection or its scope. */
export function LibraryPaperToolbar({ query, sortBy, scope, unclassifiedCount, visibleColumns, pinnedEdges, tagNavigation, refresh, onQueryChange, onSortChange, onScopeChange, onColumnChange, onPinChange }: {
  query: string;
  sortBy: string;
  scope: PaperScope | null;
  unclassifiedCount: number | null;
  visibleColumns: ReadonlySet<EntryLibraryColumnId>;
  pinnedEdges: ReadonlySet<'left' | 'right'>;
  tagNavigation: { shown: boolean; disabled: boolean; onShownChange: (shown: boolean) => void };
  refresh?: { busy: boolean; disabled: boolean; onRefresh: () => void };
  onQueryChange: (query: string) => void;
  onSortChange: (sort: string) => void;
  onScopeChange: (scope: PaperScope) => void;
  onColumnChange: (column: EntryLibraryColumnId, visible: boolean) => void;
  onPinChange: (edge: 'left' | 'right', pinned: boolean) => void;
}) {
  const scopes = scope === 'direct' || scope === 'descendants' ? tagScopes : rootScopes;
  return <div className="@container/library-toolbar min-w-0 shrink-0 border-b px-3 py-2">
    <div aria-label="条目库筛选与操作" className="flex min-w-0 flex-wrap items-center gap-1.5">
      <SearchInput label="搜索条目" placeholder="搜索标题、PDF、字段、标签或解析状态" value={query} onValueChange={onQueryChange} className="min-w-28 @max-[700px]/library-toolbar:min-w-24" />
      <Select value={sortBy} onValueChange={onSortChange}>
        <SelectTrigger aria-label="条目排序" className="w-32 shrink-0 text-xs @max-[700px]/library-toolbar:w-28" size="default"><SelectValue placeholder="排序" /></SelectTrigger>
        <SelectContent viewportAligned>
          <SelectItem value="recent">最近更新</SelectItem>
          <SelectItem value="title">标题</SelectItem>
          <SelectItem value="parser">解析状态</SelectItem>
          <SelectItem value="reading-progress">阅读进度</SelectItem>
          <SelectItem value="last-read">最近阅读</SelectItem>
          <SelectItem value="reading-time">阅读时长</SelectItem>
        </SelectContent>
      </Select>
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle aria-label="标签导航" variant="outline" size="default" pressed={tagNavigation.shown}
            disabled={tagNavigation.disabled} onPressedChange={tagNavigation.onShownChange}
            className="shrink-0 gap-1.5 text-xs aria-pressed:border-primary/30 aria-pressed:bg-accent aria-pressed:text-accent-foreground data-[state=on]:bg-accent @max-[700px]/library-toolbar:w-8 @max-[700px]/library-toolbar:px-0">
            <FolderTree className="size-3.5" aria-hidden="true" /><span className="@max-[700px]/library-toolbar:hidden">标签导航</span>
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>{tagNavigation.shown ? '隐藏标签导航' : '显示标签导航'}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button aria-label="表头" title="表头" className="text-xs @max-[700px]/library-toolbar:w-8 @max-[700px]/library-toolbar:px-0" size="default" variant="outline"><Columns3 size={14} aria-hidden="true" /><span className="@max-[700px]/library-toolbar:hidden">表头</span></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44" viewportAligned>
          <DropdownMenuLabel>显示的列</DropdownMenuLabel><DropdownMenuSeparator />
          {ENTRY_LIBRARY_COLUMNS.map(column => <DropdownMenuCheckboxItem key={column.id} checked={visibleColumns.has(column.id)}
            onCheckedChange={checked => onColumnChange(column.id, checked === true)} onSelect={event => event.preventDefault()}>{column.label}</DropdownMenuCheckboxItem>)}
          <DropdownMenuSeparator /><DropdownMenuLabel>固定列</DropdownMenuLabel>
          {(['left', 'right'] as const).map(edge => <DropdownMenuCheckboxItem key={edge} checked={pinnedEdges.has(edge)}
            onCheckedChange={checked => onPinChange(edge, checked === true)} onSelect={event => event.preventDefault()}>{edge === 'left' ? '固定最左列' : '固定最右列'}</DropdownMenuCheckboxItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      {scope ? <ToggleGroup aria-label="论文范围" className="h-8 shrink-0 rounded-md border bg-muted p-0.5" size="sm" spacing={0} type="single" value={scope}
        onValueChange={value => { if (scopes.some(option => option.value === value)) onScopeChange(value as PaperScope); }}>
        {scopes.map(option => <ToggleGroupItem key={option.value} aria-label={option.label} value={option.value} title={option.title}
          className={cn('h-full gap-1.5 px-2 text-xs', scope === option.value ? 'bg-background shadow-sm hover:bg-background' : 'text-muted-foreground')}>
          {option.value === 'direct' ? '仅当前' : option.label}
          {option.value === 'unclassified' && unclassifiedCount !== null ? <span className="tabular-nums text-muted-foreground">{unclassifiedCount}</span> : null}
        </ToggleGroupItem>)}
      </ToggleGroup> : null}
      {refresh ? <Button size="default" variant="outline" className="text-xs" disabled={refresh.disabled || refresh.busy} onClick={refresh.onRefresh}>
        <RefreshCw className={cn(refresh.busy && 'animate-spin')} size={14} aria-hidden="true" />刷新
      </Button> : null}
    </div>
  </div>;
}
