import { AlertTriangle, Eye, FilePlus2, FilterX, PanelRight, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  beginEntryTagDrag,
  cancelEntryTagDrag,
  finishEntryTagDrag,
  updateEntryTagDrag
} from '@/shared/lib/entryDragData';
import type { TagMeta, TrashItem } from '@/shared/types/domain';

import type { LibraryEntry, LibraryView } from '../../library/components/LibrarySidebar';
import { buildTagPathById, collectDescendantTagIds } from '../../library/utils/tagTree';
import { EntryActionDialog } from './EntryActionDialog';
import { AssetSummary, StatusBadge, TagBadges, formatDate } from './EntryDisplay';
import { TrashItemsView } from './TrashItemsView';

type EntryLibraryViewProps = {
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
  onOpenEntryExplorer: (entryId: string) => void;
  onOpenEntryInSidePane: (entryId: string) => void;
  onPurgeEntry: (entryId: string) => Promise<void> | void;
  onPurgeTrashItem: (entryId: string, trashId: string) => Promise<void> | void;
  onRefreshParseStatus: () => Promise<void> | void;
  onRestoreEntry: (entryId: string) => Promise<void> | void;
  onRestoreTrashItem: (entryId: string, trashId: string) => Promise<void> | void;
  onSelectEntry: (id: string) => void;
  standalone?: boolean;
};

export function EntryLibraryView({
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
  onRestoreEntry,
  onRestoreTrashItem,
  onSelectEntry,
  standalone = false
}: EntryLibraryViewProps) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [dialog, setDialog] = useState<{ action: 'move-to-trash' | 'purge'; entry: LibraryEntry } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const [entryDragPreview, setEntryDragPreview] = useState<{ title: string; x: number; y: number } | null>(null);
  const entryDragRef = useRef<{ dragging: boolean; entryId: string; pointerId: number; startX: number; startY: number } | null>(null);
  const suppressEntryClickRef = useRef(false);
  const [emptyTrashConfirmOpen, setEmptyTrashConfirmOpen] = useState(false);
  const [emptyTrashBusy, setEmptyTrashBusy] = useState(false);
  const isTrashView = libraryView === 'trash';
  useEffect(() => {
    setQuery('');
    setSortBy('recent');
  }, [filterResetKey]);
  const visibleEntries = isTrashView ? trashedEntries : entries;
  const tagPathById = useMemo(() => buildTagPathById(tags), [tags]);
  const activeTagIds = useMemo(
    () => (activeTag ? collectDescendantTagIds(tags, activeTag) : null),
    [activeTag, tags]
  );
  const filteredEntries = useMemo(
    () => filterEntries(visibleEntries, libraryView, activeTagIds, query, sortBy, recentReadingEntryIds),
    [activeTagIds, libraryView, query, recentReadingEntryIds, sortBy, visibleEntries]
  );
  const activeJobs = entries.filter((item) => ['Queued', 'Uploading', 'Parsing'].includes(item.status)).length;
  const activeTagLabel = activeTag ? tagPathById.get(activeTag) ?? activeTag : null;
  const headCellClass = 'h-7 border-r border-border bg-muted/45 px-2 text-center text-[11px] font-semibold last:border-r-0';
  const bodyCellClass = 'h-9 border-r border-border px-2 py-1 align-middle last:border-r-0';
  const centeredContentClass = 'flex min-w-0 items-center justify-center';

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

  const openEntryDetails = (entryId: string) => {
    onSelectEntry(entryId);
    onOpenEntryExplorer(entryId);
  };

  const content = (
    <>
      <div className={cn('grid min-h-full gap-3', standalone && 'min-w-[760px]')}>
        <Card className="rounded-none py-0">
          <CardHeader className="border-b py-2.5">
            <CardTitle>{isTrashView ? '回收站' : '条目库'}</CardTitle>
            <CardAction>
              {!isTrashView ? (
                <Button size="sm" type="button" onClick={onOpenCreateEntryTab}>
                  <FilePlus2 size={15} aria-hidden="true" />
                  创建条目
                </Button>
              ) : (
                <Button
                  disabled={trashItems.length === 0 || emptyTrashBusy}
                  size="sm"
                  type="button"
                  variant="destructive"
                  onClick={() => setEmptyTrashConfirmOpen(true)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  清空回收站
                </Button>
              )}
            </CardAction>
          </CardHeader>
          {!isTrashView ? <CardContent className="py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="relative min-w-72 flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-8 text-xs"
                  placeholder={isTrashView ? '搜索回收站条目' : '搜索标题、PDF、字段、标签或解析状态'}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue placeholder="排序" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">最近更新</SelectItem>
                  <SelectItem value="title">标题</SelectItem>
                  <SelectItem value="parser">解析状态</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" type="button" variant="outline" onClick={() => setQuery('')}>
                <FilterX size={14} aria-hidden="true" />
                清除
              </Button>
              {libraryView === 'parsing' ? (
                <Button
                  disabled={activeJobs === 0 || isRefreshingParseStatus}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => void onRefreshParseStatus()}
                >
                  <RefreshCw className={cn(isRefreshingParseStatus && 'animate-spin')} size={14} aria-hidden="true" />
                  刷新
                </Button>
              ) : null}
              {activeTagLabel ? <Badge variant="secondary">标签：{activeTagLabel}</Badge> : null}
            </div>
          </CardContent> : null}

          {isTrashView ? (
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
          ) : (
          <div className="entry-library-table-shell min-w-0 border border-border">
          <Table className="table-fixed border-collapse">
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[17%]" />
              <col className="w-[13%]" />
              <col className="w-[13%]" />
              <col className="w-[12%]" />
              <col className="w-[13%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className={cn(headCellClass, 'text-left')}>标题</TableHead>
                <TableHead className={headCellClass}>标签</TableHead>
                <TableHead className={headCellClass}>文件</TableHead>
                <TableHead className={headCellClass}>解析器</TableHead>
                <TableHead className={headCellClass}>更新时间</TableHead>
                <TableHead className={headCellClass}>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status === 'loading' ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={6}>
                    正在打开条目库...
                  </TableCell>
                </TableRow>
              ) : null}
              {status !== 'loading' && filteredEntries.length === 0 ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={6}>
                    {isTrashView ? '回收站为空。' : '没有符合当前筛选条件的条目。'}
                  </TableCell>
                </TableRow>
              ) : null}
              {filteredEntries.map((item) => (
                <ContextMenu key={item.id}>
                  <ContextMenuTrigger asChild>
                    <TableRow
                      className={cn(
                        !isTrashView && 'cursor-pointer',
                        item.id === selectedEntryId && !isTrashView && 'bg-accent/70',
                        item.id === draggingEntryId && 'opacity-55'
                      )}
                      data-allow-context-menu="true"
                      title={!isTrashView ? '拖动到左侧标签以添加标签' : undefined}
                      onClick={() => {
                        if (suppressEntryClickRef.current) {
                          suppressEntryClickRef.current = false;
                          return;
                        }
                        if (!isTrashView) {
                          openEntryDetails(item.id);
                        }
                      }}
                      onContextMenu={() => {
                        if (!isTrashView) {
                          onSelectEntry(item.id);
                        }
                      }}
                      onPointerCancel={(event) => {
                        if (entryDragRef.current?.pointerId !== event.pointerId) {
                          return;
                        }
                        cancelEntryTagDrag();
                        entryDragRef.current = null;
                        setDraggingEntryId(null);
                        setEntryDragPreview(null);
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                      }}
                      onPointerDown={(event) => {
                        if (isTrashView || event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) {
                          return;
                        }
                        entryDragRef.current = {
                          dragging: false,
                          entryId: item.id,
                          pointerId: event.pointerId,
                          startX: event.clientX,
                          startY: event.clientY
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const drag = entryDragRef.current;
                        if (!drag || drag.pointerId !== event.pointerId) {
                          return;
                        }
                        if (!drag.dragging) {
                          const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
                          if (distance < 6) {
                            return;
                          }
                          drag.dragging = true;
                          suppressEntryClickRef.current = true;
                          beginEntryTagDrag(drag.entryId, event.clientX, event.clientY);
                          setDraggingEntryId(drag.entryId);
                          setEntryDragPreview({ title: item.title, x: event.clientX, y: event.clientY });
                          document.body.style.cursor = 'grabbing';
                          document.body.style.userSelect = 'none';
                        } else {
                          updateEntryTagDrag(event.clientX, event.clientY);
                          setEntryDragPreview((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
                        }
                        event.preventDefault();
                      }}
                      onPointerUp={(event) => {
                        const drag = entryDragRef.current;
                        if (!drag || drag.pointerId !== event.pointerId) {
                          return;
                        }
                        if (drag.dragging) {
                          finishEntryTagDrag(event.clientX, event.clientY);
                        }
                        entryDragRef.current = null;
                        setDraggingEntryId(null);
                        setEntryDragPreview(null);
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                      }}
                    >
                      <TableCell className={cn(bodyCellClass, 'text-left')}>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{item.title}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {item.fields.description || item.pdfFileName || '暂无描述'}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={cn(bodyCellClass, 'min-w-0 overflow-hidden')}>
                        <div className={cn(centeredContentClass, 'w-full max-w-full overflow-hidden')}>
                          <TagBadges tags={item.tags} />
                        </div>
                      </TableCell>
                      <TableCell className={bodyCellClass}>
                        <div className={centeredContentClass}>
                          <AssetSummary entry={item} />
                        </div>
                      </TableCell>
                      <TableCell className={bodyCellClass}>
                        <div className={centeredContentClass}>
                          <StatusBadge status={item.status} />
                        </div>
                      </TableCell>
                      <TableCell className={cn(bodyCellClass, 'text-center text-muted-foreground')}>
                        {formatDate(item.updatedAt)}
                      </TableCell>
                      <TableCell className={bodyCellClass}>
                        <div className={cn(centeredContentClass, 'gap-1')}>
                          {isTrashView ? (
                            <>
                              <Button
                                size="icon-xs"
                                title="恢复"
                                type="button"
                                variant="outline"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onRestoreEntry(item.id);
                                }}
                              >
                                <RotateCcw size={14} aria-hidden="true" />
                              </Button>
                              <Button
                                size="icon-xs"
                                title="彻底删除"
                                type="button"
                                variant="destructive"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDialog({ action: 'purge', entry: item });
                                }}
                              >
                                <Trash2 size={14} aria-hidden="true" />
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="icon-xs"
                              title="移到回收站"
                              type="button"
                              variant="destructive"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDialog({ action: 'move-to-trash', entry: item });
                              }}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-44" data-allow-context-menu="true">
                    <ContextMenuLabel className="truncate">{item.title}</ContextMenuLabel>
                    <ContextMenuSeparator />
                    {!isTrashView ? (
                      <ContextMenuItem onSelect={() => openEntryDetails(item.id)}>
                        <Eye size={13} aria-hidden="true" />
                        查看详情
                      </ContextMenuItem>
                    ) : null}
                    {!isTrashView ? (
                      <ContextMenuItem onSelect={() => onOpenEntryInSidePane(item.id)}>
                        <PanelRight size={13} aria-hidden="true" />
                        在右侧打开
                      </ContextMenuItem>
                    ) : null}
                    {isTrashView ? (
                      <ContextMenuItem onSelect={() => void onRestoreEntry(item.id)}>
                        <RotateCcw size={13} aria-hidden="true" />
                        恢复条目
                      </ContextMenuItem>
                    ) : null}
                    <ContextMenuItem
                      variant="destructive"
                      onSelect={() => {
                        setDialog({ action: isTrashView ? 'purge' : 'move-to-trash', entry: item });
                      }}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      {isTrashView ? '彻底删除' : '移到回收站'}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </TableBody>
          </Table>
          </div>
          )}
        </Card>
      </div>
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
              清空回收站
            </DialogTitle>
            <DialogDescription>
              将永久删除总回收站中的 {trashItems.length} 个可见项目，此操作无法撤销。
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
      {entryDragPreview && typeof document !== 'undefined'
        ? createPortal(
            <div
              aria-hidden="true"
              className="pointer-events-none fixed z-[2147483000] flex h-8 max-w-72 -translate-x-1/2 -translate-y-1/2 items-center rounded-none border bg-popover px-2.5 text-xs font-medium text-popover-foreground shadow-lg"
              data-entry-tag-drag-preview="true"
              style={{ left: entryDragPreview.x, top: entryDragPreview.y }}
            >
              <span className="truncate">{entryDragPreview.title}</span>
            </div>,
            document.body
          )
        : null}
    </>
  );

  if (standalone) {
    return <div className="h-full min-h-0 overflow-auto">{content}</div>;
  }

  return (
    <TabsContent className="m-0" value="library">
      {content}
    </TabsContent>
  );
}

function filterEntries(
  entries: LibraryEntry[],
  libraryView: LibraryView,
  activeTagIds: Set<string> | null,
  query: string,
  sortBy: string,
  recentReadingEntryIds: string[]
) {
  const entriesInView = entries.filter((item) => {
    if (libraryView === 'recent') {
      return recentReadingEntryIds.includes(item.id);
    }
    if (libraryView === 'parsed') {
      return item.status === 'Parsed';
    }
    if (libraryView === 'parsing') {
      return ['Queued', 'Uploading', 'Parsing'].includes(item.status);
    }
    if (libraryView === 'failed') {
      return item.status === 'Failed';
    }
    if (libraryView === 'no_pdf') {
      return item.status === 'No PDF';
    }
    return true;
  });
  const entriesInTag = activeTagIds
    ? entriesInView.filter((item) => item.tagIds.some((tagId) => activeTagIds.has(tagId)))
    : entriesInView;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? entriesInTag.filter((item) => {
        const fieldText = Object.entries(item.fields)
          .flatMap(([key, value]) => [key, value])
          .join(' ');
        const haystack = [item.title, item.status, item.pdfFileName ?? '', fieldText, ...item.tags]
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : entriesInTag;

  return [...filtered].sort((left, right) => {
    if (libraryView === 'recent') {
      return recentReadingEntryIds.indexOf(left.id) - recentReadingEntryIds.indexOf(right.id);
    }
    if (sortBy === 'title') {
      return left.title.localeCompare(right.title);
    }
    if (sortBy === 'parser') {
      return left.status.localeCompare(right.status);
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}
