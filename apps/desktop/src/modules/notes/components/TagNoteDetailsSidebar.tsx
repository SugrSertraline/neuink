import { useState } from 'react';
import { FileText, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { SidebarPanel } from '@/modules/library/components/SidebarPanel';
import { SidebarPanelGroup } from '@/modules/library/components/SidebarPanelGroup';
import { SidebarPaperRow } from '@/modules/library/components/SidebarPaperRow';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { buildTagPathById } from '@/modules/library/utils/tagTree';
import { useLibraryReadingStates } from '@/modules/reader/useLibraryReadingStates';
import type { WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import type { NoteTarget, TagMeta } from '@/shared/types/domain';
import { sameNoteTarget } from '@/shared/lib/noteOwner';
import { useWorkspaceNotes } from '../WorkspaceNotesContext';
import { TagNotesSidebarSection } from './TagNotesSidebarSection';

/** Saved note metadata comes from the shared catalog; this view never owns an editor. */
export function TagNoteDetailsSidebar({ target, title, entries, tags, status, error, layout, onLocateTag, onRead, onOpenNote }: {
  target: NoteTarget; title?: string; entries: LibraryEntry[]; tags: TagMeta[];
  status: 'loading' | 'ready' | 'error'; error: string | null; layout: WorkspaceSurfaceLayout;
  onLocateTag: (id: string) => void;
  onRead: (entry: LibraryEntry, split: boolean) => void;
  onOpenNote: (target: NoteTarget, title: string, split?: boolean) => void;
}) {
  const model = useWorkspaceNotes();
  const reading = useLibraryReadingStates(model?.root ?? null, status === 'ready');
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const note = model?.catalog.notes.find(item => sameNoteTarget(item.target, target));
  const paths = buildTagPathById(tags);
  const tagId = target.owner.kind === 'tag_reading' ? target.owner.tag_id : null;
  const tag = tags.find(item => item.id === tagId);
  const loading = status === 'loading' || Boolean(model?.loading);
  const failure = error || model?.error || note?.error;
  const ready = status === 'ready' && Boolean(model?.root) && !loading && !failure;
  const sourceIds = [...new Set(note?.links.flatMap(link => link.sources.map(source => source.entry_id)) ?? [])];
  const unavailable = !note || Boolean(note.deleted_at) || !tag;
  const splitPane = layout.focusedPane === 'right' && layout.right ? 'left' : 'right';
  return <aside className="app-sidebar" aria-label="标签笔记详情" style={{ gridTemplateRows: 'auto minmax(0, 1fr)' }}>
    <div className="side-head"><span>标签笔记详情</span></div>
    <div className="flex min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 px-3 py-2">
        <h2 className="line-clamp-2 text-[13px] font-medium" title={note?.title ?? title}>{note?.title ?? title ?? '标签笔记'}</h2>
        {tag ? <Button aria-label="定位所属标签" title={`定位所属标签：${paths.get(tag.id)}`} variant="plain" size="sm" className="h-auto max-w-full justify-start px-0 py-0.5" disabled={status !== 'ready'} onClick={() => onLocateTag(tag.id)}>
          <Badge variant="secondary" className="min-w-0 gap-1"><Tag size={12} aria-hidden="true" /><span className="truncate">{paths.get(tag.id)}</span></Badge>
        </Button> : !loading ? <p className="text-xs text-muted-foreground">所属标签已删除或不可用</p> : null}
      </div>
      <SidebarPanelGroup>
        <SidebarPanel name="来源论文" label={`来源论文${ready && !unavailable ? ` · ${sourceIds.length}` : ''}`} open={sourcesOpen} onToggle={() => setSourcesOpen(value => !value)} weight={2}>
          {loading ? <p role="status" className="px-2 py-2 text-xs text-muted-foreground">正在读取笔记详情…</p>
            : failure ? <div role="alert" className="px-2 py-2 text-xs text-destructive">{failure}<Button size="xs" variant="ghost" onClick={model?.refresh}>重试</Button></div>
            : !ready ? <p className="px-2 py-2 text-xs text-muted-foreground">资料库不可用，暂时无法读取笔记详情。</p>
            : unavailable ? <p className="px-2 py-2 text-xs text-muted-foreground">{note?.deleted_at ? '此笔记已移入回收站。' : !tag ? '请先恢复所属标签。' : '此笔记已删除或不可用。'}</p>
            : <div className="space-y-1">
              {!sourceIds.length ? <p className="px-2 py-2 text-xs text-muted-foreground">尚未关联来源论文</p> : null}
              {sourceIds.map(id => {
                const entry = entries.find(item => item.id === id);
                const states = note.source_statuses?.filter(source => source.entry_id === id) ?? [];
                const warnings = [...new Set(states.filter(source => source.status !== 'available').map(source => source.message))];
                if (entry) return <SidebarPaperRow key={id} entry={entry} layout={layout} paths={paths} state={reading.states[id]} loading={reading.loading} error={reading.error}
                  splitPane={splitPane} onOpen={() => onRead(entry, false)} onSplit={() => onRead(entry, true)}
                  previewFooter={warnings.length ? <p className="text-xs text-muted-foreground">{warnings.join('；')}</p> : undefined} />;
                const removed = states.some(source => source.status === 'entry_deleted');
                const trashed = states.some(source => source.status === 'entry_trashed');
                const message = removed ? '原论文已删除' : trashed ? '原论文已移入回收站' : '来源论文暂不可用';
                return <HoverCard key={id}><HoverCardTrigger asChild>
                  <div tabIndex={0} className="flex min-h-10 min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50" aria-label={`${message} ${id}`}>
                    <FileText size={14} className="shrink-0" aria-hidden="true" /><div className="min-w-0"><p>{message}</p><p className="truncate text-[10px]">{id}</p></div>
                  </div>
                </HoverCardTrigger><HoverCardContent side="right" align="start" className="w-72 text-xs">
                  <p>{message}，笔记中的引用快照仍保留。</p><p className="mt-1 break-all text-muted-foreground">{id}</p>
                </HoverCardContent></HoverCard>;
              })}
            </div>}
          {model?.catalog.errors.map(message => <p key={message} role="alert" className="px-2 py-1 text-xs text-destructive">{message}</p>)}
        </SidebarPanel>
        <TagNotesSidebarSection tagId={tagId} descendants={false} tags={tags} contextKey={model?.root ?? ''}
          status={status} activeTarget={target} onOpen={onOpenNote} label="同标签笔记" actionScope="tag-note-details/notes" />
      </SidebarPanelGroup>
    </div>
  </aside>;
}
