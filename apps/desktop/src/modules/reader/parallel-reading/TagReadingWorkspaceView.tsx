import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useSurfaceCloseGuard } from '@/app/useSurfaceCloseGuard';
import type { WorkspacePaneId } from '@/app/workspaceSurface';
import type { NoteTarget, ReadingMode, TagMeta } from '@/shared/types/domain';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { MarkdownNoteEditor } from '@/modules/notes/components/MarkdownNoteEditor';
import type { SourceLinkOpenTarget } from '@/modules/notes/editor/SourceLinkNode';
import { noteOwnerKey, noteTargetKey, sameNoteTarget } from '@/shared/lib/noteOwner';
import type { PdfJumpRequest } from '../types';
import { useParallelNotes, type EntryNoteSave } from './useParallelNotes';
import { ParallelNotePicker } from './ParallelNotePicker';
import { ReadingViewSwitch, type ReadingView } from './ReadingViewSwitch';
import type { TagReadingMember, TagReadingState } from '@/shared/ipc/tagReadingApi';
import { buildTagPathById } from '@/modules/library/utils/tagTree';
import { useTagReadingWorkspace } from './useTagReadingWorkspace';
import { finishAndContinue, isReadableMember, markMember, moveReadingMember, selectReadingEntry, tagReadingProgress } from './tagReadingState';
import { TagReadingQueue } from './TagReadingQueue';
import { TagReadingToolbar } from './TagReadingToolbar';
import { ReadingViewFrame } from './ReadingViewFrame';
import { useReadingSplit } from './ReadingSplitDivider';

const NO_ENTRIES: LibraryEntry[] = [];
const NO_REFRESH = () => undefined;
const NO_SAVE: EntryNoteSave = async () => { throw new Error('笔记保存接口不可用，请重新打开项目。'); };

export function TagReadingWorkspaceView({ root, tagId, tags, refreshKey, active, pane, availableEntryIds, entries = NO_ENTRIES, onSaveEntryNote = NO_SAVE, onRefreshEntries = NO_REFRESH, onOpenSourceLink, onOpenNote, renderReader, onOpenLibrary }: {
  root: string | null; tagId: string; tags: TagMeta[]; refreshKey: string; active: boolean; pane: WorkspacePaneId;
  availableEntryIds: Set<string>;
  entries?: LibraryEntry[]; onSaveEntryNote?: EntryNoteSave; onRefreshEntries?: () => Promise<void> | void;
  onOpenSourceLink?: (target: SourceLinkOpenTarget) => void;
  onOpenNote?: (target: NoteTarget) => void;
  renderReader: (entryId: string, mode: ReadingMode, scopeKey: string) => ReactNode;
  onOpenLibrary: () => void;
}) {
  const model = useTagReadingWorkspace(root, tagId, refreshKey);
  const { state, members, loading, saving, error, commit } = model;
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueMode, setQueueMode] = useState<'read' | 'compare'>('read');
  const queueTrigger = useRef<HTMLElement | null>(null);
  const [display, setDisplay] = useState<ReadingView>('current');
  const restoredDisplay = useRef(false);
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [jumps, setJumps] = useState<Record<string, PdfJumpRequest>>({});
  const jumpSequence = useRef(0);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [modes, setModes] = useState<Record<string, ReadingMode>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const memberHistory = useRef(new Map<string, TagReadingMember>());
  for (const member of members) memberHistory.current.set(member.entry_id, member);
  const exists = tags.some((tag) => tag.id === tagId);
  const rawTarget = state?.active_note ?? null;
  // Preserve editor/asset extension identity when task progress is re-saved.
  const targetKey = rawTarget ? noteTargetKey(rawTarget) : '';
  const target = useMemo(() => rawTarget, [targetKey]);
  useEffect(() => {
    if (!state || restoredDisplay.current) return;
    restoredDisplay.current = true;
    if (state.active_note && state.auxiliary_view === 'note') setDisplay('note');
  }, [state]);
  const tagTitle = tags.find((tag) => tag.id === tagId)?.name ?? '标签不可用';
  const notes = useParallelNotes({ root, tagId, tagTitle, entries, memberIds: members.map((member) => member.entry_id), target, open: notePickerOpen, refreshKey, onSaveEntryNote, onRefreshEntries });
  const disabled = loading || saving || Boolean(error) || !exists || notes.busy || Boolean(notes.pending);
  const guard = useSurfaceCloseGuard({ root, onClose: () => undefined });
  const guarded = (action: () => void, scopes?: string[]) => {
    if (scopes?.length === 0) { action(); return; }
    guard.requestClose((scopes ?? [undefined]).map((scopeKey) => ({ pane, surface: { kind: 'tag-reading' as const, tagId }, scopeKey })), action);
  };
  const readerScopes = (...ids: (string | null | undefined)[]) => ids.filter(Boolean).flatMap((id) => [`tag-reading:${tagId}/pdf:${id}`, `tag-reading:${tagId}/reflow:${id}`]);
  const noteScopes = target ? [`tag-reading:${tagId}/note:${targetKey}`] : [];
  const change = (update: (value: TagReadingState) => TagReadingState) => { void commit(update); };
  const path = useMemo(() => buildTagPathById(tags).get(tagId) ?? '已删除的标签', [tags, tagId]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const queueVisible = width >= 1120 && !state?.queue_collapsed;
  const readingWidth = width - (queueVisible ? 270 : 0);
  const noteVisible = Boolean(target) && (state?.auxiliary_view === 'note' || !state?.compare_entry_id);
  const hasAuxiliary = Boolean(target || state?.compare_entry_id);
  const dual = readingWidth >= 800 && hasAuxiliary && Boolean(state?.active_entry_id);
  const split = useReadingSplit(state?.split_ratio ?? 0.5, (split_ratio) => commit((current) => ({ ...current, split_ratio })), dual && !disabled, readingWidth);
  const leftWidth = Math.min(Math.max(readingWidth * split.ratio, 360), Math.max(360, readingWidth - 364));
  const ready = useCallback((entryId: string) => {
    if (!active || disabled || !state || state.member_states[entryId]?.status !== 'unread') return;
    void commit((current) => markMember(current, entryId, 'reading'));
  }, [active, disabled, state, commit]);
  const progress = state ? tagReadingProgress(state, members) : null;
  const currentMember = state?.active_entry_id ? memberHistory.current.get(state.active_entry_id) : null;
  const canFinish = Boolean(currentMember && members.some((member) => member.entry_id === currentMember.entry_id && isReadableMember(member)));
  const slots = state ? [state.active_entry_id, state.compare_entry_id].filter((id): id is string => Boolean(id)) : [];
  const openQueue = (mode: 'read' | 'compare') => {
    queueTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQueueMode(mode);
    setQueueOpen(true);
  };
  const selectDisplay = (value: ReadingView) => {
    const show = () => { setDisplay(value); setFocusedId(value === 'current' ? state?.active_entry_id ?? null : value === 'compare' ? state?.compare_entry_id ?? null : null); };
    if (value === 'current') show();
    else void commit((current) => ({ ...current, auxiliary_view: value })).then((saved) => { if (saved) show(); });
  };
  const selectNote = (next: NoteTarget) => guarded(() => {
    if ((!state || error) && onOpenNote) { setNotePickerOpen(false); onOpenNote(next); return; }
    void commit((current) => ({ ...current, active_note: next, auxiliary_view: 'note' })).then((saved) => {
      if (saved) { setNotePickerOpen(false); setDisplay('note'); setFocusedId(null); }
    });
  }, noteScopes);
  const closeNote = () => guarded(() => {
    void commit((current) => ({ ...current, active_note: null, auxiliary_view: 'compare' })).then((saved) => { if (saved) setDisplay('current'); });
  }, noteScopes);
  const openSource = (source: SourceLinkOpenTarget) => {
    if (!source.sourceEntryId || !availableEntryIds.has(source.sourceEntryId)) { setNotice('来源条目不可用，请先从回收站恢复。'); return; }
    const id = source.sourceEntryId;
    if (!members.some((member) => member.entry_id === id && isReadableMember(member))) {
      onOpenSourceLink?.(source); return;
    }
    guarded(() => {
      void commit((current) => selectReadingEntry(current, id)).then((saved) => {
        if (!saved) return;
        const requestKey = ++jumpSequence.current;
        const pageIdx = Math.max(0, (source.page ?? 1) - 1);
        setJumps((current) => ({ ...current, [id]: source.segmentUid ? { kind: 'segment', segmentUid: source.segmentUid, pageIdx, requestKey } : { kind: 'page', pageIdx, requestKey } }));
        setDisplay('current'); setFocusedId(id);
      });
    }, readerScopes(state?.active_entry_id));
  };
  const viewSwitch = (includeCurrent: boolean) => ({ value: dual ? (noteVisible ? 'note' as const : 'compare' as const) : display,
    currentTitle: includeCurrent ? currentMember?.title ?? '' : undefined,
    compareTitle: state?.compare_entry_id ? memberHistory.current.get(state.compare_entry_id)?.title ?? '' : undefined,
    noteTitle: target ? notes.selected?.title ?? '文档笔记' : undefined, onChange: selectDisplay });
  const buildQueue = (mode: 'read' | 'compare') => state ? <TagReadingQueue state={state} members={members} disabled={disabled} mode={mode}
    onSelect={(id) => guarded(() => {
      setQueueOpen(false);
      void commit((current) => selectReadingEntry(current, id)).then((saved) => {
        if (saved) { setDisplay('current'); setFocusedId(id); setNotice(null); }
      });
    }, readerScopes(state.active_entry_id))}
    onCompare={(id) => guarded(() => {
      setQueueOpen(false);
      void commit((current) => ({ ...current, compare_entry_id: id, auxiliary_view: 'compare' })).then((saved) => {
        if (saved) { setDisplay('compare'); setFocusedId(id); setNotice(null); }
      });
    }, readerScopes(state.compare_entry_id))}
    onStatus={(id, status) => change((current) => markMember(current, id, status))}
    onMove={(id, delta) => change((current) => moveReadingMember(current, members, id, delta))} /> : null;

  return <div ref={container} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card" data-testid="tag-reading-workspace">
    <TagReadingToolbar title={tags.find((tag) => tag.id === tagId)?.name ?? '标签不可用'} path={path} compact={width < 600}
      progress={progress} saveStatus={saving ? '保存中…' : model.hasPending ? '未保存' : state && state.revision > 0 ? '已保存' : ''}
      disabled={disabled} noteDisabled={!root || !exists || notes.busy || Boolean(notes.pending)} loaded={Boolean(state)} queueVisible={queueVisible} hasCompare={Boolean(state?.compare_entry_id)} canFinish={canFinish}
      viewingCompare={!dual && display !== 'current'} currentTitle={currentMember?.title ?? ''} includeDescendants={state?.include_descendants ?? false}
      onBack={onOpenLibrary}
      onQueue={() => {
        if (width >= 1120) void commit((current) => ({ ...current, queue_collapsed: !current.queue_collapsed }));
        else openQueue('read');
      }}
      onCompare={() => openQueue('compare')}
      onNote={() => setNotePickerOpen(true)} hasNote={Boolean(target)} onCloseNote={closeNote}
      onFinish={() => guarded(() => {
          const next = finishAndContinue(state!, members);
          void commit(() => next).then((saved) => {
            if (!saved) return;
            setDisplay('current'); setFocusedId(next.active_entry_id);
            setNotice(next.active_entry_id === state?.active_entry_id ? '主读论文已标为已读。没有下一篇未读论文，可从论文列表选择其他论文。' : null);
          });
      }, readerScopes(state?.active_entry_id))}
      onIncludeDescendants={(include_descendants) => guarded(() => { void commit((current) => ({ ...current, include_descendants })).then((saved) => { if (saved) void model.reload(true); }); })}
      onSwap={() => guarded(() => change((current) => ({ ...current, active_entry_id: current.compare_entry_id, compare_entry_id: current.active_entry_id })), readerScopes(state?.active_entry_id, state?.compare_entry_id))}
      onRemoveCompare={() => guarded(() => { void commit((current) => ({ ...current, compare_entry_id: null })).then((saved) => { if (saved) setDisplay('current'); }); }, readerScopes(state?.compare_entry_id))}
      onReload={() => guarded(() => { void model.reload(true); })}
    />
    {notice ? <p role="status" className="shrink-0 border-b px-2 py-1 text-xs text-muted-foreground">{notice}</p> : null}
    {error ? <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1 text-xs text-destructive"><span className="min-w-0 flex-1 break-words">{error}</span><Button size="xs" variant="outline" disabled={saving} onClick={() => { if (model.hasPending) void model.retry(); else void model.reload(); }}>重试</Button></div> : null}
    {!exists ? <div className="p-3 text-sm">标签已移入回收站。描述、标签笔记与阅读状态已保留，可在回收站恢复。</div> : null}
    {loading && !state ? <p role="status" className="p-3 text-sm text-muted-foreground">正在载入标签阅读队列…</p> : null}
    {state ? <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {queueVisible ? <aside aria-label="论文列表" className="h-full w-[270px] shrink-0 overflow-hidden border-r">{buildQueue('read')}</aside> : null}
      <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden" data-reading-resizing={split.resizing}>
        {slots.length === 0 ? <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-2 p-4 text-sm text-muted-foreground"><p>暂无可读论文。为条目添加此标签后，从论文列表打开 PDF 或重排视图。</p><Button variant="outline" onClick={() => guarded(onOpenLibrary)}>打开条目库</Button></div> : null}
        {slots.map((id, index) => {
          const member = memberHistory.current.get(id);
          if (!member) return null;
          const preference = modes[id] ?? member.preferred_mode;
          const mode = preference === 'pdf' && !member.pdf_available ? 'reflow' : preference === 'reflow' && !member.reflow_available ? 'pdf' : preference;
          const hidden = index === 0 ? (!dual && hasAuxiliary && display !== 'current') : (dual ? noteVisible : display !== 'compare');
          const focus = focusedId === 'note' ? null : focusedId && slots.includes(focusedId) ? focusedId : state.active_entry_id;
          return <ReadingSlot key={id} divider={index === 1 && dual && !noteVisible ? split.divider : null}>
            <ReadingViewFrame member={member} role={index === 0 ? '主读论文' : '对照论文'} mode={mode} hidden={hidden} disabled={disabled}
              viewSwitch={(!dual && hasAuxiliary) || (index === 1 && target) ? viewSwitch(!dual) : undefined}
              note={target && notes.writable && !notes.selected?.deleted ? { title: notes.selected?.title ?? '文档笔记', onAddSource: async (entryId, segmentUid) => { await notes.addSource(entryId, segmentUid); selectDisplay('note'); } } : undefined}
              jump={jumps[id]}
              resizing={split.resizing}
              active={active && (dual ? focus === id : !hidden)} width={dual && index === 0 ? `${leftWidth}px` : undefined}
              removed={!members.some((item) => item.entry_id === id)} onFocus={() => setFocusedId(id)} onReady={ready}
              onMode={(next) => guarded(() => setModes((current) => ({ ...current, [id]: next })), readerScopes(id))}>
              {availableEntryIds.has(id) ? renderReader(id, mode, `tag-reading:${tagId}/${mode}:${id}`) : <p className="p-3 text-sm text-muted-foreground">条目已移入回收站或不可用，请恢复条目后重试。</p>}
            </ReadingViewFrame>
          </ReadingSlot>;
        })}
        {target ? <ReadingSlot key="note-pane" divider={dual && noteVisible ? split.divider : null}>
          <section aria-label="文档笔记阅读区" data-reading-note className={`h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${dual ? noteVisible ? 'flex' : 'hidden' : display === 'note' || !state.active_entry_id ? 'flex' : 'hidden'}`} onPointerDown={() => setFocusedId('note')} onFocusCapture={() => setFocusedId('note')}>
            <div className="flex h-9 min-w-0 shrink-0 items-center gap-1 border-b bg-muted px-2">
              <ReadingViewSwitch {...viewSwitch(!dual)} />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={notes.selected?.ownerTitle}>{notes.selected?.ownerTitle ?? (target.owner.kind === 'tag_reading' ? `标签综合笔记 · ${tagTitle}` : '论文文档笔记')}</span>
              <Button size="xs" variant="ghost" disabled={disabled} onClick={() => setNotePickerOpen(true)}>更换</Button>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              {exists && !notes.selected?.deleted && (target.owner.kind !== 'entry' || entries.some((entry) => target.owner.kind === 'entry' && entry.id === target.owner.entry_id && entry.contents.some((item) => item.kind === 'note' && item.note_id === target.note_id))) ? <MarkdownNoteEditor key={targetKey} entryId={noteOwnerKey(target.owner)} noteOwner={target.owner} noteId={target.note_id}
                editorScopeKey={`tag-reading:${tagId}/note:${targetKey}`} fallbackTitle={notes.selected?.title ?? '文档笔记'} entryTitle={notes.selected?.ownerTitle ?? tagTitle}
                workspaceRoot={root} compact onLoadNote={notes.load} onSaveNote={notes.save} onWritableChange={notes.setWritable}
                sourceLinkToInsert={notes.pending} onSourceLinkInserted={notes.inserted} onCreateSourceLinkFromPaste={notes.buildSource} onOpenSourceLink={openSource} /> : <p className="p-3 text-sm text-muted-foreground">笔记或所属条目已删除，恢复后可继续编辑。</p>}
            </div>
          </section>
        </ReadingSlot> : null}
      </div>
    </div> : null}
    <Dialog open={queueOpen} onOpenChange={setQueueOpen}><DialogContent className="flex h-[75%] min-h-0 flex-col overflow-hidden" onCloseAutoFocus={(event) => { event.preventDefault(); if (queueTrigger.current?.isConnected) queueTrigger.current.focus(); }}>
      <DialogHeader><DialogTitle>{queueMode === 'compare' ? '选择对照论文' : '论文列表'}</DialogTitle><DialogDescription className="truncate" title={path}>{path}</DialogDescription></DialogHeader>
      <div className="min-h-0 flex-1 overflow-hidden">{buildQueue(queueMode)}</div>
    </DialogContent></Dialog>
    <ParallelNotePicker open={notePickerOpen} onOpenChange={setNotePickerOpen} options={notes.options} tagId={tagId} tagTitle={tagTitle}
      papers={members.map((member) => ({ id: member.entry_id, title: member.title }))} loading={notes.loading} busy={!exists || notes.busy || Boolean(notes.pending)} error={notes.error} onRetry={notes.reload}
      onSelect={selectNote} onCreate={(owner, title) => { void notes.create(owner, title).then((created) => { if (created) selectNote(created); }); }}
      onSetDeleted={(option, deleted) => guarded(() => {
        // Close first, so a successful deletion can never leave an editable stale document.
        const remove = async () => {
          if (deleted && sameNoteTarget(option.target, target)) {
            if (!await commit((current) => ({ ...current, active_note: null, auxiliary_view: 'compare' }))) return;
            setDisplay('current');
          }
          await notes.setDeleted(option, deleted);
        };
        void remove();
      })} />
    {guard.dialog}
  </div>;
}

function ReadingSlot({ divider, children }: { divider: ReactNode; children: ReactNode }) {
  return <>{divider}{children}</>;
}
