import { useState } from 'react';
import { Plus, SlidersHorizontal, Tag, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SidebarSectionHeader } from '@/modules/library/components/SidebarSectionHeader';
import { SidebarContentRow } from '@/modules/library/components/SidebarContentRow';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { buildTagPathById } from '@/modules/library/utils/tagTree';
import { noteTargetKey } from '@/shared/lib/noteOwner';
import type { NoteTarget, TagMeta } from '@/shared/types/domain';
import { useWorkspaceNotes } from '../WorkspaceNotesContext';
import { useTagNoteActions } from '../useTagNoteActions';
import { CreateTagNoteDialog } from './CreateTagNoteDialog';
import { SplitNoteButton } from './SplitNoteButton';

export type EntryTagNotesContext = {
  contextTagId?: string;
  scope: string;
  activeTarget?: NoteTarget | null;
  onOpen: (target: NoteTarget, title: string, split?: boolean) => void;
};

export function EntryTagNotesSidebar({ entry, tags, contextTagId, scope, activeTarget, onOpen }: EntryTagNotesContext & {
  entry: LibraryEntry; tags: TagMeta[];
}) {
  const model = useWorkspaceNotes();
  const action = useTagNoteActions(`${scope}/tag-notes`);
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const allowed = new Set(entry.tagIds);
  if (contextTagId) allowed.add(contextTagId);
  const byId = new Map(tags.map(tag => [tag.id, tag]));
  for (const id of [...allowed]) {
    let parent = byId.get(id)?.parent_id;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      visited.add(parent); allowed.add(parent); parent = byId.get(parent)?.parent_id;
    }
  }
  const citesPaper = (note: NonNullable<typeof model>['catalog']['notes'][number]) => note.links.some(link => link.sources.some(source => source.entry_id === entry.id));
  const related = (model?.catalog.notes ?? []).filter(note => note.target.owner.kind === 'tag_reading' && !note.deleted_at
    && (allowed.has(note.target.owner.tag_id) || citesPaper(note)));
  for (const note of related) if (note.target.owner.kind === 'tag_reading') allowed.add(note.target.owner.tag_id);
  const pathById = buildTagPathById(tags);
  const choices = tags.filter(tag => allowed.has(tag.id)).map(tag => ({ id: tag.id, label: pathById.get(tag.id) ?? tag.name }));
  const selectedTag = filter.startsWith('tag:') && choices.some(tag => `tag:${tag.id}` === filter) ? filter.slice(4) : null;
  const currentFilter = selectedTag ? filter : filter === 'citations' ? filter : 'all';
  const filtered = currentFilter !== 'all' || Boolean(query.trim());
  const notes = related.filter(note => (!selectedTag || (note.target.owner.kind === 'tag_reading' && note.target.owner.tag_id === selectedTag))
    && (currentFilter !== 'citations' || citesPaper(note))
    && `${note.title} ${note.owner_title}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section aria-label="条目详情中的标签笔记" className="min-w-0 space-y-1">
    <SidebarSectionHeader label={`标签笔记${model?.loading || model?.error ? '' : ` · ${notes.length}`}`} open={open} onToggle={() => setOpen(value => !value)} action={<>
      <Popover><PopoverTrigger asChild><Button aria-label="筛选标签笔记" title="筛选标签笔记" size="icon-xs" variant={filtered ? 'secondary' : 'ghost'}><SlidersHorizontal size={13} /></Button></PopoverTrigger>
        <PopoverContent align="start" viewportAligned className="w-72">
          <p className="text-xs font-medium">筛选标签笔记</p>
          <Input aria-label="搜索标签笔记" placeholder="搜索标题或标签" value={query} onChange={event => setQuery(event.target.value)} className="h-8 text-xs" />
          <Select value={currentFilter} onValueChange={setFilter}>
            <SelectTrigger aria-label="标签笔记范围" className="w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent viewportAligned>
              <SelectItem value="all">全部相关笔记</SelectItem><SelectItem value="citations">仅引用本论文</SelectItem>
              {choices.map(tag => <SelectItem key={tag.id} value={`tag:${tag.id}`}>{tag.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs leading-5 text-muted-foreground">包含本论文标签及上级标签的笔记，以及引用本论文的笔记。</p>
          <Button size="xs" variant="ghost" disabled={!filtered} onClick={() => { setFilter('all'); setQuery(''); }}>清除筛选</Button>
        </PopoverContent>
      </Popover>
      <Button aria-label="新建标签笔记" title="新建标签笔记" size="icon-xs" variant="ghost" disabled={!action.writable || !choices.length} onClick={() => { setOpen(true); setCreating(true); }}><Plus size={13} /></Button>
    </>} />
    <div hidden={!open}>
      {filtered ? <Button className="mx-2 mb-1 max-w-[calc(100%-1rem)] text-muted-foreground" size="xs" variant="ghost" onClick={() => { setFilter('all'); setQuery(''); }}><span className="truncate">{selectedTag ? pathById.get(selectedTag) : currentFilter === 'citations' ? '仅引用本论文' : '搜索结果'}</span><X size={12} aria-label="清除筛选" /></Button> : null}
      {model?.loading ? <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">正在读取笔记…</p> : null}
      {model?.error || action.error ? <div role="alert" className="px-2 py-1.5 text-xs text-destructive">{action.error || model?.error}<Button size="xs" variant="ghost" disabled={action.busy || model?.loading} onClick={model?.refresh}>重试</Button></div> : null}
      {model?.catalog.errors.map(error => <p role="alert" key={error} className="px-2 py-1 text-xs text-destructive">{error}</p>)}
      {!model?.loading && !model?.error && !notes.length ? <p className="px-2 py-1.5 text-xs text-muted-foreground">{filtered ? '没有匹配的笔记' : '暂无相关标签笔记'}</p> : null}
      <ul className="space-y-0.5">{notes.map(note => <li key={noteTargetKey(note.target)}>
        <SidebarContentRow active={Boolean(activeTarget && noteTargetKey(activeTarget) === noteTargetKey(note.target))}
          disabled={action.busy || Boolean(note.error)} icon={<Tag size={14} aria-hidden="true" />} label={note.title}
          meta={note.error ? `读取失败：${note.error}` : `标签笔记 · ${note.owner_title}`}
          onClick={() => onOpen(note.target, note.title)} action={<span className="flex items-center"><SplitNoteButton title={note.title} disabled={action.busy || Boolean(note.error)} onClick={() => onOpen(note.target, note.title, true)} /><Button aria-label={`删除标签笔记 ${note.title}`} title="移到回收站" size="icon-xs" variant="ghost" disabled={!action.writable || Boolean(note.error)} onClick={() => action.setDeleted(note, true)}><Trash2 size={13} aria-hidden="true" /></Button></span>} />
      </li>)}</ul>
    </div>
    {creating ? <CreateTagNoteDialog tags={choices} defaultTagId={selectedTag ?? contextTagId} busy={action.busy} disabled={!action.writable} error={action.error || model?.error || null} onClose={() => setCreating(false)} onCreate={(tagId, title) => action.create(tagId, title, (target, label) => { setCreating(false); onOpen(target, label); })} /> : null}
  </section>;
}
