import type { FieldDefinition } from '@/shared/ipc/fieldDefinitionsApi';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, FolderTree, ListChecks, RefreshCw, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { fieldColumnId } from './LibraryPaperTable';
import type { EntryLibraryColumnId } from './useEntryLibraryColumnWidths';
import { LibraryColumnSettingsDialog } from './LibraryColumnSettingsDialog';
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
export function LibraryPaperToolbar({ folderNavigation, tagsOnly, query, sortBy, sortDirection, recentOrderAvailable, scope, visibleColumns, fieldNames = [], fieldDefinitions = [], fieldFilter, workspaceRoot, pinnedEdges, tagNavigation, refresh, sourceFilter, selection, selectionActions, onQueryChange, onSortChange, onSortDirectionChange, onScopeChange, onColumnChange, onPinChange }: {
  folderNavigation?: { path: Array<{ id: string; name: string }>; onNavigate: (id: string | null) => void; folders: number; papers: number; disabled: boolean };
  tagsOnly?: { enabled: boolean; onChange: (enabled: boolean) => void };
  selectionActions?: ReactNode;
  selection?: { enabled: boolean; disabled: boolean; onToggle: () => void };
  query: string;
  sortBy: LibraryEntrySortKey;
  sortDirection: LibraryEntrySortDirection;
  recentOrderAvailable: boolean;
  scope: PaperScope | null;
  workspaceRoot?: string | null;
  fieldNames?: readonly string[];
  fieldDefinitions?: readonly FieldDefinition[];
  fieldFilter?: { name: string; value: string; onChange: (name: string, value: string) => void };
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
  const filterDefinition = fieldDefinitions.find(value => value.name === fieldFilter?.name);
  const activeSourceIndex = sourceOptions.findIndex(([value]) => value === sourceFilter?.value);
  const navigationControl = <DropdownMenu>
    <DropdownMenuTrigger asChild><Button aria-label="标签导航" aria-pressed={tagNavigation.shown || Boolean(tagsOnly?.enabled)} disabled={tagNavigation.disabled && !tagsOnly?.enabled} variant="outline" className="shrink-0 gap-1.5 text-xs"><FolderTree size={14} />标签导航</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end"><DropdownMenuLabel>显示方式</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={tagsOnly?.enabled ? 'folders' : tagNavigation.shown ? 'both' : 'table'} onValueChange={value => {
        tagsOnly?.onChange(value === 'folders'); tagNavigation.onShownChange(value !== 'table');
      }}>
        <DropdownMenuRadioItem value="table">纯条目表格</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="folders">纯标签文件夹</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="both">标签与表格</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
  if (tagsOnly?.enabled) return <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-2 overflow-x-auto border-b px-3 py-2" aria-label="文件夹导航工具栏">
    <Button variant="ghost" size="sm" className="shrink-0 gap-1 text-xs" disabled={!folderNavigation?.path.length || folderNavigation.disabled}
      onClick={() => folderNavigation?.onNavigate(folderNavigation.path[folderNavigation.path.length - 2]?.id ?? null)}><ArrowUp size={14} aria-hidden="true" />返回上一级</Button>
    <nav aria-label="文件夹位置" className="flex min-w-0 w-[400px] max-w-[45%] shrink items-center gap-1 overflow-x-auto text-xs">
      <Button variant="ghost" size="sm" className="shrink-0 text-xs" disabled={folderNavigation?.disabled} onClick={() => folderNavigation?.onNavigate(null)}>全部标签</Button>
      {folderNavigation?.path.map((part, index) => <span key={part.id} className="flex min-w-0 shrink-0 items-center gap-1">
        <ChevronRight size={12} aria-hidden="true" className="text-muted-foreground" />
        {index === folderNavigation.path.length - 1 ? <span aria-current="location" title={part.name} className="max-w-48 truncate px-2 font-medium">{part.name}</span>
          : <Button variant="ghost" size="sm" title={part.name} className="max-w-40 text-xs" disabled={folderNavigation.disabled} onClick={() => folderNavigation.onNavigate(part.id)}><span className="truncate">{part.name}</span></Button>}
      </span>)}
    </nav>
    {folderNavigation && <span className="ml-auto shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{folderNavigation.folders} 个文件夹 · {folderNavigation.papers} 篇论文</span>}
    {navigationControl}
  </div>;
  return <div data-material="workspace-toolbar" className="@container/library-toolbar min-w-0 shrink-0 border-b px-3 py-2">
    <div aria-label="条目库筛选与操作" className={cn('flex min-w-0 items-center gap-2', selection?.enabled
      ? 'min-h-10 flex-wrap'
      : 'h-10 flex-nowrap overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:thin]')}>
      <SearchInput label="搜索条目" placeholder="搜索标题、标签、PDF…" value={query} onValueChange={onQueryChange}
        className={selection?.enabled ? 'w-48 max-w-48 basis-32' : 'w-48 max-w-48 shrink-0'} />
      <div role={selection?.enabled ? 'group' : undefined} aria-label={selection?.enabled ? '选择模式操作' : undefined}
        className={selection?.enabled ? 'flex min-h-8 min-w-0 max-w-full flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2' : 'contents'}>
        {selectionActions}
        {selection && <Button size={selection.enabled ? 'sm' : 'default'} variant={selection.enabled ? 'ghost' : 'outline'}
          disabled={selection.disabled} aria-pressed={selection.enabled} className="shrink-0 gap-1.5 text-xs" onClick={selection.onToggle}>
          <ListChecks size={14} aria-hidden="true" />{selection.enabled ? '退出选择' : '选择模式'}
        </Button>}
      </div>
      {!selection?.enabled && <>
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
      <div className="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-1.5">
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
          {fieldNames.map(name => <SelectItem key={name} value={fieldColumnId(name, workspaceRoot)}>{name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="button" size="icon" variant="outline"
        aria-label={sortDirection === 'asc' ? '升序排列，切换为降序' : '降序排列，切换为升序'}
        title={sortDirection === 'asc' ? '升序排列，切换为降序' : '降序排列，切换为升序'}
        onClick={() => onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc')}>
        {sortDirection === 'asc' ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
      </Button>
      {fieldFilter && fieldNames.length > 0 && <Popover><PopoverTrigger asChild><Button type="button" size="icon" variant="outline" aria-label="筛选属性" title="筛选属性"><Filter size={14} />{fieldFilter.value && <span className="sr-only">已启用</span>}</Button></PopoverTrigger><PopoverContent align="end" className="w-64 space-y-3"><Select value={fieldFilter.name ? `field:${fieldFilter.name}` : '__none__'} onValueChange={value => fieldFilter.onChange(value === '__none__' ? '' : value.slice(6), '')}><SelectTrigger aria-label="筛选属性名称"><SelectValue placeholder="选择属性" /></SelectTrigger><SelectContent><SelectItem value="__none__">不筛选</SelectItem>{fieldNames.map(name => <SelectItem key={name} value={`field:${name}`}>{name}</SelectItem>)}</SelectContent></Select>{filterDefinition && ['select', 'multi_select'].includes(filterDefinition.kind) ? <Select value={fieldFilter.value ? `option:${fieldFilter.value}` : '__all__'} onValueChange={value => fieldFilter.onChange(fieldFilter.name, value === '__all__' ? '' : value.slice(7))}><SelectTrigger aria-label="属性筛选内容"><SelectValue placeholder="选择属性值" /></SelectTrigger><SelectContent><SelectItem value="__all__">全部值</SelectItem>{filterDefinition.options.map(option => <SelectItem key={option} value={`option:${option}`}>{option}</SelectItem>)}</SelectContent></Select> : <Input aria-label="属性筛选内容" placeholder="输入属性值" value={fieldFilter.value} disabled={!fieldFilter.name} onChange={event => fieldFilter.onChange(fieldFilter.name, event.target.value)} />}<Button type="button" size="sm" variant="ghost" onClick={() => fieldFilter.onChange('', '')}>清除筛选</Button></PopoverContent></Popover>}
      <LibraryDisplayControl />
      {navigationControl}
      {appearance !== 'atelier' || libraryDisplay === 'list' ? <LibraryColumnSettingsDialog root={workspaceRoot} fields={fieldNames} visible={visibleColumns} pins={pinnedEdges} onColumnChange={onColumnChange} onPinChange={onPinChange} /> : null}
      {refresh ? <Button size="default" variant="outline" className="text-xs" disabled={refresh.disabled || refresh.busy} onClick={refresh.onRefresh}>
        <RefreshCw className={cn(refresh.busy && 'animate-spin')} size={14} aria-hidden="true" />刷新
      </Button> : null}
      </div>
      </>}
    </div>
  </div>;
}
