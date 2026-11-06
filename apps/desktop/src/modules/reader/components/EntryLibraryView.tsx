import {
  CalendarDays,
  EyeOff,
  FilePlus2,
  Network,
  RefreshCw,
  Trash2
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState
} from 'react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { NoteTarget, TagMeta, TrashItem } from '@/shared/types/domain';
import { useToast } from '@/shared/hooks/useToast';
import { useLibraryReadingStates } from '../useLibraryReadingStates';

import type { LibraryEntry, LibraryView } from '../../library/components/LibrarySidebar';
import { getLibraryViewTitle } from '../../library/utils/libraryView';
import {
  buildTagPathById,
  buildTagTree,
  collectDescendantTagIds,
  flattenTagTree
} from '../../library/utils/tagTree';
import { EntryActionDialog } from './EntryActionDialog';
import { TrashItemsView } from './TrashItemsView';
import { WorkspaceTrashView } from './WorkspaceTrashView';
import { EmptyWorkspaceTrashButton } from './EmptyWorkspaceTrashButton';
import { LibraryHeading } from './LibraryHeading';
import { TagNotesList } from '@/modules/notes/components/TagNotesList';
import { CreateTagNoteButton } from '@/modules/notes/components/CreateTagNoteButton';
import { useWorkspaceNotes } from '@/modules/notes/WorkspaceNotesContext';
import type { EntryLibraryColumnId } from './useEntryLibraryColumnWidths';
import { ENTRY_LIBRARY_COLUMNS } from './LibraryPaperTable';
import { LibraryPapers } from './LibraryPapers';
import { LibraryTagNavigation } from './LibraryTagNavigation';
import { LibraryPaperToolbar, type PaperSource } from './LibraryPaperToolbar';
import { PointerPreview } from '@/components/ui/pointer-preview';
import { useBookOpening } from './book/BookOpeningProvider';
import { useLibraryEntryDrag } from './useLibraryEntryDrag';
import { buildTagBreadcrumb, filterEntries } from './libraryEntryFilters';
import { useAppearance } from '@/shared/components/AppearanceProvider';
import type { LibrarySourceCatalog } from '@/modules/library/useLibrarySourceCatalog';
import type { LibrarySourceSync } from '@/modules/import/useLibrarySourceSync';
import { isEntrySourceHidden, isSourceEntryVisible } from '@/modules/library/utils/sourceVisibility';
import type { PdfParseAction } from '@/modules/library/components/PdfParseButton';
import { useLibrarySelection } from './useLibrarySelection';
import { LibrarySelectionActions } from './LibrarySelectionActions';
import { defaultLibrarySortDirection, type LibraryEntrySort } from './libraryEntrySorting';

type EntryLibraryViewProps = {
  onApplyEntryTagPaths?: (entryId: string, paths: string[]) => Promise<unknown> | unknown;
  pdfParseAction?: PdfParseAction;
  librarySourceSync?: LibrarySourceSync;
  librarySourceCatalog?: LibrarySourceCatalog;
  onOpenDailyDashboard: () => void;
  section?: 'papers' | 'notes';
  onSectionChange?: (section: 'papers' | 'notes') => void;
  onUpdateTagDescription?: (id: string, value: string, expected: string) => Promise<TagMeta>;
  onOpenTagNote?: (target: NoteTarget, label: string) => void;
  onOpenTrash?: () => void;
  onRestoreTagArchive?: (id: string) => Promise<number>;
  onOpenRelations?: () => void;
  activeTag: string | null;
  entries: LibraryEntry[];
  trashedEntries: LibraryEntry[];
  trashItems: TrashItem[];
  isRefreshingParseStatus: boolean;
  libraryView: LibraryView;
  onSelectView: (view: LibraryView) => void;
  onClearFilters: () => void;
  onManageTags: () => void;
  filterResetKey: number;
  recentReadingEntryIds: string[];
  selectedEntryId: string | null;
  status: 'loading' | 'ready' | 'error';
  tags: TagMeta[];
  workspaceRoot: string | null;
  onDeleteEntry: (entryId: string) => Promise<void> | void;
  onOpenCreateEntryTab: () => void;
  onOpenEntryExplorer: (entryId: string, explicitContentId?: 'overview') => void;
  onOpenEntryInSidePane: (entryId: string) => void;
  onPurgeEntry: (entryId: string) => Promise<void> | void;
  onPurgeTrashItem: (entryId: string, trashId: string) => Promise<void> | void;
  onRefreshParseStatus: () => Promise<void> | void;
  onReparseEntry: (entryId: string) => Promise<void> | void;
  onRestoreEntry: (entryId: string) => Promise<void> | void;
  onRestoreTrashItem: (entryId: string, trashId: string) => Promise<void> | void;
  onSelectEntry: (id: string) => void;
  onSelectTag: (tag: string | null) => void;
  onUpdateEntry: (
    entryId: string,
    request: { fields: Record<string, string>; tagPaths: string[]; title: string }
  ) => Promise<unknown> | unknown;
  standalone?: boolean;
};

type EntryLibraryTagScope = 'direct' | 'descendants';
type EntryLibraryPinnedEdge = 'left' | 'right';
const ENTRY_LIBRARY_TAG_NAVIGATION_STORAGE_KEY = 'neuink.entryLibraryShowTagNavigation';
const ENTRY_LIBRARY_TAG_SCOPE_STORAGE_KEY = 'neuink.entryLibraryTagScope';
const ENTRY_LIBRARY_COLUMNS_STORAGE_KEY = 'neuink.entryLibraryColumns.v1';
export const ENTRY_LIBRARY_PINNED_EDGES_STORAGE_KEY = 'neuink.entryLibraryPinnedEdges.v1';
export function EntryLibraryView({
  onApplyEntryTagPaths,
  pdfParseAction,
  librarySourceSync,
  librarySourceCatalog,
  onOpenDailyDashboard,
  onOpenRelations,
  section: controlledSection, onSectionChange, onUpdateTagDescription, onOpenTagNote, onOpenTrash,
  onRestoreTagArchive,
  activeTag,
  entries,
  trashedEntries,
  trashItems,
  isRefreshingParseStatus,
  libraryView,
  onSelectView, onClearFilters, onManageTags,
  filterResetKey,
  recentReadingEntryIds,
  selectedEntryId,
  status,
  tags,
  workspaceRoot,
  onDeleteEntry,
  onOpenCreateEntryTab,
  onOpenEntryExplorer,
  onOpenEntryInSidePane,
  onPurgeEntry,
  onPurgeTrashItem,
  onRefreshParseStatus,
  onReparseEntry,
  onRestoreEntry,
  onRestoreTrashItem,
  onSelectEntry,
  onSelectTag,
  onUpdateEntry,
  standalone = false
}: EntryLibraryViewProps) {
  const { appearance, libraryDisplay } = useAppearance();
  const [localSection, setLocalSection] = useState<'papers' | 'notes'>('papers');
  const notesModel = useWorkspaceNotes();
  const section = activeTag && tags.some(tag => tag.id === activeTag) && libraryView !== 'trash' ? controlledSection ?? localSection : 'papers';
  const changeSection = (value: string) => { if (value !== 'papers' && value !== 'notes') return; if (onSectionChange) onSectionChange(value); else setLocalSection(value); };
  useEffect(() => setLocalSection('papers'), [activeTag]);
  const noteCount = notesModel && !notesModel.loading && !notesModel.error ? notesModel.catalog.notes.filter(note => !note.deleted_at && note.target.owner.kind === 'tag_reading' && note.target.owner.tag_id === activeTag).length : null;
  const [query, setQuery] = useState('');
  const [explicitSort, setSort] = useState<LibraryEntrySort | null>(null);
  const sort: LibraryEntrySort = explicitSort ?? { by: libraryView === 'recent' ? 'recent' : 'created', direction: 'desc' };
  const { by: sortBy, direction: sortDirection } = sort;
  const [sourceFilter, setSourceFilter] = useState<PaperSource>('all');
  const entrySources = librarySourceCatalog?.sources ?? {};
  const enabledSources = librarySourceSync?.enabledSources ?? { zotero: true, mineru: true };
  const selectedSource = (sourceFilter === 'zotero' && !enabledSources.zotero) || (sourceFilter === 'mineru' && !enabledSources.mineru) ? 'all' : sourceFilter;
  const [hidingEntryId, setHidingEntryId] = useState<string | null>(null);
  const sourceAvailable = libraryView !== 'trash' && status === 'ready' && Boolean(workspaceRoot);
  const isHiddenView = libraryView === 'hidden';
  useEffect(() => setSourceFilter('all'), [workspaceRoot, filterResetKey]);
  useEffect(() => {
    if ((sourceFilter === 'zotero' && !enabledSources.zotero) || (sourceFilter === 'mineru' && !enabledSources.mineru)) setSourceFilter('all');
  }, [sourceFilter, enabledSources.zotero, enabledSources.mineru]);
  const [showTagNavigation, setShowTagNavigation] = useState(readStoredShowTagNavigation);
  const [tagScope, setTagScope] = useState<EntryLibraryTagScope>(readStoredEntryLibraryTagScope);
  const [visibleColumns, setVisibleColumns] = useState<Set<EntryLibraryColumnId>>(readStoredEntryLibraryColumns);
  const [pinnedEdges, setPinnedEdges] = useState<Set<EntryLibraryPinnedEdge>>(readStoredEntryLibraryPinnedEdges);
  const { states: readingStates } = useLibraryReadingStates(workspaceRoot, libraryView !== 'trash');
  const [dialog, setDialog] = useState<{ action: 'move-to-trash' | 'purge'; entry: LibraryEntry } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const { draggingEntryId, entryDragPreview, entryDragHandlers, consumeDragClick } = useLibraryEntryDrag(
    `${workspaceRoot}:${activeTag}:${libraryView}:${section}:${status}:${appearance}:${libraryDisplay}`
  );
  const { notify } = useToast();
  const isTrashView = libraryView === 'trash';
  useEffect(() => {
    setQuery('');
    setSort(null);
  }, [filterResetKey]);
  const visibleEntries = isTrashView ? trashedEntries : entries;
  const activeTagIds = useMemo(
    () => (activeTag ? tagScope === 'descendants' ? collectDescendantTagIds(tags, activeTag) : new Set([activeTag]) : null),
    [activeTag, tagScope, tags]
  );
  const entriesInCurrentView = useMemo(
    () => filterEntries(visibleEntries.filter(item => isSourceEntryVisible(entrySources[item.id], enabledSources)), libraryView, null, '', 'recent', recentReadingEntryIds, readingStates),
    [libraryView, readingStates, recentReadingEntryIds, visibleEntries, entrySources, enabledSources.zotero, enabledSources.mineru]
  );
  const externalEntryIds = useMemo(() => new Set(Object.entries(entrySources).filter(([, source]) => source.kinds.length > 0).map(([id]) => id)), [entrySources]);
  const hiddenEntryCount = entries.filter(item => isEntrySourceHidden(entrySources[item.id]) && isSourceEntryVisible(entrySources[item.id], enabledSources)).length;
  const sourceKindsByEntry = useMemo(() => Object.fromEntries(Object.entries(entrySources).map(([id, source]) => [id, source.kinds.filter(kind => enabledSources[kind])])), [entrySources, enabledSources.zotero, enabledSources.mineru]);
  const sourceHiddenByEntry = useMemo(() => Object.fromEntries(Object.entries(entrySources).map(([id, source]) => [id, isEntrySourceHidden(source)])), [entrySources]);
  const filteredEntries = useMemo(
    () => filterEntries(entriesInCurrentView.filter(item => {
        const source = entrySources[item.id];
        if (isHiddenView) return isEntrySourceHidden(source);
        if (isEntrySourceHidden(source)) return false;
        return !sourceAvailable || selectedSource === 'all' || (selectedSource === 'local' ? !source?.kinds.length : source?.kinds.includes(selectedSource));
      }),
      libraryView, activeTagIds, query, sortBy, recentReadingEntryIds, readingStates, { direction: sortDirection, sourceKindsByEntry }),
    [activeTagIds, entriesInCurrentView, libraryView, query, readingStates, recentReadingEntryIds, sortBy, sortDirection, sourceKindsByEntry, sourceAvailable, selectedSource, entrySources, isHiddenView]
  );
  const selectionContext = JSON.stringify([workspaceRoot, activeTag, libraryView, section, status, filterResetKey]);
  const selection = useLibrarySelection(selectionContext, JSON.stringify([query, selectedSource, tagScope]), filteredEntries);
  const tagTree = useMemo(() => buildTagTree(tags, entriesInCurrentView.filter(item => isEntrySourceHidden(entrySources[item.id]) === isHiddenView)), [entriesInCurrentView, tags, entrySources, isHiddenView]);
  const currentFolderNode = useMemo(
    () => activeTag ? flattenTagTree(tagTree).find(node => node.id === activeTag) ?? null : null,
    [activeTag, tagTree]
  );
  const visibleFolderNodes = activeTag ? currentFolderNode?.children ?? [] : tagTree;
  const folderBreadcrumb = useMemo(() => buildTagBreadcrumb(tags, activeTag), [activeTag, tags]);
  const activeJobs = entries.filter((item) => ['Queued', 'Uploading', 'Parsing'].includes(item.status)).length;
  const sourceAlertCount = (librarySourceSync?.changes.length ?? 0) + (librarySourceSync?.issues.length ?? 0) + (librarySourceSync?.error ? 1 : 0) + (librarySourceSync?.truncated ? 1 : 0);
  const activeTagMeta = !isTrashView && activeTag ? tags.find((tag) => tag.id === activeTag) : null;
  const viewTitle = getLibraryViewTitle(libraryView);
  const pageTitle = !isTrashView && activeTag
    ? activeTagMeta?.name ?? (status === 'loading' ? '正在加载标签…' : '标签不可用')
    : viewTitle;
  const pageSummary = [
    status === 'loading' ? '正在加载…' : status === 'error' ? '加载失败' : isTrashView
      ? '条目、标签与笔记'
      : `${query.trim() ? '搜索结果：' : ''}${filteredEntries.length} 个条目`,
    activeTagMeta
      ? tagScope === 'descendants' ? '含子标签' : '仅当前标签'
      : null
  ].filter(Boolean).join(' · ');

  const toggleColumn = (columnId: EntryLibraryColumnId, visible: boolean) => {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (visible) {
        next.add(columnId);
      } else if (next.size > 1) {
        next.delete(columnId);
      }
      window.localStorage.setItem(ENTRY_LIBRARY_COLUMNS_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const confirmEntryAction = async () => {
    if (!dialog) {
      return;
    }
    setActionBusy(true);
    try {
      if (dialog.action === 'purge') {
        await onPurgeEntry(dialog.entry.id);
      } else {
        await onDeleteEntry(dialog.entry.id);
      }
      setDialog(null);
    } catch {
      // The workspace hook owns the user-facing error state.
    } finally {
      setActionBusy(false);
    }
  };

  const beginBookOpening = useBookOpening();
  const openEntry = (entryId: string, element?: HTMLElement) => {
    const entry = entries.find(value => value.id === entryId);
    const source = element?.querySelector<HTMLElement>('.library-book-standing, .library-book');
    if (appearance === 'atelier' && libraryDisplay !== 'list' && entry && source) {
      beginBookOpening(entry, source, () => { onSelectEntry(entryId); onOpenEntryExplorer(entryId); });
      return;
    }
    onSelectEntry(entryId);
    onOpenEntryExplorer(entryId);
  };

  const changeShowTagNavigation = (shown: boolean) => {
    setShowTagNavigation(shown);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ENTRY_LIBRARY_TAG_NAVIGATION_STORAGE_KEY, String(shown));
    }
  };

  const togglePinnedEdge = (edge: EntryLibraryPinnedEdge, pinned: boolean) => {
    setPinnedEdges((current) => {
      const next = new Set(current);
      if (pinned) next.add(edge);
      else next.delete(edge);
      window.localStorage.setItem(ENTRY_LIBRARY_PINNED_EDGES_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const changeTagScope = (nextScope: EntryLibraryTagScope) => {
    setTagScope(nextScope);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ENTRY_LIBRARY_TAG_SCOPE_STORAGE_KEY, nextScope);
    }
  };

  const assignEntryToTag = async (entryId: string, tagPath: string) => {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry || entry.tags.includes(tagPath)) {
      return;
    }
    try {
      await onUpdateEntry(entry.id, {
        fields: entry.fields,
        tagPaths: [...entry.tags, tagPath],
        title: entry.title
      });
      notify({
        tone: 'success',
        title: '标签已添加',
        description: `已将“${entry.title}”添加到“${tagPath}”。`
      });
    } catch (error) {
      notify({
        tone: 'danger',
        title: '添加标签失败',
        description: error instanceof Error ? error.message : `无法将“${entry.title}”添加到“${tagPath}”。`
      });
    }
  };

  const toggleSourceHidden = async (entry: LibraryEntry) => {
    if (!workspaceRoot || hidingEntryId) return;
    const hidden = !isEntrySourceHidden(entrySources[entry.id]);
    setHidingEntryId(entry.id);
    try {
      if (!librarySourceCatalog) return;
      await librarySourceCatalog.setHidden(entry.id, hidden);
      notify({ tone: 'success', title: hidden ? '已隐藏来源论文' : '已恢复显示', description: hidden ? '本地副本保留，可通过“已隐藏”查看并恢复。' : entry.title,
        action: hidden ? <Button size="xs" variant="outline" onClick={() => onSelectView('hidden')}>查看已隐藏</Button> : undefined });
    } catch (caught) {
      notify({ tone: 'danger', title: '保存显示状态失败', description: String(caught) });
    } finally { setHidingEntryId(null); }
  };

  const content = (
    <>
      <Tabs value={section} onValueChange={changeSection} onKeyDown={selection.onKeyDown} data-material="library-workspace" className="h-full min-h-0 min-w-0 gap-0 overflow-hidden bg-card">
          <LibraryHeading title={pageTitle} summary={pageSummary} tag={activeTagMeta} ancestors={folderBreadcrumb.slice(0, -1)} workspaceRoot={workspaceRoot}
            hasTagContext={!isTrashView && Boolean(activeTag)} view={libraryView} onSelectView={onSelectView} onClearFilters={onClearFilters} onManageTags={onManageTags}
            disabled={status !== 'ready'} onNavigate={onSelectTag} onDescription={onUpdateTagDescription}
            actions={isTrashView ? <EmptyWorkspaceTrashButton root={workspaceRoot} externalIds={externalEntryIds}
              onPurgeEntry={onPurgeEntry} onPurgeItem={onPurgeTrashItem} /> : <>
              {(enabledSources.zotero || enabledSources.mineru) && <Button size="default" variant={isHiddenView ? 'secondary' : 'ghost'} className="gap-1.5 text-xs" aria-label={`已隐藏 ${hiddenEntryCount}`} onClick={() => onSelectView('hidden')}>
                <EyeOff size={14} aria-hidden="true" />已隐藏{hiddenEntryCount > 0 ? ` ${hiddenEntryCount}` : ''}
              </Button>}
              {activeTagMeta ? <TabsList aria-label="标签内容" className="shrink-0">
                <TabsTrigger value="papers" className="px-2 text-xs">论文</TabsTrigger>
                <TabsTrigger value="notes" className="px-2 text-xs" disabled={!onOpenTagNote}>标签笔记{noteCount === null ? '' : ` ${noteCount}`}</TabsTrigger>
              </TabsList> : null}
              {onOpenRelations ? <Button size="default" variant="ghost" aria-label="关系图" title="关系图" className="gap-1.5 text-xs text-muted-foreground @max-[900px]/library-heading:w-8 @max-[900px]/library-heading:px-0" onClick={onOpenRelations}><Network size={14} aria-hidden="true" /><span className="@max-[900px]/library-heading:hidden">关系图</span></Button> : null}
              {librarySourceSync && <Button size="default" variant="ghost" aria-label={sourceAlertCount ? `查看 ${sourceAlertCount} 项来源动态` : '检查 Zotero 和 MinerU 来源'} title="检查 Zotero 和 MinerU 来源" disabled={librarySourceSync.running} className="gap-1.5 text-xs text-muted-foreground @max-[900px]/library-heading:w-8 @max-[900px]/library-heading:px-0" onClick={sourceAlertCount && librarySourceSync.review ? librarySourceSync.review : librarySourceSync.refresh}><RefreshCw size={14} className={librarySourceSync.running ? 'animate-spin' : undefined} aria-hidden="true" /><span className="@max-[900px]/library-heading:hidden">{sourceAlertCount ? `来源动态 ${sourceAlertCount}` : '检查来源'}</span></Button>}
              <Button size="default" aria-label="阅读统计" title="在每日看板查看全资料库阅读统计" variant="ghost"
                className="gap-1.5 text-xs text-muted-foreground @max-[900px]/library-heading:w-8 @max-[900px]/library-heading:px-0"
                onClick={onOpenDailyDashboard}>
                <CalendarDays size={14} aria-hidden="true" />
                <span className="@max-[900px]/library-heading:hidden">阅读统计</span>
              </Button>
              <div hidden={section !== 'papers'}>
                <Button size="default" aria-label="创建条目" title="创建条目" className="gap-1.5 text-xs" onClick={onOpenCreateEntryTab}><FilePlus2 size={14} aria-hidden="true" /><span>创建条目</span></Button>
              </div>
              {activeTagMeta && onOpenTagNote ? <div hidden={section !== 'notes'}>
                <CreateTagNoteButton key={`${workspaceRoot}:${activeTagMeta.id}`} tagId={activeTagMeta.id} tagLabel={folderBreadcrumb.map(tag => tag.name).join(' / ')} scope={`library/tag:${activeTagMeta.id}`} disabled={status !== 'ready'} onOpen={onOpenTagNote} />
              </div> : null}
            </>} />
          <TabsContent forceMount value="papers" aria-hidden={section !== 'papers' || undefined} className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden">
            {librarySourceCatalog?.error && !isTrashView ? <div role="alert" className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs text-destructive">
              <span>来源信息读取失败，可能导致隐藏和恢复操作不可用。</span>{librarySourceCatalog.reload && <Button size="xs" variant="outline" onClick={librarySourceCatalog.reload}>重试读取来源</Button>}
            </div> : null}
            {!isTrashView && showTagNavigation && status === 'ready' ? <LibraryTagNavigation
              key={activeTag ?? 'root'} nested={Boolean(activeTag)} nodes={visibleFolderNodes}
              onOpen={onSelectTag} onAssignEntryToTag={assignEntryToTag} /> : null}
            {!isTrashView ? <LibraryPaperToolbar query={query} sortBy={sortBy} sortDirection={sortDirection}
              recentOrderAvailable={libraryView === 'recent'}
              onSortDirectionChange={direction => setSort({ by: sortBy, direction })}
              selectionActions={<LibrarySelectionActions active={selection.enabled && !isTrashView && section === 'papers'} context={selectionContext}
              selected={filteredEntries.filter(entry => selection.ids.has(entry.id)).map(entry => ({ ...entry, sourceInfo: entrySources[entry.id] ?? entry.sourceInfo }))}
              total={filteredEntries.length} hidden={isHiddenView} sourceUnavailable={Boolean(librarySourceCatalog?.loading || librarySourceCatalog?.error)}
              tagPaths={[...buildTagPathById(tags).values()]} onClear={selection.clear} onSelectAll={selection.toggleAll} onComplete={selection.remove}
              onDelete={onDeleteEntry} onSetHidden={workspaceRoot ? librarySourceCatalog?.setHidden : undefined} onAddTags={onApplyEntryTagPaths} />}
              selection={{ enabled: selection.enabled, disabled: status !== 'ready', onToggle: selection.enabled ? selection.exit : selection.enter }}
              sourceFilter={sourceAvailable && !isHiddenView ? { value: selectedSource, onChange: setSourceFilter, enabledSources, loading: librarySourceCatalog?.loading ?? false } : undefined}
              scope={activeTagMeta ? tagScope : null}
              visibleColumns={visibleColumns} pinnedEdges={pinnedEdges}
              tagNavigation={{ shown: showTagNavigation, disabled: status !== 'ready', onShownChange: changeShowTagNavigation }}
              onQueryChange={setQuery} onSortChange={by => setSort({ by, direction: defaultLibrarySortDirection(by) })} onColumnChange={toggleColumn} onPinChange={togglePinnedEdge}
              onScopeChange={changeTagScope}
              refresh={libraryView === 'parsing' ? { busy: isRefreshingParseStatus, disabled: activeJobs === 0, onRefresh: () => void onRefreshParseStatus() } : undefined} /> : null}

            {librarySourceSync?.running && <p role="status" className="border-b border-border px-4 py-1 text-xs text-muted-foreground">{librarySourceSync.current || '正在检查来源'} · {librarySourceSync.completed}/{librarySourceSync.total}</p>}

          {isTrashView ? (
            onRestoreTagArchive ? <WorkspaceTrashView root={workspaceRoot} tags={tags} items={trashItems} onRestoreTag={onRestoreTagArchive}
              onPurgeEntry={onPurgeEntry} onPurgeItem={onPurgeTrashItem} onRestoreEntry={onRestoreEntry} onRestoreItem={onRestoreTrashItem} /> :
            <div className="p-3">
              <TrashItemsView
                fixedHeight
                items={trashItems}
                onPurgeEntry={onPurgeEntry}
                onPurgeItem={onPurgeTrashItem}
                onRestoreEntry={onRestoreEntry}
                onRestoreItem={onRestoreTrashItem}
              />
            </div>
          ) : <>
            <LibraryPapers active={section === 'papers'} entries={filteredEntries} status={status}
              sort={sort} onSortChange={setSort}
              selection={selection.enabled ? selection : undefined}
              deleteDisabled={Boolean(librarySourceCatalog?.loading || librarySourceCatalog?.error)}
              sourceKindsByEntry={sourceKindsByEntry}
              sourceChangedEntryIds={new Set(librarySourceSync?.changedEntryIds ?? [])}
              onReviewSourceChanges={librarySourceSync?.review}
              externalEntryIds={externalEntryIds} sourceHiddenByEntry={sourceHiddenByEntry} onToggleSourceHidden={entry => void toggleSourceHidden(entry)}
              pdfParseAction={pdfParseAction}
              emptyMessage={isHiddenView ? '当前标签下没有已隐藏的来源论文。' : activeTag && !activeTagMeta
                ? '当前标签已移入回收站或不可用。返回全部条目或打开回收站继续。'
                : query.trim() ? '没有符合当前筛选条件的条目。'
                : activeTag && tagScope === 'direct' ? '还没有论文直接归入当前标签。可以切换到“含子标签”查看下级论文。'
                : activeTag ? '当前标签及其子标签中还没有论文。可将论文拖到标签上增加归属。'
                : '没有符合当前筛选条件的条目。'}
              readingStates={readingStates} selectedEntryId={selectedEntryId} draggingEntryId={draggingEntryId}
              onSelect={id => { selection.ensureSelected(id); onSelectEntry(id); }}
              visibleColumns={visibleColumns} pinnedEdges={pinnedEdges} reparseDisabled={activeJobs > 0}
              getRowProps={item => ({
                ...(!selection.enabled ? entryDragHandlers(item) : {}),
                onClick: event => {
                  if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"], [role="menuitem"], [data-allow-context-menu="true"][role="menu"]')) return;
                  if (!consumeDragClick()) { if (selection.enabled) selection.toggle(item.id, event.shiftKey); onSelectEntry(item.id); }
                },
                onDoubleClick: event => {
                  if (selection.enabled) return;
                  if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"], [role="menuitem"]')) return;
                  if (!consumeDragClick()) openEntry(item.id, event.currentTarget);
                },
                onKeyDown: event => {
                  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault(); if (selection.enabled) selection.toggle(item.id, event.shiftKey); else openEntry(item.id, event.currentTarget);
                  }
                }
              })}
              onRead={entryId => openEntry(entryId)}
              onOpen={entryId => { onSelectEntry(entryId); onOpenEntryExplorer(entryId, 'overview'); }} onOpenInSidePane={onOpenEntryInSidePane}
              onDelete={item => { if (externalEntryIds.has(item.id) || item.sourceInfo?.kinds.length) void toggleSourceHidden(item); else setDialog({ action: 'move-to-trash', entry: item }); }}
              onReparse={item => {
                void Promise.resolve(onReparseEntry(item.id)).then(() => notify({
                  title: '已重新提交解析', description: `${item.title} 已重新加入解析队列，解析结果会覆盖现有内容。`
                })).catch(() => undefined);
              }} />
          </> }
          </TabsContent>
          {activeTagMeta && onOpenTagNote ? <TabsContent forceMount value="notes" aria-hidden={section !== 'notes' || undefined} className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden">
            <TagNotesList key={`${workspaceRoot}:${activeTagMeta.id}`} tagId={activeTagMeta.id} scope={`library/tag:${activeTagMeta.id}`} onOpen={onOpenTagNote} hideCreateAction />
          </TabsContent> : null}
          {activeTag && !activeTagMeta && status === 'ready' && !isTrashView ? <div className="flex shrink-0 gap-2 border-t p-3"><Button size="sm" variant="outline" onClick={() => onSelectTag(null)}>返回全部条目</Button>{onOpenTrash ? <Button size="sm" variant="ghost" onClick={onOpenTrash}>打开回收站</Button> : null}</div> : null}
      </Tabs>
      <EntryActionDialog
        action={dialog?.action ?? 'move-to-trash'}
        busy={actionBusy}
        entry={dialog?.entry ?? null}
        workspaceRoot={workspaceRoot}
        onConfirm={() => void confirmEntryAction()}
        onOpenChange={(open) => {
          if (!open && !actionBusy) {
            setDialog(null);
          }
        }}
      />
      {entryDragPreview ? <PointerPreview aria-hidden="true" data-entry-tag-drag-preview="true"
        anchor={{ x: entryDragPreview.x, top: entryDragPreview.y, bottom: entryDragPreview.y }} width={260}
        className="flex h-8 items-center px-2.5 py-1 text-xs font-medium">
        <span className="truncate">{entryDragPreview.title}</span>
      </PointerPreview> : null}
    </>
  );

  if (standalone) {
    return <div className={cn('h-full min-h-0 min-w-0', isTrashView ? 'overflow-auto' : 'overflow-hidden')}>{content}</div>;
  }

  return (
    <TabsContent className="m-0 h-full min-h-0 min-w-0" value="library">
      {content}
    </TabsContent>
  );
}

function readStoredShowTagNavigation(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage.getItem(ENTRY_LIBRARY_TAG_NAVIGATION_STORAGE_KEY);
  if (stored === 'true' || stored === 'false') return stored === 'true';
  // Preserve the previous display preference until the user changes the toggle.
  return window.localStorage.getItem('neuink.entryLibraryLayout') === 'tag-folders';
}

function readStoredEntryLibraryTagScope(): EntryLibraryTagScope {
  if (typeof window === 'undefined') {
    return 'descendants';
  }
  return window.localStorage.getItem(ENTRY_LIBRARY_TAG_SCOPE_STORAGE_KEY) === 'direct'
    ? 'direct'
    : 'descendants';
}

function readStoredEntryLibraryColumns() {
  const defaults = new Set(ENTRY_LIBRARY_COLUMNS.map((column) => column.id));
  if (typeof window === 'undefined') {
    return defaults;
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(ENTRY_LIBRARY_COLUMNS_STORAGE_KEY) ?? 'null');
    if (!Array.isArray(stored)) {
      return defaults;
    }
    const validIds = new Set(ENTRY_LIBRARY_COLUMNS.map((column) => column.id));
    const selected = stored.filter((value): value is EntryLibraryColumnId => validIds.has(value));
    if (selected.length > 0 && !window.localStorage.getItem('neuink.entryLibrarySourceColumnMigrated.v1')) {
      if (!selected.includes('source')) selected.splice(1, 0, 'source');
      window.localStorage.setItem('neuink.entryLibrarySourceColumnMigrated.v1', '1');
      window.localStorage.setItem(ENTRY_LIBRARY_COLUMNS_STORAGE_KEY, JSON.stringify(selected));
    }
    return selected.length > 0 ? new Set(selected) : defaults;
  } catch {
    return defaults;
  }
}

function readStoredEntryLibraryPinnedEdges() {
  const defaults = new Set<EntryLibraryPinnedEdge>(['left', 'right']);
  if (typeof window === 'undefined') return defaults;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(ENTRY_LIBRARY_PINNED_EDGES_STORAGE_KEY) ?? 'null'
    );
    if (!Array.isArray(stored)) return defaults;
    return new Set(
      stored.filter((value): value is EntryLibraryPinnedEdge => value === 'left' || value === 'right')
    );
  } catch {
    return defaults;
  }
}
