import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  applyTagProposal,
  applyEntryMetaProposal,
  createAnnotation,
  createEntry,
  createNote,
  createNoteSourceLink,
  createTag,
  deleteEntry,
  deleteNote,
  deleteTag,
  getNoteFilePath,
  listAnnotations,
  listEntries,
  listTrashedEntries,
  listTrashItems,
  restoreTrashItem,
  purgeTrashItem,
  emptyEntryTrash,
  openNoteFile,
  openDevWorkspace,
  purgeEntry,
  queuePdfParse,
  readNote,
  readPdfReader,
  refreshParseStatus,
  revealNoteFile,
  resetWorkspaceRoot,
  restoreEntry,
  retryPdfParse,
  saveNoteMarkdownAs,
  renameTag,
  createAndSetWorkspaceRoot,
  switchWorkspaceRoot as switchWorkspaceRootApi,
  submitQueuedPdfParse,
  updateAnnotation,
  updateEntryMeta,
  updateNote,
  deleteAnnotation,
  upsertSegmentNote,
  type AnnotationCatalogRecord
} from '../ipc/workspaceApi';
import type {
  Annotation,
  AnnotationId,
  AnnotationImportance,
  EntryMeta,
  NoteId,
  TagId,
  TagMeta,
  TrashItem
} from '../types/domain';
import type { AssistantEntryMetaProposal, AssistantTagProposal } from '../types/assistant';
import { useWorkspaceResourceActions } from './useWorkspaceResourceActions';

type WorkspaceStatus = 'loading' | 'ready' | 'error';

export type CreateEntryRequest = {
  pdfPath?: string;
  mineruZipPath?: string;
  title: string;
  fields?: Record<string, string>;
  tagPaths?: string[];
};

export type CreateEntryResult = {
  importedMineruClientResult?: boolean;
  entryId: string;
  createdWithPdf: boolean;
  parseSubmissionFailed: boolean;
  parseMessage?: string | null;
};

export type RefreshParsingEntriesResult = {
  completedEntryIds: string[];
  updatedEntries: EntryMeta[];
};

export function useWorkspace() {
  const [root, setRoot] = useState<string | null>(null);
  const [entries, setEntries] = useState<EntryMeta[]>([]);
  const [annotationRecords, setAnnotationRecords] = useState<AnnotationCatalogRecord[]>([]);
  const [trashedEntries, setTrashedEntries] = useState<EntryMeta[]>([]);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [tags, setTags] = useState<TagMeta[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkspaceStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [parseSubmissionCount, setParseSubmissionCount] = useState(0);
  const [isRefreshingParseStatus, setIsRefreshingParseStatus] = useState(false);
  const lastParseStatusRefreshAt = useRef(0);
  const parseStatusRefreshInFlight = useRef(false);

  const selectFirstEntry = useCallback((nextEntries: EntryMeta[]) => {
    setSelectedEntryId((current) => {
      if (current && nextEntries.some((entry) => entry.id === current)) {
        return current;
      }
      return nextEntries[0]?.id ?? null;
    });
  }, []);

  const refreshEntries = useCallback(
    async (workspaceRoot = root) => {
      if (!workspaceRoot) {
        return;
      }
      const [nextEntries, nextTrashedEntries, nextTrashItems] = await Promise.all([
        listEntries(workspaceRoot),
        listTrashedEntries(workspaceRoot),
        listTrashItems(workspaceRoot)
      ]);
      setEntries(nextEntries);
      setTrashedEntries(nextTrashedEntries);
      setTrashItems(nextTrashItems);
      selectFirstEntry(nextEntries);
    },
    [root, selectFirstEntry]
  );

  const applyOpenedWorkspace = useCallback(
    (workspace: {
      entries: EntryMeta[];
      root: string;
      tags: TagMeta[];
      trashed_entries: EntryMeta[];
    }) => {
      setRoot(workspace.root);
      setEntries(workspace.entries);
      setAnnotationRecords([]);
      setTrashedEntries(workspace.trashed_entries);
      void listTrashItems(workspace.root).then(setTrashItems).catch((caught) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      });
      setTags(workspace.tags);
      selectFirstEntry(workspace.entries);
      setError(null);
      setStatus('ready');
      void listAnnotations(workspace.root)
        .then(setAnnotationRecords)
        .catch((caught) => {
          setError(caught instanceof Error ? caught.message : String(caught));
        });
    },
    [selectFirstEntry]
  );

  const refreshAnnotationCatalog = useCallback(
    async (workspaceRoot = root) => {
      if (!workspaceRoot) {
        setAnnotationRecords([]);
        return [];
      }
      const records = await listAnnotations(workspaceRoot);
      setAnnotationRecords(records);
      return records;
    },
    [root]
  );

  const refreshTrashItems = useCallback(
    async (workspaceRoot = root) => {
      if (!workspaceRoot) {
        setTrashItems([]);
        return [];
      }
      const items = await listTrashItems(workspaceRoot);
      setTrashItems(items);
      return items;
    },
    [root]
  );

  useEffect(() => {
    let cancelled = false;

    async function openWorkspace() {
      try {
        setStatus('loading');
        const workspace = await openDevWorkspace();
        if (cancelled) {
          return;
        }
        applyOpenedWorkspace(workspace);
      } catch (caught) {
        if (cancelled) {
          return;
        }
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus('error');
      }
    }

    void openWorkspace();

    return () => {
      cancelled = true;
    };
  }, [applyOpenedWorkspace]);

  const switchWorkspaceRoot = useCallback(
    async (nextRoot: string) => {
      setStatus('loading');
      try {
        applyOpenedWorkspace(await switchWorkspaceRootApi(nextRoot));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus(root ? 'ready' : 'error');
        throw caught;
      }
    },
    [applyOpenedWorkspace, root]
  );

  const createWorkspaceRoot = useCallback(
    async (nextRoot: string) => {
      setStatus('loading');
      try {
        applyOpenedWorkspace(await createAndSetWorkspaceRoot(nextRoot));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus(root ? 'ready' : 'error');
        throw caught;
      }
    },
    [applyOpenedWorkspace, root]
  );

  const resetWorkspaceToDefault = useCallback(async () => {
    setStatus('loading');
    try {
      applyOpenedWorkspace(await resetWorkspaceRoot());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus(root ? 'ready' : 'error');
      throw caught;
    }
  }, [applyOpenedWorkspace, root]);


  const {
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
  } = useWorkspaceResourceActions({
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
  });

  const restoreWorkspaceTrashItem = useCallback(async (entryId: string, trashId: string) => {
    if (!root) return;
    try {
      await restoreTrashItem(root, entryId, trashId);
      await Promise.all([refreshEntries(root), refreshAnnotationCatalog(root)]);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    }
  }, [refreshAnnotationCatalog, refreshEntries, root]);

  const purgeWorkspaceTrashItem = useCallback(async (entryId: string, trashId: string) => {
    if (!root) return;
    try {
      await purgeTrashItem(root, entryId, trashId);
      await refreshTrashItems(root);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    }
  }, [refreshTrashItems, root]);

  const emptyWorkspaceEntryTrash = useCallback(async (entryId: string) => {
    if (!root) return;
    try {
      await emptyEntryTrash(root, entryId);
      await refreshTrashItems(root);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    }
  }, [refreshTrashItems, root]);

  const refreshParsingEntries = useCallback(
    async (
      endpoint: string,
      options: { apiKey?: string; force?: boolean } = {}
    ): Promise<RefreshParsingEntriesResult | null> => {
      if (!root || parseStatusRefreshInFlight.current) {
        return null;
      }

      const now = Date.now();
      if (!options.force && now - lastParseStatusRefreshAt.current < 3000) {
        return null;
      }

      const targets = entries.filter((entry) => {
        const parse = entry.pdf?.parse;
        return (
          parse?.task_id &&
          ['queued', 'uploading', 'uploaded', 'parsing'].includes(parse.status)
        );
      });

      if (targets.length === 0) {
        return null;
      }

      const previousStatusByEntryId = new Map(
        targets.map((entry) => [entry.id, entry.pdf?.parse.status])
      );

      parseStatusRefreshInFlight.current = true;
      lastParseStatusRefreshAt.current = now;
      setIsRefreshingParseStatus(true);

      try {
        const results = await Promise.allSettled(
          targets.map((entry) => refreshParseStatus(root, entry.id, endpoint, options.apiKey))
        );
        const updatedEntries = results
          .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof refreshParseStatus>>> =>
            result.status === 'fulfilled'
          )
          .map((result) => result.value.entry);
        const failed = results.find((result) => result.status === 'rejected');

        if (updatedEntries.length > 0) {
          setEntries((current) =>
            current.map((entry) => updatedEntries.find((updated) => updated.id === entry.id) ?? entry)
          );
        }
        if (failed?.status === 'rejected') {
          if (updatedEntries.length === 0) {
            setError(failed.reason instanceof Error ? failed.reason.message : String(failed.reason));
          } else {
            setError(null);
          }
        } else {
          setError(null);
        }
        return {
          completedEntryIds: updatedEntries
            .filter(
              (entry) =>
                previousStatusByEntryId.get(entry.id) !== 'succeeded' &&
                entry.pdf?.parse.status === 'succeeded'
            )
            .map((entry) => entry.id),
          updatedEntries
        };
      } finally {
        parseStatusRefreshInFlight.current = false;
        setIsRefreshingParseStatus(false);
      }
    },
    [entries, root]
  );

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedEntryId) ?? entries[0] ?? null,
    [entries, selectedEntryId]
  );

  return {
    root,
    entries,
    trashedEntries,
    trashItems,
    selectedEntry,
    selectedEntryId,
    status,
    tags,
    annotationRecords,
    error,
    applyEntryTagPaths,
    applyWorkspaceEntryMetaProposal,
    applyWorkspaceTagProposal,
    createLibraryEntry,
    createMarkdownNote,
    createTagPath,
    createWorkspaceEntry,
    createWorkspaceRoot,
    deleteMarkdownNote,
    deleteWorkspaceEntry,
    deleteWorkspaceTag,
    importPdfForEntry,
    importPdfForSelectedEntry,
    isParsingPdf: parseSubmissionCount > 0,
    isRefreshingParseStatus,
    purgeWorkspaceEntry,
    createMarkdownSourceLink,
    importMarkdownNoteSegmentAsset,
    getMarkdownNoteFilePath,
    openMarkdownNoteFile,
    readMarkdownNote,
    readEntryPdfReader,
    renameWorkspaceTag,
    refreshEntries,
    refreshTrashItems,
    refreshAnnotationCatalog,
    refreshParsingEntries,
    restoreWorkspaceEntry,
    restoreWorkspaceTrashItem,
    purgeWorkspaceTrashItem,
    emptyWorkspaceEntryTrash,
    retryPdfParseForEntry,
    startQueuedPdfParseForEntry,
    importMineruClientResultForEntry,
    saveAnnotation,
    saveSegmentNote,
    removeSegmentNote,
    saveMarkdownNote,
    saveMarkdownNoteAs,
    revealMarkdownNoteFile,
    removeAnnotation,
    switchWorkspaceRoot,
    resetWorkspaceToDefault,
    updateWorkspaceEntry,
    renameWorkspacePdfDisplayName,
    setSelectedEntryId
  };
}

function cleanFields(fields: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key.trim(), value.trim()])
      .filter(([key, value]) => key.length > 0 && value.length > 0 && key.toLowerCase() !== 'title')
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
