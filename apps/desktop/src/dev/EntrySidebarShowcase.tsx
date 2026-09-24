import { useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { EntryOverview } from '@/modules/reader/components/EntryOverview';
import type { EntryUpdate } from '@/modules/library/components/EntryEditPage';
import { buildTagPathById } from '@/modules/library/utils/tagTree';
import { WorkspaceTrashView } from '@/modules/reader/components/WorkspaceTrashView';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LibrarySidebar, type LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { SameTagSidebar } from '@/modules/library/components/SameTagSidebar';
import { sameTagEntries, startTagReadingActions, tagNoteOpenPane, tagReadingSurface } from '@/app/tagReadingNavigation';
import { useSameTagContext } from '@/app/useSameTagContext';
import { useSidebarResize } from '@/app/useSidebarResize';
import { WorkspaceNotesProvider, useWorkspaceNotes } from '@/modules/notes/WorkspaceNotesContext';
import { TagPreferencesProvider } from '@/shared/components/TagPreferencesProvider';
import { ToastContext } from '@/shared/hooks/useToast';
import { notifyNotesChanged, type CatalogNote, type NoteCatalog } from '@/shared/ipc/noteCatalogApi';
import type { TagMeta } from '@/shared/types/domain';
import { resolveEntrySidebarContext, resolveTagNoteSidebarContext } from '@/app/entrySidebarContext';
import { TagNoteDetailsSidebar } from '@/modules/notes/components/TagNoteDetailsSidebar';
import { entryContentSurface, initialWorkspaceSurfaceLayout, noteSurface, surfaceKey, surfaceNoteTarget, workspaceSurfaceOpenActions, workspaceSurfaceReducer } from '@/app/workspaceSurface';
import { AppearanceProvider } from '@/shared/components/AppearanceProvider';
import { TitleBar } from '@/shared/components/TitleBar';
import { AppearanceExit } from '@/shared/components/AppearanceExit';
import { SearchDialog } from '@/modules/search/components/SearchDialog';
import { SearchPanel } from '@/modules/search/components/SearchPanel';
import { AssistantPanel } from '@/modules/assistant/components/AssistantPanel';
import { AppearanceControlsPreview } from './AppearanceControlsPreview';
import '../styles/globals.css';

const root = 'entry-sidebar-showcase';
const noop = () => undefined;
const asyncNoop = async () => undefined;
const assistantContext = { items: [] };
const assistantSurface = { capturedAt: '', entryId: null, kind: 'library' as const, noteId: null, pane: 'left' as const, segmentUid: null, surfaceKey: 'library' };
const conversation = { id: 'palette', title: '示例对话：论文比较', scope_snapshot: { kind: 'global' }, created_at: '', updated_at: '', messages: [
  { message_id: 'question', role: 'user', content: '这些论文如何处理需求验证？', source_links: [], created_at: '' },
  { message_id: 'answer', role: 'assistant', content: '可以比较 **验证目标、证据来源、评估方法**。\n\n先记录各篇论文的结论，再将引用放入同一篇标签笔记。', source_links: [], created_at: '' }
] };
const tags: TagMeta[] = [
  { id: 'software', name: '软件工程', parent_id: null, created_at: '', updated_at: '' },
  { id: 'alignment', name: '需求理解与多篇论文的研究证据对齐', parent_id: 'software', created_at: '', updated_at: '' },
  { id: 'other', name: '人机交互', parent_id: null, created_at: '', updated_at: '' }
];
const entry: LibraryEntry = { id: 'paper', title: 'Bridging the Gap between User Intent and LLM: A Requirement Alignment Approach',
  contents: [{ kind: 'note', note_id: 'summary', title: '这篇论文的阅读小结' }, { kind: 'note', note_id: 'methods', title: '方法对比：跨论文需求验证与原文证据的完整记录' }], tagIds: ['alignment'], tags: ['软件工程/需求理解与多篇论文的研究证据对齐'],
  fields: { description: '对比论文的需求表达与证据，记录阅读中仍待验证的问题。' }, createdAt: '', updatedAt: '', pdfFileName: 'requirement-alignment.pdf',
  parseMessage: null, parseEndpoint: null, status: 'Parsed', progress: 100 };
const secondEntry: LibraryEntry = { ...entry, id: 'second', title: '未添加 PDF 的新论文', tagIds: [], tags: [], contents: [{ kind: 'note', note_id: 'draft', title: '还没有 PDF 时整理的阅读笔记' }], fields: {}, pdfFileName: null, status: 'No PDF' };
const comparisonEntry: LibraryEntry = { ...entry, id: 'comparison', title: '对照论文：需求验证与人工评审之间的联系', tagIds: ['software'], tags: ['软件工程'] };
const baseEntries = [entry, secondEntry, comparisonEntry];
const note = (title: string, tag = 'software', cited = true): CatalogNote => ({ title,
  target: { owner: { kind: 'tag_reading', tag_id: tag }, note_id: title }, owner_title: tags.find(item => item.id === tag)?.name ?? tag,
  updated_at: '', deleted_at: null, error: null, revision: '1', links: cited ? [{ link_id: title, anchor_id: title, display_text: '论文证据',
    owner: { kind: 'tag_note', tag_id: tag, note_id: title }, created_at: '', sources: [{ entry_id: 'paper', segment_uid: 'source', page: 1, snapshot_text: '保留的原文证据', quote_hash: '' }] }] : [] });
let catalog: NoteCatalog = { notes: [note('跨论文比较：需求如何被验证'), note('待验证的研究想法', 'software', false),
  note('长标题：理解用户意图时如何同时保存多个来源并建立可以持续修订的研究结论'), note('从交互角度引用这篇论文', 'other'),
  note('需求对齐的相关笔记', 'alignment'), { ...note('之前删除的笔记'), deleted_at: 'now' }], errors: [] };
let mode: 'ready' | 'loading' | 'error' = 'ready';
// The isolated showcase intercepts all IPC, including mutations; no real workspace is accessed.
mockWindows('main');
mockIPC(async (command, payload) => {
  if (command === 'get_llm_settings') return { profiles: [], assistant_profile_id: 'showcase', assistant_profile: null, translation_profile_id: null, translation_profile: null };
  if (command === 'analyze_entry_tags') return { policy_version: 'showcase', recommendations: [
    { path: entry.tags[0], reason: '与现有研究主题一致', source: 'existing', dimension: '研究主题', confidence: 0.96 },
    { path: '软件工程/需求验证', reason: '比较需求表达与证据验证的方法', source: 'new', dimension: '研究方法', confidence: 0.88 },
    { path: '人机交互', reason: '研究用户意图和人工评审', source: 'existing', dimension: '领域', confidence: 0.84 },
  ] };
  if (command === 'list_conversations') return [{ ...conversation, messages: undefined, message_count: conversation.messages.length }];
  if (command === 'load_conversation') return conversation;
  if (command === 'list_agent_runs') return [];
  if (command === 'plugin:window|is_maximized') return false;
  if (command === 'list_reading_states') return [{ entry_id: 'paper', version: 1, document_hash: null, mode: 'pdf', current_page_idx: 3, page_count: 12, visited_pages: [0, 1, 2, 3], total_active_ms: 420000, session_count: 1, last_read_at: null, daily_active_ms: {} }];
  if (command === 'list_tag_archives') return [];
  if (command === 'read_note_catalog') {
    if (mode === 'loading') return new Promise(() => undefined);
    if (mode === 'error') throw new Error('笔记目录读取失败，请刷新重试。');
    return structuredClone(catalog);
  }
  if (command === 'tag_note') {
    const { tag_id: tagId, action } = (payload as { request: { tag_id: string; action: { kind: string; title: string; note_id: string; deleted: boolean } } }).request;
    if (action.kind === 'create') {
      const created = note(action.title, tagId, false);
      catalog = { ...catalog, notes: [...catalog.notes, created] };
      return { note_id: created.target.note_id, title: created.title, markdown: '', links: [], revision: '1' };
    }
    if (action.kind === 'set_deleted') catalog = { ...catalog, notes: catalog.notes.map(item => item.target.note_id === action.note_id ? { ...item, deleted_at: action.deleted ? 'now' : null } : item) };
  }
}, { shouldMockEvents: true });

function SidebarShowcase() {
  const [editableEntries, setEditableEntries] = useState(baseEntries);
  const updateEntry = (id: string, request: EntryUpdate) => setEditableEntries(current => current.map(item => item.id === id ? {
    ...item, title: request.title, fields: request.fields, tags: request.tagPaths,
    tagIds: [...buildTagPathById(tags)].filter(([, path]) => request.tagPaths.includes(path)).map(([tagId]) => tagId),
  } : item));
  const [searchOpen, setSearchOpen] = useState(false);
  const [longList, setLongList] = useState(false);
  const showcaseEntries = longList ? [...editableEntries.map(item => item.id === 'paper' ? { ...item, contents: [...item.contents, ...Array.from({ length: 30 }, (_, i) => ({ kind: 'note' as const, note_id: `long-${i}`, title: `阅读记录 ${i + 1}：长笔记列表中的来源对照` }))] } : item), ...Array.from({ length: 24 }, (_, index) => ({ ...comparisonEntry, id: `sample-${index}`, title: `示例论文 ${index + 1}：检查长列表右侧按钮与滚动条间距` }))] : editableEntries;
  const [layout, dispatch] = useReducer(workspaceSurfaceReducer, workspaceSurfaceReducer(initialWorkspaceSurfaceLayout,
    { type: 'open', surface: { kind: 'entry-overview', entryId: 'paper', contextTagId: 'software' } }));
  const [libraryView, setLibraryView] = useState<'all' | 'trash'>('all');
  const [width, setWidth] = useState(360);
  const [shellRevision, setShellRevision] = useState(0);
  const sidebarContainer = useRef<HTMLDivElement>(null);
  const sidebarResize = useSidebarResize({ width, min: 220, max: 820, enabled: true, onCommit: setWidth, containerRef: sidebarContainer });
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState(mode);
  const [panel, setPanel] = useState<'details' | 'same-tag' | 'search' | 'assistant'>('details');
  const readingContext = useSameTagContext(root, layout, showcaseEntries, tags, 'software', panel === 'same-tag' && status === 'ready');
  const readingTag = readingContext.tagId;
  const descendants = readingContext.descendants;
  const context = resolveEntrySidebarContext(layout);
  const sidebarNote = resolveTagNoteSidebarContext(layout);
  const current = showcaseEntries.find(item => item.id === context?.entryId) ?? entry;
  const focused = layout.focusedPane === 'right' && layout.right ? layout.right : layout.left;
  const notes = useWorkspaceNotes();
  return <><SearchDialog open={searchOpen} onOpenChange={setSearchOpen} root={null} status="ready" onOpenResult={noop} /><main data-material="app-background" className="flex flex-col overflow-hidden bg-background" style={{ width: `calc(100dvw / ${scale})`, height: `calc(100dvh / ${scale})` }}>
    <div className="shrink-0"><TitleBar onOpenSearch={() => setSearchOpen(true)} /></div>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
      <Button size="sm" variant="outline" onClick={() => setSearchOpen(true)}>搜索</Button><AppearanceExit /><AppearanceControlsPreview />
      <Button size="sm" onClick={() => dispatch({ type: 'open', pane: 'left', surface: { kind: 'entry-overview', entryId: 'paper', contextTagId: 'software' } })}>从软件工程打开</Button>
      <Button size="sm" variant="outline" onClick={() => dispatch({ type: 'open', pane: 'left', surface: { kind: 'entry-overview', entryId: 'paper' } })}>直接打开论文</Button>
      <Button size="sm" variant="outline" onClick={() => dispatch({ type: 'open', pane: 'left', surface: { kind: 'entry-overview', entryId: 'second' } })}>无标签和 PDF</Button>
      <Button size="sm" variant="outline" onClick={() => { readingContext.startReading('software'); setPanel('same-tag'); startTagReadingActions(layout, sameTagEntries(showcaseEntries, tags, 'software', true), 'software').forEach(dispatch); }}>平行阅读</Button>
      <Button size="sm" variant="outline" onClick={() => setPanel('same-tag')}>标签阅读</Button>
      <Button size="sm" variant="outline" onClick={() => setPanel('details')}>条目详情</Button>
      <Button size="sm" variant="outline" onClick={() => setPanel('search')}>搜索侧栏</Button>
      <Button size="sm" variant="outline" onClick={() => setPanel('assistant')}>对话侧栏</Button>
      <Button size="sm" variant="outline" onClick={() => setLongList(value => !value)}>{longList ? '精简列表' : '长列表检查'}</Button>
      {[220, 360].map(value => <Button key={value} size="sm" variant="outline" onClick={() => setWidth(value)}>{value}px 侧栏</Button>)}
      <Button size="sm" variant="outline" onClick={() => setShellRevision(value => value + 1)}>重建容器检查</Button>
      {[1, 1.25].map(value => <Button key={value} size="sm" variant="outline" onClick={() => { document.documentElement.style.zoom = String(value); setScale(value); }}>{value * 100}%</Button>)}
      <Button size="sm" variant="outline" onClick={() => { mode = status === 'ready' ? 'loading' : status === 'loading' ? 'error' : 'ready'; setStatus(mode); notifyNotesChanged(root); }}>{status === 'ready' ? '模拟加载' : status === 'loading' ? '模拟失败' : '恢复正常'}</Button>
    </div>
    <div key={shellRevision} ref={sidebarResize.observeContainer} className="relative flex min-h-0 flex-1">
      <div className="flex min-h-0 shrink-0" style={{ width: sidebarResize.effectiveWidth }}>
        {panel === 'search' ? <SearchPanel root={null} status={status} onOpenResult={noop} /> : null}
        {panel === 'assistant' ? <AssistantPanel root={root} status={status} activeEntry={null} activeTag={null} activeNote={null} activeSegment={null}
          assistantContext={assistantContext} activeSurface={assistantSurface} composerDraft={null} draftQuestion={null} entries={showcaseEntries} tags={tags}
          onClearAssistantContext={noop} onComposerDraftChange={noop} onCreateAssistantEntry={async () => entry}
          onApplyNoteProposal={async proposal => proposal} onApplyEntryMetaProposal={asyncNoop} onApplyTagProposal={asyncNoop}
          onAddAssistantContext={noop} onDraftQuestionConsumed={noop} onExportConversation={asyncNoop} onOpenSettings={noop} onOpenSource={noop}
          onAddSciverseSource={async () => { throw new Error('预览不导入论文'); }} onReplaceAssistantContext={noop} onRemoveAssistantContextItem={noop} /> : null}
        <div className={panel === 'same-tag' ? 'contents' : 'hidden'}><SameTagSidebar entries={showcaseEntries} tags={tags} tagId={readingTag} descendants={descendants} status={status} error={status === 'error' ? '论文列表加载失败' : null} layout={layout}
          workspaceRoot={root} contextKey={readingContext.contextKey} contextReason={readingContext.reason} currentEntryId={readingContext.entryId}
          onTagChange={readingContext.selectTag} onDescendantsChange={readingContext.setDescendants}
          onLocateEntry={readingContext.locateEntry}
          onOpenTagNote={(target, title, split) => workspaceSurfaceOpenActions(layout, noteSurface(target, title), tagNoteOpenPane(layout, target, split)).forEach(dispatch)}
          onRead={(item, pane) => workspaceSurfaceOpenActions(layout, tagReadingSurface(item, readingTag ?? undefined), pane).forEach(dispatch)}
          onOpenContent={(item, id, pane) => workspaceSurfaceOpenActions(layout, entryContentSurface(item.id, id, readingTag ?? undefined), pane).forEach(dispatch)}
          onDetails={item => workspaceSurfaceOpenActions(layout, { kind: 'entry-overview', entryId: item.id, contextTagId: readingTag ?? undefined }).forEach(dispatch)}
          /></div>
        <div className={panel === 'details' ? 'contents' : 'hidden'}>
        {sidebarNote ? <TagNoteDetailsSidebar target={sidebarNote.target} title={sidebarNote.label} entries={showcaseEntries} tags={tags} status={status} error={null} layout={layout}
          onLocateTag={id => { readingContext.locateTag(id); setPanel('same-tag'); }}
          onRead={(item, split) => workspaceSurfaceOpenActions(layout, tagReadingSurface(item), split ? layout.focusedPane === 'right' ? 'left' : 'right' : undefined).forEach(dispatch)}
          onOpenNote={(target, title, split) => workspaceSurfaceOpenActions(layout, noteSurface(target, title), tagNoteOpenPane(layout, target, split)).forEach(dispatch)} />
        : <LibrarySidebar activeTag="software" activeView={libraryView} entries={[entry, secondEntry]} trashItemCount={0} error={null} entryExplorerOpen={Boolean(context)}
          status="ready" tags={tags} activeContentId={context?.contentId ?? null} selectedEntry={context ? current : null} recentReadingEntryIds={[]}
          tagNotes={context ? { contextTagId: context.contextTagId, scope: surfaceKey(context.surface), activeTarget: surfaceNoteTarget(focused),
            onOpen: (target, title, split) => workspaceSurfaceOpenActions(layout, noteSurface(target, title), tagNoteOpenPane(layout, target, split)).forEach(dispatch) } : undefined}
          onCreateMarkdownNote={noop} onDeleteMarkdownNote={noop}
          onAttachPdf={noop} onOpenMarkdownInPdfPane={noop}
          onOpenContentInRight={id => dispatch({ type: 'open', pane: 'right', surface: entryContentSurface(current.id, id, context?.contextTagId) })}
          onRenameMarkdownNote={noop} onRenamePdfDisplayName={noop} onOpenCreateEntryTab={noop} onOpenTagEditorTab={noop}
          onSelectContent={id => dispatch({ type: 'open', pane: context?.pane, surface: entryContentSurface(current.id, id, context?.contextTagId) })}
          onOpenTagDetails={noop} onSelectView={view => { setLibraryView(view === 'trash' ? 'trash' : 'all'); dispatch({ type: 'open', surface: { kind: 'library' } }); }} onClearFilters={noop} onUpdateEntry={noop} />}
        </div>
      </div>
      <div role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={sidebarResize.maxWidth} aria-valuenow={sidebarResize.effectiveWidth} tabIndex={0}
        className="w-1 shrink-0 cursor-col-resize touch-none bg-border focus-visible:bg-primary" onPointerDown={sidebarResize.onPointerDown} onKeyDown={sidebarResize.onKeyDown} />
      {sidebarResize.previewWidth !== null && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ left: sidebarResize.previewWidth }} />}
      <div className="app-editor min-w-0 flex-1" style={{ gridColumn: 'auto', gridRow: 'auto' }}><div className={`grid h-full min-h-0 ${layout.right ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {(['left', 'right'] as const).map(pane => {
          const surface = layout[pane];
          if (!surface) return null;
          const target = surface ? surfaceNoteTarget(surface) : null;
          return <section key={pane} aria-label={`${pane === 'left' ? '左' : '右'}侧内容`} data-preview-surface={surfaceKey(surface)} className="min-h-0 min-w-0 overflow-hidden border-l bg-card" onClick={() => dispatch({ type: 'focus', pane })}>
            {surface?.kind === 'entry-overview' ? <EntryOverview key={surfaceKey(surface)} entry={showcaseEntries.find(item => item.id === surface.entryId) ?? entry} tags={tags} workspaceRoot={root} sourceBacklinksBySegmentUid={{}} onUpdateEntry={updateEntry}
              onCreatePdfVersion={asyncNoop} onAttachPdf={asyncNoop} onImportMineruClientResult={asyncNoop}
              onApplyEntryTagPaths={(id, paths) => { const original = showcaseEntries.find(item => item.id === id)!; updateEntry(id, { title: original.title, fields: original.fields, tagPaths: [...new Set([...original.tags, ...paths])] }); }}
              onOpenContent={id => dispatch({ type: 'open', pane, surface: entryContentSurface(surface.entryId, id, surface.contextTagId) })} />
              : surface?.kind === 'library' && libraryView === 'trash' ? <div className="flex h-full min-h-0 flex-col"><WorkspaceTrashView root={root} tags={tags} items={[]} onRestoreTag={async () => 0} onPurgeEntry={noop} onPurgeItem={noop} onRestoreEntry={noop} onRestoreItem={noop} /></div>
              : <div className="p-5"><p className="mb-4 text-xs text-muted-foreground">{pane === 'left' ? '左' : '右'}侧内容 · {layout.focusedPane === pane ? '当前焦点' : '未聚焦'}</p>
            <h1 className="break-words text-base font-semibold">{target ? surface?.kind === 'owned-note' ? surface.label : '文档笔记' : surface && 'entryId' in surface ? showcaseEntries.find(item => item.id === surface.entryId)?.title : '在左侧选择笔记'}</h1>
            <p className="mt-3 text-sm text-muted-foreground">此页使用真实条目详情、概览和回收站；PDF 与笔记编辑器只显示打开结果。</p>
            <p className="mt-3 text-sm text-muted-foreground">共享笔记目录：{notes?.catalog.notes.filter(item => !item.deleted_at).length ?? 0} 篇</p>
            {surface && 'entryId' in surface ? <Button className="mt-4" size="sm" variant="outline" onClick={event => { event.stopPropagation(); dispatch({ type: 'close', pane, key: surfaceKey(surface) }); }}>关闭论文</Button> : null}
            </div>}
          </section>;
        })}
      </div></div>
    </div>
  </main></>;
}

const showcaseRoot = createRoot(document.getElementById('root')!);
showcaseRoot.render(<AppearanceProvider><TooltipProvider><ToastContext.Provider value={{ dismiss: noop, notify: () => 'preview' }}>
  <TagPreferencesProvider><WorkspaceNotesProvider root={root} refreshKey="showcase"><SidebarShowcase /></WorkspaceNotesProvider></TagPreferencesProvider>
</ToastContext.Provider></TooltipProvider></AppearanceProvider>);

if (import.meta.hot) import.meta.hot.dispose(() => showcaseRoot.unmount());
