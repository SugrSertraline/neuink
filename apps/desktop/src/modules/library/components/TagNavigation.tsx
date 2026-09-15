import { ChevronDown, ChevronRight, FolderClosed, Pencil, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useTagPreferences } from '@/shared/components/TagPreferencesProvider';
import { flattenTagTree, type TagNode } from '../utils/tagTree';
import { SidebarTagRow } from './SidebarTagRow';
import { SidebarTagTreeItem } from './SidebarTagTreeItem';
import { TagDisplaySettingsMenu } from './TagDisplaySettingsMenu';
import { useTagTreeExpansion } from './useTagTreeExpansion';
import { useTagNavigationDragScroll } from './useTagNavigationDragScroll';
import { SidebarPanel } from './SidebarPanel';
import { SidebarPanelGroup } from './SidebarPanelGroup';

type TagNavigationProps = {
  activeTag: string | null;
  nodes: TagNode[];
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  open: boolean;
  onToggleOpen: () => void;
  onEditTags?: () => void;
  onAssignEntryToTag?: (entryId: string, tagPath: string) => Promise<unknown> | unknown;
  revealActiveTag?: boolean;
  onOpenTagDetails: (tagId: string) => void;
  collection?: { query: string; toolbar: ReactNode; onSelectAll: () => void; contextLabel?: string; panels?: boolean };
  children?: ReactNode;
};

export function TagNavigation({ activeTag, nodes, status, error, open, onToggleOpen, onEditTags, onAssignEntryToTag, onOpenTagDetails, revealActiveTag = false, collection, children }: TagNavigationProps) {
  const { preferences } = useTagPreferences();
  // Browsing the sidebar never changes the library filter or the open detail tab.
  const [directoryId, setDirectoryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const showSearch = !collection && open && searchOpen;
  const bodyId = useId();
  const searchId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const restoreSearchFocus = useRef(false);
  const requestedFocus = useRef<string | null | undefined>(undefined);
  useTagNavigationDragScroll(rootRef, Boolean(onAssignEntryToTag));
  useEffect(() => {
    if (requestedFocus.current === undefined || requestedFocus.current !== directoryId) return;
    requestedFocus.current = undefined;
    rootRef.current?.querySelector<HTMLButtonElement>('nav button[aria-current="location"]')?.focus({ preventScroll: true });
  }, [directoryId]);
  useEffect(() => {
    if (showSearch || !restoreSearchFocus.current) return;
    restoreSearchFocus.current = false;
    searchButtonRef.current?.focus({ preventScroll: true });
  }, [showSearch]);
  const closeSearch = () => {
    restoreSearchFocus.current = true;
    setQuery('');
    setSearchOpen(false);
  };
  const allNodes = useMemo(() => flattenTagTree(nodes), [nodes]);
  const nodeById = useMemo(() => new Map(allNodes.map(node => [node.id, node])), [allNodes]);
  const activeParentId = activeTag ? nodeById.get(activeTag)?.parentId ?? null : null;
  useEffect(() => {
    if (!revealActiveTag) return;
    setDirectoryId(activeParentId);
    setQuery('');
  }, [activeTag, activeParentId, revealActiveTag]);
  const selected = directoryId ? nodeById.get(directoryId) : undefined;
  const headingTag = collection ? activeTag ? nodeById.get(activeTag) : undefined : selected;
  const crumbs: TagNode[] = [];
  const visited = new Set<string>();
  for (let node = headingTag; node && !visited.has(node.id); node = node.parentId ? nodeById.get(node.parentId) : undefined) {
    visited.add(node.id);
    crumbs.unshift(node);
  }
  const activeAncestors: string[] = [];
  const activeVisited = new Set<string>();
  for (let node = activeTag ? nodeById.get(activeTag) : undefined; node?.parentId && !activeVisited.has(node.parentId); node = nodeById.get(node.parentId)) {
    activeVisited.add(node.parentId);
    activeAncestors.push(node.parentId);
  }
  const expansion = useTagTreeExpansion(activeAncestors, preferences.navigationMode === 'tree');
  const search = (collection?.query ?? query).trim().toLocaleLowerCase();
  const shown = search ? allNodes.filter(node => node.path.toLocaleLowerCase().includes(search))
    : preferences.navigationMode === 'paths' ? allNodes : selected?.children ?? nodes;
  const browseTag = (id: string | null, focusPath = false) => {
    requestedFocus.current = focusPath && id !== directoryId ? id : undefined;
    setDirectoryId(id);
  };
  const rowOptions = { density: preferences.density, showCounts: preferences.showCounts, onAssignEntryToTag, onOpenTagDetails, onBrowseTag: (id: string) => browseTag(id, true) };
  const showTree = preferences.navigationMode === 'tree' && !search;

  const contextLabel = search ? `找到 ${shown.length} 个标签` : showTree ? '标签层级'
    : preferences.navigationMode === 'paths' ? `全部 ${allNodes.length} 个标签`
      : selected ? '子标签' : '顶层标签';

  const parentNavigation = <>
        {open && selected && !showSearch && !search ? (
          <div className={collection ? 'pb-1' : 'border-b border-border/60 pb-1'} data-slot="tag-navigation-parent">
            <Button
              aria-label="上一级"
              className="w-full min-w-0 justify-start gap-2 px-2 text-xs"
              title={`返回 ${selected.parentId ? nodeById.get(selected.parentId)?.path ?? '上一级标签' : '全部标签'}`}
              type="button"
              variant="ghost"
              onClick={() => browseTag(selected.parentId, true)}
            >
              <FolderClosed className="size-3" aria-hidden="true" />
              <span className="shrink-0">上一级</span>
              <span className="ml-auto min-w-0 truncate text-[11px] font-normal text-muted-foreground">{selected.parentId ? nodeById.get(selected.parentId)?.name : '全部标签'}</span>
            </Button>
          </div>
        ) : null}
  </>;
  const tagBody = <>
      {collection?.panels ? parentNavigation : null}
      {open && status === 'ready' ? <p className="sr-only" role="status">{contextLabel}</p> : null}
      <div id={bodyId} hidden={!open}>
        {open && (!collection || collection.panels) && (status === 'loading' ? <p className="px-2 py-3 text-xs text-muted-foreground" role="status">正在加载标签…</p>
          : status === 'error' ? <p className="break-words px-2 py-3 text-xs text-destructive" role="alert">无法加载标签。{error || '请重新打开工作区后重试。'}</p>
          : directoryId && !selected ? <p className="px-2 py-2 text-xs text-muted-foreground">浏览的标签已不可用，请从全部标签重新选择。</p> : null)}
        {open && status === 'ready' ? <div className="min-w-0 space-y-0.5">
          {nodes.length === 0 ? collection && !collection.panels ? null : <p className="px-2 py-3 text-xs text-muted-foreground">{onEditTags ? '暂无标签，可通过“编辑标签”创建。' : '暂无标签。'}</p>
            : showTree ? nodes.map(node => <SidebarTagTreeItem key={node.id} activeTag={activeTag} node={node} expandedIds={expansion.expandedIds} onToggle={expansion.toggle} {...rowOptions} />)
            : shown.length ? shown.map(node => <SidebarTagRow key={node.id} active={activeTag === node.id} node={node} presentation={search ? 'paths' : preferences.navigationMode} {...rowOptions} />)
            : collection && !collection.panels ? null : <p className="px-2 py-3 text-xs text-muted-foreground">{search ? '没有匹配的标签，请尝试其他名称或路径。' : '当前标签暂无子标签。'}</p>}
          {expansion.persistenceError ? <p className="px-2 py-1 text-xs text-destructive" role="alert">展开状态已临时应用，但无法保存。</p> : null}
        </div> : null}
      </div>
  </>;

  // Search replaces the path in the same row, without adding a scroll owner.
  // Collapsing the section preserves the query; explicitly closing search clears it.
  return (
    <div ref={rootRef} className={collection?.panels ? 'flex h-full min-h-0 min-w-0 flex-col overflow-hidden' : 'min-w-0'} aria-label="标签导航">
      <div className={collection?.panels ? 'shrink-0 bg-card px-2' : 'sticky top-0 z-10 min-w-0 bg-card'} data-slot="tag-navigation-sticky">
        <div className="flex h-8 min-w-0 items-center gap-0.5" data-slot="tag-navigation-header">
          {!collection ? <Button aria-label={open ? '收起标签' : '展开标签'} aria-expanded={open} aria-controls={bodyId} size="icon-sm" title={open ? '收起标签' : '展开标签'} type="button" variant="plain" onClick={onToggleOpen}>
            {open ? <ChevronDown className="size-3" aria-hidden="true" /> : <ChevronRight className="size-3" aria-hidden="true" />}
          </Button> : null}
          {showSearch ? (
            <div className="relative min-w-0 flex-1">
              <Input
                id={searchId}
                aria-label="搜索标签或路径"
                autoFocus
                className="h-7 border-transparent bg-muted/60 pl-2 pr-7 text-xs hover:bg-muted focus-visible:border-ring focus-visible:bg-card focus-visible:ring-1 md:text-xs dark:bg-muted/60"
                placeholder="搜索标签…"
                title={status === 'ready' && search ? contextLabel : '搜索标签或完整路径'}
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
                  event.stopPropagation();
                  closeSearch();
                }}
              />
              <Button aria-label="关闭标签搜索" className="absolute right-0.5 top-0.5 text-muted-foreground" size="icon-xs" title="关闭搜索并清空关键词" type="button" variant="ghost" onClick={closeSearch}>
                <X className="size-3" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <>
              <nav aria-label="标签浏览路径" className="flex min-w-0 flex-1 items-center">
                {collection && headingTag ? <Button className="shrink-0 px-1 text-[11px] text-muted-foreground" size="sm" variant="plain" onClick={() => { browseTag(null); collection.onSelectAll(); }}>全部标签<ChevronRight size={12} aria-hidden="true" /></Button> : null}
                {headingTag ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button aria-current="location" className="min-w-0 flex-1 shrink justify-start px-1 text-xs" size="sm" title={collection?.contextLabel ? `${headingTag.path}\n${collection.contextLabel}` : headingTag.path} type="button" variant="plain">
                        <span className="truncate">{headingTag.name}</span><ChevronDown className="size-3" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-64" viewportAligned>
                      <DropdownMenuLabel>标签浏览路径</DropdownMenuLabel>
                      <DropdownMenuItem onSelect={() => { browseTag(null, true); collection?.onSelectAll(); }}>全部标签</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {crumbs.map(node => (
                        <DropdownMenuItem key={node.id} aria-current={node.id === (collection ? activeTag : directoryId) ? 'location' : undefined} className="min-w-0" onSelect={() => { browseTag(node.id, true); if (collection) onOpenTagDetails(node.id); }}>
                          <span className="min-w-0 whitespace-normal break-words" title={node.path}>{node.path}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button aria-current="location" className="min-w-0 shrink px-1 text-[11px]" size="sm" type="button" variant="plain" onClick={() => { browseTag(null, true); collection?.onSelectAll(); }}>全部标签</Button>
                )}
              </nav>
              {!collection ? <Button ref={searchButtonRef} aria-label="搜索标签" aria-expanded={showSearch} aria-controls={searchId} className="text-muted-foreground" size="icon-sm" title={query ? `搜索标签 · ${query}` : '搜索标签'} type="button" variant="ghost" onClick={() => { setSearchOpen(true); if (!open) onToggleOpen(); }}>
                <Search className="size-3" aria-hidden="true" />
              </Button> : null}
            </>
          )}
          {onEditTags ? <Button aria-label="编辑标签" className="text-muted-foreground" disabled={status !== 'ready'} size="icon-sm" title="编辑标签" type="button" variant="ghost" onClick={onEditTags}>
            <Pencil className="size-3" aria-hidden="true" />
          </Button> : null}
          <TagDisplaySettingsMenu navigation compact onCollapseAll={expansion.collapseAll} canCollapseAll={expansion.expandedIds.size > 0} />
        </div>
        {collection ? <div className="pb-2 pt-1">{collection.toolbar}</div> : null}
        {collection && !collection.panels ? <Button aria-label={open ? '收起标签选择' : '展开标签选择'} aria-expanded={open} aria-controls={bodyId} size="sm" variant="plain" className="h-7 w-full justify-start gap-1.5 px-1 text-[11px] font-normal text-muted-foreground" onClick={onToggleOpen}>
          {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          <span>标签选择</span><span className="ml-auto">{open ? '收起' : '展开'}</span>
        </Button> : null}
        {!collection?.panels ? parentNavigation : null}
      </div>
      {collection?.panels ? <SidebarPanelGroup>
        <SidebarPanel name="标签选择" label="标签选择" open={open} onToggle={onToggleOpen} toggleLabel={open ? '收起标签选择' : '展开标签选择'}>{tagBody}</SidebarPanel>
        {children}
      </SidebarPanelGroup> : <>{tagBody}{children}</>}
    </div>
  );
}
