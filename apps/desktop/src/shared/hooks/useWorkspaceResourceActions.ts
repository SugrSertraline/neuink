import { useCallback, type Dispatch, type SetStateAction } from 'react';

import {
  applyTagProposal,
  applyEntryMetaProposal,
  createAnnotation,
  createEntry,
  createFromMineruClientResult,
  createNote,
  createNoteSourceLink,
  createTag,
  deleteEntry,
  deleteNote,
  deleteTag,
  getNoteFilePath,
  importNoteSegmentAsset,
  importMineruClientResult,
  listAnnotations,
  listEntries,
  listTrashedEntries,
  openNoteFile,
  openDevWorkspace,
  purgeEntry,
  queuePdfParse,
  readNote,
  readPdfReader,
  refreshParseStatus,
  renamePdfDisplayName,
  revealNoteFile,
  resetWorkspaceRoot,
  restoreEntry,
  retryPdfParse,
  saveNoteMarkdownAs,
  renameTag,
  setWorkspaceRoot,
  submitQueuedPdfParse,
  updateAnnotation,
  updateEntryMeta,
  updateNote,
  deleteAnnotation,
  deleteSegmentNote,
  upsertSegmentNote,
  type AnnotationCatalogRecord
} from '../ipc/workspaceApi';
import { readAutoParseOnPdfImport } from '../lib/parserSettings';
import type {
  Annotation,
  AnnotationId,
  AnnotationImportance,
  AnnotationTextSelection,
  EntryMeta,
  NoteId,
  TagId,
  TagMeta
} from '../types/domain';
import type { AssistantEntryMetaProposal, AssistantTagProposal } from '../types/assistant';
import type { CreateEntryRequest, CreateEntryResult } from './useWorkspace';

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type UseWorkspaceResourceActionsOptions = {
  entries: EntryMeta[];
  refreshAnnotationCatalog: (workspaceRoot?: string | null) => Promise<AnnotationCatalogRecord[]>;
  refreshEntries: (workspaceRoot?: string | null) => Promise<void>;
  refreshTrashItems: (workspaceRoot?: string | null) => Promise<unknown>;
  root: string | null;
  selectFirstEntry: (entries: EntryMeta[]) => void;
  selectedEntryId: string | null;
  setEntries: StateSetter<EntryMeta[]>;
  setError: StateSetter<string | null>;
  setParseSubmissionCount: StateSetter<number>;
  setSelectedEntryId: StateSetter<string | null>;
  setTags: StateSetter<TagMeta[]>;
  setTrashedEntries: StateSetter<EntryMeta[]>;
  tags: TagMeta[];
};

export function useWorkspaceResourceActions({
  entries,
  refreshAnnotationCatalog,
  refreshEntries,
  refreshTrashItems,
  root,
  selectFirstEntry,
  selectedEntryId,
  setEntries,
  setError,
  setParseSubmissionCount,
  setSelectedEntryId,
  setTags,
  setTrashedEntries,
  tags
}: UseWorkspaceResourceActionsOptions) {
  const ensureTagPath = useCallback(
    async (path: string, catalog: TagMeta[]): Promise<{ tagId: TagId | null; tags: TagMeta[] }> => {
      if (!root) {
        return { tagId: null, tags: catalog };
      }

      let parentId: TagId | null = null;
      let nextTags = catalog;
      for (const segment of splitTagPath(path)) {
        const existing = nextTags.find(
          (tag) => tag.parent_id === parentId && tag.name.toLowerCase() === segment.toLowerCase()
        );
        if (existing) {
          parentId = existing.id;
          continue;
        }

        const created = await createTag(root, segment, parentId);
        nextTags = [...nextTags, created];
        parentId = created.id;
      }

      return { tagId: parentId, tags: nextTags };
    },
    [root]
  );

  const createWorkspaceEntry = useCallback(
    async (title: string, tagPaths: string[] = []) => {
      if (!root) {
        return;
      }
      try {
        let nextTags = tags;
        const tagIds: TagId[] = [];
        for (const tagPath of cleanTagPaths(tagPaths)) {
          const result = await ensureTagPath(tagPath, nextTags);
          nextTags = result.tags;
          if (result.tagId) {
            tagIds.push(result.tagId);
          }
        }
        setTags(nextTags);

        const entry = await createEntry(root, title.trim(), {}, tagIds);
        setEntries((current) => [entry, ...current.filter((item) => item.id !== entry.id)]);
        setSelectedEntryId(entry.id);
        setError(null);
        return entry;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return undefined;
      }
    },
    [ensureTagPath, root, tags]
  );

  const submitQueuedParse = useCallback(
    (workspaceRoot: string, entryId: string, endpoint: string, apiKey?: string) => {
      setParseSubmissionCount((count) => count + 1);
      void submitQueuedPdfParse(workspaceRoot, entryId, endpoint, apiKey)
        .then((response) => {
          setEntries((current) => [
            response.entry,
            ...current.filter((entry) => entry.id !== response.entry.id)
          ]);
          setError(
            response.entry.pdf?.parse.status === 'failed'
              ? response.entry.pdf.parse.message
              : null
          );
        })
        .catch(async (caught) => {
          setError(caught instanceof Error ? caught.message : String(caught));
          await refreshEntries(workspaceRoot);
        })
        .finally(() => {
          setParseSubmissionCount((count) => Math.max(0, count - 1));
        });
    },
    [refreshEntries]
  );

  const createLibraryEntry = useCallback(
    async (
      request: CreateEntryRequest,
      endpoint: string,
      apiKey?: string
    ): Promise<CreateEntryResult | undefined> => {
      if (!root) {
        return;
      }
      const title = request.title.trim();
      if (!title) {
        throw new Error('entry title is required');
      }
      const fields = cleanFields(request.fields ?? {});

      let createdEntryId: string | null = null;
      try {
        let nextTags = tags;
        const tagIds: TagId[] = [];
        for (const tagPath of cleanTagPaths(request.tagPaths ?? [])) {
          const result = await ensureTagPath(tagPath, nextTags);
          nextTags = result.tags;
          if (result.tagId) {
            tagIds.push(result.tagId);
          }
        }
        setTags(nextTags);

        if (request.mineruZipPath) {
          const imported = await createFromMineruClientResult(root, title, fields, tagIds, request.mineruZipPath);
          setEntries((current) => [imported.entry, ...current.filter((entry) => entry.id !== imported.entry.id)]);
          setSelectedEntryId(imported.entry.id);
          return { createdWithPdf: true, entryId: imported.entry.id, importedMineruClientResult: true, parseSubmissionFailed: false, parseMessage: imported.entry.pdf?.parse.message ?? null };
        }

        const created = await createEntry(root, title, fields, tagIds);
        createdEntryId = created.id;
        setEntries((current) => [created, ...current.filter((item) => item.id !== created.id)]);
        setSelectedEntryId(created.id);
        setError(null);

        if (request.pdfPath) {
          const queued = await queuePdfParse(root, created.id, request.pdfPath);
          setEntries((current) => [
            queued,
            ...current.filter((entry) => entry.id !== queued.id)
          ]);
          if (readAutoParseOnPdfImport()) {
            submitQueuedParse(root, queued.id, endpoint, apiKey);
          }
          return {
            createdWithPdf: true,
            entryId: created.id,
            parseSubmissionFailed: false,
            parseMessage: queued.pdf?.parse.message ?? null
          };
        }
        await refreshEntries(root);
        setError(null);
        return {
          createdWithPdf: Boolean(request.pdfPath),
          entryId: created.id,
          parseSubmissionFailed: false,
          parseMessage: null
        };
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await refreshEntries(root);
        if (createdEntryId) {
          setSelectedEntryId(createdEntryId);
        }
        throw caught;
      }
    },
    [ensureTagPath, refreshEntries, root, submitQueuedParse, tags]
  );

  const importPdfForEntry = useCallback(
    async (entryId: string, pdfPath: string, endpoint: string, apiKey?: string) => {
      if (!root) {
        return;
      }
      try {
        const queued = await queuePdfParse(root, entryId, pdfPath);
        setEntries((current) =>
          current.map((entry) => (entry.id === queued.id ? queued : entry))
        );
        if (readAutoParseOnPdfImport()) {
          submitQueuedParse(root, queued.id, endpoint, apiKey);
        }
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await refreshEntries(root);
      }
    },
    [refreshEntries, root, submitQueuedParse]
  );

  const importPdfForSelectedEntry = useCallback(
    async (pdfPath: string, endpoint: string, apiKey?: string) => {
      if (!selectedEntryId) {
        return;
      }
      return importPdfForEntry(selectedEntryId, pdfPath, endpoint, apiKey);
    },
    [importPdfForEntry, selectedEntryId]
  );

  const retryPdfParseForEntry = useCallback(
    async (entryId: string, endpoint: string, apiKey?: string) => {
      if (!root) {
        return;
      }
      try {
        const response = await retryPdfParse(root, entryId, endpoint, apiKey);
        setEntries((current) =>
          current.map((entry) => (entry.id === response.entry.id ? response.entry : entry))
        );
        setError(
          response.entry.pdf?.parse.status === 'failed'
            ? response.entry.pdf.parse.message
            : null
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await refreshEntries(root);
        throw caught;
      }
    },
    [refreshEntries, root]
  );

  const startQueuedPdfParseForEntry = useCallback(
    async (entryId: string, endpoint: string, apiKey?: string) => {
      if (!root) return;
      const response = await submitQueuedPdfParse(root, entryId, endpoint, apiKey);
      setEntries((current) =>
        current.map((entry) => (entry.id === response.entry.id ? response.entry : entry))
      );
      setError(response.entry.pdf?.parse.status === 'failed' ? response.entry.pdf.parse.message : null);
    },
    [root]
  );

  const importMineruClientResultForEntry = useCallback(
    async (entryId: string, zipPath: string) => {
      if (!root) return;
      const response = await importMineruClientResult(root, entryId, zipPath);
      setEntries((current) => current.map((entry) => entry.id === response.entry.id ? response.entry : entry));
      setError(null);
      return response;
    },
    [root]
  );

  const createMarkdownNote = useCallback(
    async (entryId: string, title: string) => {
      if (!root) {
        return;
      }
      try {
        const updated = await createNote(root, entryId, title);
        setEntries((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry))
        );
        setSelectedEntryId(updated.id);
        setError(null);
        return updated;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await refreshEntries(root);
        throw caught;
      }
    },
    [refreshEntries, root]
  );

  const deleteMarkdownNote = useCallback(
    async (entryId: string, noteId: NoteId) => {
      if (!root) {
        return;
      }
      try {
        const updated = await deleteNote(root, entryId, noteId);
        setEntries((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry))
        );
        setSelectedEntryId(updated.id);
        setError(null);
        await refreshTrashItems(root);
        return updated;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await refreshEntries(root);
        throw caught;
      }
    },
    [refreshEntries, refreshTrashItems, root]
  );

  const createTagPath = useCallback(
    async (path: string) => {
      if (!root) {
        return;
      }
      try {
        const result = await ensureTagPath(path, tags);
        setTags(result.tags);
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        throw caught;
      }
    },
    [ensureTagPath, root, tags]
  );

  const updateWorkspaceEntry = useCallback(
    async (
      entryId: string,
      request: {
        fields: Record<string, string>;
        tagPaths: string[];
        title: string;
      }
    ) => {
      if (!root) {
        return;
      }

      try {
        let nextTags = tags;
        const tagIds: TagId[] = [];
        for (const tagPath of cleanTagPaths(request.tagPaths)) {
          const result = await ensureTagPath(tagPath, nextTags);
          nextTags = result.tags;
          if (result.tagId) {
            tagIds.push(result.tagId);
          }
        }
        setTags(nextTags);

        const updated = await updateEntryMeta(
          root,
          entryId,
          request.title,
          cleanFields(request.fields),
          tagIds
        );
        setEntries((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry))
        );
        setSelectedEntryId(updated.id);
        setError(null);
        return updated;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await refreshEntries(root);
        throw caught;
      }
    },
    [ensureTagPath, refreshEntries, root, tags]
  );

  const renameWorkspacePdfDisplayName = useCallback(
    async (entryId: string, fileName: string) => {
      if (!root) {
        throw new Error('workspace is not open');
      }

      try {
        const updated = await renamePdfDisplayName(root, entryId, fileName);
        setEntries((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry))
        );
        setSelectedEntryId(updated.id);
        setError(null);
        return updated;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await refreshEntries(root);
        throw caught;
      }
    },
    [refreshEntries, root]
  );

  const applyEntryTagPaths = useCallback(
    async (entryId: string, tagPaths: string[]) => {
      if (!root) {
        return;
      }

      const entry = entries.find((item) => item.id === entryId);
      if (!entry) {
        return;
      }

      try {
        let nextTags = tags;
        const tagIds = new Set<TagId>(entry.tags);
        for (const tagPath of cleanTagPaths(tagPaths)) {
          const result = await ensureTagPath(tagPath, nextTags);
          nextTags = result.tags;
          if (result.tagId) {
            tagIds.add(result.tagId);
          }
        }
        setTags(nextTags);

        const updated = await updateEntryMeta(root, entryId, entry.title, entry.fields, [
          ...tagIds
        ]);
        setEntries((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
        setSelectedEntryId(updated.id);
        setError(null);
        return updated;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await refreshEntries(root);
        throw caught;
      }
    },
    [ensureTagPath, entries, refreshEntries, root, tags]
  );

  const applyWorkspaceTagProposal = useCallback(
    async (proposal: AssistantTagProposal) => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      try {
        const response = await applyTagProposal(root, proposal);
        setEntries(response.entries);
        setTags(response.tags);
        selectFirstEntry(response.entries);
        setError(null);
        return response;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await refreshEntries(root);
        throw caught;
      }
    },
    [refreshEntries, root, selectFirstEntry]
  );

  const applyWorkspaceEntryMetaProposal = useCallback(
    async (proposal: AssistantEntryMetaProposal) => {
      if (!root) throw new Error('workspace is not open');
      try {
        const updated = await applyEntryMetaProposal(root, proposal);
        setEntries((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry))
        );
        setError(null);
        return updated;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await refreshEntries(root);
        throw caught;
      }
    },
    [refreshEntries, root]
  );

  const renameWorkspaceTag = useCallback(
    async (tagId: TagId, name: string) => {
      if (!root) {
        return;
      }
      try {
        const updated = await renameTag(root, tagId, name);
        setTags((current) => current.map((tag) => (tag.id === updated.id ? updated : tag)));
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        throw caught;
      }
    },
    [root]
  );

  const deleteWorkspaceTag = useCallback(
    async (tagId: TagId) => {
      if (!root) {
        return;
      }
      try {
        const response = await deleteTag(root, tagId);
        setTags(response.tags);
        setEntries(response.entries);
        selectFirstEntry(response.entries);
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        throw caught;
      }
    },
    [root, selectFirstEntry]
  );

  const deleteWorkspaceEntry = useCallback(
    async (entryId: string) => {
      if (!root) {
        return;
      }
      try {
        const deleted = entries.find((entry) => entry.id === entryId) ?? null;
        await deleteEntry(root, entryId);
        const nextEntries = entries.filter((entry) => entry.id !== entryId);
        setEntries(nextEntries);
        setTrashedEntries((current) =>
          deleted ? [deleted, ...current.filter((entry) => entry.id !== entryId)] : current
        );
        selectFirstEntry(nextEntries);
        setError(null);
        await refreshTrashItems(root);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await refreshEntries(root);
        throw caught;
      }
    },
    [entries, refreshEntries, refreshTrashItems, root, selectFirstEntry]
  );

  const restoreWorkspaceEntry = useCallback(
    async (entryId: string) => {
      if (!root) {
        return;
      }
      try {
        const restored = await restoreEntry(root, entryId);
        const nextEntries = [restored, ...entries.filter((entry) => entry.id !== restored.id)];
        setEntries(nextEntries);
        setTrashedEntries((current) => current.filter((entry) => entry.id !== restored.id));
        setSelectedEntryId(restored.id);
        setError(null);
        await refreshTrashItems(root);
        return restored;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(
          message.includes('entry already exists')
            ? '无法恢复：原位置已有同一条目。恢复不会覆盖现有 PDF 或条目，请保留当前条目并从回收站复制所需内容。'
            : message
        );
        await refreshEntries(root);
        throw caught;
      }
    },
    [entries, refreshEntries, refreshTrashItems, root]
  );

  const purgeWorkspaceEntry = useCallback(
    async (entryId: string) => {
      if (!root) {
        return;
      }
      try {
        await purgeEntry(root, entryId);
        setTrashedEntries((current) => current.filter((entry) => entry.id !== entryId));
        setError(null);
        await refreshTrashItems(root);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        await refreshEntries(root);
        throw caught;
      }
    },
    [refreshEntries, refreshTrashItems, root]
  );

  const readEntryPdfReader = useCallback(
    async (entryId: string) => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      return readPdfReader(root, entryId);
    },
    [root]
  );

  const saveSegmentNote = useCallback(
    async (entryId: string, segmentUid: string, text: string) => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      return upsertSegmentNote(root, entryId, segmentUid, text);
    },
    [root]
  );

  const removeSegmentNote = useCallback(
    async (entryId: string, segmentUid: string) => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      const notes = await deleteSegmentNote(root, entryId, segmentUid);
      await refreshTrashItems(root);
      return notes;
    },
    [refreshTrashItems, root]
  );

  const saveAnnotation = useCallback(
    async (
      entryId: string,
      annotation: {
        annotationId?: AnnotationId | null;
        content: string;
        importance: AnnotationImportance;
        kind: string;
        segmentUid: string;
        textSelection?: AnnotationTextSelection | null;
      }
    ): Promise<Annotation[]> => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      if (annotation.annotationId) {
        const annotations = await updateAnnotation(
          root,
          entryId,
          annotation.annotationId,
          annotation.kind,
          annotation.content,
          annotation.importance
        );
        await refreshAnnotationCatalog(root);
        return annotations;
      }
      const annotations = await createAnnotation(
        root,
        entryId,
        annotation.segmentUid,
        annotation.kind,
        annotation.content,
        annotation.importance,
        annotation.textSelection
      );
      await refreshAnnotationCatalog(root);
      return annotations;
    },
    [refreshAnnotationCatalog, root]
  );

  const removeAnnotation = useCallback(
    async (entryId: string, annotationId: AnnotationId): Promise<Annotation[]> => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      const annotations = await deleteAnnotation(root, entryId, annotationId);
      await Promise.all([refreshAnnotationCatalog(root), refreshTrashItems(root)]);
      return annotations;
    },
    [refreshAnnotationCatalog, refreshTrashItems, root]
  );

  const readMarkdownNote = useCallback(
    async (entryId: string, noteId: NoteId) => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      return readNote(root, entryId, noteId);
    },
    [root]
  );

  const saveMarkdownNote = useCallback(
    async (entryId: string, noteId: NoteId, title: string, markdown: string) => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      const note = await updateNote(root, entryId, noteId, title, markdown);
      setEntries((current) =>
        current.map((entry) => {
          if (entry.id !== entryId) {
            return entry;
          }
          let changed = false;
          const nextContents = entry.contents.map((content) => {
            if (content.kind !== 'note' || content.note_id !== noteId || content.title === note.title) {
              return content;
            }
            changed = true;
            return {
              ...content,
              title: note.title
            };
          });
          return changed
            ? {
                ...entry,
                contents: nextContents
              }
            : entry;
        })
      );
      return note;
    },
    [root]
  );

  const getMarkdownNoteFilePath = useCallback(
    async (entryId: string, noteId: NoteId) => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      return getNoteFilePath(root, entryId, noteId);
    },
    [root]
  );

  const openMarkdownNoteFile = useCallback(
    async (entryId: string, noteId: NoteId) => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      await openNoteFile(root, entryId, noteId);
    },
    [root]
  );

  const revealMarkdownNoteFile = useCallback(
    async (entryId: string, noteId: NoteId) => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      await revealNoteFile(root, entryId, noteId);
    },
    [root]
  );

  const saveMarkdownNoteAs = useCallback(
    async (targetPath: string, markdown: string) => {
      await saveNoteMarkdownAs(targetPath, markdown);
    },
    []
  );

  const createMarkdownSourceLink = useCallback(
    async (entryId: string, noteId: NoteId, sourceEntryId: string, segmentUid: string) => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      return createNoteSourceLink(root, entryId, noteId, sourceEntryId, segmentUid);
    },
    [root]
  );

  const importMarkdownNoteSegmentAsset = useCallback(
    async (entryId: string, noteId: NoteId, sourceEntryId: string, segmentUid: string) => {
      if (!root) {
        throw new Error('workspace is not open');
      }
      return importNoteSegmentAsset(root, entryId, noteId, sourceEntryId, segmentUid);
    },
    [root]
  );

  return {
    ensureTagPath,
    createWorkspaceEntry,
    submitQueuedParse,
    createLibraryEntry,
    importPdfForEntry,
    importPdfForSelectedEntry,
    retryPdfParseForEntry,
    startQueuedPdfParseForEntry,
    importMineruClientResultForEntry,
    createMarkdownNote,
    deleteMarkdownNote,
    createTagPath,
    updateWorkspaceEntry,
    renameWorkspacePdfDisplayName,
    applyEntryTagPaths,
    applyWorkspaceTagProposal,
    applyWorkspaceEntryMetaProposal,
    renameWorkspaceTag,
    deleteWorkspaceTag,
    deleteWorkspaceEntry,
    restoreWorkspaceEntry,
    purgeWorkspaceEntry,
    readEntryPdfReader,
    saveSegmentNote,
    removeSegmentNote,
    saveAnnotation,
    removeAnnotation,
    readMarkdownNote,
    saveMarkdownNote,
    getMarkdownNoteFilePath,
    openMarkdownNoteFile,
    revealMarkdownNoteFile,
    saveMarkdownNoteAs,
    createMarkdownSourceLink,
    importMarkdownNoteSegmentAsset
  };
}

function cleanFields(fields: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key.trim(), value.trim()])
      .filter(
        ([key, value]) =>
          key.length > 0 &&
          value.length > 0 &&
          key.toLowerCase() !== 'title'
      )
  );
}

function cleanTagPaths(paths: string[]) {
  return [...new Set(paths.map(normalizeTagPath).filter((path) => path.length > 0))];
}

function normalizeTagPath(path: string) {
  return splitTagPath(path).join('/');
}

function splitTagPath(path: string) {
  return path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}
