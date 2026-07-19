import { ArrowLeft, FileText, FileType, LayoutDashboard, Link2, PanelRightOpen, Pencil, Plus, ScrollText, StickyNote, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { TagMeta } from '@/shared/types/domain';

import { StatusBadge } from '../../reader/components/EntryDisplay';
import { EntryEditDialog } from './EntryEditDialog';
import type { LibraryEntry } from './LibrarySidebar';

type EntryContentSidebarProps = {
  activeContentId: string | null;
  entry: LibraryEntry;
  tags: TagMeta[];
  onBack: () => void;
  onCreateMarkdownNote: () => Promise<void> | void;
  onDeleteMarkdownNote: (entryId: string, noteId: string) => Promise<void> | void;
  onOpenMarkdownInPdfPane: (noteId: string) => void;
  onOpenContentInRight: (contentId: string) => void;
  onRenameMarkdownNote: (entryId: string, noteId: string, title: string) => Promise<unknown> | unknown;
  onRenamePdfDisplayName: (entryId: string, fileName: string) => Promise<unknown> | unknown;
  onSelectContent: (contentId: string) => void;
  onUpdateEntry: (
    entryId: string,
    request: {
      fields: Record<string, string>;
      tagPaths: string[];
      title: string;
    }
  ) => Promise<unknown> | unknown;
};

export function EntryContentSidebar({
  activeContentId,
  entry,
  tags,
  onBack,
  onCreateMarkdownNote,
  onDeleteMarkdownNote,
  onOpenMarkdownInPdfPane,
  onOpenContentInRight,
  onRenameMarkdownNote,
  onRenamePdfDisplayName,
  onSelectContent,
  onUpdateEntry
}: EntryContentSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [notePendingDelete, setNotePendingDelete] = useState<{
    noteId: string;
    title: string;
  } | null>(null);
  const [noteContextMenu, setNoteContextMenu] = useState<{
    noteId: string;
    title: string;
    x: number;
    y: number;
  } | null>(null);
  const [pdfContextMenu, setPdfContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renamingNote, setRenamingNote] = useState<{
    busy: boolean;
    draft: string;
    noteId: string;
    originalTitle: string;
  } | null>(null);
  const [renamingPdf, setRenamingPdf] = useState<{
    busy: boolean;
    draft: string;
    originalFileName: string;
  } | null>(null);
  const renameBlurSuppressed = useRef(false);
  const notes = entry.contents.filter((content) => content.kind === 'note');
  const fields = Object.entries(entry.fields).filter(([key]) => key !== 'description');

  useEffect(() => {
    if (!noteContextMenu && !pdfContextMenu) {
      return undefined;
    }

    const close = () => {
      setNoteContextMenu(null);
      setPdfContextMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [noteContextMenu, pdfContextMenu]);

  const createNote = async () => {
    if (creating) {
      return;
    }
    try {
      setCreating(true);
      await onCreateMarkdownNote();
    } finally {
      setCreating(false);
    }
  };

  const deletePendingNote = async () => {
    if (!notePendingDelete) {
      return;
    }
    await onDeleteMarkdownNote(entry.id, notePendingDelete.noteId);
    setNotePendingDelete(null);
  };

  const startRenameNote = (noteId: string, title: string) => {
    setNoteContextMenu(null);
    setRenamingNote({
      busy: false,
      draft: title,
      noteId,
      originalTitle: title
    });
  };

  const startRenamePdf = () => {
    if (!entry.pdfFileName) {
      return;
    }
    setPdfContextMenu(null);
    setRenamingPdf({
      busy: false,
      draft: entry.pdfFileName,
      originalFileName: entry.pdfFileName
    });
  };

  const commitRenameNote = async () => {
    if (renameBlurSuppressed.current) {
      renameBlurSuppressed.current = false;
      return;
    }
    if (!renamingNote || renamingNote.busy) {
      return;
    }

    const nextTitle = renamingNote.draft.trim() || 'Untitled note';
    if (nextTitle === renamingNote.originalTitle) {
      setRenamingNote(null);
      return;
    }

    setRenamingNote((current) => (current ? { ...current, busy: true } : current));
    try {
      await onRenameMarkdownNote(entry.id, renamingNote.noteId, nextTitle);
      setRenamingNote(null);
    } catch {
      setRenamingNote((current) => (current ? { ...current, busy: false } : current));
    }
  };

  const commitRenamePdf = async () => {
    if (renameBlurSuppressed.current) {
      renameBlurSuppressed.current = false;
      return;
    }
    if (!renamingPdf || renamingPdf.busy) {
      return;
    }

    const fileName = renamingPdf.draft.trim();
    if (!fileName || fileName === renamingPdf.originalFileName) {
      setRenamingPdf(null);
      return;
    }

    setRenamingPdf((current) => (current ? { ...current, busy: true } : current));
    try {
      await onRenamePdfDisplayName(entry.id, fileName);
      setRenamingPdf(null);
    } catch {
      setRenamingPdf((current) => (current ? { ...current, busy: false } : current));
    }
  };

  return (
    <>
      <ScrollArea className="side-body">
        <div className="min-w-0 space-y-3 p-2">
          <button
            className="flex min-h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            type="button"
            onClick={onBack}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            返回条目库
          </button>

          <section className="min-w-0 overflow-hidden space-y-3 rounded-md border bg-muted/25 p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="break-all text-sm font-semibold">{entry.title}</div>
                <div className="mt-1">
                  <StatusBadge status={entry.status} />
                </div>
              </div>

              <Button
                size="icon-sm"
                title="编辑条目"
                type="button"
                variant="outline"
                onClick={() => setEditOpen(true)}
              >
                <Pencil size={14} aria-hidden="true" />
              </Button>
            </div>

            <InfoBlock label="描述">
              {entry.fields.description ? (
                <p className="whitespace-pre-wrap break-words">{entry.fields.description}</p>
              ) : (
                <span className="text-muted-foreground">暂无描述</span>
              )}
            </InfoBlock>

            <InfoBlock label="标签">
              {entry.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {entry.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">暂无标签</span>
              )}
            </InfoBlock>

            <InfoBlock label="属性">
              {fields.length > 0 ? (
                <div className="grid gap-1">
                  {fields.map(([key, value]) => (
                    <div className="grid grid-cols-[0.8fr_1fr] gap-2 text-xs" key={key}>
                      <span className="truncate font-medium text-foreground" title={key}>
                        {key}
                      </span>
                      <span className="truncate text-muted-foreground" title={value}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">暂无属性</span>
              )}
            </InfoBlock>
          </section>

          <section className="min-w-0 space-y-1">
            <div className="flex h-7 items-center gap-1.5 px-1.5 text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">内容</span>
              <Button
                disabled={creating}
                size="icon-xs"
                title="新建笔记"
                type="button"
                variant="ghost"
                onClick={() => void createNote()}
              >
                <Plus size={13} aria-hidden="true" />
              </Button>
            </div>

            <ContentRow
              active={activeContentId === 'overview'}
              icon={<LayoutDashboard size={14} />}
              label="条目概览"
              meta="管理"
              action={<OpenInRightButton onClick={() => onOpenContentInRight('overview')} />}
              onClick={() => onSelectContent('overview')}
            />

            {entry.pdfFileName ? (
              <>
                <ContentRow
                  active={activeContentId === 'pdf'}
                  icon={<FileType size={14} />}
                  label={entry.pdfFileName}
                  labelContent={
                    renamingPdf ? (
                      <Input
                        autoFocus
                        className="h-7 min-w-0 text-xs"
                        disabled={renamingPdf.busy}
                        value={renamingPdf.draft}
                        onBlur={() => void commitRenamePdf()}
                        onChange={(event) =>
                          setRenamingPdf((current) =>
                            current ? { ...current, draft: event.target.value } : current
                          )
                        }
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void commitRenamePdf();
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            renameBlurSuppressed.current = true;
                            setRenamingPdf(null);
                          }
                        }}
                      />
                    ) : undefined
                  }
                  meta="PDF"
                  action={<OpenInRightButton onClick={() => onOpenContentInRight('pdf')} />}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setNoteContextMenu(null);
                    setPdfContextMenu({ x: event.clientX, y: event.clientY });
                  }}
                  onClick={() => onSelectContent('pdf')}
                />
                <ContentRow
                  active={activeContentId === 'reflow'}
                  icon={<ScrollText size={14} />}
                  label="重排视图"
                  meta="Reflow"
                  action={<OpenInRightButton onClick={() => onOpenContentInRight('reflow')} />}
                  onClick={() => onSelectContent('reflow')}
                />
                <ContentRow
                  active={activeContentId === 'segment-notes' || activeContentId === 'annotations'}
                  icon={<StickyNote size={14} />}
                  label="片段记录"
                  meta="笔记与批注"
                  action={<OpenInRightButton onClick={() => onOpenContentInRight('segment-notes')} />}
                  onClick={() => onSelectContent('segment-notes')}
                />
                <ContentRow
                  active={activeContentId === 'source-links'}
                  icon={<Link2 size={14} />}
                  label="来源链接"
                  meta="引用关系"
                  action={<OpenInRightButton onClick={() => onOpenContentInRight('source-links')} />}
                  onClick={() => onSelectContent('source-links')}
                />
              </>
            ) : (
              <div className="rounded-md px-2 py-1.5 text-xs text-muted-foreground">
                未附带 PDF
              </div>
            )}

            {notes.map((note) => (
              <ContentRow
                active={activeContentId === `note:${note.note_id}`}
                icon={<FileText size={14} />}
                key={note.note_id}
                label={note.title}
                labelContent={
                  renamingNote?.noteId === note.note_id ? (
                    <Input
                      autoFocus
                      className="h-7 min-w-0 text-xs"
                      disabled={renamingNote.busy}
                      value={renamingNote.draft}
                      onBlur={() => void commitRenameNote()}
                      onChange={(event) =>
                        setRenamingNote((current) =>
                          current ? { ...current, draft: event.target.value } : current
                        )
                      }
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void commitRenameNote();
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          renameBlurSuppressed.current = true;
                          setRenamingNote(null);
                        }
                      }}
                    />
                  ) : undefined
                }
                meta="笔记"
                action={
                  <div className="flex items-center gap-0.5">
                    {entry.pdfFileName ? (
                      <Button
                        size="icon-xs"
                        title="在 PDF 旁打开"
                        type="button"
                        variant="ghost"
                        onClick={() => onOpenMarkdownInPdfPane(note.note_id)}
                      >
                        <PanelRightOpen size={13} aria-hidden="true" />
                      </Button>
                    ) : null}
                    <Button
                      size="icon-xs"
                      title="删除笔记"
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setNotePendingDelete({ noteId: note.note_id, title: note.title })
                      }
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </Button>
                  </div>
                }
                onContextMenu={(event) => {
                  event.preventDefault();
                  setPdfContextMenu(null);
                  setNoteContextMenu({
                    noteId: note.note_id,
                    title: note.title,
                    x: event.clientX,
                    y: event.clientY
                  });
                }}
                onClick={() => onSelectContent(`note:${note.note_id}`)}
              />
            ))}

            {notes.length === 0 ? (
              <div className="rounded-md px-2 py-1.5 text-xs text-muted-foreground">
                暂无笔记
              </div>
            ) : null}

            <div className="my-1 h-px bg-border" />
            <ContentRow
              active={activeContentId === 'entry-trash'}
              icon={<Trash2 size={14} />}
              label="回收站"
              meta="已删除内容"
              action={<OpenInRightButton onClick={() => onOpenContentInRight('entry-trash')} />}
              onClick={() => onSelectContent('entry-trash')}
            />
          </section>
        </div>
      </ScrollArea>

      {noteContextMenu ? (
        <ViewportContextMenu x={noteContextMenu.x} y={noteContextMenu.y}>
          <ContextMenuButton
            onClick={() => {
              onSelectContent(`note:${noteContextMenu.noteId}`);
              setNoteContextMenu(null);
            }}
          >
            打开
          </ContextMenuButton>
          {entry.pdfFileName ? (
            <ContextMenuButton
              onClick={() => {
                onOpenMarkdownInPdfPane(noteContextMenu.noteId);
                setNoteContextMenu(null);
              }}
            >
              在 PDF 旁打开
            </ContextMenuButton>
          ) : null}
          <ContextMenuButton onClick={() => startRenameNote(noteContextMenu.noteId, noteContextMenu.title)}>
            修改标题
          </ContextMenuButton>
          <div className="-mx-1 my-1 h-px bg-border" />
          <ContextMenuButton
            destructive
            onClick={() => {
              setNotePendingDelete({
                noteId: noteContextMenu.noteId,
                title: noteContextMenu.title
              });
              setNoteContextMenu(null);
            }}
          >
            删除
          </ContextMenuButton>
        </ViewportContextMenu>
      ) : null}

      {pdfContextMenu ? (
        <ViewportContextMenu x={pdfContextMenu.x} y={pdfContextMenu.y}>
          <ContextMenuButton
            onClick={() => {
              onSelectContent('pdf');
              setPdfContextMenu(null);
            }}
          >
            打开
          </ContextMenuButton>
          <ContextMenuButton onClick={startRenamePdf}>修改文件名</ContextMenuButton>
        </ViewportContextMenu>
      ) : null}

      <EntryEditDialog
        entry={entry}
        open={editOpen}
        tags={tags}
        onOpenChange={setEditOpen}
        onUpdateEntry={onUpdateEntry}
      />

      <Dialog
        open={Boolean(notePendingDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setNotePendingDelete(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除笔记</DialogTitle>
            <DialogDescription>
              删除后会将这篇笔记、来源链接和资源移入当前条目的回收站。
            </DialogDescription>
          </DialogHeader>
          {notePendingDelete ? (
            <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm font-medium">
              {notePendingDelete.title}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNotePendingDelete(null)}>
              取消
            </Button>
            <Button type="button" variant="destructive" onClick={() => void deletePendingNote()}>
              移到回收站
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InfoBlock({
  children,
  label
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="grid gap-1.5 text-xs">
      <div className="font-semibold text-muted-foreground">{label}</div>
      <div className="min-w-0 leading-5">{children}</div>
    </div>
  );
}

function ContentRow({
  active,
  icon,
  label,
  labelContent,
  meta,
  action,
  onContextMenu,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  labelContent?: ReactNode;
  meta: string;
  action?: ReactNode;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onClick: () => void;
}) {
  return (
    <div
      className={cn(
        'flex min-h-7 w-full min-w-0 items-center gap-1 overflow-hidden rounded-md border border-transparent text-xs transition-colors',
        active
          ? 'border-primary/20 bg-accent font-bold text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
      onContextMenu={onContextMenu}
    >
      {labelContent ? (
        <div className="flex w-full min-w-0 max-w-full flex-1 items-center gap-2 overflow-hidden px-2 py-1 text-left">
          <span className="grid size-4 shrink-0 place-items-center">{icon}</span>
          <span className="w-0 min-w-0 flex-1 overflow-hidden">
            {labelContent}
            <span className="block text-[10px] font-medium text-muted-foreground">{meta}</span>
          </span>
        </div>
      ) : (
        <button
          className="flex w-full min-w-0 max-w-full flex-1 items-center gap-2 overflow-hidden px-2 py-1 text-left"
          title={label}
          type="button"
          onClick={onClick}
        >
          <span className="grid size-4 shrink-0 place-items-center">{icon}</span>
          <span className="w-0 min-w-0 flex-1 overflow-hidden">
            <span className="block truncate">{label}</span>
            <span className="block text-[10px] font-medium text-muted-foreground">{meta}</span>
          </span>
        </button>
      )}
      {action ? <span className="shrink-0 pr-1">{action}</span> : null}
    </div>
  );
}

function OpenInRightButton({ onClick }: { onClick: () => void }) {
  return <Button size="icon-xs" title="在右侧打开" type="button" variant="ghost" onClick={onClick}><PanelRightOpen size={13} aria-hidden="true" /></Button>;
}

function ContextMenuButton({
  children,
  destructive = false,
  onClick
}: {
  children: ReactNode;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'flex h-8 w-full items-center rounded-sm px-2 text-left text-sm outline-none transition hover:bg-accent hover:text-accent-foreground',
        destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive'
      )}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ViewportContextMenu({
  children,
  x,
  y
}: {
  children: ReactNode;
  x: number;
  y: number;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const updatePosition = () => {
      const rect = menuRef.current?.getBoundingClientRect();
      const margin = 8;
      const width = rect?.width ?? 160;
      const height = rect?.height ?? 96;
      setPosition({
        left: Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - width - margin)),
        top: Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - height - margin))
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [x, y]);

  return createPortal(
    <div
      className="fixed z-[1000] max-h-[calc(100vh-1rem)] w-40 overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
      ref={menuRef}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
