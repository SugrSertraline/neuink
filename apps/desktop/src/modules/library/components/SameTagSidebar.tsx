import { ListTree, ListFilter, LocateFixed } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Toggle } from '@/components/ui/toggle';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { surfaceNoteTarget, type WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { sameTagEntries } from '@/app/tagReadingNavigation';
import type { NoteTarget, TagMeta } from '@/shared/types/domain';
import { TagNotesSidebarSection } from '@/modules/notes/components/TagNotesSidebarSection';
import { buildTagPathById, buildTagTree } from '../utils/tagTree';
import type { LibraryEntry } from './LibrarySidebar';
import { SidebarPaperRow } from './SidebarPaperRow';
import { SidebarPanel } from './SidebarPanel';
import { TagNavigation } from './TagNavigation';
import { useLibraryReadingStates } from '@/modules/reader/useLibraryReadingStates';


export function SameTagSidebar({ entries, tags, tagId, descendants, status, error, layout, workspaceRoot = null, contextKey = '', contextReason, currentEntryId, onTagChange, onDescendantsChange, onRead, onDetails, onEditTags, onLocateEntry, onOpenTagNote }: {
  entries: LibraryEntry[]; tags: TagMeta[]; tagId: string | null; descendants: boolean;
  status: 'loading' | 'ready' | 'error'; error: string | null; layout: WorkspaceSurfaceLayout;
  workspaceRoot?: string | null; contextKey?: string; contextReason?: string; currentEntryId?: string | null;
  onTagChange: (id: string | null) => void; onDescendantsChange: (value: boolean) => void;
  onRead: (entry: LibraryEntry, pane: 'left' | 'right') => void; onDetails: (entry: LibraryEntry) => void;
  onEditTags?: () => void;
  onLocateEntry?: () => void;
  onOpenTagNote?: (target: NoteTarget, title: string, split?: boolean) => void;
}) {
  const sidebarRef = useRef<HTMLElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);
  const [locateRequest, setLocateRequest] = useState<string | null>(null);
  const [tagsOpen, setTagsOpen] = useState(true);
  const [papersOpen, setPapersOpen] = useState(true);
  const tagTree = useMemo(() => buildTagTree(tags, entries), [tags, entries]);
  const filterKey = JSON.stringify([contextKey, tagId]);
  const [filter, setFilter] = useState({ key: filterKey, query: '' });
  const query = filter.key === filterKey ? filter.query : '';
  if (filter.key !== filterKey) setFilter({ key: filterKey, query: '' });
  const setQuery = (query: string) => {
    setFilter({ key: filterKey, query });
    if (query.trim()) setTagsOpen(true);
  };
  const reading = useLibraryReadingStates(workspaceRoot, status === 'ready');
  const paths = buildTagPathById(tags);
  const valid = Boolean(tagId && paths.has(tagId));
  const members = tagId === null ? entries : sameTagEntries(entries, tags, tagId, descendants);
  const filtered = members.filter(entry => `${entry.title} ${entry.pdfFileName ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const currentEntry = entries.find(entry => entry.id === currentEntryId);
  const currentInScope = members.some(entry => entry.id === currentEntryId);
  const currentVisible = filtered.some(entry => entry.id === currentEntryId);
  const activeNote = surfaceNoteTarget(layout[layout.focusedPane] ?? layout.left);
  const noteTagId = activeNote?.owner.kind === 'tag_reading' ? activeNote.owner.tag_id : null;
  const locateHint = !currentEntry ? '当前没有可定位的论文' : !currentInScope ? '当前论文不在此范围 · 点击切换范围并定位'
    : !currentVisible ? '当前论文被搜索隐藏 · 点击清除搜索并定位' : '定位当前论文';
  useLayoutEffect(() => {
    if (!locateRequest) return;
    if (locateRequest === currentEntryId && currentVisible && status === 'ready') {
      const viewport = sidebarRef.current?.querySelector<HTMLElement>('[data-sidebar-panel="论文"] [data-slot="scroll-area-viewport"]');
      const row = activeRowRef.current;
      if (viewport && row) {
        // Only an explicit locate action scrolls; never move page focus or other panes.
        viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top
          - Math.max(0, (viewport.clientHeight - row.clientHeight) / 2);
      }
    }
    setLocateRequest(null);
  }, [locateRequest, currentEntryId, currentVisible, status]);
  const toolbar = <div className="flex items-center gap-1.5">
        <SearchInput label="搜索标签或论文" placeholder="搜索标签或论文…" value={query} onValueChange={setQuery} />
        <Tooltip><TooltipTrigger asChild><Toggle aria-label="包含子标签" pressed={descendants} onPressedChange={onDescendantsChange} disabled={!valid || status !== 'ready'} variant="outline" className="size-8 shrink-0 px-0 data-[state=on]:border-primary/30 data-[state=on]:bg-primary/10 data-[state=on]:text-primary">{descendants ? <ListTree size={15} aria-hidden="true" /> : <ListFilter size={15} aria-hidden="true" />}</Toggle></TooltipTrigger><TooltipContent>{descendants ? '包含子标签的论文和笔记 · 点击仅看当前标签' : '仅当前标签 · 点击包含子标签的论文和笔记'}</TooltipContent></Tooltip>
        {noteTagId ? <Tooltip><TooltipTrigger asChild><Button aria-label="定位笔记所属标签" size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground" disabled={!paths.has(noteTagId) || status !== 'ready'} onClick={() => {
          setQuery(''); setTagsOpen(true); onTagChange(noteTagId);
        }}><LocateFixed size={15} aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>{paths.has(noteTagId) ? `定位笔记所属标签：${paths.get(noteTagId)}` : '笔记所属标签已删除或不可用'}</TooltipContent></Tooltip>
        : onLocateEntry ? <Tooltip><TooltipTrigger asChild><Button aria-label="定位当前论文" title={locateHint} size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground" disabled={!currentEntry || status !== 'ready'} onClick={() => {
          if (!currentEntry) return;
          if (!currentVisible) setQuery('');
          if (!currentInScope) onLocateEntry();
          setPapersOpen(true);
          setLocateRequest(currentEntry.id);
        }}><LocateFixed size={15} aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>{locateHint}</TooltipContent></Tooltip> : null}
      </div>;
  return <aside ref={sidebarRef} className="app-sidebar" style={{ gridTemplateRows: 'minmax(0, 1fr)' }} aria-label="标签阅读">
      <TagNavigation activeTag={tagId} nodes={tagTree} status={status} error={error} open={tagsOpen} onToggleOpen={() => setTagsOpen(value => !value)} onOpenTagDetails={id => { setQuery(''); onTagChange(id); }} onEditTags={onEditTags} revealActiveTag
        collection={{ query, toolbar, panels: true, contextLabel: contextReason, onSelectAll: () => { setQuery(''); onTagChange(null); } }}>
      <SidebarPanel name="论文" label={`论文${status === 'ready' && (tagId === null || valid) ? ` · ${filtered.length}` : ''}`} open={papersOpen} onToggle={() => setPapersOpen(value => !value)} weight={2}>
      <div className="space-y-1" aria-label="当前范围的论文">
        {status === 'loading' ? <p role="status" className="p-2 text-xs text-muted-foreground">正在读取论文…</p>
          : status === 'error' ? <p role="alert" className="p-2 text-xs text-destructive">{error || '读取失败，请重新打开资料库。'}</p>
          : tagId !== null && !valid ? <p className="p-2 text-xs text-muted-foreground">此标签已移入回收站或不可用。恢复标签，或选择其他标签继续阅读。</p>
          : filtered.length === 0 ? <p className="p-2 text-xs text-muted-foreground">{query.trim() ? '没有匹配的论文。' : '当前范围暂无论文。可在条目库为论文添加此标签。'}</p>
          : filtered.map(entry => {
            return <div key={entry.id} ref={entry.id === currentEntryId ? activeRowRef : undefined}>
              <SidebarPaperRow entry={entry} layout={layout} paths={paths} state={reading.states[entry.id]} loading={reading.loading} error={reading.error}
                active={currentEntryId === undefined ? undefined : entry.id === currentEntryId}
                onOpen={() => onRead(entry, 'left')} onSplit={() => onRead(entry, 'right')} onDetails={() => onDetails(entry)} />
            </div>;
          })}
      </div>
      </SidebarPanel>
      {onOpenTagNote ? <TagNotesSidebarSection tagId={tagId} descendants={descendants} tags={tags} contextKey={contextKey} status={status}
        activeTarget={surfaceNoteTarget(layout[layout.focusedPane] ?? layout.left)} onOpen={onOpenTagNote} /> : null}
      </TagNavigation>
  </aside>;
}
