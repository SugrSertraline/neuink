import type { Editor } from '@tiptap/core';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from 'react';

import { useToast } from '@/shared/hooks/useToast';
import type { NoteDocument, SourceLink } from '@/shared/types/domain';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';

import {
  clearMarkdownNoteDirty,
  registerMarkdownNoteSaveHandler,
  setMarkdownNoteDirty
} from '../editor/noteDirtyRegistry';
import {
  acquireNoteEditLease,
  clearNoteEditDraft,
  getNoteEditDraft,
  getNoteEditDraftRevision,
  ownsNoteEditLease,
  publishNoteEditDraft,
  releaseNoteEditLease,
  subscribeNoteEditLease
} from '../editor/noteEditLease';
import {
  dematerializeMarkdownSourceLinks,
  getMarkdownWithSourceLinks,
  hydrateSourceLinkNodes,
  pruneUnusedSourceLinks
} from '../editor/SourceLinkNode';

type SaveNote = (
  title: string,
  markdown: string,
  links: SourceLink[],
  expectedRevision?: string | null
) => Promise<NoteDocument>;

export type MarkdownNoteConflict = {
  localLinks: SourceLink[];
  localMarkdown: string;
  localTitle: string;
  remote: NoteDocument;
};

type SaveOptions = {
  expectedRevisionOverride?: string;
  quiet?: boolean;
  titleOverride?: string;
};

type SessionOptions = {
  editorScopeKey?: string;
  editor: Editor | null;
  editorRef: MutableRefObject<Editor | null>;
  entryId: string;
  fallbackTitle: string;
  noteId: string;
  noteLinksRef: MutableRefObject<SourceLink[]>;
  onLoadNote: () => Promise<NoteDocument>;
  onSaveNote: SaveNote;
  refreshKey: number;
  setNoteLinks: Dispatch<SetStateAction<SourceLink[]>>;
  suppressEditorUpdateRef: MutableRefObject<boolean>;
  workspaceRoot: string | null;
};

function persistedMarkdownFromEditor(editor: Editor, links: SourceLink[]) {
  const markdown = getMarkdownWithSourceLinks(editor);
  return dematerializeMarkdownSourceLinks(markdown, pruneUnusedSourceLinks(markdown, links));
}

function noteSaveErrorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message : String(caught);
  return message.includes('note changed after it was opened')
    ? '笔记已在其他位置被修改。当前草稿仍保留，请先通过“文件操作 → 另存为”备份，再重新打开笔记处理冲突。'
    : message;
}

function isNoteRevisionConflict(caught: unknown) {
  return (caught instanceof Error ? caught.message : String(caught)).includes(
    'note changed after it was opened'
  );
}

export function useMarkdownNoteSession({
  editorScopeKey,
  editor,
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
}: SessionOptions) {
  const { notify } = useToast();
  const [title, setTitle] = useState(fallbackTitle);
  const [draftTitle, setDraftTitle] = useState(fallbackTitle);
  const [titleEditing, setTitleEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [changeVersion, setChangeVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<MarkdownNoteConflict | null>(null);

  const dirtyRef = useRef(false);
  const titleRef = useRef(fallbackTitle);
  const draftTitleRef = useRef(fallbackTitle);
  const dirtyRegistryOwnerId = useRef(
    `markdown-note-editor-${Math.random().toString(36).slice(2)}`
  );
  const editLeaseOwnerId = useRef(`markdown-note-lease-${Math.random().toString(36).slice(2)}`);
  const canEdit = useSyncExternalStore(
    subscribeNoteEditLease,
    () => ownsNoteEditLease(entryId, noteId, editLeaseOwnerId.current),
    () => false
  );
  const sharedDraftRevision = useSyncExternalStore(
    subscribeNoteEditLease,
    () => getNoteEditDraftRevision(entryId, noteId),
    () => 0
  );
  const changeVersionRef = useRef(0);
  const savingRef = useRef(false);
  const loadedNoteIdentityRef = useRef<string | null>(null);
  const lastPersistedMarkdownRef = useRef<{
    identity: string;
    markdown: string;
    title: string;
  } | null>(null);
  const lastPersistedRevisionRef = useRef<string | null>(null);
  const persistedNoteRef = useRef<NoteDocument | null>(null);
  const onLoadNoteRef = useRef(onLoadNote);
  const onSaveNoteRef = useRef(onSaveNote);
  const saveCurrentNoteRef = useRef<
    (options?: SaveOptions) => Promise<boolean>
  >(async () => false);
  const activeSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const titleBlurSuppressed = useRef(false);

  useEffect(() => {
    acquireNoteEditLease(entryId, noteId, editLeaseOwnerId.current);
    return () => {
      setMarkdownNoteDirty(entryId, noteId, dirtyRegistryOwnerId.current, false);
      releaseNoteEditLease(entryId, noteId, editLeaseOwnerId.current);
    };
  }, [entryId, noteId]);

  const markEditorDirty = () => {
    if (
      suppressEditorUpdateRef.current ||
      !ownsNoteEditLease(entryId, noteId, editLeaseOwnerId.current)
    ) {
      return;
    }
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    const markdown = getMarkdownWithSourceLinks(currentEditor);
    const persistedMarkdown = persistedMarkdownFromEditor(currentEditor, noteLinksRef.current ?? []);
    const currentTitle = draftTitleRef.current.trim() || '未命名笔记';
    const persisted = lastPersistedMarkdownRef.current;
    if (
      persisted?.identity === `${workspaceRoot ?? ''}:${entryId}:${noteId}` &&
      persisted.markdown === persistedMarkdown &&
      persisted.title === currentTitle
    ) {
      dirtyRef.current = false;
      setMarkdownNoteDirty(entryId, noteId, dirtyRegistryOwnerId.current, false);
      setDirty(false);
      return;
    }
    dirtyRef.current = true;
    publishNoteEditDraft(entryId, noteId, markdown, currentTitle);
    setMarkdownNoteDirty(entryId, noteId, dirtyRegistryOwnerId.current, true);
    changeVersionRef.current += 1;
    setDirty(true);
    setChangeVersion(changeVersionRef.current);
    setConflict((current) =>
      current
        ? {
            ...current,
            localLinks: pruneUnusedSourceLinks(markdown, noteLinksRef.current ?? []),
            localMarkdown: persistedMarkdown,
            localTitle: currentTitle
          }
        : current
    );
  };

  useEffect(() => {
    if (editorRef.current !== editor) {
      editorRef.current = editor;
    }
    return () => {
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  }, [editor, editorRef]);

  useEffect(() => {
    editor?.setEditable(canEdit && !loading && !loadFailed);
  }, [canEdit, editor, loadFailed, loading]);

  useEffect(() => {
    if (canEdit || !editor || loading) return;
    const draft = getNoteEditDraft(entryId, noteId);
    if (!draft) return;
    suppressEditorUpdateRef.current = true;
    try {
      editor.commands.setContent(draft.markdown, { contentType: 'markdown', emitUpdate: false });
      titleRef.current = draft.title;
      draftTitleRef.current = draft.title;
      setTitle(draft.title);
      setDraftTitle(draft.title);
    } finally {
      suppressEditorUpdateRef.current = false;
    }
  }, [canEdit, editor, entryId, loading, noteId, sharedDraftRevision, suppressEditorUpdateRef]);

  useEffect(() => {
    onLoadNoteRef.current = onLoadNote;
  }, [onLoadNote]);

  useEffect(() => {
    onSaveNoteRef.current = onSaveNote;
  }, [onSaveNote]);

  useEffect(() => {
    let cancelled = false;
    const noteIdentity = `${workspaceRoot ?? ''}:${entryId}:${noteId}`;
    const isInitialLoad = loadedNoteIdentityRef.current !== noteIdentity;
    const editVersionWhenLoadStarted = changeVersionRef.current;
    if (isInitialLoad) setLoading(true);
    setLoadFailed(false);
    setError(null);

    async function load() {
      try {
        const note = await onLoadNoteRef.current();
        if (cancelled) return;

        const incomingMarkdown = note.markdown || '';
        const isCurrentNote = loadedNoteIdentityRef.current === noteIdentity;
        const isOwnPersistedRefresh =
          lastPersistedMarkdownRef.current?.identity === noteIdentity &&
          lastPersistedMarkdownRef.current.markdown === incomingMarkdown &&
          lastPersistedMarkdownRef.current.title === note.title;
        const editedWhileLoading =
          dirtyRef.current || changeVersionRef.current !== editVersionWhenLoadStarted;
        if (isCurrentNote && (isOwnPersistedRefresh || editedWhileLoading)) return;

        titleRef.current = note.title;
        draftTitleRef.current = note.title;
        setTitle(note.title);
        setDraftTitle(note.title);
        setTitleEditing(false);
        suppressEditorUpdateRef.current = true;
        try {
          editor?.commands.setContent(
            dematerializeMarkdownSourceLinks(incomingMarkdown, note.links),
            { contentType: 'markdown', emitUpdate: false }
          );
          if (editor) hydrateSourceLinkNodes(editor, note.links, workspaceRoot);
        } finally {
          suppressEditorUpdateRef.current = false;
        }
        setNoteLinks(note.links);
        noteLinksRef.current = note.links;
        loadedNoteIdentityRef.current = noteIdentity;
        const canonicalMarkdown = editor
          ? persistedMarkdownFromEditor(editor, note.links)
          : incomingMarkdown;
        lastPersistedMarkdownRef.current = {
          identity: noteIdentity,
          markdown: canonicalMarkdown,
          title: note.title
        };
        lastPersistedRevisionRef.current = note.revision;
        persistedNoteRef.current = note;
        setConflict(null);
        dirtyRef.current = false;
        if (ownsNoteEditLease(entryId, noteId, editLeaseOwnerId.current)) {
          clearMarkdownNoteDirty(entryId, noteId);
          clearNoteEditDraft(entryId, noteId);
        } else {
          setMarkdownNoteDirty(entryId, noteId, dirtyRegistryOwnerId.current, false);
        }
        setDirty(false);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
          if (isInitialLoad) setLoadFailed(true);
        }
      } finally {
        if (!cancelled && isInitialLoad) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [editor, entryId, noteId, noteLinksRef, refreshKey, reloadKey, setNoteLinks, suppressEditorUpdateRef, workspaceRoot]);

  const save = async (options: SaveOptions = {}) => {
    if (!ownsNoteEditLease(entryId, noteId, editLeaseOwnerId.current)) {
      if (!options.quiet) notify({ tone: 'default', title: '此笔记正在另一侧编辑' });
      return false;
    }
    if (!editor || loading || loadFailed) return false;
    if (activeSavePromiseRef.current) return activeSavePromiseRef.current;

    savingRef.current = true;
    setSaving(true);
    setError(null);
    const operation = (async () => {
      const versionWhenSaveStarted = changeVersionRef.current;
      const titleToSave =
        (options.titleOverride ?? draftTitleRef.current).trim() || '未命名笔记';
      let linksToSave = noteLinksRef.current ?? [];
      let persistedMarkdown = '';
      try {
        suppressEditorUpdateRef.current = true;
        let markdown: string;
        try {
          markdown = getMarkdownWithSourceLinks(editor);
        } finally {
          suppressEditorUpdateRef.current = false;
        }
        linksToSave = pruneUnusedSourceLinks(markdown, noteLinksRef.current ?? []);
        persistedMarkdown = dematerializeMarkdownSourceLinks(markdown, linksToSave);
        const saved = await onSaveNoteRef.current(
          titleToSave,
          persistedMarkdown,
          linksToSave,
          options.expectedRevisionOverride ?? lastPersistedRevisionRef.current
        );
        const titleUnchangedDuringSave =
          (draftTitleRef.current.trim() || '未命名笔记') === titleToSave;
        if (titleUnchangedDuringSave) {
          titleRef.current = saved.title;
          draftTitleRef.current = saved.title;
          setTitle(saved.title);
          setDraftTitle(saved.title);
        }
        const liveLinks = changeVersionRef.current === versionWhenSaveStarted ? saved.links :
          [...new Map([...saved.links, ...noteLinksRef.current].map((link) => [link.link_id, link])).values()];
        setNoteLinks(liveLinks);
        noteLinksRef.current = liveLinks;
        lastPersistedMarkdownRef.current = {
          identity: `${workspaceRoot ?? ''}:${entryId}:${noteId}`,
          markdown: persistedMarkdown,
          title: saved.title
        };
        lastPersistedRevisionRef.current = saved.revision;
        persistedNoteRef.current = saved;
        setConflict(null);
        setError(null);
        const currentPersistedMarkdown = persistedMarkdownFromEditor(editor, liveLinks);
        const currentTitle = draftTitleRef.current.trim() || '未命名笔记';
        if (
          changeVersionRef.current === versionWhenSaveStarted &&
          currentPersistedMarkdown === persistedMarkdown &&
          currentTitle === saved.title
        ) {
          dirtyRef.current = false;
          clearMarkdownNoteDirty(entryId, noteId);
          clearNoteEditDraft(entryId, noteId);
          setDirty(false);
        } else {
          dirtyRef.current = true;
          publishNoteEditDraft(entryId, noteId, getMarkdownWithSourceLinks(editor), currentTitle);
          setMarkdownNoteDirty(entryId, noteId, dirtyRegistryOwnerId.current, true);
          setDirty(true);
        }
        if (!options.quiet) {
          notify({ tone: 'success', title: '笔记已保存', description: saved.title });
        }
        return true;
      } catch (caught) {
        const message = noteSaveErrorMessage(caught);
        setError(message);
        if (isNoteRevisionConflict(caught)) {
          try {
            const remote = await onLoadNoteRef.current();
            const currentMarkdown = getMarkdownWithSourceLinks(editor);
            const currentLinks = pruneUnusedSourceLinks(
              currentMarkdown,
              noteLinksRef.current ?? []
            );
            setConflict({
              localLinks: currentLinks,
              localMarkdown: dematerializeMarkdownSourceLinks(currentMarkdown, currentLinks),
              localTitle: draftTitleRef.current.trim() || '未命名笔记',
              remote
            });
          } catch (refreshError) {
            setError(
              `${message} 无法读取磁盘上的最新版本：${
                refreshError instanceof Error ? refreshError.message : String(refreshError)
              }`
            );
          }
        }
        if (!options.quiet) {
          notify({ tone: 'danger', title: '保存失败', description: message });
        }
        return false;
      }
    })();
    activeSavePromiseRef.current = operation;
    try {
      return await operation;
    } finally {
      if (activeSavePromiseRef.current === operation) activeSavePromiseRef.current = null;
      savingRef.current = false;
      setSaving(false);
    }
  };
  saveCurrentNoteRef.current = save;

  // An embedded document shares the parent surface's close/save boundary, while
  // retaining the same note edit lease as standalone and split-pane editors.
  const discardRef = useRef<() => void>(() => undefined);
  discardRef.current = () => {
    const note = persistedNoteRef.current;
    if (!canEdit || !editor || !note) return;
    suppressEditorUpdateRef.current = true;
    try {
      editor.commands.setContent(dematerializeMarkdownSourceLinks(note.markdown, note.links), { contentType: 'markdown', emitUpdate: false });
      hydrateSourceLinkNodes(editor, note.links, workspaceRoot);
    } finally { suppressEditorUpdateRef.current = false; }
    titleRef.current = note.title;
    draftTitleRef.current = note.title;
    setTitle(note.title); setDraftTitle(note.title); setTitleEditing(false);
    noteLinksRef.current = note.links; setNoteLinks(note.links);
    dirtyRef.current = false;
    clearMarkdownNoteDirty(entryId, noteId); clearNoteEditDraft(entryId, noteId);
    setDirty(false); setConflict(null); setError(null);
    changeVersionRef.current += 1; setChangeVersion(changeVersionRef.current);
  };
  useEffect(() => {
    if (!editorScopeKey || !canEdit) return;
    const owner = dirtyRegistryOwnerId.current;
    const unregister = registerSegmentEditorCloseHandler(editorScopeKey, owner, {
      save: () => saveCurrentNoteRef.current({ quiet: true }),
      discard: () => discardRef.current(),
      isDirty: () => dirtyRef.current || savingRef.current
    });
    return () => { unregister(); setSegmentEditorDirty(editorScopeKey, owner, false); };
  }, [editorScopeKey, canEdit]);
  useEffect(() => {
    if (editorScopeKey) setSegmentEditorDirty(editorScopeKey, dirtyRegistryOwnerId.current, canEdit && (dirty || saving));
  }, [editorScopeKey, canEdit, dirty, saving]);

  useEffect(() => {
    if (!canEdit) return undefined;
    return registerMarkdownNoteSaveHandler(
      entryId,
      noteId,
      dirtyRegistryOwnerId.current,
      () => saveCurrentNoteRef.current()
    );
  }, [canEdit, entryId, noteId]);

  useEffect(() => {
    if (!canEdit || !dirty || conflict || error || loading || loadFailed || savingRef.current) return undefined;
    const timeoutId = window.setTimeout(() => {
      void saveCurrentNoteRef.current({ quiet: true });
    }, 1000);
    return () => window.clearTimeout(timeoutId);
  }, [canEdit, changeVersion, conflict, error, dirty, loadFailed, loading, saving]);

  useEffect(() => {
    if (!canEdit) setTitleEditing(false);
  }, [canEdit]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
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
    draftTitleRef.current = normalized;
    if (normalized === title) {
      setDraftTitle(normalized);
      setTitleEditing(false);
      return;
    }
    titleRef.current = normalized;
    setTitle(normalized);
    setDraftTitle(normalized);
    setTitleEditing(false);
    markEditorDirty();
  };

  const updateDraftTitle = (value: string) => {
    if (!canEdit || loadFailed) return;
    draftTitleRef.current = value;
    setDraftTitle(value);
    markEditorDirty();
  };

  const cancelTitleEdit = () => {
    titleBlurSuppressed.current = true;
    draftTitleRef.current = titleRef.current;
    setDraftTitle(title);
    setTitleEditing(false);
    markEditorDirty();
  };

  const startTitleEditing = () => {
    draftTitleRef.current = titleRef.current;
    setDraftTitle(titleRef.current);
    setTitleEditing(true);
  };

  const takeOverEditing = () => {
    const draft = getNoteEditDraft(entryId, noteId);
    if (draft && editor) {
      suppressEditorUpdateRef.current = true;
      try {
        editor.commands.setContent(draft.markdown, {
          contentType: 'markdown',
          emitUpdate: false
        });
        titleRef.current = draft.title;
        draftTitleRef.current = draft.title;
        setTitle(draft.title);
        setDraftTitle(draft.title);
      } finally {
        suppressEditorUpdateRef.current = false;
      }
    }
    acquireNoteEditLease(entryId, noteId, editLeaseOwnerId.current, true);
    if (draft) {
      dirtyRef.current = true;
      setMarkdownNoteDirty(entryId, noteId, dirtyRegistryOwnerId.current, true);
      changeVersionRef.current += 1;
      setChangeVersion(changeVersionRef.current);
      setDirty(true);
    }
  };

  const acceptRemoteConflict = () => {
    if (!conflict || !editor) return;
    const remote = conflict.remote;
    suppressEditorUpdateRef.current = true;
    try {
      editor.commands.setContent(
        dematerializeMarkdownSourceLinks(remote.markdown || '', remote.links),
        { contentType: 'markdown', emitUpdate: false }
      );
      hydrateSourceLinkNodes(editor, remote.links, workspaceRoot);
    } finally {
      suppressEditorUpdateRef.current = false;
    }
    titleRef.current = remote.title;
    draftTitleRef.current = remote.title;
    setTitle(remote.title);
    setDraftTitle(remote.title);
    setTitleEditing(false);
    setNoteLinks(remote.links);
    noteLinksRef.current = remote.links;
    lastPersistedMarkdownRef.current = {
      identity: `${workspaceRoot ?? ''}:${entryId}:${noteId}`,
      markdown: persistedMarkdownFromEditor(editor, remote.links),
      title: remote.title
    };
    lastPersistedRevisionRef.current = remote.revision;
    persistedNoteRef.current = remote;
    dirtyRef.current = false;
    clearMarkdownNoteDirty(entryId, noteId);
    clearNoteEditDraft(entryId, noteId);
    setDirty(false);
    setError(null);
    setConflict(null);
    changeVersionRef.current += 1;
    setChangeVersion(changeVersionRef.current);
  };

  const overwriteRemoteConflict = async () => {
    if (!conflict) return false;
    return save({ expectedRevisionOverride: conflict.remote.revision });
  };

  return {
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
    reload: () => setReloadKey((value) => value + 1),
    save,
    saveTitle,
    saving,
    startTitleEditing,
    takeOverEditing,
    title,
    titleEditing,
    updateDraftTitle
  };
}
