import {
  AlertTriangle,
  FilePlus2,
  Network,
  Trash2
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState
} from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { NoteTarget, TagMeta, TrashItem } from '@/shared/types/domain';
import { useToast } from '@/shared/hooks/useToast';
import { useLibraryReadingStates } from '../useLibraryReadingStates';

import type { LibraryEntry, LibraryView } from '../../library/components/LibrarySidebar';
import { getLibraryViewTitle } from '../../library/utils/libraryView';
import {
  buildTagTree,
  collectDescendantTagIds,
  flattenTagTree
} from '../../library/utils/tagTree';
import { EntryActionDialog } from './EntryActionDialog';
import { TrashItemsView } from './TrashItemsView';
import { WorkspaceTrashView } from './WorkspaceTrashView';
import { LibraryHeading } from './LibraryHeading';
import { TagNotesList } from '@/modules/notes/components/TagNotesList';
import { CreateTagNoteButton } from '@/modules/notes/components/CreateTagNoteButton';
import { useWorkspaceNotes } from '@/modules/notes/WorkspaceNotesContext';
import type { EntryLibraryColumnId } from './useEntryLibraryColumnWidths';
import { ENTRY_LIBRARY_COLUMNS } from './LibraryPaperTable';
import { LibraryPapers } from './LibraryPapers';
import { LibraryTagNavigation } from './LibraryTagNavigation';
import { LibraryPaperToolbar } from './LibraryPaperToolbar';
import { PointerPreview } from '@/components/ui/pointer-preview';
import { useLibraryEntryDrag } from './useLibraryEntryDrag';
import { buildReadingOverview } from './libraryReading';
import { ReadingOverviewPopover } from './ReadingOverviewPopover';
import { buildTagBreadcrumb, filterEntries } from './libraryEntryFilters';
import { useAppearance } from '@/shared/components/AppearanceProvider';

type EntryLibraryViewProps = {
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
  onOpenRelations,
  section: controlledSection, onSectionChange, onUpdateTagDescription, onOpenTagNote, onOpenTrash,
  onRestoreTagArchive,
  activeTag,
  entries,
  trashedEntries,
  trashItems,
  isRefreshingParseStatus,
  libraryView,
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
  const [sortBy, setSortBy] = useState('recent');
  const [rootScope, setRootScope] = useState<'all' | 'unclassified'>('all');
  useEffect(() => setRootScope('all'), [activeTag, libraryView, workspaceRoot, filterResetKey]);
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
  const [emptyTrashConfirmOpen, setEmptyTrashConfirmOpen] = useState(false);
  const [emptyTrashBusy, setEmptyTrashBusy] = useState(false);
  const { notify } = useToast();
  const isTrashView = libraryView === 'trash';
  useEffect(() => {
    setQuery('');
    setSortBy('recent');
  }, [filterResetKey]);
  const visibleEntries = isTrashView ? trashedEntries : entries;
  const activeTagIds = useMemo(
    () => (activeTag ? tagScope === 'descendants' ? collectDescendantTagIds(tags, activeTag) : new Set([activeTag]) : null),
    [activeTag, tagScope, tags]
  );
  const entriesInCurrentView = useMemo(
    () => filterEntries(visibleEntries, libraryView, null, '', 'recent', recentReadingEntryIds, readingStates),
    [libraryView, readingStates, recentReadingEntryIds, visibleEntries]
  );
  const unclassifiedEntries = useMemo(() => entriesInCurrentView.filter(item => item.tagIds.length === 0), [entriesInCurrentView]);
  const filteredEntries = useMemo(
    () => filterEntries(!activeTag && rootScope === 'unclassified' ? unclassifiedEntries : entriesInCurrentView,
      libraryView, activeTagIds, query, sortBy, recentReadingEntryIds, readingStates),
    [activeTag, activeTagIds, entriesInCurrentView, libraryView, query, readingStates, recentReadingEntryIds, rootScope, sortBy, unclassifiedEntries]
  );
  const tagTree = useMemo(() => buildTagTree(tags, entriesInCurrentView), [entriesInCurrentView, tags]);
  const currentFolderNode = useMemo(
    () => activeTag ? flattenTagTree(tagTree).find(node => node.id === activeTag) ?? null : null,
    [activeTag, tagTree]
  );
  const visibleFolderNodes = activeTag ? currentFolderNode?.children ?? [] : tagTree;
  const folderBreadcrumb = useMemo(() => buildTagBreadcrumb(tags, activeTag), [activeTag, tags]);
  const activeJobs = entries.filter((item) => ['Queued', 'Uploading', 'Parsing'].includes(item.status)).length;
  const activeTagMeta = !isTrashView && activeTag ? tags.find((tag) => tag.id === activeTag) : null;
  const viewTitle = getLibraryViewTitle(libraryView);
  const pageTitle = !isTrashView && activeTag
    ? activeTagMeta?.name ?? (status === 'loading' ? '正在加载标签…' : '标签不可用')
    : viewTitle;
  const pageSummary = [
    activeTagMeta && libraryView !== 'all' ? viewTitle : null,
    status === 'loading' ? '正在加载…' : status === 'error' ? '加载失败' : isTrashView
      ? `${trashItems.length} 个项目`
      : `${query.trim() ? '搜索结果：' : ''}${filteredEntries.length} 个条目`,
    !isTrashView && !activeTag && rootScope === 'unclassified' ? '未分类' : null,
    activeTagMeta
      ? tagScope === 'descendants' ? '含子标签' : '仅当前标签'
      : null
  ].filter(Boolean).join(' · ');
  const readingOverview = useMemo(
    () => buildReadingOverview(filteredEntries, readingStates),
    [filteredEntries, readingStates]
  );

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

  const confirmEmptyTrash = async () => {
    if (trashItems.length === 0) {
      setEmptyTrashConfirmOpen(false);
      return;
    }
    setEmptyTrashBusy(true);
    try {
      for (const item of trashItems.filter((item) => item.kind === 'entry')) {
        await onPurgeEntry(item.entry_id);
      }
      for (const item of trashItems.filter((item) => item.kind !== 'entry' && item.restorable)) {
        await onPurgeTrashItem(item.entry_id, item.trash_id);
      }
      setEmptyTrashConfirmOpen(false);
    } catch {
      // The workspace hook owns the user-facing error state.
    } finally {
      setEmptyTrashBusy(false);
    }
  };

  const openEntry = (entryId: string) => {
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

  const content = (
    <>
      <Tabs value={section} onValueChange={changeSection} data-material="library-workspace" className="h-full min-h-0 min-w-0 gap-0 overflow-hidden bg-card">
          <LibraryHeading title={pageTitle} summary={pageSummary} tag={activeTagMeta} ancestors={folderBreadcrumb.slice(0, -1)} workspaceRoot={workspaceRoot}
            disabled={status !== 'ready'} onNavigate={onSelectTag} onDescription={onUpdateTagDescription}
            actions={isTrashView ? <Button disabled={!trashItems.length || emptyTrashBusy} size="default" variant="destructive" onClick={() => setEmptyTrashConfirmOpen(true)}>清空条目与记录</Button> : <>
              {activeTagMeta ? <TabsList aria-label="标签内容" className="shrink-0">
                <TabsTrigger value="papers" className="px-2 text-xs">论文</TabsTrigger>
                <TabsTrigger value="notes" className="px-2 text-xs" disabled={!onOpenTagNote}>标签笔记{noteCount === null ? '' : ` ${noteCount}`}</TabsTrigger>
              </TabsList> : null}
              {onOpenRelations ? <Button size="default" variant="outline" aria-label="关系图" title="关系图" className="@max-[700px]/library-heading:w-8 @max-[700px]/library-heading:px-0" onClick={onOpenRelations}><Network size={14} aria-hidden="true" /><span className="@max-[700px]/library-heading:hidden">关系图</span></Button> : null}
              <ReadingOverviewPopover overview={readingOverview} />
              <div hidden={section !== 'papers'}>
                <Button size="default" aria-label="创建条目" title="创建条目" className="@max-[700px]/library-heading:w-8 @max-[700px]/library-heading:px-0" onClick={onOpenCreateEntryTab}><FilePlus2 size={14} aria-hidden="true" /><span className="@max-[700px]/library-heading:hidden">创建条目</span></Button>
              </div>
              {activeTagMeta && onOpenTagNote ? <div hidden={section !== 'notes'}>
                <CreateTagNoteButton key={`${workspaceRoot}:${activeTagMeta.id}`} tagId={activeTagMeta.id} tagLabel={folderBreadcrumb.map(tag => tag.name).join(' / ')} scope={`library/tag:${activeTagMeta.id}`} disabled={status !== 'ready'} onOpen={onOpenTagNote} className="@max-[700px]/library-heading:w-8 @max-[700px]/library-heading:px-0" />
              </div> : null}
            </>} />
          <TabsContent forceMount value="papers" aria-hidden={section !== 'papers' || undefined} className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden">
            {!isTrashView && showTagNavigation && status === 'ready' ? <LibraryTagNavigation
              key={activeTag ?? 'root'} nested={Boolean(activeTag)} nodes={visibleFolderNodes}
              onOpen={onSelectTag} onAssignEntryToTag={assignEntryToTag} /> : null}
            {!isTrashView ? <LibraryPaperToolbar query={query} sortBy={sortBy}
              scope={activeTagMeta ? tagScope : !activeTag ? rootScope : null}
              unclassifiedCount={status === 'ready' ? unclassifiedEntries.length : null}
              visibleColumns={visibleColumns} pinnedEdges={pinnedEdges}
              tagNavigation={{ shown: showTagNavigation, disabled: status !== 'ready', onShownChange: changeShowTagNavigation }}
              onQueryChange={setQuery} onSortChange={setSortBy} onColumnChange={toggleColumn} onPinChange={togglePinnedEdge}
              onScopeChange={value => {
                if (value === 'direct' || value === 'descendants') changeTagScope(value);
                else setRootScope(value);
              }}
              refresh={libraryView === 'parsing' ? { busy: isRefreshingParseStatus, disabled: activeJobs === 0, onRefresh: () => void onRefreshParseStatus() } : undefined} /> : null}

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
              emptyMessage={activeTag && !activeTagMeta
                ? '当前标签已移入回收站或不可用。返回全部条目或打开回收站继续。'
                : query.trim() ? '没有符合当前筛选条件的条目。'
                : !activeTag && rootScope === 'unclassified' ? '当前范围内没有未分类论文。'
                : activeTag && tagScope === 'direct' ? '还没有论文直接归入当前标签。可以切换到“含子标签”查看下级论文。'
                : activeTag ? '当前标签及其子标签中还没有论文。可将论文拖到标签上增加归属。'
                : '没有符合当前筛选条件的条目。'}
              readingStates={readingStates} selectedEntryId={selectedEntryId} draggingEntryId={draggingEntryId}
              visibleColumns={visibleColumns} pinnedEdges={pinnedEdges} reparseDisabled={activeJobs > 0}
              getRowProps={item => ({
                ...entryDragHandlers(item),
                onClick: () => { if (!consumeDragClick()) openEntry(item.id); },
                onContextMenu: () => onSelectEntry(item.id),
                onKeyDown: event => {
                  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault(); openEntry(item.id);
                  }
                }
              })}
              onOpen={entryId => { onSelectEntry(entryId); onOpenEntryExplorer(entryId, 'overview'); }} onOpenInSidePane={onOpenEntryInSidePane}
              onDelete={item => setDialog({ action: 'move-to-trash', entry: item })}
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
      <Dialog open={emptyTrashConfirmOpen} onOpenChange={(open) => {
        if (!open && !emptyTrashBusy) {
          setEmptyTrashConfirmOpen(false);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} aria-hidden="true" />
              清空条目与记录
            </DialogTitle>
            <DialogDescription>
              将永久删除回收站中的 {trashItems.length} 个条目与记录，标签保留在回收站中。此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            条目的 PDF、笔记、解析结果和元数据都会被移除。
          </div>
          <DialogFooter>
            <Button
              disabled={emptyTrashBusy}
              type="button"
              variant="outline"
              onClick={() => setEmptyTrashConfirmOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={emptyTrashBusy || trashItems.length === 0}
              type="button"
              variant="destructive"
              onClick={() => void confirmEmptyTrash()}
            >
              <Trash2 size={14} aria-hidden="true" />
              清空回收站
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
