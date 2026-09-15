import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { noteTargetKey } from '@/shared/lib/noteOwner';
import type { CatalogNote } from '@/shared/ipc/noteCatalogApi';
import type { NoteTarget } from '@/shared/types/domain';
import { useWorkspaceNotes } from '../WorkspaceNotesContext';
import { useTagNoteActions } from '../useTagNoteActions';
import { CreateTagNoteButton } from './CreateTagNoteButton';

export function tagNotesForScope(notes: CatalogNote[], tagId?: string | null, entryId?: string, citedOnly = false) {
  return notes.filter((note) => note.target.owner.kind === 'tag_reading' && (!tagId || note.target.owner.tag_id === tagId)
    && (!(citedOnly || !tagId) || !entryId || note.links.some((link) => link.sources.some((source) => source.entry_id === entryId))));
}

export function TagNotesList({ tagId, entryId, citedOnly, scope, onOpen, deletedOnly = false, embedded = false, hideCreateAction = false }: {
  tagId?: string | null; entryId?: string; citedOnly?: boolean; scope: string; onOpen?: (target: NoteTarget, title: string) => void;
  deletedOnly?: boolean; embedded?: boolean; hideCreateAction?: boolean;
}) {
  const model = useWorkspaceNotes();
  const [query, setQuery] = useState('');
  const action = useTagNoteActions(scope);
  const notes = tagNotesForScope(model?.catalog.notes ?? [], tagId, entryId, citedOnly)
    .filter(note => Boolean(note.deleted_at) === deletedOnly && `${note.title} ${note.owner_title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section aria-label={deletedOnly ? '已删除标签笔记' : '标签笔记'} className={cn('flex min-h-0 min-w-0 flex-col', !embedded && 'flex-1')}>
    <div aria-label="标签笔记筛选与操作" className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
      <SearchInput label={deletedOnly ? '搜索已删除标签笔记' : '搜索标签笔记'} value={query} onValueChange={setQuery} placeholder={deletedOnly ? '搜索已删除标签笔记' : '搜索笔记标题、所属标签'} />
      {tagId && !deletedOnly && !hideCreateAction ? <CreateTagNoteButton tagId={tagId} scope={scope} onOpen={onOpen} /> : null}
    </div>
    {model?.loading ? <p role="status" className="px-3 py-1 text-xs text-muted-foreground">正在读取笔记…</p> : null}
    {model?.error || action.error ? <div role="alert" className="flex items-center gap-2 px-3 py-2 text-xs text-destructive"><p>{action.error || model?.error}</p>{model?.error ? <Button size="xs" variant="outline" disabled={model.loading} onClick={model.refresh}>重试</Button> : null}</div> : null}
    {model?.catalog.errors.map(error => <p key={error} role="alert" className="px-3 text-xs text-destructive">{error}</p>)}
    <div className={embedded ? 'min-w-0' : 'min-h-0 flex-1 overflow-y-auto'}>
      {!model?.loading && !model?.error && !notes.length ? <p className="p-3 text-sm text-muted-foreground">{query.trim() ? '没有匹配的标签笔记。' : deletedOnly ? '暂无已删除的标签笔记。' : '暂无标签笔记。'}</p> : null}
      <ul className="divide-y">{notes.map(note => <li key={noteTargetKey(note.target)} className="flex min-w-0 items-center gap-1 px-3 py-2 text-xs">
        <button type="button" disabled={deletedOnly || Boolean(note.error) || action.busy} className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60" onClick={() => onOpen?.(note.target, note.title)}>
          {!tagId ? <p className="truncate text-muted-foreground">{note.owner_title}</p> : null}
          <p className="truncate font-medium" title={note.title}>{note.title}</p>
          <p className="truncate text-muted-foreground">{new Set(note.links.flatMap(link => link.sources.map(source => source.entry_id))).size} 篇来源论文{note.error ? ` · 读取失败：${note.error}` : ''}</p>
        </button>
        <Button size="xs" variant="ghost" disabled={!action.writable || Boolean(note.error)} onClick={() => action.setDeleted(note, !deletedOnly)}>{deletedOnly ? '恢复' : '删除'}</Button>
      </li>)}</ul>
    </div>
  </section>;
}
