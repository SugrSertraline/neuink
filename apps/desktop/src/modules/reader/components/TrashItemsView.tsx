import { AlertTriangle, FileText, Highlighter, MessageSquareText, RotateCcw, StickyNote, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { TrashItem, TrashItemKind } from '@/shared/types/domain';

type TrashItemsViewProps = {
  items: TrashItem[];
  fixedHeight?: boolean;
  showEntry?: boolean;
  onEmpty?: () => Promise<void> | void;
  onPurgeEntry: (entryId: string) => Promise<void> | void;
  onPurgeItem: (entryId: string, trashId: string) => Promise<void> | void;
  onRestoreEntry: (entryId: string) => Promise<void> | void;
  onRestoreItem: (entryId: string, trashId: string) => Promise<void> | void;
};

export function TrashItemsView({
  items,
  fixedHeight = false,
  showEntry = true,
  onEmpty,
  onPurgeEntry,
  onPurgeItem,
  onRestoreEntry,
  onRestoreItem
}: TrashItemsViewProps) {
  const [filter, setFilter] = useState<'all' | TrashItemKind>('all');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingPurge, setPendingPurge] = useState<TrashItem | null>(null);
  const [emptyConfirmOpen, setEmptyConfirmOpen] = useState(false);
  const headCellClass = 'h-7 border-r border-border bg-muted/45 px-2 text-center text-[11px] font-semibold last:border-r-0';
  const bodyCellClass = 'h-9 border-r border-border px-2 py-1 align-middle last:border-r-0';
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false;
      if (!normalized) return true;
      return [item.title, item.preview, item.entry_title, trashKindLabel(item.kind)]
        .some((value) => value.toLocaleLowerCase().includes(normalized));
    });
  }, [filter, items, query]);

  const run = async (id: string, action: () => Promise<void> | void) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await action();
    } catch {
      // The workspace hook owns the user-facing error state.
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
    <div className="grid min-h-0 min-w-0 gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Input
          className="h-8 min-w-56 flex-1 text-xs"
          placeholder="搜索名称、内容或所属条目"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select value={filter} onValueChange={(value) => setFilter(value as 'all' | TrashItemKind)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="entry">条目</SelectItem>
            <SelectItem value="markdown_note">Markdown 笔记</SelectItem>
            <SelectItem value="segment_note">片段笔记</SelectItem>
            <SelectItem value="annotation">批注</SelectItem>
            <SelectItem value="highlight">高亮</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline">{visibleItems.length} 项</Badge>
        {onEmpty ? (
          <Button
            disabled={items.length === 0 || Boolean(busyId)}
            size="sm"
            type="button"
            variant="destructive"
            onClick={() => setEmptyConfirmOpen(true)}
          >
            <Trash2 size={13} aria-hidden="true" />
            清空此条目回收站
          </Button>
        ) : null}
      </div>

      <div className={`entry-library-table-shell min-w-0 overflow-y-auto overflow-x-hidden border border-border ${fixedHeight ? 'max-h-[min(60vh,34rem)]' : ''}`}>
        <Table className="table-fixed border-collapse">
          <colgroup>
            <col className="w-[14%]" />
            <col className={showEntry ? 'w-[40%]' : 'w-[54%]'} />
            {showEntry ? <col className="w-[20%]" /> : null}
            <col className="w-[16%]" />
            <col className="w-[10%]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className={headCellClass}>类型</TableHead>
              <TableHead className={cn(headCellClass, 'text-left')}>名称与摘要</TableHead>
              {showEntry ? <TableHead className={cn(headCellClass, 'text-left')}>原所属条目</TableHead> : null}
              <TableHead className={headCellClass}>删除时间</TableHead>
              <TableHead className={headCellClass}>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleItems.length === 0 ? (
              <TableRow>
                <TableCell className="py-10 text-center text-muted-foreground" colSpan={showEntry ? 5 : 4}>
                  回收站为空。
                </TableCell>
              </TableRow>
            ) : null}
            {visibleItems.map((item) => {
              const itemBusy = busyId === item.trash_id;
              return (
                <TableRow key={`${item.entry_id}:${item.trash_id}`}>
                  <TableCell className={cn(bodyCellClass, 'text-center')}>
                    <Badge className="gap-1" variant="outline">
                      {trashKindIcon(item.kind)}
                      {trashKindLabel(item.kind)}
                    </Badge>
                  </TableCell>
                  <TableCell className={bodyCellClass}>
                    <TrashTextHoverCard preview={item.preview} title={item.title}>
                      <div className="flex h-10 min-w-0 flex-col justify-center gap-0.5">
                        <div className="truncate text-sm font-medium leading-5">{item.title}</div>
                        <div className="truncate text-[11px] leading-4 text-muted-foreground">{trashPreview(item)}</div>
                      </div>
                    </TrashTextHoverCard>
                  </TableCell>
                  {showEntry ? (
                    <TableCell className={bodyCellClass}>
                      <TrashTextHoverCard title={item.entry_title}>
                        <div className="truncate text-xs">{item.entry_title}</div>
                      </TrashTextHoverCard>
                    </TableCell>
                  ) : null}
                  <TableCell className={cn(bodyCellClass, 'text-center text-xs text-muted-foreground')}>
                    <TrashTextHoverCard title={formatTrashDate(item.deleted_at)}>
                      <div className="truncate">{formatTrashDate(item.deleted_at)}</div>
                    </TrashTextHoverCard>
                  </TableCell>
                  <TableCell className={bodyCellClass}>
                    <div className="flex justify-center gap-1">
                      <Button
                        disabled={itemBusy}
                        size="icon-xs"
                        title={item.restorable ? '恢复' : '恢复所属条目'}
                        type="button"
                        variant="outline"
                        onClick={() => void run(item.trash_id, () =>
                          item.kind === 'entry'
                            ? onRestoreEntry(item.entry_id)
                            : item.restorable
                              ? onRestoreItem(item.entry_id, item.trash_id)
                              : Promise.resolve(onRestoreEntry(item.entry_id)).then(() =>
                                  item.stored_trash_item
                                    ? onRestoreItem(item.entry_id, item.trash_id)
                                    : undefined
                                )
                        )}
                      >
                        <RotateCcw size={13} aria-hidden="true" />
                      </Button>
                      {item.kind === 'entry' || item.restorable ? (
                        <Button
                          disabled={itemBusy}
                          size="icon-xs"
                          title="彻底删除"
                          type="button"
                          variant="destructive"
                          onClick={() => setPendingPurge(item)}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
    <Dialog open={Boolean(pendingPurge)} onOpenChange={(open) => {
      if (!open && !busyId) setPendingPurge(null);
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={16} aria-hidden="true" />
            彻底删除？
          </DialogTitle>
          <DialogDescription>
            {pendingPurge?.kind === 'entry'
              ? '该条目及其 PDF、笔记、片段记录和内部回收站都会永久删除。'
              : '该项目将从回收站永久删除，无法恢复。'}
          </DialogDescription>
        </DialogHeader>
        {pendingPurge ? (
          <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm font-medium">
            {pendingPurge.title}
          </div>
        ) : null}
        <DialogFooter>
          <Button disabled={Boolean(busyId)} type="button" variant="outline" onClick={() => setPendingPurge(null)}>
            取消
          </Button>
          <Button
            disabled={!pendingPurge || Boolean(busyId)}
            type="button"
            variant="destructive"
            onClick={() => {
              if (!pendingPurge) return;
              const item = pendingPurge;
              void run(item.trash_id, () =>
                item.kind === 'entry'
                  ? onPurgeEntry(item.entry_id)
                  : onPurgeItem(item.entry_id, item.trash_id)
              ).then(() => setPendingPurge(null));
            }}
          >
            彻底删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={emptyConfirmOpen} onOpenChange={setEmptyConfirmOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={16} aria-hidden="true" />
            清空此条目回收站？
          </DialogTitle>
          <DialogDescription>
            将永久删除当前条目回收站中的 {items.length} 个项目，此操作无法撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setEmptyConfirmOpen(false)}>取消</Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              void Promise.resolve(onEmpty?.()).then(() => setEmptyConfirmOpen(false));
            }}
          >
            清空回收站
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function TrashTextHoverCard({
  children,
  preview,
  title
}: {
  children: ReactNode;
  preview?: string | null;
  title: string;
}) {
  return (
    <HoverCard closeDelay={120} openDelay={220}>
      <HoverCardTrigger asChild>
        <div className="min-w-0 cursor-default">{children}</div>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 break-words" side="top">
        <div className="text-sm font-medium">{title}</div>
        {preview?.trim() ? <div className="mt-1 text-xs leading-5 text-muted-foreground">{preview}</div> : null}
      </HoverCardContent>
    </HoverCard>
  );
}

function trashPreview(item: TrashItem) {
  if (item.parent_entry_trashed && item.kind !== 'entry') {
    return '所属条目也在回收站中';
  }
  return item.preview?.trim() || '暂无摘要';
}

function trashKindLabel(kind: TrashItemKind) {
  switch (kind) {
    case 'entry': return '条目';
    case 'markdown_note': return 'Markdown 笔记';
    case 'segment_note': return '片段笔记';
    case 'annotation': return '批注';
    case 'highlight': return '高亮';
  }
}

function trashKindIcon(kind: TrashItemKind) {
  switch (kind) {
    case 'entry': return <Trash2 size={12} aria-hidden="true" />;
    case 'markdown_note': return <FileText size={12} aria-hidden="true" />;
    case 'segment_note': return <StickyNote size={12} aria-hidden="true" />;
    case 'annotation': return <MessageSquareText size={12} aria-hidden="true" />;
    case 'highlight': return <Highlighter size={12} aria-hidden="true" />;
  }
}

function formatTrashDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
