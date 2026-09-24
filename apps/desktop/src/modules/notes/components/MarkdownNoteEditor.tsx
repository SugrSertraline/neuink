import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import type { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import Placeholder from '@tiptap/extension-placeholder';
import UnderlineExtension from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { GripVertical } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';
import { useToast } from '@/shared/hooks/useToast';
import { NoteReviewBanner } from '@/modules/assistant/review/NoteReviewBanner';
import { ReadingExportDialog } from '@/modules/reader/export/ReadingExportDialog';
import type { NoteDocument, NoteOwner, SourceLink } from '@/shared/types/domain';

import { CalloutBlock } from '../editor/CalloutBlock';
import { DataTableNode } from '../editor/DataTableNode';
import { MathMarkdownInputRules } from '../editor/MathMarkdownInputRules';
import { MermaidDiagram } from '../editor/MermaidDiagram';
import { EditableBlockMath, EditableInlineMath } from '../editor/EditableMathNodes';
import { MarkdownTextStyle } from '../editor/MarkdownTextStyle';
import { NoteImage } from '../editor/NoteImage';
import {
  SourceLinkNode,
  type SourceLinkOpenTarget
} from '../editor/SourceLinkNode';
import { TableDeletionShortcuts } from '../editor/TableDeletionShortcuts';
import { sanitizePastedNoteHtml } from '../editor/pasteSanitizer';
import { insertStructuredMarkdownPaste } from '../editor/structuredMarkdownPaste';
import { MarkdownInsertMenu } from './MarkdownInsertMenu';
import { MarkdownNoteConflictPanel } from './MarkdownNoteConflictPanel';
import { MarkdownNoteHeader } from './MarkdownNoteHeader';
import { MarkdownNoteToolbar } from './MarkdownNoteToolbar';
import { SourceLinksPanel } from './SourceLinksPanel';
import { NoteSourcesProvider } from '../NoteSourcesContext';
import { useMarkdownBlockDrag } from './useMarkdownBlockDrag';
import {
  firstImageFromClipboard,
  insertNoteImageIntoEditor,
  useMarkdownNoteImages
} from './useMarkdownNoteImages';
import { useMarkdownNoteFileActions } from './useMarkdownNoteFileActions';
import { useMarkdownNoteSession } from './useMarkdownNoteSession';
import { useMarkdownSourceLinks } from './useMarkdownSourceLinks';
import {
  TableContextMenu,
  useMarkdownTableContextMenu
} from './useMarkdownTableContextMenu';

type InsertMenuState = {
  from: number;
  left: number;
  mode: 'context' | 'slash' | 'toolbar';
  shouldDeleteTrigger: boolean;
  top: number;
};

type MarkdownNoteEditorProps = {
  entryId: string;
  noteOwner?: NoteOwner;
  editorScopeKey?: string;
  onWritableChange?: (writable: boolean) => void;
  entryTitle?: string;
  fallbackTitle: string;
  noteId: string;
  refreshKey?: number;
  onLoadNote: () => Promise<NoteDocument>;
  onSaveNote: (
    title: string,
    markdown: string,
    links: SourceLink[],
    expectedRevision?: string | null
  ) => Promise<NoteDocument>;
  compact?: boolean;
  sourceLinkToInsert?: SourceLink | null;
  noteImageToInsert?: {
    alt?: string | null;
    id: string;
    markdownPath: string;
  } | null;
  pdfDocument?: PDFDocumentProxy | null;
  workspaceRoot?: string | null;
  onCreateSourceLinkFromPaste?: (sourceEntryId: string, segmentUid: string) => Promise<SourceLink>;
  onNoteImageInserted?: (imageId: string) => void;
  onSourceLinkInserted?: (link: SourceLink) => void;
  onOpenSourceLink?: (target: SourceLinkOpenTarget) => void;
};


export function MarkdownNoteEditor({
  entryId,
  noteOwner,
  editorScopeKey,
  onWritableChange,
  entryTitle,
  fallbackTitle,
  noteId,
  refreshKey = 0,
  onLoadNote,
  onSaveNote,
  compact = false,
  sourceLinkToInsert = null,
  noteImageToInsert = null,
  pdfDocument = null,
  workspaceRoot = null,
  onCreateSourceLinkFromPaste,
  onNoteImageInserted,
  onSourceLinkInserted,
  onOpenSourceLink
}: MarkdownNoteEditorProps) {
  const { notify } = useToast();
  const [exportOpen, setExportOpen] = useState(false);
  const [noteLinks, setNoteLinks] = useState<SourceLink[]>([]);
  const [insertMenu, setInsertMenu] = useState<InsertMenuState | null>(null);
  const suppressEditorUpdateRef = useRef(false);
  const handledNoteImageId = useRef<string | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const noteLinksRef = useRef<SourceLink[]>([]);
  const markEditorDirtyRef = useRef<() => void>(() => undefined);
  const onNoteImageInsertedRef = useRef(onNoteImageInserted);
  const onOpenSourceLinkRef = useRef(onOpenSourceLink);
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(pdfDocument);
  const pasteSourceLinkBusyRef = useRef(false);
  const pasteSourceLinkHandlerRef = useRef<(editor: Editor, text: string) => boolean>(
    () => false
  );
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const openSlashInsertMenuRef = useRef<(view: Editor['view']) => boolean>(() => false);
  const editorBusyRef = useRef(false);
  const {
    imageImporting,
    pasteImageBusyRef,
    savePastedImage,
    selectAndInsertImage
  } = useMarkdownNoteImages({ entryId, noteOwner, noteId, notify, workspaceRoot });

  useEffect(() => {
    onOpenSourceLinkRef.current = onOpenSourceLink;
  }, [onOpenSourceLink]);

  useEffect(() => {
    pdfDocumentRef.current = pdfDocument;
  }, [pdfDocument]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        underline: false,
        codeBlock: {
          HTMLAttributes: {
            class: 'rounded-md bg-muted px-3 py-2 font-mono text-xs'
          }
        }
      }),
      Link.configure({
        autolink: true,
        openOnClick: false
      }),
      TaskList.configure({
        HTMLAttributes: {
          class: 'not-prose ml-0 list-none space-y-1 pl-0'
        }
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: {
          class: 'flex gap-2'
        }
      }),
      Table.configure({
        allowTableNodeSelection: true,
        resizable: false,
        HTMLAttributes: {
          class:
            'my-4 w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm'
        }
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: {
          class:
            'border border-slate-200 bg-slate-100/90 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-700'
        }
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-slate-200 px-3 py-2 align-top'
        }
      }),
      TableDeletionShortcuts,
      CalloutBlock,
      DataTableNode,
      NoteImage.configure({
        entryId,
        noteOwner,
        noteId,
        workspaceRoot
      }),
      EditableBlockMath.configure({
        katexOptions: {
          strict: false,
          throwOnError: false
        }
      }),
      EditableInlineMath.configure({
        katexOptions: {
          strict: false,
          throwOnError: false
        }
      }),
      MathMarkdownInputRules,
      MermaidDiagram,
      Markdown,
      MarkdownTextStyle,
      Color.configure({ types: ['textStyle'] }),
      Highlight.configure({ multicolor: true }),
      SourceLinkNode.configure({
        getPdfDocument: () => pdfDocumentRef.current,
        onOpenSourceLink: onOpenSourceLink ? (target: SourceLinkOpenTarget) => {
          onOpenSourceLinkRef.current?.(target);
        } : null,
        snapshotAssetContext: {
          entryId,
          entryTitle,
          noteOwner,
          noteId,
          workspaceRoot
        }
      }),
      UnderlineExtension,
      Placeholder.configure({
        placeholder: '写下 Markdown 笔记、总结、问题，或带来源的判断...'
      })
    ],
    content: '',
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class:
          'min-h-[520px] w-full min-w-0 max-w-none break-words [overflow-wrap:anywhere] rounded-md border bg-white py-3 pr-4 pl-10 text-sm leading-6 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 [&_.tableWrapper]:max-w-full [&_.tableWrapper]:overflow-x-auto [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h1]:mb-3 [&_h1]:mt-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-dashed [&_hr]:border-slate-300 [&_img]:mx-auto [&_img]:h-auto [&_img]:max-w-full [&_ol]:ml-5 [&_ol]:list-decimal [&_pre]:my-2 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:my-4 [&_tbody_tr:nth-child(even)]:bg-slate-50/80 [&_td]:min-w-28 [&_th]:min-w-28 [&_ul:not([data-type=taskList])]:ml-5 [&_ul:not([data-type=taskList])]:list-disc [&_ul[data-type=taskList]_li]:items-start [&_ul[data-type=taskList]_li>label]:pt-0.5 [&_ul[data-type=taskList]_li>div]:min-w-0 [&_ul[data-type=taskList]_p]:m-0'
      },
      handleKeyDown: (view, event) => {
        if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) {
          return false;
        }
        return openSlashInsertMenuRef.current(view);
      },
      handlePaste: (_view, event) => {
        if (editorBusyRef.current || pasteSourceLinkBusyRef.current || pasteImageBusyRef.current) {
          return false;
        }

        const targetEditor = editorRef.current;
        const pastedImage = firstImageFromClipboard(event.clipboardData);
        if (pastedImage && workspaceRoot && targetEditor) {
          event.preventDefault();
          void savePastedImage(targetEditor, pastedImage).catch((caught) => {
            notify({
              tone: 'danger',
              title: '图片粘贴失败',
              description: caught instanceof Error ? caught.message : String(caught)
            });
          });
          return true;
        }

        const pastedText = event.clipboardData?.getData('text/plain') ?? '';
        if (targetEditor && pasteSourceLinkHandlerRef.current(targetEditor, pastedText)) {
          event.preventDefault();
          return true;
        }

        if (
          targetEditor &&
          insertStructuredMarkdownPaste(
            targetEditor,
            pastedText,
            event.clipboardData?.getData('text/html') || null
          )
        ) {
          event.preventDefault();
          return true;
        }

        return false;
      },
      transformPastedHTML: sanitizePastedNoteHtml
    },
    onUpdate: () => markEditorDirtyRef.current()
  }, [entryId, noteId, noteOwner, savePastedImage, workspaceRoot]);

  const {
    acceptRemoteConflict,
    canEdit,
    cancelTitleEdit,
    changeVersion,
    conflict,
    dirty,
    draftTitle,
    error,
    loadFailed,
    loading,
    markEditorDirty,
    overwriteRemoteConflict,
    reload,
    save,
    saveTitle,
    saving,
    startTitleEditing,
    takeOverEditing,
    title,
    titleEditing,
    updateDraftTitle
  } = useMarkdownNoteSession({
    editor,
    editorScopeKey,
    editorRef,
    entryId,
    fallbackTitle,
    noteId,
    noteLinksRef,
    onLoadNote,
    onSaveNote,
    refreshKey,
    setNoteLinks,
    suppressEditorUpdateRef,
    workspaceRoot
  });
  markEditorDirtyRef.current = markEditorDirty;
  useEffect(() => {
    onWritableChange?.(canEdit && !loading && !loadFailed);
    return () => onWritableChange?.(false);
  }, [canEdit, loading, loadFailed, onWritableChange]);

  const {
    dragHandle,
    dragState,
    handleBlockPointerDown,
    handleEditorMouseLeave,
    handleEditorMouseMove,
    handleEditorScroll: handleBlockDragScroll
  } = useMarkdownBlockDrag({ canEdit, editor, loadFailed, scrollRef: editorScrollRef });

  const {
    activeSourceLinks,
    locateSourceLink,
    setSourcePanelFilter,
    setSourcePanelOpen,
    sourcePanelFilter,
    sourcePanelFilters,
    sourcePanelOpen,
    visibleSourceLinks
  } = useMarkdownSourceLinks({
    canEdit,
    changeVersion,
    editor,
    editorScrollRef,
    entryId,
    loadFailed,
    loading,
    markEditorDirtyRef,
    noteId,
    noteLinks,
    noteLinksRef,
    notify,
    onCreateSourceLinkFromPaste,
    onSourceLinkInserted,
    pasteSourceLinkBusyRef,
    pasteSourceLinkHandlerRef,
    setNoteLinks,
    sourceLinkToInsert,
    workspaceRoot
  });

  const {
    handleEditorContextMenu,
    handleEditorMouseDownCapture,
    runTableCommand,
    tableContextMenu,
    tableContextMenuRef
  } = useMarkdownTableContextMenu({ canEdit, editor, loadFailed });

  const pasteFromClipboard = async () => {
    const targetEditor = editorRef.current;
    if (
      !targetEditor ||
      editorBusyRef.current ||
      pasteSourceLinkBusyRef.current ||
      pasteImageBusyRef.current
    ) {
      return;
    }
    if (!navigator.clipboard?.readText) {
      notify({ tone: 'danger', title: '当前环境不支持读取剪贴板' });
      return;
    }

    try {
      let text = '';
      let html: string | null = null;
      if (navigator.clipboard.read) {
        try {
          const items = await navigator.clipboard.read();
          const imageItem = items.find((item) => item.types.some((type) => type.startsWith('image/')));
          if (imageItem) {
            const imageType = imageItem.types.find((type) => type.startsWith('image/'))!;
            try {
              const blob = await imageItem.getType(imageType);
              await savePastedImage(
                targetEditor,
                new File([blob], `pasted-image.${imageType.split('/')[1] || 'png'}`, { type: imageType })
              );
            } catch (caught) {
              notify({
                tone: 'danger',
                title: '图片粘贴失败',
                description: caught instanceof Error ? caught.message : String(caught),
              });
            }
            return;
          }
          const textItem = items.find((item) => item.types.includes('text/plain'));
          if (textItem) {
            text = await (await textItem.getType('text/plain')).text();
          }
          const htmlItem = items.find((item) => item.types.includes('text/html'));
          if (htmlItem) {
            html = await (await htmlItem.getType('text/html')).text();
          }
        } catch {
          // Some WebView builds allow readText() but not the richer read() API.
        }
      }
      if (!text) {
        text = await navigator.clipboard.readText();
      }
      if (!text && !html) {
        return;
      }
      if (pasteSourceLinkHandlerRef.current(targetEditor, text)) {
        return;
      }
      if (insertStructuredMarkdownPaste(targetEditor, text, html)) {
        return;
      }
      targetEditor.chain().focus().insertContent(text).run();
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '粘贴失败',
        description: caught instanceof Error ? caught.message : String(caught),
      });
    }
  };

  useEffect(() => {
    onNoteImageInsertedRef.current = onNoteImageInserted;
  }, [onNoteImageInserted]);

  useEffect(() => {
    editorBusyRef.current = loading || loadFailed || !canEdit;
  }, [canEdit, loadFailed, loading]);

  useEffect(() => {
    openSlashInsertMenuRef.current = (view) => {
      if (editorBusyRef.current) {
        return false;
      }

      window.requestAnimationFrame(() => {
        const { from } = view.state.selection;
        const coords = view.coordsAtPos(from);
        setInsertMenu({
          from: Math.max(0, from - 1),
          left: coords.left,
          mode: 'slash',
          shouldDeleteTrigger: true,
          top: coords.bottom + 6
        });
      });
      return false;
    };
  }, []);

  const closeInsertMenu = () => {
    setInsertMenu(null);
    editor?.commands.focus();
  };

  const openInsertMenuFromButton = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!editor || loading || loadFailed || !canEdit) {
      return;
    }

    const buttonRect = event.currentTarget.getBoundingClientRect();
    setInsertMenu({
      from: editor.state.selection.from,
      left: buttonRect.left,
      mode: 'toolbar',
      shouldDeleteTrigger: false,
      top: buttonRect.bottom + 6
    });
    editor.commands.focus();
  };

  useEffect(() => {
    if (!editor || loading || loadFailed || !canEdit || !noteImageToInsert) {
      return;
    }
    if (handledNoteImageId.current === noteImageToInsert.id) {
      return;
    }

    insertNoteImageIntoEditor(editor, noteImageToInsert.markdownPath, noteImageToInsert.alt);
    handledNoteImageId.current = noteImageToInsert.id;
    notify({
      tone: 'success',
      title: '片段图片已插入',
      description: noteImageToInsert.markdownPath
    });
    onNoteImageInsertedRef.current?.(noteImageToInsert.id);
  }, [canEdit, editor, loadFailed, loading, noteImageToInsert, notify]);

  const saveFromFocusedEditor = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      event.stopPropagation();
      if (!loading && !loadFailed && canEdit && !saving) {
        void save();
      }
    }
  };

  const { fileAction, openMarkdownFile, revealMarkdownFile, saveMarkdownAs } =
    useMarkdownNoteFileActions({
      noteOwner,
      dirty,
      editor,
      entryId,
      fallbackTitle,
      noteId,
      noteLinks,
      notify,
      save,
      title,
      workspaceRoot
    });

  // A zero-minimum column is needed on every nested grid. min-w-0 on the
  // container alone still lets long headers push the scroll owner offscreen.
  return (
    <NoteSourcesProvider root={workspaceRoot} links={noteLinks}>
    <div
      className={cn(
        'markdown-note-editor grid h-full w-full min-h-0 min-w-0 max-w-full grid-cols-1 grid-rows-[minmax(0,1fr)]',
        editorScopeKey && 'markdown-note-editor-embedded'
      )}
      onKeyDownCapture={saveFromFocusedEditor}
    >
      <section
        className={cn(
          'grid min-h-0 min-w-0 grid-cols-1 gap-3',
          conflict
            ? 'grid-rows-[auto_auto_minmax(0,1fr)]'
            : 'grid-rows-[auto_minmax(0,1fr)]'
        )}
      >
        <div className="min-w-0">
        <NoteReviewBanner entryId={entryId} noteId={noteId} />
        <MarkdownNoteHeader
          canEdit={canEdit}
          canRedo={editor?.can().redo() ?? false}
          canUndo={editor?.can().undo() ?? false}
          compact={compact}
          dirty={dirty}
          draftTitle={draftTitle}
          entryTitle={entryTitle}
          error={error}
          fileAction={fileAction}
          loadFailed={loadFailed}
          loading={loading}
          saving={saving}
          sourceCount={noteLinks.length}
          title={title}
          titleEditing={titleEditing}
          workspaceAvailable={Boolean(workspaceRoot)}
          onCancelTitle={cancelTitleEdit}
          onCommitTitle={saveTitle}
          onDraftTitleChange={updateDraftTitle}
          onOpenFile={() => void openMarkdownFile()}
          onRedo={() => editor?.chain().focus().redo().run()}
          onReload={reload}
          onRevealFile={() => void revealMarkdownFile()}
          onSave={() => void save()}
          onSaveAs={() => void saveMarkdownAs()}
          onExport={() => setExportOpen(true)}
          onStartTitleEdit={startTitleEditing}
          onTakeOver={takeOverEditing}
          onUndo={() => editor?.chain().focus().undo().run()}
        />
        </div>
        <ReadingExportDialog entryId={entryId} tagId={noteOwner?.kind === 'tag_reading' ? noteOwner.tag_id : undefined} entryTitle={entryTitle ?? fallbackTitle} workspaceRoot={workspaceRoot} noteId={noteId} open={exportOpen} onOpenChange={setExportOpen} />
        {conflict ? (
          <MarkdownNoteConflictPanel
            conflict={conflict}
            saving={saving}
            onAcceptRemote={acceptRemoteConflict}
            onOverwriteRemote={() => void overwriteRemoteConflict()}
            onSaveAs={() => void saveMarkdownAs()}
          />
        ) : null}
        <div
          className={cn(
            'grid min-h-0 min-w-0 grid-cols-1',
            sourcePanelOpen && activeSourceLinks.length > 0
              ? 'grid-rows-[auto_auto_minmax(0,1fr)]'
              : 'grid-rows-[auto_minmax(0,1fr)]'
          )}
        >
          <MarkdownNoteToolbar
            activeSourceCount={activeSourceLinks.length}
            disabled={loading || loadFailed || !canEdit}
            editor={editor}
            imageBusy={imageImporting}
            imageDisabled={!workspaceRoot}
            insertAt={insertMenu?.from ?? null}
            insertMenuAnchor={
              insertMenu?.mode === 'toolbar' ? { left: insertMenu.left, top: insertMenu.top } : null
            }
            sourcePanelOpen={sourcePanelOpen}
            onCloseInsertMenu={closeInsertMenu}
            onInsertImage={() => void selectAndInsertImage(editor)}
            onOpenInsertMenu={openInsertMenuFromButton}
            onToggleSourcePanel={() => setSourcePanelOpen((open) => !open)}
          />
          {sourcePanelOpen && activeSourceLinks.length > 0 ? (
            <SourceLinksPanel
              filters={sourcePanelFilters}
              links={visibleSourceLinks}
              selectedFilter={sourcePanelFilter}
              totalCount={activeSourceLinks.length}
              onFilterChange={setSourcePanelFilter}
              onLocate={locateSourceLink}
              onOpenSourceLink={onOpenSourceLink}
            />
          ) : null}
          <div
            ref={editorScrollRef}
            className="markdown-note-scroll relative w-full min-h-0 min-w-0 max-w-full overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
            onContextMenu={handleEditorContextMenu}
            onMouseDownCapture={handleEditorMouseDownCapture}
            onMouseLeave={handleEditorMouseLeave}
            onMouseMove={handleEditorMouseMove}
            onScroll={() => {
              handleBlockDragScroll();
              setInsertMenu(null);
            }}
          >
                <MarkdownInsertMenu
                  anchor={
                    insertMenu && insertMenu.mode !== 'toolbar'
                      ? { left: insertMenu.left, top: insertMenu.top }
                      : null
                  }
                  disabled={loading || loadFailed || !canEdit}
                  editor={editor}
                  imageDisabled={!workspaceRoot}
                  imageBusy={imageImporting}
                  insertAt={insertMenu?.from ?? null}
                  contextMenu={insertMenu?.mode === 'context'}
                  onPaste={() => void pasteFromClipboard()}
                  shouldDeleteTrigger
                  onClose={closeInsertMenu}
                  onInsertImage={() => void selectAndInsertImage(editor)}
                />
                {dragHandle && !dragState && !loading && canEdit && !loadFailed ? (
                  <div
                    className="pointer-events-none absolute z-10 border border-primary/10 bg-primary/[0.025] shadow-[0_1px_6px_rgba(15,23,42,0.04)] transition-[top] duration-100"
                    style={{
                      height: dragHandle.height,
                      left: dragHandle.left,
                      top: dragHandle.highlightTop,
                      width: dragHandle.width
                    }}
                  />
                ) : null}
                {dragState?.dropAllowed ? (
                  <>
                    <div
                      className="pointer-events-none absolute z-10 border border-dashed border-primary/25 bg-primary/[0.035] shadow-[0_1px_8px_rgba(15,23,42,0.05)] transition-[top] duration-75"
                      style={{
                        height: dragHandle?.height ?? dragState.blockHeight,
                        left: dragState.previewLeft,
                        top: dragState.previewTop,
                        width: dragState.previewWidth
                      }}
                    />
                    <div
                      className="pointer-events-none absolute left-0 right-0 z-20 h-0.5 bg-primary transition-[top] duration-75"
                      style={{ top: dragState.lineTop }}
                    />
                  </>
                ) : null}
                {dragHandle && !loading && canEdit && !loadFailed ? (
                  <button
                    aria-label="拖动排序当前块"
                    className={cn(
                      'absolute left-2.5 z-20 flex size-6 cursor-grab select-none touch-none items-center justify-center rounded-md border border-transparent bg-background/80 text-muted-foreground/75 transition hover:border-slate-200 hover:bg-background hover:text-foreground',
                      dragState && 'cursor-grabbing scale-105 border-slate-200 bg-background text-foreground shadow-sm'
                    )}
                    data-block-drag-handle="true"
                    style={{ top: dragState ? dragState.handleTop : dragHandle.top }}
                    type="button"
                    onPointerDown={handleBlockPointerDown}
                  >
                    <GripVertical size={12} aria-hidden="true" />
                  </button>
                ) : null}
                <EditorContent
                  className={cn(
                    'w-full min-w-0 max-w-full',
                    compact &&
                      '[&_.tiptap]:min-h-[360px] [&_.tiptap]:py-3 [&_.tiptap]:pr-3 [&_.tiptap]:pl-8'
                  )}
                  editor={editor}
                />
          </div>
          {tableContextMenu
            ? createPortal(
                <TableContextMenu
                  ref={tableContextMenuRef}
                  left={tableContextMenu.left}
                  top={tableContextMenu.top}
                  onRun={runTableCommand}
                />,
                document.body
              )
            : null}
        </div>
      </section>
    </div>
    </NoteSourcesProvider>
  );
}
