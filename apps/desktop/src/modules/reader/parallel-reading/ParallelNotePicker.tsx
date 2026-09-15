import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { NoteOwner, NoteTarget } from '@/shared/types/domain';
import { noteTargetKey } from '@/shared/lib/noteOwner';
import type { ParallelNoteOption } from './useParallelNotes';

export function ParallelNotePicker({ open, onOpenChange, options, tagId, tagTitle, papers, busy, loading, error, onRetry, onSelect, onCreate, onSetDeleted }: {
  open: boolean; onOpenChange: (open: boolean) => void; options: ParallelNoteOption[]; tagId: string; tagTitle: string;
  papers: { id: string; title: string }[]; busy: boolean; loading: boolean; error: string | null;
  onRetry: () => void; onSelect: (target: NoteTarget) => void;
  onCreate: (owner: NoteOwner, title: string) => void;
  onSetDeleted: (option: ParallelNoteOption, deleted: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('tag');
  const [trash, setTrash] = useState(false);
  const [deleting, setDeleting] = useState<ParallelNoteOption | null>(null);
  const visible = options.filter((item) => Boolean(item.deleted) === trash && `${item.title} ${item.ownerTitle}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) { setDeleting(null); onOpenChange(value); } }}>
    <DialogContent className="flex max-h-[85%] min-h-0 min-w-0 flex-col overflow-hidden">
      <DialogHeader><DialogTitle>打开文档笔记</DialogTitle><DialogDescription>选择本组论文的笔记，或属于“{tagTitle}”的综合笔记。不会自动创建空白笔记。</DialogDescription></DialogHeader>
      <div className="flex min-w-0 items-center gap-2"><Input aria-label="搜索文档笔记" placeholder="按笔记标题、所属论文搜索" value={query} onChange={(event) => setQuery(event.target.value)} /><Button size="sm" variant="outline" disabled={busy} onClick={() => setTrash(!trash)}>{trash ? '返回笔记' : '已删除'}</Button></div>
      {loading ? <p role="status" className="text-xs text-muted-foreground">正在读取标签综合笔记…</p> : null}
      {error ? <div role="alert" className="text-xs text-destructive"><p className="break-words">{error}</p><Button size="xs" variant="outline" onClick={onRetry} disabled={busy || loading}>重试</Button></div> : null}
      <ul className="min-h-24 min-w-0 flex-1 divide-y overflow-y-auto overscroll-contain rounded-md border">
        {visible.map((item) => <li key={noteTargetKey(item.target)} className="flex min-w-0 items-center gap-1 px-2 py-1 hover:bg-muted">
          <Button variant="ghost" disabled={busy || item.deleted || Boolean(item.error)} className="h-auto min-w-0 flex-1 justify-start px-1 py-1.5 text-left" onClick={() => onSelect(item.target)}>
            <span className="min-w-0"><span className="block truncate text-sm" title={item.title}>{item.title}</span><span className="block truncate text-xs font-normal text-muted-foreground" title={item.error ?? item.ownerTitle}>{item.error ? `读取失败：${item.error}` : item.ownerTitle}</span></span>
          </Button>
          {item.target.owner.kind === 'tag_reading' && item.revision ? <Button size="xs" variant="ghost" disabled={busy} onClick={() => item.deleted ? onSetDeleted(item, false) : setDeleting(item)}>{item.deleted ? '恢复' : '删除'}</Button> : null}
        </li>)}
        {!loading && visible.length === 0 ? <li className="p-3 text-xs text-muted-foreground">{trash ? '没有匹配的已删除综合笔记。' : query ? '没有匹配的笔记。' : '还没有文档笔记，可在下方新建。'}</li> : null}
      </ul>
      {deleting ? <div role="alert" className="space-y-2 border-t pt-2 text-xs"><p>将“{deleting.title}”移入已删除？正文和图片会保留，可以恢复。</p><div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => setDeleting(null)}>取消</Button><Button size="sm" variant="destructive" disabled={busy} onClick={() => { onSetDeleted(deleting, true); setDeleting(null); }}>移入已删除</Button></div></div> : null}
      {!trash && !deleting ? <form className="grid gap-2 border-t pt-3" onSubmit={(event) => { event.preventDefault(); if (title.trim()) onCreate(owner === 'tag' ? { kind: 'tag_reading', tag_id: tagId } : { kind: 'entry', entry_id: owner }, title.trim()); }}>
        <label className="text-xs font-medium" htmlFor={`note-title-${tagId}`}>新建文档笔记</label>
        <div className="flex min-w-0 gap-2"><Input id={`note-title-${tagId}`} required maxLength={200} disabled={busy} placeholder="笔记标题" value={title} onChange={(event) => setTitle(event.target.value)} />
          <Button size="default" disabled={busy || loading || !title.trim() || (owner === 'tag' && Boolean(error))} type="submit">{busy ? '处理中…' : '新建并打开'}</Button></div>
        <Select value={owner} onValueChange={setOwner} disabled={busy}><SelectTrigger className="w-full min-w-0 [&>span]:truncate" aria-label="新笔记归属"><SelectValue /></SelectTrigger><SelectContent position="popper">
          <SelectItem value="tag">标签综合笔记 · {tagTitle}</SelectItem>{papers.map((paper) => <SelectItem key={paper.id} value={paper.id}>论文笔记 · {paper.title}</SelectItem>)}
        </SelectContent></Select>
      </form> : null}
    </DialogContent>
  </Dialog>;
}
