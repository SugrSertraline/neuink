import type { Editor } from '@tiptap/core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react';

import type { ToastContextValue } from '@/shared/hooks/useToast';
import { parseSourceLinkClipboardPayload } from '@/shared/lib/sourceLinkClipboard';
import type { SourceLink } from '@/shared/types/domain';

import {
  findSourceLinkForSegment,
  insertSourceLinkNode,
  sourceLinkAnchorIdsInEditor
} from '../editor/SourceLinkNode';
import {
  compareSourceLinks,
  findExistingSourceLinkForSameSource,
  revealInsertedSourceLink,
  sourceLinkDescription
} from './markdownNoteEditorSupport';

type SourceLinkPasteHandler = (editor: Editor, text: string) => boolean;

export function sourceLinkFilters(links: SourceLink[]) {
  const types = new Set(links.map((link) => link.sources[0]?.segment_type ?? 'unknown'));
  return ['all', ...Array.from(types).sort()];
}

export function visibleSourceLinks(links: SourceLink[], filter: string) {
  return filter === 'all'
    ? links
    : links.filter((link) => (link.sources[0]?.segment_type ?? 'unknown') === filter);
}

export function useMarkdownSourceLinks({
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
}: {
  canEdit: boolean;
  changeVersion: number;
  editor: Editor | null;
  editorScrollRef: { current: HTMLDivElement | null };
  entryId: string;
  loadFailed: boolean;
  loading: boolean;
  markEditorDirtyRef: { current: () => void };
  noteId: string;
  noteLinks: SourceLink[];
  noteLinksRef: { current: SourceLink[] };
  notify: ToastContextValue['notify'];
  onCreateSourceLinkFromPaste?: (sourceEntryId: string, segmentUid: string) => Promise<SourceLink>;
  onSourceLinkInserted?: (link: SourceLink) => void;
  pasteSourceLinkBusyRef: { current: boolean };
  pasteSourceLinkHandlerRef: { current: SourceLinkPasteHandler };
  setNoteLinks: Dispatch<SetStateAction<SourceLink[]>>;
  sourceLinkToInsert?: SourceLink | null;
  workspaceRoot?: string | null;
}) {
  const [sourcePanelFilter, setSourcePanelFilter] = useState('all');
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const handledSourceLinkIdRef = useRef<string | null>(null);
  const onCreateSourceLinkFromPasteRef = useRef(onCreateSourceLinkFromPaste);
  const onSourceLinkInsertedRef = useRef(onSourceLinkInserted);

  useEffect(() => {
    noteLinksRef.current = noteLinks;
  }, [noteLinks, noteLinksRef]);

  useEffect(() => {
    onCreateSourceLinkFromPasteRef.current = onCreateSourceLinkFromPaste;
  }, [onCreateSourceLinkFromPaste]);

  useEffect(() => {
    onSourceLinkInsertedRef.current = onSourceLinkInserted;
  }, [onSourceLinkInserted]);

  const insertSourceLink = useCallback(
    (targetEditor: Editor, link: SourceLink) => {
      if (targetEditor.isDestroyed || !targetEditor.isEditable) return;
      const linkToInsert =
        findExistingSourceLinkForSameSource(noteLinksRef.current, link) ?? link;
      insertSourceLinkNode(targetEditor, linkToInsert, workspaceRoot);
      setNoteLinks((current) => {
        const next = current.some(
          (currentLink) => currentLink.link_id === linkToInsert.link_id
        )
          ? current
          : [...current, linkToInsert];
        noteLinksRef.current = next;
        return next;
      });
      markEditorDirtyRef.current();
      revealInsertedSourceLink(editorScrollRef.current, linkToInsert.anchor_id);
      notify({
        tone: 'success',
        title: '已插入来源链接',
        description: sourceLinkDescription(linkToInsert)
      });
      onSourceLinkInsertedRef.current?.(link);
    },
    [editorScrollRef, markEditorDirtyRef, noteLinksRef, notify, setNoteLinks, workspaceRoot]
  );

  const beginSourceLinkPaste = useCallback<SourceLinkPasteHandler>(
    (targetEditor, text) => {
      const payload = parseSourceLinkClipboardPayload(text);
      const createSourceLink = onCreateSourceLinkFromPasteRef.current;
      if (!payload || !createSourceLink || pasteSourceLinkBusyRef.current) {
        return false;
      }

      pasteSourceLinkBusyRef.current = true;
      void (async () => {
        try {
          const existingLink = findSourceLinkForSegment(
            noteLinksRef.current,
            payload.sourceEntryId,
            payload.segmentUid
          );
          if (existingLink) {
            insertSourceLink(targetEditor, existingLink);
            return;
          }

          const link = await createSourceLink(payload.sourceEntryId, payload.segmentUid);
          insertSourceLink(targetEditor, link);
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
    },
    [insertSourceLink, noteLinksRef, notify, pasteSourceLinkBusyRef]
  );

  useEffect(() => {
    pasteSourceLinkHandlerRef.current = beginSourceLinkPaste;
    return () => {
      if (pasteSourceLinkHandlerRef.current === beginSourceLinkPaste) {
        pasteSourceLinkHandlerRef.current = () => false;
      }
    };
  }, [beginSourceLinkPaste, pasteSourceLinkHandlerRef]);

  const activeSourceLinks = useMemo(() => {
    if (!editor) {
      return [];
    }
    const anchorIds = sourceLinkAnchorIdsInEditor(editor);
    return noteLinks
      .filter((link) => anchorIds.has(link.anchor_id))
      .sort(compareSourceLinks);
  }, [changeVersion, editor, noteLinks]);
  const filters = useMemo(() => sourceLinkFilters(activeSourceLinks), [activeSourceLinks]);
  const visibleLinks = useMemo(
    () => visibleSourceLinks(activeSourceLinks, sourcePanelFilter),
    [activeSourceLinks, sourcePanelFilter]
  );

  useEffect(() => {
    if (sourcePanelFilter !== 'all' && !filters.includes(sourcePanelFilter)) {
      setSourcePanelFilter('all');
    }
  }, [filters, sourcePanelFilter]);

  useEffect(() => {
    setSourcePanelOpen(false);
    setSourcePanelFilter('all');
    handledSourceLinkIdRef.current = null;
  }, [entryId, noteId]);

  useEffect(() => {
    if (!editor || loading || loadFailed || !canEdit || !sourceLinkToInsert) {
      return;
    }
    if (handledSourceLinkIdRef.current === sourceLinkToInsert.link_id) {
      return;
    }

    // Tiptap React node views may flush synchronously. Insert outside React's
    // effect commit, and cancel when ownership/target changes before this runs.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed || !editor.isEditable) return;
      handledSourceLinkIdRef.current = sourceLinkToInsert.link_id;
      insertSourceLink(editor, sourceLinkToInsert);
    });
    return () => { cancelled = true; };
  }, [canEdit, editor, insertSourceLink, loadFailed, loading, sourceLinkToInsert]);

  const locateSourceLink = useCallback(
    (anchorId: string) => {
      revealInsertedSourceLink(editorScrollRef.current, anchorId);
      editor?.commands.focus();
    },
    [editor, editorScrollRef]
  );

  return {
    activeSourceLinks,
    locateSourceLink,
    sourcePanelFilter,
    sourcePanelFilters: filters,
    sourcePanelOpen,
    visibleSourceLinks: visibleLinks,
    setSourcePanelFilter,
    setSourcePanelOpen
  };
}
