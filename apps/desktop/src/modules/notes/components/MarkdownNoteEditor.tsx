import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
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
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import Placeholder from '@tiptap/extension-placeholder';
import UnderlineExtension from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  ExternalLink,
  FileDown,
  FolderOpen,
  GripVertical,
  Link2,
  Loader2,
  Plus,
  PlusCircle,
  Redo2,
  Rows3,
  Save,
  Trash2,
  Undo2
} from 'lucide-react';
import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useToast } from '@/shared/hooks/useToast';
import {
  importNoteAsset,
  openNoteFile,
  revealNoteFile,
  saveNoteAssetBytes,
  saveNoteMarkdownAs
} from '@/shared/ipc/workspaceApi';
import { parseSourceLinkClipboardPayload } from '@/shared/lib/sourceLinkClipboard';
import type { NoteDocument, SourceLink } from '@/shared/types/domain';

import { CalloutBlock } from '../editor/CalloutBlock';
import { DataTableNode } from '../editor/DataTableNode';
import { MathMarkdownInputRules } from '../editor/MathMarkdownInputRules';
import { MermaidDiagram } from '../editor/MermaidDiagram';
import { EditableBlockMath, EditableInlineMath } from '../editor/EditableMathNodes';
import { MarkdownTextStyle } from '../editor/MarkdownTextStyle';
import { NoteImage } from '../editor/NoteImage';
import {
  registerMarkdownNoteSaveHandler,
  setMarkdownNoteDirty
} from '../editor/noteDirtyRegistry';
import {
  dematerializeMarkdownSourceLinks,
  SourceLinkNode,
  findSourceLinkForSegment,
  type SourceLinkOpenTarget,
  getMarkdownWithSourceLinks,
  hydrateSourceLinkNodes,
  insertSourceLinkNode,
  materializeMarkdownSourceLinks,
  pruneUnusedSourceLinks,
  sourceLinkAnchorIdsInEditor
} from '../editor/SourceLinkNode';
import { TableDeletionShortcuts } from '../editor/TableDeletionShortcuts';
import { sanitizePastedNoteHtml } from '../editor/pasteSanitizer';
import { insertStructuredMarkdownPaste } from '../editor/structuredMarkdownPaste';
import { MarkdownInsertMenu } from './MarkdownInsertMenu';
import { MarkdownInlineToolbar } from './MarkdownInlineToolbar';
import { SourceLinksPanel } from './SourceLinksPanel';

const DRAG_HANDLE_SIZE = 24;
const DRAG_HOVER_GUTTER = 44;

type TableContextMenuState = {
  anchorPos: number;
  left: number;
  top: number;
};

type InsertMenuState = {
  from: number;
  left: number;
  mode: 'context' | 'slash' | 'toolbar';
  shouldDeleteTrigger: boolean;
  top: number;
};

type TableCommand =
  | 'addColumnAfter'
  | 'addColumnBefore'
  | 'addRowAfter'
  | 'addRowBefore'
  | 'deleteColumn'
  | 'deleteRow'
  | 'deleteTable';

type MarkdownNoteEditorProps = {
  entryId: string;
  entryTitle?: string;
  fallbackTitle: string;
  noteId: string;
  refreshKey?: number;
  onLoadNote: () => Promise<NoteDocument>;
  onSaveNote: (title: string, markdown: string) => Promise<NoteDocument>;
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


import {
  TableContextMenu,
  compareSourceLinks,
  findBlockByVerticalPosition,
  findDirectChildBlock,
  findExistingSourceLinkForSameSource,
  findTableFromTarget,
  focusTableAt,
  getBlockVisualRect,
  imageAltFromPath,
  reorderTopLevelBlocks,
  resolveDropTarget,
  revealInsertedSourceLink,
  sanitizeExportFileName,
  sourceLinkDescription,
  tableAnchorPos
} from './markdownNoteEditorSupport';

export function MarkdownNoteEditor({
  entryId,
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
  const [title, setTitle] = useState(fallbackTitle);
  const [draftTitle, setDraftTitle] = useState(fallbackTitle);
  const [titleEditing, setTitleEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [changeVersion, setChangeVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fileAction, setFileAction] = useState<'open' | 'reveal' | 'save-as' | null>(null);
  const [imageImporting, setImageImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteLinks, setNoteLinks] = useState<SourceLink[]>([]);
  const [sourcePanelFilter, setSourcePanelFilter] = useState('all');
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [tableContextMenu, setTableContextMenu] = useState<TableContextMenuState | null>(null);
  const [insertMenu, setInsertMenu] = useState<InsertMenuState | null>(null);
  const [dragHandle, setDragHandle] = useState<{
    height: number;
    highlightTop: number;
    index: number;
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const [dragState, setDragState] = useState<{
    blockHeight: number;
    handleTop: number;
    lineTop: number;
    pointerOffsetY: number;
    previewLeft: number;
    previewTop: number;
    previewWidth: number;
    sourceIndex: number;
    targetIndex: number;
  } | null>(null);
  // Keep edit/save state outside React's render timing. A save can resolve while the
  // user is already typing the next character, and an external refresh triggered by
  // that save must never write the document back into the editor.
  const dirtyRef = useRef(false);
  const dirtyRegistryOwnerId = useRef(`markdown-note-editor-${Math.random().toString(36).slice(2)}`);
  const changeVersionRef = useRef(0);
  const savingRef = useRef(false);
  const suppressEditorUpdateRef = useRef(false);
  const loadedNoteIdentityRef = useRef<string | null>(null);
  const lastPersistedMarkdownRef = useRef<{ identity: string; markdown: string } | null>(null);
  const titleBlurSuppressed = useRef(false);
  const handledSourceLinkId = useRef<string | null>(null);
  const handledNoteImageId = useRef<string | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const noteLinksRef = useRef<SourceLink[]>([]);
  const onLoadNoteRef = useRef(onLoadNote);
  const onSaveNoteRef = useRef(onSaveNote);
  const onCreateSourceLinkFromPasteRef = useRef(onCreateSourceLinkFromPaste);
  const onNoteImageInsertedRef = useRef(onNoteImageInserted);
  const onSourceLinkInsertedRef = useRef(onSourceLinkInserted);
  const onOpenSourceLinkRef = useRef(onOpenSourceLink);
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(pdfDocument);
  const pasteSourceLinkBusyRef = useRef(false);
  const pasteImageBusyRef = useRef(false);
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const dragRootRef = useRef<HTMLElement | null>(null);
  const tableContextMenuRef = useRef<HTMLDivElement | null>(null);
  const contextTableAnchorPosRef = useRef<number | null>(null);
  const openSlashInsertMenuRef = useRef<(view: Editor['view']) => boolean>(() => false);
  const editorBusyRef = useRef(false);
  const dragStateRef = useRef<{
    blockHeight: number;
    handleTop: number;
    lineTop: number;
    pointerOffsetY: number;
    previewLeft: number;
    previewTop: number;
    previewWidth: number;
    sourceIndex: number;
    targetIndex: number;
  } | null>(null);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    onOpenSourceLinkRef.current = onOpenSourceLink;
  }, [onOpenSourceLink]);

  useEffect(() => {
    pdfDocumentRef.current = pdfDocument;
  }, [pdfDocument]);

  useEffect(() => {
    return () => setMarkdownNoteDirty(entryId, noteId, dirtyRegistryOwnerId.current, false);
  }, [entryId, noteId]);

  const markEditorDirty = () => {
    // Markdown/source-link serialization temporarily replaces source-link nodes
    // and hydrates them again. Those internal transactions are not user edits.
    if (suppressEditorUpdateRef.current) {
      return;
    }
    dirtyRef.current = true;
    setMarkdownNoteDirty(entryId, noteId, dirtyRegistryOwnerId.current, true);
    changeVersionRef.current += 1;
    setDirty(true);
    setChangeVersion(changeVersionRef.current);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
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
        onOpenSourceLink: (target: SourceLinkOpenTarget) => {
          onOpenSourceLinkRef.current?.(target);
        },
        snapshotAssetContext: {
          entryId,
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
          pasteImageBusyRef.current = true;
          setImageImporting(true);
          void (async () => {
            try {
              const imported = await saveNoteAssetBytes(
                workspaceRoot,
                entryId,
                noteId,
                pastedImage.type,
                await fileToBase64(pastedImage),
                pastedImage.name || null
              );
              insertNoteImageIntoEditor(
                targetEditor,
                imported.markdown_path,
                imageAltFromPath(pastedImage.name)
              );
              notify({
                tone: 'success',
                title: '图片已粘贴',
                description: imported.markdown_path
              });
            } catch (caught) {
              notify({
                tone: 'danger',
                title: '图片粘贴失败',
                description: caught instanceof Error ? caught.message : String(caught)
              });
            } finally {
              pasteImageBusyRef.current = false;
              setImageImporting(false);
            }
          })();
          return true;
        }

        const pastedText = event.clipboardData?.getData('text/plain') ?? '';
        const sourceLinkPayload = parseSourceLinkClipboardPayload(pastedText);
        const createSourceLink = onCreateSourceLinkFromPasteRef.current;
        if (sourceLinkPayload && createSourceLink && targetEditor) {
          event.preventDefault();
          pasteSourceLinkBusyRef.current = true;
          void (async () => {
            try {
              const existingLink = findSourceLinkForSegment(
                noteLinksRef.current,
                sourceLinkPayload.sourceEntryId,
                sourceLinkPayload.segmentUid
              );
              if (existingLink) {
                insertSourceLinkIntoEditor(targetEditor, existingLink);
                return;
              }

              const link = await createSourceLink(
                sourceLinkPayload.sourceEntryId,
                sourceLinkPayload.segmentUid
              );
              insertSourceLinkIntoEditor(targetEditor, link);
            } catch (caught) {
              notify({
                tone: 'danger',
                title: '粘贴来源失败',
                description: caught instanceof Error ? caught.message : String(caught)
              });
            } finally {
              pasteSourceLinkBusyRef.current = false;
            }
          })();

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
    onUpdate: markEditorDirty
  }, [entryId, noteId, workspaceRoot]);

  const insertNoteImageIntoEditor = (targetEditor: Editor, markdownPath: string, alt?: string | null) => {
    targetEditor
      .chain()
      .focus()
      .setImage({
        src: markdownPath,
        alt: alt ?? ''
      })
      .run();
  };

  const pasteImageIntoNote = async (targetEditor: Editor, image: File) => {
    if (!workspaceRoot) {
      throw new Error('当前笔记所在工作区不可用，无法保存图片。');
    }
    pasteImageBusyRef.current = true;
    setImageImporting(true);
    try {
      const imported = await saveNoteAssetBytes(
        workspaceRoot,
        entryId,
        noteId,
        image.type,
        await fileToBase64(image),
        image.name || null
      );
      insertNoteImageIntoEditor(targetEditor, imported.markdown_path, imageAltFromPath(image.name));
      notify({
        tone: 'success',
        title: '图片已粘贴',
        description: imported.markdown_path,
      });
    } finally {
      pasteImageBusyRef.current = false;
      setImageImporting(false);
    }
  };

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
              await pasteImageIntoNote(
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
      const sourceLinkPayload = parseSourceLinkClipboardPayload(text);
      const createSourceLink = onCreateSourceLinkFromPasteRef.current;
      if (sourceLinkPayload && createSourceLink) {
        pasteSourceLinkBusyRef.current = true;
        try {
          const existingLink = findSourceLinkForSegment(
            noteLinksRef.current,
            sourceLinkPayload.sourceEntryId,
            sourceLinkPayload.segmentUid,
          );
          if (existingLink) {
            insertSourceLinkIntoEditor(targetEditor, existingLink);
            return;
          }
          const link = await createSourceLink(
            sourceLinkPayload.sourceEntryId,
            sourceLinkPayload.segmentUid,
          );
          insertSourceLinkIntoEditor(targetEditor, link);
          return;
        } finally {
          pasteSourceLinkBusyRef.current = false;
        }
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

  const insertSourceLinkIntoEditor = (targetEditor: Editor, link: SourceLink) => {
    const linkToInsert = findExistingSourceLinkForSameSource(noteLinksRef.current, link) ?? link;
    insertSourceLinkNode(targetEditor, linkToInsert, workspaceRoot);
    setNoteLinks((current) => {
      const next = current.some((currentLink) => currentLink.link_id === linkToInsert.link_id)
        ? current
        : [...current, linkToInsert];
      noteLinksRef.current = next;
      return next;
    });
    markEditorDirty();
    revealInsertedSourceLink(editorScrollRef.current, linkToInsert.anchor_id);
    notify({
      tone: 'success',
      title: '已插入来源链接',
      description: sourceLinkDescription(linkToInsert)
    });
    onSourceLinkInsertedRef.current?.(link);
  };

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  }, [editor]);

  useEffect(() => {
    noteLinksRef.current = noteLinks;
  }, [noteLinks]);

  useEffect(() => {
    onLoadNoteRef.current = onLoadNote;
  }, [onLoadNote]);

  useEffect(() => {
    onSaveNoteRef.current = onSaveNote;
  }, [onSaveNote]);

  useEffect(() => {
    onCreateSourceLinkFromPasteRef.current = onCreateSourceLinkFromPaste;
  }, [onCreateSourceLinkFromPaste]);

  useEffect(() => {
    onNoteImageInsertedRef.current = onNoteImageInserted;
  }, [onNoteImageInserted]);

  useEffect(() => {
    onSourceLinkInsertedRef.current = onSourceLinkInserted;
  }, [onSourceLinkInserted]);

  useEffect(() => {
    editorBusyRef.current = loading || saving;
  }, [loading, saving]);

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
    if (!editor || loading || saving) {
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

  const activeSourceLinks = useMemo(() => {
    if (!editor) {
      return [];
    }

    const anchorIds = sourceLinkAnchorIdsInEditor(editor);
    return noteLinks
      .filter((link) => anchorIds.has(link.anchor_id))
      .sort(compareSourceLinks);
  }, [changeVersion, editor, noteLinks]);

  const sourcePanelFilters = useMemo(() => {
    const types = new Set(
      activeSourceLinks.map((link) => link.sources[0]?.segment_type ?? 'unknown')
    );
    return ['all', ...Array.from(types).sort()];
  }, [activeSourceLinks]);

  const visibleSourceLinks = useMemo(
    () =>
      sourcePanelFilter === 'all'
        ? activeSourceLinks
        : activeSourceLinks.filter(
            (link) => (link.sources[0]?.segment_type ?? 'unknown') === sourcePanelFilter
          ),
    [activeSourceLinks, sourcePanelFilter]
  );

  useEffect(() => {
    if (sourcePanelFilter === 'all' || sourcePanelFilters.includes(sourcePanelFilter)) {
      return;
    }

    setSourcePanelFilter('all');
  }, [sourcePanelFilter, sourcePanelFilters]);

  useEffect(() => {
    setSourcePanelOpen(false);
  }, [entryId, noteId]);

  const locateSourceLink = (anchorId: string) => {
    revealInsertedSourceLink(editorScrollRef.current, anchorId);
    editor?.commands.focus();
  };

  useEffect(() => {
    let cancelled = false;
    const noteIdentity = `${workspaceRoot ?? ''}:${entryId}:${noteId}`;
    const editVersionWhenLoadStarted = changeVersionRef.current;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const note = await onLoadNoteRef.current();
        if (cancelled) {
          return;
        }

        const incomingMarkdown = note.markdown || '';
        const isCurrentNote = loadedNoteIdentityRef.current === noteIdentity;
        const isOwnPersistedRefresh =
          lastPersistedMarkdownRef.current?.identity === noteIdentity &&
          lastPersistedMarkdownRef.current.markdown === incomingMarkdown;
        const editedWhileLoading =
          dirtyRef.current || changeVersionRef.current !== editVersionWhenLoadStarted;

        // `onSaveNote` may update the parent refresh key. Reloading the exact text
        // that this editor just persisted uses `setContent`, which recreates the
        // ProseMirror selection and makes the caret disappear. Keep the live editor
        // document in that case. Likewise, never overwrite a local draft with an
        // external refresh that arrived during editing.
        if (isCurrentNote && (isOwnPersistedRefresh || editedWhileLoading)) {
          return;
        }

        setTitle(note.title);
        setDraftTitle(note.title);
        setTitleEditing(false);
        suppressEditorUpdateRef.current = true;
        try {
          editor?.commands.setContent(dematerializeMarkdownSourceLinks(incomingMarkdown, note.links), {
            contentType: 'markdown',
            emitUpdate: false
          });
          if (editor) {
            hydrateSourceLinkNodes(editor, note.links, workspaceRoot);
          }
        } finally {
          suppressEditorUpdateRef.current = false;
        }
        setNoteLinks(note.links);
        noteLinksRef.current = note.links;
        loadedNoteIdentityRef.current = noteIdentity;
        lastPersistedMarkdownRef.current = { identity: noteIdentity, markdown: incomingMarkdown };
        dirtyRef.current = false;
        setMarkdownNoteDirty(entryId, noteId, dirtyRegistryOwnerId.current, false);
        setDirty(false);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [editor, entryId, noteId, workspaceRoot, refreshKey]);

  useEffect(() => {
    if (!editor || loading || !sourceLinkToInsert) {
      return;
    }
    if (handledSourceLinkId.current === sourceLinkToInsert.link_id) {
      return;
    }

    insertSourceLinkIntoEditor(editor, sourceLinkToInsert);
    handledSourceLinkId.current = sourceLinkToInsert.link_id;
  }, [editor, loading, notify, sourceLinkToInsert, workspaceRoot]);

  useEffect(() => {
    if (!editor || loading || !noteImageToInsert) {
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
  }, [editor, loading, noteImageToInsert, notify]);

  const save = async (options: { quiet?: boolean; titleOverride?: string } = {}) => {
    if (!editor) {
      return false;
    }

    if (savingRef.current) {
      return false;
    }

    savingRef.current = true;
	    setSaving(true);
	    setError(null);
	    try {
	      const changeVersionWhenSaveStarted = changeVersionRef.current;
	      suppressEditorUpdateRef.current = true;
	      let markdown: string;
	      try {
	        markdown = getMarkdownWithSourceLinks(editor);
	      } finally {
	        suppressEditorUpdateRef.current = false;
	      }
	      const linksToSave = pruneUnusedSourceLinks(markdown, noteLinksRef.current);
	      const persistedMarkdown = dematerializeMarkdownSourceLinks(markdown, linksToSave);
	      const saved = await onSaveNoteRef.current(
	        options.titleOverride ?? title,
	        persistedMarkdown
	      );
	      setTitle(saved.title);
	      setDraftTitle(saved.title);
	      setNoteLinks(saved.links);
	      noteLinksRef.current = saved.links;
	      lastPersistedMarkdownRef.current = {
	        identity: `${workspaceRoot ?? ''}:${entryId}:${noteId}`,
	        markdown: persistedMarkdown
	      };
      if (changeVersionRef.current === changeVersionWhenSaveStarted) {
        dirtyRef.current = false;
        setMarkdownNoteDirty(entryId, noteId, dirtyRegistryOwnerId.current, false);
        setDirty(false);
      }
      if (!options.quiet) {
        notify({
          tone: 'success',
          title: '笔记已保存',
          description: saved.title
        });
      }
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      if (!options.quiet) {
        notify({
          tone: 'danger',
          title: '保存失败',
          description: message
        });
      }
      return false;
    } finally {
	      savingRef.current = false;
      setSaving(false);
    }
  };

  useEffect(
    () => registerMarkdownNoteSaveHandler(entryId, noteId, dirtyRegistryOwnerId.current, () => save()),
    [entryId, noteId, save]
  );

  useEffect(() => {
    const saveFromShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!loading && !savingRef.current) {
          void save();
        }
      }
    };

    window.addEventListener('keydown', saveFromShortcut);
    return () => window.removeEventListener('keydown', saveFromShortcut);
  }, [loading, save]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  const saveTitle = () => {
    if (titleBlurSuppressed.current) {
      titleBlurSuppressed.current = false;
      return;
    }
    const normalized = draftTitle.trim() || '未命名笔记';
    if (normalized === title) {
      setDraftTitle(normalized);
      setTitleEditing(false);
      return;
    }
    setTitle(normalized);
    setDraftTitle(normalized);
    setTitleEditing(false);
    dirtyRef.current = true;
    setMarkdownNoteDirty(entryId, noteId, dirtyRegistryOwnerId.current, true);
    setDirty(true);
  };

  const cancelTitleEdit = () => {
    titleBlurSuppressed.current = true;
    setDraftTitle(title);
    setTitleEditing(false);
  };

	  const currentExportMarkdown = () => {
	    if (!editor) {
	      return '';
	    }
	    const markdown = getMarkdownWithSourceLinks(editor);
	    const links = pruneUnusedSourceLinks(markdown, noteLinks);
	    return materializeMarkdownSourceLinks(markdown, links)
	      .trimEnd()
	      .concat('\n');
	  };

  const saveDirtyNoteBeforeFileAction = async () => {
    if (!dirty) {
      return true;
    }
    return save({ quiet: true });
  };

  const openMarkdownFile = async () => {
    if (!workspaceRoot || fileAction) {
      return;
    }

    setFileAction('open');
    try {
      const saved = await saveDirtyNoteBeforeFileAction();
      if (!saved) {
        return;
      }
      await openNoteFile(workspaceRoot, entryId, noteId);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      notify({
        tone: 'danger',
        title: '打开失败',
        description: message
      });
    } finally {
      setFileAction(null);
    }
  };

  const revealMarkdownFile = async () => {
    if (!workspaceRoot || fileAction) {
      return;
    }

    setFileAction('reveal');
    try {
      const saved = await saveDirtyNoteBeforeFileAction();
      if (!saved) {
        return;
      }
      await revealNoteFile(workspaceRoot, entryId, noteId);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      notify({
        tone: 'danger',
        title: '定位失败',
        description: message
      });
    } finally {
      setFileAction(null);
    }
  };

  const saveMarkdownAs = async () => {
    if (!editor || fileAction) {
      return;
    }

    setFileAction('save-as');
    try {
      const targetPath = await saveDialog({
        defaultPath: `${sanitizeExportFileName(title || fallbackTitle || '笔记')}.md`,
        filters: [{ name: 'Markdown 文件', extensions: ['md', 'markdown'] }]
      });
      if (!targetPath) {
        return;
      }

      await saveNoteMarkdownAs(targetPath, currentExportMarkdown());
      notify({
        tone: 'success',
        title: '已另存 Markdown',
        description: targetPath
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      notify({
        tone: 'danger',
        title: '另存失败',
        description: message
      });
    } finally {
      setFileAction(null);
    }
  };

  const insertLocalImage = async () => {
    if (!editor || !workspaceRoot || imageImporting) {
      return;
    }

    setImageImporting(true);
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          {
            name: '图片',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']
          }
        ]
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }

      const imported = await importNoteAsset(workspaceRoot, entryId, noteId, selected);
      insertNoteImageIntoEditor(editor, imported.markdown_path, imageAltFromPath(selected));
      notify({
        tone: 'success',
        title: '图片已导入',
        description: imported.markdown_path
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      notify({
        tone: 'danger',
        title: '图片导入失败',
        description: message
      });
    } finally {
      setImageImporting(false);
    }
  };

  const runTableCommand = (
    command: TableCommand,
    anchorPos = tableContextMenu?.anchorPos ?? contextTableAnchorPosRef.current
  ) => {
    if (!editor || anchorPos === null) {
      return;
    }
    focusTableAt(editor, anchorPos);
    const chain = editor.chain().focus();
    switch (command) {
      case 'addColumnBefore':
        chain.addColumnBefore().run();
        setTableContextMenu(null);
        return;
      case 'addColumnAfter':
        chain.addColumnAfter().run();
        setTableContextMenu(null);
        return;
      case 'addRowBefore':
        chain.addRowBefore().run();
        setTableContextMenu(null);
        return;
      case 'addRowAfter':
        chain.addRowAfter().run();
        setTableContextMenu(null);
        return;
      case 'deleteColumn':
        chain.deleteColumn().run();
        setTableContextMenu(null);
        return;
      case 'deleteRow':
        chain.deleteRow().run();
        setTableContextMenu(null);
        return;
      case 'deleteTable':
        chain.deleteTable().run();
        setTableContextMenu(null);
        return;
    }
  };

  const handleEditorContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor) {
      contextTableAnchorPosRef.current = null;
      setTableContextMenu(null);
      return;
    }

    const table = findTableFromTarget(event.target);
    if (!table) {
      event.preventDefault();
      contextTableAnchorPosRef.current = null;
      setTableContextMenu(null);
      const targetPos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
      if (targetPos !== undefined) {
        editor.chain().setTextSelection(targetPos).run();
      }
      setInsertMenu({
        from: targetPos ?? editor.state.selection.from,
        left: event.clientX,
        mode: 'context',
        shouldDeleteTrigger: false,
        top: event.clientY
      });
      return;
    }

    event.preventDefault();
    const anchorPos = tableAnchorPos(editor, table, event.clientX, event.clientY);
    if (anchorPos === null) {
      contextTableAnchorPosRef.current = null;
      setTableContextMenu(null);
      return;
    }

    contextTableAnchorPosRef.current = anchorPos;
    setTableContextMenu({
      anchorPos,
      left: event.clientX,
      top: event.clientY
    });
  };

  const handleEditorMouseDownCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 2 || !editor || !findTableFromTarget(event.target)) {
      return;
    }
    event.preventDefault();
  };

  const updateDragHandleFromPointer = (clientX: number, clientY: number, target?: EventTarget | null) => {
    const scrollElement = editorScrollRef.current;
    const root = scrollElement?.querySelector('.tiptap');
    if (!(scrollElement instanceof HTMLDivElement) || !(root instanceof HTMLElement)) {
      setDragHandle(null);
      return;
    }
    if (target instanceof HTMLElement && target.closest('[data-block-drag-handle="true"]')) {
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const withinHorizontalBand =
      clientX >= rootRect.left - DRAG_HOVER_GUTTER && clientX <= rootRect.right;
    if (!withinHorizontalBand) {
      setDragHandle(null);
      return;
    }
    const block =
      findBlockByVerticalPosition(root, clientY) ??
      (target instanceof Node ? findDirectChildBlock(target, root) : findBlockByVerticalPosition(root, clientY));
    if (!block) {
      setDragHandle(null);
      return;
    }
    const scrollRect = scrollElement.getBoundingClientRect();
    const blockRect = block.element.getBoundingClientRect();
    const visualRect = getBlockVisualRect(block.element);
    const centeredTop =
      blockRect.top - scrollRect.top + scrollElement.scrollTop + blockRect.height / 2 - DRAG_HANDLE_SIZE / 2;
    setDragHandle({
      height: visualRect.height,
      highlightTop: visualRect.top - scrollRect.top + scrollElement.scrollTop,
      index: block.index,
      left: visualRect.left - scrollRect.left,
      top: centeredTop,
      width: visualRect.width
    });
  };

  const handleEditorMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (dragState) {
      return;
    }
    updateDragHandleFromPointer(event.clientX, event.clientY, event.target);
  };

  const handleEditorMouseLeave = () => {
    if (!dragState) {
      setDragHandle(null);
    }
  };

  const handleEditorScroll = () => {
    if (!dragState) {
      setDragHandle(null);
    }
    setInsertMenu(null);
  };

  useEffect(() => {
    const root = dragRootRef.current ?? editorScrollRef.current?.querySelector('.tiptap');
    if (!(root instanceof HTMLElement)) {
      return;
    }

    const children = Array.from(root.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement
    );

    for (const child of children) {
      child.style.transition = '';
      child.style.transform = '';
      child.style.opacity = '';
      child.style.pointerEvents = '';
    }

    if (!dragState) {
      return;
    }

    const { sourceIndex, targetIndex, blockHeight } = dragState;
    const movingDown = targetIndex > sourceIndex + 1;
    const movingUp = targetIndex < sourceIndex;

    children.forEach((child, index) => {
      child.style.transition = 'transform 140ms ease, opacity 140ms ease';

      if (index === sourceIndex) {
        child.style.opacity = '0.18';
        child.style.pointerEvents = 'none';
        return;
      }

      if (movingDown && index > sourceIndex && index < targetIndex) {
        child.style.transform = `translateY(${-blockHeight}px)`;
        return;
      }

      if (movingUp && index >= targetIndex && index < sourceIndex) {
        child.style.transform = `translateY(${blockHeight}px)`;
      }
    });

    return () => {
      for (const child of children) {
        child.style.transition = '';
        child.style.transform = '';
        child.style.opacity = '';
        child.style.pointerEvents = '';
      }
    };
  }, [dragState]);

  const handleBlockDragEnd = () => {
    setDragState(null);
    setDragHandle(null);
    dragRootRef.current = null;
  };

  const updateDragStateFromPointer = (_clientX: number, clientY: number) => {
    const scrollElement = editorScrollRef.current;
    const root = dragRootRef.current;
    if (!(scrollElement instanceof HTMLDivElement) || !(root instanceof HTMLElement)) {
      return;
    }

    const scrollRect = scrollElement.getBoundingClientRect();
    const children = Array.from(root.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement
    );
    const dropTarget = resolveDropTarget(children, clientY);

    setDragState((current) => {
      if (!current) {
        return current;
      }

      const handleTop =
        clientY - scrollRect.top + scrollElement.scrollTop - current.pointerOffsetY;
      if (!dropTarget) {
        const nextState = {
          ...current,
          handleTop
        };
        dragStateRef.current = nextState;
        return nextState;
      }
      const previewTop = dropTarget.top - scrollRect.top + scrollElement.scrollTop;
      const nextTargetIndex = dropTarget.targetIndex;

      const nextState = {
        ...current,
        previewTop,
        handleTop,
        lineTop: previewTop,
        targetIndex: nextTargetIndex
      };
      dragStateRef.current = nextState;
      return nextState;
    });
  };

  const handleBlockPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const scrollElement = editorScrollRef.current;
    const root = scrollElement?.querySelector('.tiptap');
    if (!dragHandle || !(scrollElement instanceof HTMLDivElement) || !(root instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    dragRootRef.current = root;
    const scrollRect = scrollElement.getBoundingClientRect();
    const blockElement = root.children[dragHandle.index];
    if (!(blockElement instanceof HTMLElement)) {
      return;
    }
    const blockRect = blockElement.getBoundingClientRect();
    const visualRect = getBlockVisualRect(blockElement);
    const pointerOffsetY = event.clientY - (scrollRect.top + dragHandle.top);
    const nextState = {
      blockHeight: blockRect.height,
      handleTop: dragHandle.top,
      lineTop: blockRect.top - scrollRect.top + scrollElement.scrollTop,
      pointerOffsetY,
      previewLeft: visualRect.left - scrollRect.left,
      previewTop: visualRect.top - scrollRect.top + scrollElement.scrollTop,
      previewWidth: visualRect.width,
      sourceIndex: dragHandle.index,
      targetIndex: dragHandle.index
    };
    setDragState(nextState);
    dragStateRef.current = nextState;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateDragStateFromPointer(moveEvent.clientX, moveEvent.clientY);
    };

    const finishDrag = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      const currentDrag = dragStateRef.current;
      if (editor && currentDrag) {
        reorderTopLevelBlocks(editor, currentDrag.sourceIndex, currentDrag.targetIndex);
      }
      handleBlockDragEnd();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    updateDragStateFromPointer(event.clientX, event.clientY);
  };

  useEffect(() => {
    if (!tableContextMenu) {
      return undefined;
    }

    const closeFromPointer = (event: PointerEvent) => {
      if (
        tableContextMenuRef.current &&
        event.target instanceof Node &&
        tableContextMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setTableContextMenu(null);
      contextTableAnchorPosRef.current = null;
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTableContextMenu(null);
        contextTableAnchorPosRef.current = null;
      }
    };

    window.addEventListener('pointerdown', closeFromPointer);
    window.addEventListener('keydown', closeFromKeyboard);
    return () => {
      window.removeEventListener('pointerdown', closeFromPointer);
      window.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [tableContextMenu]);

  return (
    <div className={cn('grid h-full w-full min-h-[560px] min-w-0 max-w-none', compact && 'min-h-0')}>
      <section className="grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3">
        <div className="flex min-h-10 min-w-0 items-center gap-2 border-b bg-white px-3 py-2">
          {entryTitle ? (
            <>
              <span className="min-w-0 max-w-[40%] truncate text-sm font-semibold" title={entryTitle}>{entryTitle}</span>
              <span aria-hidden="true" className="text-muted-foreground/50">·</span>
            </>
          ) : null}
          {titleEditing ? (
            <Input
              aria-label="Markdown 文件标题"
              autoFocus
              className={cn('h-9 max-w-[28rem] font-semibold', compact && 'max-w-full')}
              value={draftTitle}
              onBlur={saveTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  saveTitle();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelTitleEdit();
                }
              }}
            />
          ) : (
            <button
              className={cn(
                'min-w-0 max-w-[36rem] truncate rounded-sm text-left text-base font-semibold outline-none transition hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/40',
                compact && 'max-w-60 text-sm'
              )}
              disabled={loading}
              title="点击修改标题"
              type="button"
              onClick={() => setTitleEditing(true)}
            >
              {title}
            </button>
          )}
          {saving ? <Loader2 className="animate-spin text-muted-foreground" size={15} aria-hidden="true" /> : null}
        </div>

        <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-2 bg-white px-3 py-1.5 text-xs text-muted-foreground">
          {loading ? <Badge variant="outline">加载中</Badge> : null}
          {!loading && dirty ? <Badge variant="secondary">未保存，请手动保存</Badge> : null}
          {!loading ? <span>自动保存已关闭 · Ctrl/Cmd + S 保存</span> : null}
          {!loading && noteLinks.length > 0 ? (
            <span className="truncate">
              来源链接：点击预览，Ctrl/Cmd + 点击跳转
            </span>
          ) : null}
          {error ? <span className="truncate text-destructive">{error}</span> : null}
          <span className="min-w-0 flex-1" />
          <Button
            disabled={loading || saving || !workspaceRoot || fileAction !== null}
            size="xs"
            type="button"
            variant="outline"
            onClick={() => void openMarkdownFile()}
          >
            {fileAction === 'open' ? (
              <Loader2 className="animate-spin" size={13} aria-hidden="true" />
            ) : (
              <ExternalLink size={13} aria-hidden="true" />
            )}
            打开 Markdown
          </Button>
          <Button
            disabled={loading || saving || !workspaceRoot || fileAction !== null}
            size="xs"
            title="在文件管理器中定位 Markdown 文件"
            type="button"
            variant="outline"
            onClick={() => void revealMarkdownFile()}
          >
            {fileAction === 'reveal' ? (
              <Loader2 className="animate-spin" size={13} aria-hidden="true" />
            ) : (
              <FolderOpen size={13} aria-hidden="true" />
            )}
            定位文件
          </Button>
          <Button
            disabled={loading || fileAction !== null}
            size="xs"
            type="button"
            variant="outline"
            onClick={() => void saveMarkdownAs()}
          >
            {fileAction === 'save-as' ? (
              <Loader2 className="animate-spin" size={13} aria-hidden="true" />
            ) : (
              <FileDown size={13} aria-hidden="true" />
            )}
            另存为
          </Button>
          <Button
            disabled={loading || saving || !editor || !editor.can().undo()}
            size="xs"
            title="撤销（Ctrl/Cmd + Z）"
            type="button"
            variant="outline"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 size={13} aria-hidden="true" />
            撤销
          </Button>
          <Button
            disabled={loading || saving || !editor || !editor.can().redo()}
            size="xs"
            title="恢复（Ctrl/Cmd + Shift + Z）"
            type="button"
            variant="outline"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 size={13} aria-hidden="true" />
            恢复
          </Button>
          <Button
            disabled={loading || saving || !dirty}
            size="xs"
            title="保存（Ctrl/Cmd + S）"
            type="button"
            onClick={() => void save()}
          >
            {saving ? (
              <Loader2 className="animate-spin" size={13} aria-hidden="true" />
            ) : (
              <Save size={13} aria-hidden="true" />
            )}
            保存
          </Button>
        </div>

        <div
          className={cn(
            'grid min-h-0 min-w-0',
            sourcePanelOpen && activeSourceLinks.length > 0
              ? 'grid-rows-[auto_auto_minmax(0,1fr)]'
              : 'grid-rows-[auto_minmax(0,1fr)]'
          )}
        >
          <div
            className="relative mb-2 flex flex-wrap items-start gap-2 bg-white px-3 py-2"
            data-note-editor-toolbar="true"
          >
            <MarkdownInlineToolbar disabled={loading} editor={editor} />
            <MarkdownInsertMenu
              anchor={insertMenu?.mode === 'toolbar' ? { left: insertMenu.left, top: insertMenu.top } : null}
              disabled={loading || saving}
              editor={editor}
              imageDisabled={!workspaceRoot}
              imageBusy={imageImporting}
              insertAt={insertMenu?.from ?? null}
              shouldDeleteTrigger={false}
              onClose={closeInsertMenu}
              onInsertImage={() => void insertLocalImage()}
            />
            <Button
              className="h-[42px]"
              disabled={loading || saving || !editor}
              size="sm"
              title="插入块"
              type="button"
              variant="outline"
              onMouseDown={(event) => event.preventDefault()}
              onClick={openInsertMenuFromButton}
            >
              <PlusCircle size={13} aria-hidden="true" />
              插入
            </Button>
            {activeSourceLinks.length > 0 ? (
              <Button
                aria-expanded={sourcePanelOpen}
                className="ml-auto h-7 gap-1 px-1.5 text-[11px]"
                size="sm"
                title={sourcePanelOpen ? '收起来源' : `展开 ${activeSourceLinks.length} 个来源`}
                type="button"
                variant={sourcePanelOpen ? 'secondary' : 'ghost'}
                onClick={() => setSourcePanelOpen((open) => !open)}
              >
                <Link2 size={12} aria-hidden="true" />
                {activeSourceLinks.length}
                <span className="sr-only">{sourcePanelOpen ? '收起来源' : '展开来源'}</span>
              </Button>
            ) : null}
          </div>
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
            className="relative min-h-0 min-w-0 overflow-x-hidden overflow-y-auto"
            onContextMenu={handleEditorContextMenu}
            onMouseDownCapture={handleEditorMouseDownCapture}
            onMouseLeave={handleEditorMouseLeave}
            onMouseMove={handleEditorMouseMove}
            onScroll={handleEditorScroll}
          >
                <MarkdownInsertMenu
                  anchor={
                    insertMenu && insertMenu.mode !== 'toolbar'
                      ? { left: insertMenu.left, top: insertMenu.top }
                      : null
                  }
                  disabled={loading || saving}
                  editor={editor}
                  imageDisabled={!workspaceRoot}
                  imageBusy={imageImporting}
                  insertAt={insertMenu?.from ?? null}
                  contextMenu={insertMenu?.mode === 'context'}
                  onPaste={() => void pasteFromClipboard()}
                  shouldDeleteTrigger
                  onClose={closeInsertMenu}
                  onInsertImage={() => void insertLocalImage()}
                />
                {dragHandle && !dragState && !loading ? (
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
                {dragState ? (
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
                {dragHandle && !loading ? (
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
                    'min-w-0 max-w-full',
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
  );
}

function firstImageFromClipboard(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) {
    return null;
  }

  for (const file of Array.from(clipboardData.files)) {
    if (file.type.startsWith('image/')) {
      return file;
    }
  }

  for (const item of Array.from(clipboardData.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }

  return null;
}

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}
