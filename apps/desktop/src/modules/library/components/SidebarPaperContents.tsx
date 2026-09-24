import { useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { FileText, FileType, Link2, PanelLeftOpen, PanelRightOpen, ScrollText, StickyNote, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DisclosureIcon } from '@/components/ui/disclosure-icon';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuPortal, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu';
import { entryContentSurface, findSurfacePane, surfaceKey, type WorkspacePaneId, type WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { SidebarContentRow } from './SidebarContentRow';
import { SidebarPaperRow } from './SidebarPaperRow';
import { SidebarSectionHeader } from './SidebarSectionHeader';

type Content = { id: string; label: string; meta: string; icon: LucideIcon; disabled?: boolean };
type Props = ComponentProps<typeof SidebarPaperRow> & {
  expanded: boolean;
  notesExpanded: boolean;
  onExpandedChange: (open: boolean) => void;
  onNotesExpandedChange: (open: boolean) => void;
  onOpenContent: (contentId: string, pane?: WorkspacePaneId) => void;
};

/** Expansion belongs to SameTagSidebar; its existing paper panel owns scrolling. */
export function SidebarPaperContents({ expanded, notesExpanded, onExpandedChange, onNotesExpandedChange, onOpenContent, ...paper }: Props) {
  const contentsId = useId();
  const notesId = useId();
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const notesDisclosureRef = useRef<HTMLButtonElement>(null);
  const contentsRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLDivElement>(null);
  const { entry, layout } = paper;
  const parsed = entry.status === 'Parsed';
  const reflowState = ['Queued', 'Uploading', 'Parsing'].includes(entry.status) ? '解析中' : entry.status === 'Failed' ? '解析失败' : '未解析';
  const contents: Content[] = [
    ...(entry.pdfFileName ? [{ id: 'pdf', label: 'PDF 原文', meta: entry.pdfFileName, icon: FileType }] : []),
    { id: 'reflow', label: '重排阅读', meta: parsed ? '解析正文' : reflowState, icon: ScrollText, disabled: !parsed },
    ...(entry.pdfFileName || parsed ? [{ id: 'segment-notes', label: '片段记录', meta: '笔记与批注', icon: StickyNote }] : []),
    { id: 'source-links', label: '引用此文', meta: '证据与笔记', icon: Link2 }
  ];
  const notes: Content[] = entry.contents.filter(item => item.kind === 'note').map(note => ({ id: `note:${note.note_id}`, label: note.title || '未命名笔记', meta: '文档笔记', icon: FileText }));
  const focused = layout[layout.focusedPane] ?? layout.left;
  const currentContent = [...contents, ...notes].find(item => surfaceKey(entryContentSurface(entry.id, item.id)) === surfaceKey(focused));
  const currentNote = currentContent?.id.startsWith('note:') ? currentContent : undefined;
  const otherPane = layout.focusedPane === 'right' && layout.right ? 'left' : 'right';
  const otherLabel = otherPane === 'left' ? '左侧' : '右侧';
  const menuItems = (pane?: WorkspacePaneId) => <>
    {contents.map(item => <ContentMenuItem key={item.id} item={item} onSelect={() => onOpenContent(item.id, pane)} />)}
    {notes.length > 0 && <><ContextMenuSeparator /><ContextMenuLabel>文档笔记 · {notes.length}</ContextMenuLabel>
      {notes.map(item => <ContentMenuItem key={item.id} item={item} onSelect={() => onOpenContent(item.id, pane)} />)}</>}
  </>;
  return <div className="sidebar-paper-tree min-w-0" data-entry-contents={entry.id} data-expanded={expanded} data-current-branch={Boolean(currentContent)}>
    <ContextMenu>
      <ContextMenuTrigger asChild><div data-sidebar-paper-heading>
        <SidebarPaperRow {...paper} hideIcon active={expanded && currentContent ? false : paper.active}
          summary={!expanded && currentContent ? <span className="flex h-4 items-center gap-1 text-primary"><span className="shrink-0">当前：</span><span className="truncate" title={currentContent.label}>{currentContent.label}</span></span> : undefined}
          leading={<Button ref={disclosureRef} data-sidebar-disclosure size="icon-xs" variant="plain" className="text-inherit"
          aria-label={`${expanded ? '收起' : '展开'}论文内容 ${entry.title}`} aria-expanded={expanded} aria-controls={contentsId}
          title={expanded ? '收起论文内容' : '展开论文内容'} onClick={() => onExpandedChange(!expanded)}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            if (event.key === 'ArrowRight' && expanded) focusFirstContent(contentsRef.current);
            else onExpandedChange(event.key === 'ArrowRight');
          }}><DisclosureIcon open={expanded} /></Button>} />
      </div></ContextMenuTrigger>
      <ContextMenuContent viewportAligned className="w-60 max-w-[calc(100vw-1rem)]">
        <ContextMenuLabel>打开内容</ContextMenuLabel>
        {menuItems()}
        <ContextMenuSeparator />
        <ContextMenuSub><ContextMenuSubTrigger>在{otherLabel}打开</ContextMenuSubTrigger>
          <ContextMenuPortal><ContextMenuSubContent className="max-h-(--radix-context-menu-content-available-height) w-60 max-w-[calc(100vw-1rem)] overflow-y-auto">
            {menuItems(otherPane)}
          </ContextMenuSubContent></ContextMenuPortal>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={paper.onDetails}>查看条目详情</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
    <div ref={contentsRef} id={contentsId} role="group" aria-label={`${entry.title} 的内部内容`} hidden={!expanded} className="sidebar-tree-children">
      {expanded && <>
        {contents.map(item => <ContentRow key={item.id} item={item} entryId={entry.id} layout={layout} onOpen={onOpenContent} onFocusParent={() => disclosureRef.current?.focus()} />)}
        <div className="sidebar-tree-node" data-current-branch={Boolean(currentNote)}>
          <SidebarSectionHeader variant="branch" label="文档笔记" count={notes.length} hint={!notesExpanded && currentNote ? '当前' : undefined}
            buttonRef={notesDisclosureRef} controlsId={notesId} open={notesExpanded}
            toggleLabel={`${notesExpanded ? '收起' : '展开'}文档笔记 ${entry.title}`} onToggle={() => onNotesExpandedChange(!notesExpanded)}
            onKeyDown={event => {
              if (event.key === 'ArrowRight' && notesExpanded) { event.preventDefault(); focusFirstContent(notesRef.current); }
              if (event.key === 'ArrowLeft' && !notesExpanded) { event.preventDefault(); disclosureRef.current?.focus(); }
            }} />
          <div ref={notesRef} id={notesId} role="group" aria-label={`${entry.title} 的文档笔记`} hidden={!notesExpanded} className="sidebar-tree-children">
            {notesExpanded && (notes.length ? notes.map(item => <ContentRow key={item.id} item={item} entryId={entry.id} layout={layout} onOpen={onOpenContent} onFocusParent={() => notesDisclosureRef.current?.focus()} />)
              : <p className="sidebar-tree-node px-2 py-1.5 text-xs text-muted-foreground">暂无文档笔记</p>)}
          </div>
        </div>
      </>}
    </div>
  </div>;
}

function ContentMenuItem({ item, onSelect }: { item: Content; onSelect: () => void }) {
  return <ContextMenuItem disabled={item.disabled} onSelect={onSelect} title={item.label}>
    <item.icon aria-hidden="true" />
    <span className="min-w-0 flex-1 truncate">{item.label}</span>
    {item.disabled && <span className="shrink-0 text-xs text-muted-foreground">{item.meta}</span>}
  </ContextMenuItem>;
}

function ContentRow({ item, entryId, layout, onOpen, onFocusParent }: {
  item: Content; entryId: string; layout: WorkspaceSurfaceLayout; onOpen: Props['onOpenContent']; onFocusParent: () => void;
}) {
  const key = surfaceKey(entryContentSurface(entryId, item.id));
  const openedPane = findSurfacePane(layout, key);
  const focused = layout[layout.focusedPane] ?? layout.left;
  const active = surfaceKey(focused) === key;
  const otherPane = layout.focusedPane === 'right' && layout.right ? 'left' : 'right';
  const otherLabel = otherPane === 'left' ? '左侧' : '右侧';
  const SplitIcon = otherPane === 'left' ? PanelLeftOpen : PanelRightOpen;
  const position = openedPane ? `${openedPane === 'left' ? '左侧' : '右侧'}已打开` : '';
  return <div className="sidebar-tree-node" data-current-branch={active}>
    <ContentContextMenu disabled={item.disabled} otherLabel={otherLabel} onOpen={() => onOpen(item.id)} onSplit={() => onOpen(item.id, otherPane)}>
    <SidebarContentRow density="compact" active={active} disabled={item.disabled} icon={<item.icon size={14} aria-hidden="true" />} label={item.label}
      meta={[position, item.meta].filter(Boolean).join(' · ')} onClick={() => onOpen(item.id)}
      metaContent={item.disabled ? item.meta : openedPane ? <span title={position} className="rounded-sm bg-muted px-1">{openedPane === 'left' ? '左' : '右'}</span> : undefined}
      onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); onFocusParent(); } }}
      action={<Button size="icon-xs" variant="ghost" disabled={item.disabled} aria-label={`在${otherLabel}打开 ${item.label}`} title={`在${otherLabel}打开`}
        onClick={() => onOpen(item.id, otherPane)}><SplitIcon size={13} aria-hidden="true" /></Button>} />
  </ContentContextMenu></div>;
}

function focusFirstContent(group: HTMLDivElement | null) {
  group?.querySelector<HTMLButtonElement>('[data-material="content-row-main"]:not(:disabled)')?.focus();
}

function ContentContextMenu({ children, disabled, otherLabel, onOpen, onSplit }: {
  children: ReactNode; disabled?: boolean; otherLabel: string; onOpen: () => void; onSplit: () => void;
}) {
  return <ContextMenu><ContextMenuTrigger asChild disabled={disabled}><div>{children}</div></ContextMenuTrigger>
    <ContextMenuContent viewportAligned><ContextMenuItem onSelect={onOpen}>打开</ContextMenuItem><ContextMenuItem onSelect={onSplit}>在{otherLabel}打开</ContextMenuItem></ContextMenuContent>
  </ContextMenu>;
}
