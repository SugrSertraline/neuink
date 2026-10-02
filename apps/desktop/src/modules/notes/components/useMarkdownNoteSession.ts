import type { Editor } from '@tiptap/core';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useToast } from '@/shared/hooks/useToast';
import type { NoteDocument, SourceLink } from '@/shared/types/domain';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { registerMarkdownNoteSaveHandler, setMarkdownNoteDirty } from '../editor/noteDirtyRegistry';
import { getSharedNoteSession, retainSharedNoteSession, type NoteConflict, type NoteSaveOptions } from '../editor/sharedNoteSession';

export type MarkdownNoteConflict = NoteConflict;
type SessionOptions = {
  editorScopeKey?: string;
  editor: Editor | null;
  editorRef: MutableRefObject<Editor | null>;
  entryId: string;
  fallbackTitle: string;
  noteId: string;
  noteLinksRef: MutableRefObject<SourceLink[]>;
  onLoadNote: () => Promise<NoteDocument>;
  onSaveNote: (title: string, markdown: string, links: SourceLink[], revision?: string | null) => Promise<NoteDocument>;
  refreshKey: number;
  setNoteLinks: Dispatch<SetStateAction<SourceLink[]>>;
  suppressEditorUpdateRef: MutableRefObject<boolean>;
  workspaceRoot: string | null;
};

export function useMarkdownNoteSession({ editorScopeKey, editor, editorRef, entryId, fallbackTitle, noteId,
  noteLinksRef, onLoadNote, onSaveNote, refreshKey, setNoteLinks, suppressEditorUpdateRef, workspaceRoot }: SessionOptions) {
  const { notify } = useToast();
  const key = JSON.stringify([workspaceRoot, entryId, noteId]);
  const session = useMemo(() => getSharedNoteSession(key, workspaceRoot, fallbackTitle), [key]);
  session.configure({ load: onLoadNote, save: onSaveNote });
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [titleEditing, setTitleEditing] = useState(false);
  const originalTitle = useRef(fallbackTitle);
  const suppressTitleBlur = useRef(false);
  const owner = useRef('note-view-' + crypto.randomUUID()).current;

  useEffect(() => retainSharedNoteSession(key, session), [key, session]);
  useEffect(() => {
    editorRef.current = editor;
    if (!editor) return;
    const detach = session.attach({ editor, links: () => noteLinksRef.current, updateLinks: links => {
      noteLinksRef.current = links; setNoteLinks(links);
    } });
    return () => { detach(); if (editorRef.current === editor) editorRef.current = null; };
  }, [session, editor, editorRef, noteLinksRef, setNoteLinks]);
  useEffect(() => { void session.load(true); }, [session, refreshKey]);
  useEffect(() => { editor?.setEditable(!state.loading && !state.loadFailed); }, [editor, state.loading, state.loadFailed]);

  const save = async (options: NoteSaveOptions = {}) => {
    const success = await session.save(options);
    if (!options.quiet) {
      const current = session.getSnapshot();
      if (success) notify({ tone: 'success', title: '笔记已保存', description: current.title });
      else if (current.error) notify({ tone: 'danger', title: '保存失败', description: current.error });
    }
    return success;
  };
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => registerMarkdownNoteSaveHandler(entryId, noteId, owner, () => saveRef.current({ quiet: true })), [entryId, noteId, owner]);
  useEffect(() => {
    const update = () => { const s = session.getSnapshot(); setMarkdownNoteDirty(entryId, noteId, owner, s.dirty || s.saving); };
    update(); const unsubscribe = session.subscribe(update);
    return () => { unsubscribe(); setMarkdownNoteDirty(entryId, noteId, owner, false); };
  }, [entryId, noteId, owner, session]);
  useEffect(() => {
    if (!editorScopeKey) return;
    const unregister = registerSegmentEditorCloseHandler(editorScopeKey, owner, {
      save: () => saveRef.current({ quiet: true }), discard: () => { session.discard(); setTitleEditing(false); },
      isDirty: () => { const s = session.getSnapshot(); return s.dirty || s.saving; }
    });
    return () => { unregister(); setSegmentEditorDirty(editorScopeKey, owner, false); };
  }, [editorScopeKey, owner, session]);
  useEffect(() => {
    if (!editorScopeKey) return;
    const update = () => { const s = session.getSnapshot(); setSegmentEditorDirty(editorScopeKey, owner, s.dirty || s.saving); };
    update(); const unsubscribe = session.subscribe(update);
    return () => { unsubscribe(); setSegmentEditorDirty(editorScopeKey, owner, false); };
  }, [editorScopeKey, owner, session]);
  useEffect(() => {
    if (!state.dirty || state.loading || state.loadFailed || state.saving || state.error || state.conflict) return;
    const timeout = window.setTimeout(() => void session.save({ quiet: true }), 1000);
    return () => window.clearTimeout(timeout);
  }, [session, state]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const current = session.getSnapshot();
      if (current.dirty || current.saving) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [session]);

  return {
    runInsertionOnce: session.runInsertionOnce,
    acceptRemoteConflict: () => { session.acceptRemote(); setTitleEditing(false); },
    canEdit: !state.loadFailed,
    cancelTitleEdit: () => { suppressTitleBlur.current = true; session.setTitle(originalTitle.current); setTitleEditing(false); },
    changeVersion: state.version,
    conflict: state.conflict,
    dirty: state.dirty,
    draftTitle: state.title,
    error: state.error,
    loadFailed: state.loadFailed,
    loading: state.loading,
    markEditorDirty: () => { if (!suppressEditorUpdateRef.current) session.changed(); },
    overwriteRemoteConflict: () => session.save({ expectedRevisionOverride: session.getSnapshot().conflict?.remote.revision }),
    reload: () => session.load(true),
    save,
    saveTitle: () => {
      if (suppressTitleBlur.current) { suppressTitleBlur.current = false; return; }
      session.setTitle(session.getSnapshot().title.trim() || '未命名笔记'); setTitleEditing(false);
    },
    saving: state.saving,
    startTitleEditing: () => { originalTitle.current = session.getSnapshot().title; setTitleEditing(true); },
    takeOverEditing: () => { /* All views edit the same session; no takeover is necessary. */ },
    title: state.title,
    titleEditing,
    updateDraftTitle: (value: string) => session.setTitle(value)
  };
}
