import { useState } from 'react';
import { AlertTriangle, RotateCcw, StickyNote, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/search-input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { noteTargetKey } from '@/shared/lib/noteOwner';
import type { CatalogNote } from '@/shared/ipc/noteCatalogApi';
import type { NoteTarget } from '@/shared/types/domain';
import { useWorkspaceNotes } from '../WorkspaceNotesContext';
import { useTagNoteActions } from '../useTagNoteActions';
import { CreateTagNoteButton } from './CreateTagNoteButton';
import { AppearanceIcon } from '@/shared/components/AppearanceIcon';

export function tagNotesForScope(notes: CatalogNote[], tagId?: string | null, entryId?: string, citedOnly = false) {
  return notes.filter((note) => note.target.owner.kind === 'tag_reading' && (!tagId || note.target.owner.tag_id === tagId)
    && (!(citedOnly || !tagId) || !entryId || note.links.some((link) => link.sources.some((source) => source.entry_id === entryId))));
}

export function TagNotesList({ tagId, entryId, citedOnly, scope, onOpen, deletedOnly = false, embedded = false, hideCreateAction = false, searchQuery }: {
  tagId?: string | null; entryId?: string; citedOnly?: boolean; scope: string; onOpen?: (target: NoteTarget, title: string) => void;
  deletedOnly?: boolean; embedded?: boolean; hideCreateAction?: boolean; searchQuery?: string;
}) {
  const model = useWorkspaceNotes();
  const [localQuery, setLocalQuery] = useState('');
  const query = searchQuery ?? localQuery;
  const [pendingPurge, setPendingPurge] = useState<CatalogNote | null>(null);
  const action = useTagNoteActions(scope);
  const notes = tagNotesForScope(model?.catalog.notes ?? [], tagId, entryId, citedOnly)
    .filter(note => Boolean(note.deleted_at) === deletedOnly && `${note.title} ${note.owner_title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section data-material="notebook-list" aria-label={deletedOnly ? '已删除标签笔记' : '标签笔记'} className={cn('flex min-h-0 min-w-0 flex-col', !embedded && 'flex-1')}>
    {searchQuery === undefined || (tagId && !deletedOnly && !hideCreateAction) ? <div aria-label="标签笔记筛选与操作" className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
      {searchQuery === undefined ? <SearchInput label={deletedOnly ? '搜索已删除标签笔记' : '搜索标签笔记'} value={query} onValueChange={setLocalQuery} placeholder={deletedOnly ? '搜索已删除标签笔记' : '搜索笔记标题、所属标签'} /> : null}
      {tagId && !deletedOnly && !hideCreateAction ? <CreateTagNoteButton tagId={tagId} scope={scope} onOpen={onOpen} /> : null}
    </div> : null}
    {!deletedOnly && model?.loading && notes.length === 0 ? <p role="status" className="px-3 py-1 text-xs text-muted-foreground">正在读取笔记…</p> : null}
    {model?.error || action.error ? <div role="alert" className="flex items-center gap-2 px-3 py-2 text-xs text-destructive"><p>{action.error || model?.error}</p>{model?.error ? <Button size="xs" variant="outline" disabled={model.loading} onClick={model.refresh}>重试</Button> : null}</div> : null}
    {model?.catalog.errors.map(error => <p key={error} role="alert" className="px-3 text-xs text-destructive">{error}</p>)}
    <div className={embedded ? 'min-w-0' : 'min-h-0 flex-1 overflow-y-auto'}>
      {deletedOnly ? <div className="entry-library-table-shell min-w-0 overflow-x-auto border border-border">
        <Table className="min-w-[650px] table-fixed border-collapse"><colgroup><col className="w-[14%]" /><col className="w-[36%]" /><col className="w-[20%]" /><col className="w-[16%]" /><col className="w-[14%]" /></colgroup>
          <TableHeader><TableRow>
            <TableHead className="h-7 border-r border-border bg-muted/45 px-2 text-center text-[11px] font-semibold">类型</TableHead>
            <TableHead className="h-7 border-r border-border bg-muted/45 px-2 text-left text-[11px] font-semibold">名称与摘要</TableHead>
            <TableHead className="h-7 border-r border-border bg-muted/45 px-2 text-left text-[11px] font-semibold">原所属标签</TableHead>
            <TableHead className="h-7 border-r border-border bg-muted/45 px-2 text-center text-[11px] font-semibold">删除时间</TableHead>
            <TableHead className="h-7 bg-muted/45 px-2 text-center text-[11px] font-semibold">操作</TableHead>
          </TableRow></TableHeader>
          <TableBody>{notes.length ? notes.map(note => <TableRow key={noteTargetKey(note.target)}>
            <TableCell className="h-9 border-r border-border px-2 py-1 text-center"><Badge className="gap-1" variant="outline"><StickyNote size={12} aria-hidden="true" />标签笔记</Badge></TableCell>
            <TableCell className="h-9 border-r border-border px-2 py-1"><div className="min-w-0" title={note.title}><div className="truncate text-sm font-medium leading-5">{note.title}</div><div className="truncate text-[11px] leading-4 text-muted-foreground">{new Set(note.links.flatMap(link => link.sources.map(source => source.entry_id))).size} 篇来源论文{note.error ? ` · 读取失败：${note.error}` : ''}</div></div></TableCell>
            <TableCell className="h-9 border-r border-border px-2 py-1 text-xs" title={note.owner_title}><div className="truncate">{note.owner_title}</div></TableCell>
            <TableCell className="h-9 border-r border-border px-2 py-1 text-center text-xs text-muted-foreground" title={formatDate(note.deleted_at)}><div className="truncate">{formatDate(note.deleted_at)}</div></TableCell>
            <TableCell className="h-9 px-2 py-1"><div className="flex justify-center gap-1">
              <Button size="icon-xs" variant="outline" title="恢复" aria-label={`恢复标签笔记 ${note.title}`} disabled={!action.writable || Boolean(note.error)} onClick={() => { void action.setDeleted(note, false); }}><RotateCcw size={13} aria-hidden="true" /></Button>
              <Button size="icon-xs" variant="destructive" title="彻底删除" aria-label={`彻底删除标签笔记 ${note.title}`} disabled={!action.writable || Boolean(note.error)} onClick={() => setPendingPurge(note)}><Trash2 size={13} aria-hidden="true" /></Button>
            </div></TableCell>
          </TableRow>) : <TableRow><TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">{model?.loading ? '正在读取笔记…' : query.trim() ? '没有匹配的标签笔记。' : '暂无已删除的标签笔记。'}</TableCell></TableRow>}</TableBody>
        </Table>
      </div> : <>
      {!model?.loading && !model?.error && !notes.length ? <p className="p-3 text-sm text-muted-foreground">{query.trim() ? '没有匹配的标签笔记。' : '暂无标签笔记。'}</p> : null}
      <ul className="divide-y">{notes.map(note => <li key={noteTargetKey(note.target)} className="flex min-w-0 items-center gap-1 px-3 py-2 text-xs">
        <AppearanceIcon kind="notes">{null}</AppearanceIcon>
        <button type="button" disabled={deletedOnly || Boolean(note.error) || action.busy} className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60" onClick={() => onOpen?.(note.target, note.title)}>
          {!tagId ? <p className="truncate text-muted-foreground">{note.owner_title}</p> : null}
          <p className="truncate font-medium" title={note.title}>{note.title}</p>
          <p className="truncate text-muted-foreground">{new Set(note.links.flatMap(link => link.sources.map(source => source.entry_id))).size} 篇来源论文{note.error ? ` · 读取失败：${note.error}` : ''}</p>
        </button>
        <Button size="xs" variant="ghost" disabled={!action.writable || Boolean(note.error)} onClick={() => action.setDeleted(note, !deletedOnly)}>{deletedOnly ? '恢复' : '删除'}</Button>
      </li>)}</ul></>}
    </div>
    {deletedOnly ? <Dialog open={Boolean(pendingPurge)} onOpenChange={(open) => { if (!open && !action.busy) setPendingPurge(null); }}>
      <DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" />彻底删除标签笔记？</DialogTitle><DialogDescription>笔记正文、来源链接和附加图片将永久删除，无法恢复。</DialogDescription></DialogHeader>
        {pendingPurge ? <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm font-medium">{pendingPurge.title}</div> : null}
        {action.error ? <p role="alert" className="text-xs text-destructive">{action.error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={action.busy} onClick={() => setPendingPurge(null)}>取消</Button><Button variant="destructive" disabled={!pendingPurge || !action.writable} onClick={() => { if (!pendingPurge) return; void action.purge(pendingPurge).then((ok) => { if (ok) setPendingPurge(null); }); }}>彻底删除</Button></DialogFooter>
      </DialogContent>
    </Dialog> : null}
  </section>;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
