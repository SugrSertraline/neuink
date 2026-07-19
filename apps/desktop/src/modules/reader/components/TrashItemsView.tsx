import { AlertTriangle, FileText, Highlighter, MessageSquareText, RotateCcw, StickyNote, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  showEntry?: boolean;
  onEmpty?: () => Promise<void> | void;
  onPurgeEntry: (entryId: string) => Promise<void> | void;
  onPurgeItem: (entryId: string, trashId: string) => Promise<void> | void;
  onRestoreEntry: (entryId: string) => Promise<void> | void;
  onRestoreItem: (entryId: string, trashId: string) => Promise<void> | void;
};

export function TrashItemsView({
  items,
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

      <div className="min-w-0 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>类型</TableHead>
              <TableHead>名称与摘要</TableHead>
              {showEntry ? <TableHead>原所属条目</TableHead> : null}
              <TableHead>删除时间</TableHead>
              <TableHead className="w-28 text-center">操作</TableHead>
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
                  <TableCell>
                    <Badge className="gap-1" variant="outline">
                      {trashKindIcon(item.kind)}
                      {trashKindLabel(item.kind)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-xl">
                      <div className="truncate text-sm font-medium">{item.title}</div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">{item.preview || '暂无摘要'}</div>
                      {item.parent_entry_trashed && item.kind !== 'entry' ? (
                        <div className="mt-1 text-[11px] text-amber-700">所属条目也在回收站中</div>
                      ) : null}
                    </div>
                  </TableCell>
                  {showEntry ? <TableCell className="max-w-56 truncate">{item.entry_title}</TableCell> : null}
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatTrashDate(item.deleted_at)}
                  </TableCell>
                  <TableCell>
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
