import { useRef, useState } from 'react';
import { MoreHorizontal, Plus, SlidersHorizontal, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SidebarPanel } from '@/modules/library/components/SidebarPanel';
import { SidebarContentRow } from '@/modules/library/components/SidebarContentRow';
import { buildTagPathById, collectDescendantTagIds } from '@/modules/library/utils/tagTree';
import { noteTargetKey, sameNoteTarget } from '@/shared/lib/noteOwner';
import type { NoteTarget, TagMeta } from '@/shared/types/domain';
import { useWorkspaceNotes } from '../WorkspaceNotesContext';
import { useTagNoteActions } from '../useTagNoteActions';
import { CreateTagNoteDialog } from './CreateTagNoteDialog';
import { SplitNoteButton } from './SplitNoteButton';

/** Owns its panel scroll and follows the stable browsing scope, not the active paper. */
export function TagNotesSidebarSection({ tagId, descendants, tags, contextKey, status, activeTarget, onOpen, label = '标签笔记', actionScope = 'same-tag-sidebar/tag-notes' }: {
  tagId: string | null; descendants: boolean; tags: TagMeta[]; contextKey: string;
  status: 'loading' | 'ready' | 'error'; activeTarget: NoteTarget | null;
  onOpen: (target: NoteTarget, title: string, split?: boolean) => void;
  label?: string; actionScope?: string;
}) {
  const model = useWorkspaceNotes();
  const action = useTagNoteActions(actionScope);
  const [open, setOpen] = useState(true);
  const filterKey = JSON.stringify([contextKey, tagId]);
  const [filter, setFilter] = useState({ key: filterKey, query: '' });
  const query = filter.key === filterKey ? filter.query : '';
  if (filter.key !== filterKey) setFilter({ key: filterKey, query: '' });
  const [creation, setCreation] = useState<{ tags: { id: string; label: string }[]; defaultTagId?: string } | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const paths = buildTagPathById(tags);
  const valid = tagId === null || paths.has(tagId);
  const allowed = tagId === null ? new Set(tags.map(tag => tag.id))
    : descendants ? collectDescendantTagIds(tags, tagId) : new Set([tagId]);
  const choices = tags.filter(tag => allowed.has(tag.id)).map(tag => ({ id: tag.id, label: paths.get(tag.id) ?? tag.name }));
  const notes = (model?.catalog.notes ?? []).filter(note => note.target.owner.kind === 'tag_reading'
    && !note.deleted_at && allowed.has(note.target.owner.tag_id) && paths.has(note.target.owner.tag_id)
    && `${note.title} ${paths.get(note.target.owner.tag_id)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const loading = status === 'loading' || Boolean(model?.loading);
  const unavailable = status !== 'ready' || !valid || !model?.root;
  const writable = !unavailable && action.writable;
  const catalogError = model?.error;
  const knownCount = !unavailable && !loading && !catalogError;
  // Freeze the creation owner across browsing changes, but never write to a deleted tag.
  const creationTags = creation?.tags.filter(tag => paths.has(tag.id)) ?? [];
  return <>
    <SidebarPanel name="当前标签范围的笔记" label={`${label}${knownCount ? ` · ${notes.length}` : ''}`} open={open} onToggle={() => setOpen(value => !value)} action={<>
      <Popover><Tooltip><TooltipTrigger asChild><PopoverTrigger asChild>
        <Button aria-label="筛选标签笔记" size="icon-xs" variant={query.trim() ? 'secondary' : 'ghost'}><SlidersHorizontal size={13} aria-hidden="true" /></Button>
      </PopoverTrigger></TooltipTrigger><TooltipContent>筛选标签笔记</TooltipContent></Tooltip>
        <PopoverContent align="end" viewportAligned className="w-64">
          <SearchInput label="搜索标签笔记" placeholder="搜索笔记标题或标签…" value={query} onValueChange={query => setFilter({ key: filterKey, query })} />
        </PopoverContent>
      </Popover>
      <Tooltip><TooltipTrigger asChild><Button aria-label="新建标签笔记" size="icon-xs" variant="ghost" disabled={!writable || !choices.length} onClick={() => {
        setOpen(true); setCreation({ tags: choices, defaultTagId: tagId ?? undefined });
      }}><Plus size={13} aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>新建标签笔记</TooltipContent></Tooltip>
    </>}>
      {query.trim() ? <Button size="xs" variant="ghost" className="mx-2 max-w-[calc(100%-1rem)] text-muted-foreground" onClick={() => setFilter({ key: filterKey, query: '' })}><span className="truncate">搜索：{query}</span><span>清除</span></Button> : null}
      {loading ? <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">正在读取标签笔记…</p>
        : !valid ? <p className="px-2 py-1.5 text-xs text-muted-foreground">标签不可用，请恢复或选择其他标签。</p>
        : unavailable ? <p className="px-2 py-1.5 text-xs text-muted-foreground">资料库不可用，暂时无法读取标签笔记。</p>
        : catalogError ? <div role="alert" className="px-2 py-1.5 text-xs text-destructive">{catalogError}<Button size="xs" variant="ghost" onClick={model?.refresh}>重试</Button></div>
        : <>
          {!notes.length ? <p className="px-2 py-1.5 text-xs text-muted-foreground">{query.trim() ? '没有匹配的标签笔记。' : '当前范围暂无标签笔记。'}</p> : null}
          <ul className="space-y-0.5">{notes.map(note => {
            const path = note.target.owner.kind === 'tag_reading' ? paths.get(note.target.owner.tag_id) ?? note.owner_title : note.owner_title;
            const sourceCount = new Set(note.links.flatMap(link => link.sources.map(source => source.entry_id))).size;
            const deletedSources = note.source_statuses?.some(source => source.status === 'entry_deleted' || source.status === 'entry_trashed');
            return <li key={noteTargetKey(note.target)}><SidebarContentRow active={sameNoteTarget(activeTarget, note.target)} icon={<Tag size={14} aria-hidden="true" />} label={note.title}
              meta={note.error ? `读取失败：${note.error}` : `${path} · ${sourceCount} 篇来源论文${deletedSources ? ' · 含已删除来源' : ''}`}
              disabled={action.busy || Boolean(note.error)} onClick={() => onOpen(note.target, note.title)}
              action={<span className="flex items-center"><SplitNoteButton title={note.title} disabled={action.busy || Boolean(note.error)} onClick={() => onOpen(note.target, note.title, true)} /><DropdownMenu><DropdownMenuTrigger asChild><Button aria-label={`笔记操作 ${note.title}`} title="笔记操作" size="icon-xs" variant="ghost" disabled={!writable || Boolean(note.error)}><MoreHorizontal size={13} aria-hidden="true" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" viewportAligned><DropdownMenuItem onSelect={() => action.setDeleted(note, true)}>移到回收站</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu></span>} /></li>;
          })}</ul>
        </>}
      {action.error ? <p role="alert" className="px-2 py-1.5 text-xs text-destructive">{action.error}</p> : null}
      {!unavailable && model?.catalog.errors.map(error => <p role="alert" key={error} className="px-2 py-1 text-xs text-destructive">{error}</p>)}
    </SidebarPanel>
    {creation ? <CreateTagNoteDialog tags={creationTags} defaultTagId={creation.defaultTagId} busy={action.busy}
      disabled={status !== 'ready' || !action.writable || !creationTags.length} error={action.error || catalogError || (!creationTags.length ? '所属标签已不可用，请取消后重新选择。' : null)}
      onClose={() => setCreation(null)} onCreate={(id, title) => action.create(id, title, (target, label) => {
        setCreation(null); setFilter({ key: filterKey, query: '' }); onOpenRef.current(target, label);
      })} /> : null}
  </>;
}
