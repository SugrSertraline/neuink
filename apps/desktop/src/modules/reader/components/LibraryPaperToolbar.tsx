import { ArrowDown, ArrowUp, Columns3, FolderTree, ListChecks, RefreshCw } from 'lucide-react';
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
import { LibraryDisplayControl } from './LibraryDisplayControl';
import { libraryToolbarControl, libraryToolbarGroup, libraryToolbarGroupItem } from './libraryToolbarStyles';
import { useAppearance } from '@/shared/components/AppearanceProvider';
import type { LibraryEntrySortDirection, LibraryEntrySortKey } from './libraryEntrySorting';

type PaperScope = 'direct' | 'descendants';
export type PaperSource = 'all' | 'local' | 'zotero' | 'mineru';
const tagScopes = [
  { value: 'direct', label: '仅当前标签', title: '只显示直接归入当前标签的论文' },
  { value: 'descendants', label: '含子标签', title: '显示当前标签及所有子标签中的论文，每篇只出现一次' }
] as const;

/** Display controls never change the paper collection or its scope. */
export function LibraryPaperToolbar({ query, sortBy, sortDirection, recentOrderAvailable, scope, visibleColumns, pinnedEdges, tagNavigation, refresh, sourceFilter, selection, onQueryChange, onSortChange, onSortDirectionChange, onScopeChange, onColumnChange, onPinChange }: {
  selection?: { enabled: boolean; disabled: boolean; onToggle: () => void };
  query: string;
  sortBy: LibraryEntrySortKey;
  sortDirection: LibraryEntrySortDirection;
  recentOrderAvailable: boolean;
  scope: PaperScope | null;
  visibleColumns: ReadonlySet<EntryLibraryColumnId>;
  pinnedEdges: ReadonlySet<'left' | 'right'>;
  tagNavigation: { shown: boolean; disabled: boolean; onShownChange: (shown: boolean) => void };
  refresh?: { busy: boolean; disabled: boolean; onRefresh: () => void };
  sourceFilter?: { value: PaperSource; onChange: (value: PaperSource) => void; enabledSources: { zotero: boolean; mineru: boolean }; loading: boolean };
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LibraryEntrySortKey) => void;
  onSortDirectionChange: (direction: LibraryEntrySortDirection) => void;
  onScopeChange: (scope: PaperScope) => void;
  onColumnChange: (column: EntryLibraryColumnId, visible: boolean) => void;
  onPinChange: (edge: 'left' | 'right', pinned: boolean) => void;
}) {
  const { appearance, libraryDisplay } = useAppearance();
  const sourceOptions = ([['all', '全部'], ['local', '本地'], ['zotero', 'Zotero'], ['mineru', 'MinerU']] as const)
    .filter(([value]) => value === 'all' || value === 'local' || ((value === 'zotero' || value === 'mineru') && sourceFilter?.enabledSources[value]));
  const activeSourceIndex = sourceOptions.findIndex(([value]) => value === sourceFilter?.value);
  return <div data-material="workspace-toolbar" className="@container/library-toolbar min-w-0 shrink-0 border-b px-3 py-2">
    <div aria-label="条目库筛选与操作" className="flex min-w-0 flex-wrap items-center gap-2">
      <SearchInput label="搜索条目" placeholder="搜索标题、标签、PDF…" value={query} onValueChange={onQueryChange}
        className="w-48 max-w-48 shrink-0 @max-[700px]/library-toolbar:w-full @max-[700px]/library-toolbar:max-w-none" />
      {selection && <Button size="default" variant={selection.enabled ? 'secondary' : 'outline'} disabled={selection.disabled} aria-pressed={selection.enabled} className="gap-1.5 text-xs" onClick={selection.onToggle}><ListChecks size={14} aria-hidden="true" />{selection.enabled ? '退出选择' : '选择模式'}</Button>}
      {scope ? <ToggleGroup aria-label="论文范围" className={libraryToolbarGroup} size="sm" spacing={0} type="single" value={scope}
        onValueChange={value => { if (tagScopes.some(option => option.value === value)) onScopeChange(value as PaperScope); }}>
        {tagScopes.map(option => <ToggleGroupItem key={option.value} aria-label={option.label} value={option.value} title={option.title}
          className={cn(libraryToolbarGroupItem, scope !== option.value && 'text-muted-foreground')}>
          {option.value === 'direct' ? '仅当前' : option.label}
        </ToggleGroupItem>)}
      </ToggleGroup> : null}
      {sourceFilter && <ToggleGroup aria-label="条目来源筛选" className={cn(libraryToolbarGroup, 'relative grid')} size="sm" spacing={0} type="single" value={sourceFilter.value}
        disabled={sourceFilter.loading}
        style={{ gridTemplateColumns: `repeat(${sourceOptions.length}, minmax(0, 1fr))` }}
        onValueChange={value => { if (sourceOptions.some(([option]) => option === value)) sourceFilter.onChange(value as PaperSource); }}>
        <span aria-hidden="true" className="pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 rounded-sm bg-accent transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{ width: `calc((100% - 4px) / ${sourceOptions.length})`, transform: `translateX(${Math.max(activeSourceIndex, 0) * 100}%)` }} />
        {sourceOptions.map(([value, label]) => <ToggleGroupItem key={value} value={value} aria-label={label} className={cn(libraryToolbarGroupItem, 'relative z-10 min-w-14 px-2 data-[state=on]:bg-transparent', sourceFilter.value !== value && 'text-muted-foreground')}>{label}</ToggleGroupItem>)}
      </ToggleGroup>}
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      <Select value={sortBy} onValueChange={value => onSortChange(value as LibraryEntrySortKey)}>
        <SelectTrigger aria-label="条目排序" className={cn(libraryToolbarControl, 'w-32 @max-[700px]/library-toolbar:w-28')} size="default"><SelectValue placeholder="排序" /></SelectTrigger>
        <SelectContent viewportAligned>
          {(recentOrderAvailable || sortBy === 'recent') && <SelectItem value="recent">最近访问</SelectItem>}
          <SelectItem value="created">最近加入</SelectItem>
          <SelectItem value="title">标题</SelectItem>
          <SelectItem value="source">来源</SelectItem>
          <SelectItem value="parser">解析状态</SelectItem>
          <SelectItem value="reading-progress">阅读进度</SelectItem>
          <SelectItem value="last-read">最近阅读</SelectItem>
          <SelectItem value="reading-time">阅读时长</SelectItem>
          <SelectItem value="tags">标签</SelectItem>
          <SelectItem value="file">文件</SelectItem>
          <SelectItem value="updated">更新时间</SelectItem>
        </SelectContent>
      </Select>
      <Button type="button" size="icon" variant="outline"
        aria-label={sortDirection === 'asc' ? '升序排列，切换为降序' : '降序排列，切换为升序'}
        title={sortDirection === 'asc' ? '升序排列，切换为降序' : '降序排列，切换为升序'}
        onClick={() => onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc')}>
        {sortDirection === 'asc' ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
      </Button>
      <LibraryDisplayControl />
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle aria-label="标签导航" variant="outline" size="default" pressed={tagNavigation.shown}
            disabled={tagNavigation.disabled} onPressedChange={tagNavigation.onShownChange}
            className={cn(libraryToolbarControl, 'gap-1.5 aria-pressed:border-primary/30 aria-pressed:bg-accent aria-pressed:text-accent-foreground data-[state=on]:bg-accent @max-[900px]/library-toolbar:w-8 @max-[900px]/library-toolbar:px-0')}>
            <FolderTree className="size-3.5" aria-hidden="true" /><span className="@max-[900px]/library-toolbar:hidden">标签导航</span>
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>{tagNavigation.shown ? '隐藏标签导航' : '显示标签导航'}</TooltipContent>
      </Tooltip>
      {appearance !== 'atelier' || libraryDisplay === 'list' ? <DropdownMenu>
        <DropdownMenuTrigger asChild><Button aria-label="表头" title="表头" className="text-xs @max-[900px]/library-toolbar:w-8 @max-[900px]/library-toolbar:px-0" size="default" variant="outline"><Columns3 size={14} aria-hidden="true" /><span className="@max-[900px]/library-toolbar:hidden">表头</span></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44" viewportAligned>
          <DropdownMenuLabel>显示的列</DropdownMenuLabel><DropdownMenuSeparator />
          {ENTRY_LIBRARY_COLUMNS.map(column => <DropdownMenuCheckboxItem key={column.id} checked={visibleColumns.has(column.id)}
            onCheckedChange={checked => onColumnChange(column.id, checked === true)} onSelect={event => event.preventDefault()}>{column.label}</DropdownMenuCheckboxItem>)}
          <DropdownMenuSeparator /><DropdownMenuLabel>固定列</DropdownMenuLabel>
          {(['left', 'right'] as const).map(edge => <DropdownMenuCheckboxItem key={edge} checked={pinnedEdges.has(edge)}
            onCheckedChange={checked => onPinChange(edge, checked === true)} onSelect={event => event.preventDefault()}>{edge === 'left' ? '固定最左列' : '固定最右列'}</DropdownMenuCheckboxItem>)}
        </DropdownMenuContent>
      </DropdownMenu> : null}
      {refresh ? <Button size="default" variant="outline" className="text-xs" disabled={refresh.disabled || refresh.busy} onClick={refresh.onRefresh}>
        <RefreshCw className={cn(refresh.busy && 'animate-spin')} size={14} aria-hidden="true" />刷新
      </Button> : null}
      </div>
    </div>
  </div>;
}
