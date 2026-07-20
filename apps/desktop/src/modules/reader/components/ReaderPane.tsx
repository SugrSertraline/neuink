import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { Link2 } from 'lucide-react';

import type { WorkspacePaneId, WorkspaceSurface, WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { entryContentId, surfaceKey } from '@/app/workspaceSurface';
import {
  clampWorkspaceSplitLeftWidth,
  WORKSPACE_SPLIT_MIN_LEFT_WIDTH,
  WORKSPACE_SPLIT_MIN_RIGHT_WIDTH
} from '@/app/workspaceSplit';
import type { CreateEntryRequest, CreateEntryResult } from '@/shared/hooks/useWorkspace';
import type { AnnotationCatalogRecord, PdfReaderResponse } from '@/shared/ipc/workspaceApi';
import type {
  AssistantActiveSegment,
  AssistantContextAddOptions,
  AssistantContextInput
} from '@/shared/types/assistant';
import type {
  Annotation,
  AnnotationId,
  AnnotationImportance,
  AnnotationTextSelection,
  NoteDocument,
  SegmentBlockNote,
  SourceLink
} from '@/shared/types/domain';
import type { SourceLinkOpenTarget } from '../../notes/editor/SourceLinkNode';
import type { TagMeta, TrashItem } from '@/shared/types/domain';
import type {
  MarkdownNoteTarget,
  PdfJumpRequest,
  SidePaneState,
} from '../types';
import type { AppThemePreset, AppThemePresetId } from '@/shared/lib/themePresets';
import type { UiScale } from '@/shared/lib/uiScale';
import type { ReaderPreferences } from '@/shared/lib/readerPreferences';

import type { LibraryEntry, LibraryView } from '../../library/components/LibrarySidebar';
import { TagEditorPage } from '../../library/components/TagEditorPage';
import { SettingsPanel } from '../../settings/components/SettingsPanel';
import { CreateEntryPanel } from './CreateEntryPanel';
import { EntryLibraryView } from './EntryLibraryView';
import { EntryContentHeader } from './EntryContentHeader';
import { EntryWorkspaceView } from './EntryWorkspaceView';
import {
  ReaderEmptyState,
  ReaderSurfaceBody,
  readerSelectableItemClass
} from './ReaderSurfacePrimitives';
import {
  hasHeavyReaderIdleExpired,
  HEAVY_READER_SWEEP_INTERVAL_MS,
  isHeavyReaderSurface
} from './readerRetention';
import { useSourceBacklinks } from './useSourceBacklinks';

type ReaderPaneProps = {
  surfaceLayout: WorkspaceSurfaceLayout;
  onOpenSurface: (surface: WorkspaceSurface, pane?: WorkspacePaneId) => void;
  onFocusSurface: (pane: WorkspacePaneId) => void;
  activeTag: string | null;
  annotationRecords: AnnotationCatalogRecord[];
  markdownNoteRefreshById: Record<string, number>;
  pdfJumpByEntryId: Record<string, PdfJumpRequest | null>;
  pdfReaderReloadByEntryId: Record<string, number>;
  sidePane: SidePaneState;
  entries: LibraryEntry[];
  trashedEntries: LibraryEntry[];
  trashItems: TrashItem[];
  isRefreshingParseStatus: boolean;
  libraryView: LibraryView;
  recentReadingEntryIds: string[];
  selectedEntryId: string | null;
  status: 'loading' | 'ready' | 'error';
  tags: TagMeta[];
  themePreset: AppThemePresetId;
  themePresets: AppThemePreset[];
  uiScale: UiScale;
  workspaceRoot: string | null;
  onCreateEntry: (request: CreateEntryRequest) => Promise<CreateEntryResult | undefined>;
  onCreateEntryFinished: (result: CreateEntryResult) => void;
  onCreateMarkdownSourceLink: (
    entryId: string,
    noteId: string,
    sourceEntryId: string,
    segmentUid: string
  ) => Promise<SourceLink>;
  onImportMarkdownNoteSegmentAsset: (
    entryId: string,
    noteId: string,
    sourceEntryId: string,
    segmentUid: string
  ) => Promise<{ markdown_path: string; file_path: string }>;
  onCreateTagPath: (path: string) => Promise<void> | void;
  onDeleteEntry: (entryId: string) => Promise<void> | void;
  onDeleteMarkdownNote: (entryId: string, noteId: string) => Promise<void> | void;
  onDeleteTag: (tagId: string) => Promise<void> | void;
  onOpenCreateEntryTab: () => void;
  onOpenEntryExplorer: (entryId: string) => void;
  onOpenEntryInSidePane: (entryId: string) => void;
  onOpenEntryNote: (entryId: string, noteId: string) => void;
  onOpenAnnotation: (record: AnnotationCatalogRecord) => void;
  onCloseSidePane: () => void;
  onOpenSourceLink: (target: SourceLinkOpenTarget) => void;
  onPurgeEntry: (entryId: string) => Promise<void> | void;
  onEmptyEntryTrash: (entryId: string) => Promise<void> | void;
  onPurgeTrashItem: (entryId: string, trashId: string) => Promise<void> | void;
  parserEndpoint: string;
  parserApiKey: string;
  popoEnhancementEnabled: boolean;
  popoEnhancementEndpoint: string;
  readerPreferences: ReaderPreferences;
  onParserEndpointChange: (value: string) => void;
  onParserApiKeyChange: (value: string) => void;
  onPopoEnhancementEnabledChange: (value: boolean) => void;
  onPopoEnhancementEndpointChange: (value: string) => void;
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onThemePresetChange: (value: AppThemePresetId) => void;
  onUiScaleChange: (value: UiScale) => void;
  onRenameTag: (tagId: string, name: string) => Promise<void> | void;
  onRefreshParseStatus: () => Promise<void> | void;
  onRetryPdfParse: (entryId: string) => Promise<void> | void;
  onRefreshAnnotations: () => Promise<unknown> | unknown;
  onBeforeWorkspaceChange: () => Promise<void>;
  onCreateWorkspaceRoot: (root: string) => Promise<void>;
  onResetWorkspaceRoot: () => Promise<void>;
  onReadPdfReader: (entryId: string) => Promise<PdfReaderResponse>;
  onReadMarkdownNote: (entryId: string, noteId: string) => Promise<NoteDocument>;
  onToggleSidePanePinned: () => void;
  onRestoreEntry: (entryId: string) => Promise<void> | void;
  onRestoreTrashItem: (entryId: string, trashId: string) => Promise<void> | void;
  onAddAssistantContext?: (
    context: AssistantContextInput,
    options?: AssistantContextAddOptions
  ) => void;
  onActiveSegmentChange?: (segment: AssistantActiveSegment | null) => void;
  onApplyEntryTagPaths: (entryId: string, tagPaths: string[]) => Promise<unknown> | unknown;
  onExportTranslationNote: (entryId: string, title: string, markdown: string) => Promise<void>;
  onSaveSegmentNote: (entryId: string, segmentUid: string, text: string) => Promise<SegmentBlockNote[]>;
  onDeleteSegmentNote: (entryId: string, segmentUid: string) => Promise<SegmentBlockNote[]>;
  onSaveAnnotation: (entryId: string, annotation: {
    annotationId?: AnnotationId | null;
    content: string;
    importance: AnnotationImportance;
    kind: string;
    segmentUid: string;
    textSelection?: AnnotationTextSelection | null;
  }) => Promise<Annotation[]>;
  onDeleteAnnotation: (entryId: string, annotationId: AnnotationId) => Promise<Annotation[]>;
  onSaveMarkdownNote: (entryId: string, noteId: string, title: string, markdown: string) => Promise<NoteDocument>;
  onSelectEntry: (id: string) => void;
  onSelectTag: (tag: string | null) => void;
  onSwitchWorkspaceRoot: (root: string) => Promise<void>;
  onWorkspaceSplitLeftWidthChange: (width: number) => void;
  onWorkspaceSplitLeftWidthPreview: (width: number) => void;
  workspaceSplitLeftWidth: number | null;
};

type LinkedReaderSegment = {
  mode: 'note' | 'annotation';
  requestKey: number;
  segmentUid: string;
  source: 'pdf' | 'segment-notes' | 'reflow';
};

export function ReaderPane({
  surfaceLayout,
  onOpenSurface,
  onFocusSurface,
  activeTag,
  annotationRecords,
  markdownNoteRefreshById,
  pdfJumpByEntryId,
  pdfReaderReloadByEntryId,
  sidePane,
  entries,
  trashedEntries,
  trashItems,
  isRefreshingParseStatus,
  libraryView,
  recentReadingEntryIds,
  selectedEntryId,
  status,
  tags,
  themePreset,
  themePresets,
  uiScale,
  workspaceRoot,
  onCreateEntry,
  onCreateEntryFinished,
  onCreateMarkdownSourceLink,
  onImportMarkdownNoteSegmentAsset,
  onCreateTagPath,
  onDeleteEntry,
  onDeleteMarkdownNote,
  onDeleteTag,
  onOpenCreateEntryTab,
  onOpenEntryExplorer,
  onOpenEntryInSidePane,
  onOpenEntryNote,
  onOpenAnnotation,
  onCloseSidePane,
  onOpenSourceLink,
  onPurgeEntry,
  onEmptyEntryTrash,
  onPurgeTrashItem,
  parserEndpoint,
  parserApiKey,
  popoEnhancementEnabled,
  popoEnhancementEndpoint,
  readerPreferences,
  onParserEndpointChange,
  onParserApiKeyChange,
  onPopoEnhancementEnabledChange,
  onPopoEnhancementEndpointChange,
  onReaderPreferencesChange,
  onThemePresetChange,
  onUiScaleChange,
  onRenameTag,
  onRefreshParseStatus,
  onRetryPdfParse,
  onRefreshAnnotations,
  onBeforeWorkspaceChange,
  onCreateWorkspaceRoot,
  onResetWorkspaceRoot,
  onReadPdfReader,
  onReadMarkdownNote,
  onToggleSidePanePinned,
  onRestoreEntry,
  onRestoreTrashItem,
  onAddAssistantContext,
  onActiveSegmentChange,
  onApplyEntryTagPaths,
  onExportTranslationNote,
  onSaveSegmentNote,
  onDeleteSegmentNote,
  onSaveAnnotation,
  onDeleteAnnotation,
  onSaveMarkdownNote,
  onSelectEntry,
  onSelectTag,
  onSwitchWorkspaceRoot,
  onWorkspaceSplitLeftWidthChange,
  onWorkspaceSplitLeftWidthPreview,
  workspaceSplitLeftWidth
}: ReaderPaneProps) {
  const [pendingSourceLinkInsertion, setPendingSourceLinkInsertion] = useState<{
    entryId: string;
    noteId: string;
    link: SourceLink;
  } | null>(null);
  const [pendingNoteImageInsertion, setPendingNoteImageInsertion] = useState<{
    alt?: string | null;
    entryId: string;
    id: string;
    markdownPath: string;
    noteId: string;
  } | null>(null);
  const [linkedSegmentByEntryId, setLinkedSegmentByEntryId] = useState<
    Record<string, LinkedReaderSegment | null>
  >({});
  const [linkedPdfJumpByEntryId, setLinkedPdfJumpByEntryId] = useState<
    Record<string, PdfJumpRequest | null>
  >({});
  const [segmentNoteReloadByEntryId, setSegmentNoteReloadByEntryId] = useState<
    Record<string, number>
  >({});
  const [segmentNoteDraftsByEntryId, setSegmentNoteDraftsByEntryId] = useState<
    Record<string, Record<string, string>>
  >({});
  const linkedRequestKeyRef = useRef(0);
  const previousPdfJumpByEntryIdRef = useRef(pdfJumpByEntryId);
  const sourceBacklinksByEntryId = useSourceBacklinks(entries, markdownNoteRefreshById, onReadMarkdownNote);
  const [isWorkspaceSplitResizing, setIsWorkspaceSplitResizing] = useState(false);
  const [workspaceSplitPreviewLeft, setWorkspaceSplitPreviewLeft] = useState<number | null>(null);
  const workspaceSplitPreviewRef = useRef<HTMLDivElement | null>(null);
  const workspaceSplitResizeCleanupRef = useRef<(() => void) | null>(null);
  const heavyInactiveSinceRef = useRef(new Map<string, number>());
  const [expiredHeavySurfaceKeys, setExpiredHeavySurfaceKeys] = useState<Set<string>>(
    () => new Set()
  );

  const nextLinkedRequestKey = () => {
    linkedRequestKeyRef.current += 1;
    return linkedRequestKeyRef.current;
  };

  const focusLinkedSegment = (
    entryId: string,
    segmentUid: string,
    source: LinkedReaderSegment['source'],
    mode?: LinkedReaderSegment['mode']
  ) => {
    setLinkedSegmentByEntryId((current) => ({
      ...current,
      [entryId]: {
        mode: mode ?? current[entryId]?.mode ?? 'note',
        requestKey: nextLinkedRequestKey(),
        segmentUid,
        source
      }
    }));
  };

  const saveLinkedSegmentNote = async (entryId: string, segmentUid: string, text: string) => {
    const notes = await onSaveSegmentNote(entryId, segmentUid, text);
    setSegmentNoteReloadByEntryId((current) => ({
      ...current,
      [entryId]: (current[entryId] ?? 0) + 1
    }));
    return notes;
  };

  const deleteLinkedSegmentNote = async (entryId: string, segmentUid: string) => {
    const notes = await onDeleteSegmentNote(entryId, segmentUid);
    setSegmentNoteReloadByEntryId((current) => ({
      ...current,
      [entryId]: (current[entryId] ?? 0) + 1
    }));
    return notes;
  };

  const saveLinkedAnnotation: ReaderPaneProps['onSaveAnnotation'] = async (entryId, annotation) => {
    const annotations = await onSaveAnnotation(entryId, annotation);
    setSegmentNoteReloadByEntryId((current) => ({
      ...current,
      [entryId]: (current[entryId] ?? 0) + 1
    }));
    return annotations;
  };

  const deleteLinkedAnnotation: ReaderPaneProps['onDeleteAnnotation'] = async (entryId, annotationId) => {
    const annotations = await onDeleteAnnotation(entryId, annotationId);
    setSegmentNoteReloadByEntryId((current) => ({
      ...current,
      [entryId]: (current[entryId] ?? 0) + 1
    }));
    return annotations;
  };

  const updateLinkedSegmentNoteDraft = (
    entryId: string,
    segmentUid: string,
    text: string | null
  ) => {
    setSegmentNoteDraftsByEntryId((current) => {
      const entryDrafts = { ...(current[entryId] ?? {}) };
      if (text === null) {
        delete entryDrafts[segmentUid];
      } else {
        entryDrafts[segmentUid] = text;
      }
      return { ...current, [entryId]: entryDrafts };
    });
  };

  useEffect(() => {
    const previous = previousPdfJumpByEntryIdRef.current;
    const changedEntryIds = Object.keys(pdfJumpByEntryId).filter(
      (entryId) => previous[entryId] !== pdfJumpByEntryId[entryId]
    );
    previousPdfJumpByEntryIdRef.current = pdfJumpByEntryId;
    if (changedEntryIds.length === 0) {
      return;
    }
    setLinkedPdfJumpByEntryId((current) => {
      const next = { ...current };
      for (const entryId of changedEntryIds) {
        delete next[entryId];
      }
      return next;
    });
  }, [pdfJumpByEntryId]);

  useEffect(() => {
    const sweep = () => {
      const now = Date.now();
      const activeKeys = new Set([
        surfaceKey(surfaceLayout.left),
        surfaceLayout.right ? surfaceKey(surfaceLayout.right) : ''
      ]);
      const heavyKeys = new Set(
        [...surfaceLayout.leftTabs, ...surfaceLayout.rightTabs]
          .filter(isHeavyReaderSurface)
          .map(surfaceKey)
      );

      for (const key of Array.from(heavyInactiveSinceRef.current.keys())) {
        if (!heavyKeys.has(key) || activeKeys.has(key)) {
          heavyInactiveSinceRef.current.delete(key);
        }
      }
      for (const key of heavyKeys) {
        if (!activeKeys.has(key) && !heavyInactiveSinceRef.current.has(key)) {
          heavyInactiveSinceRef.current.set(key, now);
        }
      }

      setExpiredHeavySurfaceKeys((current) => {
        const next = new Set<string>();
        for (const [key, inactiveSince] of heavyInactiveSinceRef.current) {
          if (hasHeavyReaderIdleExpired(inactiveSince, now)) {
            next.add(key);
          }
        }
        return sameStringSet(current, next) ? current : next;
      });
    };

    sweep();
    const timer = window.setInterval(sweep, HEAVY_READER_SWEEP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [surfaceLayout]);

  useEffect(() => () => {
    workspaceSplitResizeCleanupRef.current?.();
    workspaceSplitResizeCleanupRef.current = null;
  }, []);

  const startWorkspaceSplitResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const container = event.currentTarget.parentElement;
    if (!container) {
      return;
    }

    event.preventDefault();
    workspaceSplitResizeCleanupRef.current?.();
    const divider = event.currentTarget;
    const bounds = container.getBoundingClientRect();
    const pointerId = event.pointerId;
    const getNextWidth = (clientX: number) =>
      clampWorkspaceSplitLeftWidth(clientX - bounds.left, bounds.width);
    let pendingWidth = getNextWidth(event.clientX);
    let animationFrame: number | null = null;
    let finished = false;

    divider.setPointerCapture(pointerId);
    setIsWorkspaceSplitResizing(true);
    setWorkspaceSplitPreviewLeft(pendingWidth);
    document.body.classList.add('is-workspace-split-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      pendingWidth = getNextWidth(pointerEvent.clientX);
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        workspaceSplitPreviewRef.current?.style.setProperty(
          'transform',
          `translate3d(${pendingWidth}px, 0, 0)`
        );
      });
    };
    const cleanupResize = () => {
      if (finished) return;
      finished = true;
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      document.body.classList.remove('is-workspace-split-resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleKeyDown);
      if (divider.hasPointerCapture(pointerId)) {
        divider.releasePointerCapture(pointerId);
      }
      workspaceSplitResizeCleanupRef.current = null;
    };
    const finishResize = (commit: boolean) => {
      if (finished) return;
      const finalWidth = commit ? pendingWidth : (workspaceSplitLeftWidth ?? Math.round(bounds.width / 2));
      cleanupResize();
      onWorkspaceSplitLeftWidthPreview(finalWidth);
      setIsWorkspaceSplitResizing(false);
      setWorkspaceSplitPreviewLeft(null);
      if (commit) onWorkspaceSplitLeftWidthChange(pendingWidth);
    };
    const handlePointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === pointerId) {
        finishResize(true);
      }
    };
    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === pointerId) finishResize(false);
    };
    const handleWindowBlur = () => finishResize(false);
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') finishResize(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('keydown', handleKeyDown);
    workspaceSplitResizeCleanupRef.current = cleanupResize;
  };
  const resizeWorkspaceSplitWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }

    const container = event.currentTarget.parentElement;
    if (!container) {
      return;
    }

    event.preventDefault();
    const bounds = container.getBoundingClientRect();
    const currentWidth = workspaceSplitLeftWidth ?? Math.round(bounds.width / 2);
    const nextWidth = event.key === 'Home'
      ? WORKSPACE_SPLIT_MIN_LEFT_WIDTH
      : event.key === 'End'
        ? bounds.width - WORKSPACE_SPLIT_MIN_RIGHT_WIDTH
        : currentWidth + (event.key === 'ArrowLeft' ? -24 : 24);
    const width = clampWorkspaceSplitLeftWidth(nextWidth, bounds.width);
    onWorkspaceSplitLeftWidthPreview(width);
    onWorkspaceSplitLeftWidthChange(width);
  };
  const renderLibraryView = (standalone = false) =>
    <EntryLibraryView
        activeTag={activeTag}
        entries={entries}
        standalone={standalone}
        trashedEntries={trashedEntries}
        trashItems={trashItems}
        isRefreshingParseStatus={isRefreshingParseStatus}
        libraryView={libraryView}
        recentReadingEntryIds={recentReadingEntryIds}
        selectedEntryId={selectedEntryId}
        status={status}
        tags={tags}
        onDeleteEntry={onDeleteEntry}
        onOpenCreateEntryTab={onOpenCreateEntryTab}
        onOpenEntryExplorer={onOpenEntryExplorer}
        onOpenEntryInSidePane={onOpenEntryInSidePane}
        onPurgeEntry={onPurgeEntry}
        onPurgeTrashItem={onPurgeTrashItem}
        onRefreshParseStatus={onRefreshParseStatus}
        onRestoreEntry={onRestoreEntry}
        onRestoreTrashItem={onRestoreTrashItem}
        onSelectEntry={onSelectEntry}
      />;
  const resolveMarkdownNoteTarget = (tabId: string | null): MarkdownNoteTarget | null => {
    if (!tabId) {
      return null;
    }

    const parsed = parseEntryContentTab(tabId);
    if (!parsed || !parsed.contentId.startsWith('note:')) {
      return null;
    }

    const noteId = parsed.contentId.slice('note:'.length);
    const noteEntry = entries.find((item) => item.id === parsed.entryId);
    const note =
      noteEntry?.contents.find((content) => content.kind === 'note' && content.note_id === noteId) ?? null;

    if (!noteEntry || !note || note.kind !== 'note') {
      return null;
    }

    return {
      entryId: noteEntry.id,
      entryTitle: noteEntry.title,
      noteId: note.note_id,
      noteTitle: note.title
    };
  };

  const consumePendingSourceLinkInsertion = (entryId: string, noteId: string, linkId: string) => {
    setPendingSourceLinkInsertion((current) => {
      if (!current) {
        return current;
      }
      if (current.entryId !== entryId || current.noteId !== noteId || current.link.link_id !== linkId) {
        return current;
      }
      return null;
    });
  };

  const consumePendingNoteImageInsertion = (entryId: string, noteId: string, imageId: string) => {
    setPendingNoteImageInsertion((current) => {
      if (!current) {
        return current;
      }
      if (current.entryId !== entryId || current.noteId !== noteId || current.id !== imageId) {
        return current;
      }
      return null;
    });
  };

  const renderEntryWorkspaceView = (
    tabId: string | null,
    siblingTabId: string | null = null,
    standalone = false,
    pane: WorkspacePaneId = 'left',
    focusedSegmentUid?: string,
    initialRecordMode: 'note' | 'annotation' = 'note'
  ) => {
    if (!tabId) {
      return standalone ? <EmptyPane /> : null;
    }

    const parsed = parseEntryContentTab(tabId);
    if (!parsed) {
      return standalone ? <EmptyPane /> : null;
    }

    const openEntry = entries.find((item) => item.id === parsed.entryId);
    if (!openEntry) {
      return standalone ? <EmptyPane /> : null;
    }

    const sidePaneEntry =
      sidePane.target?.kind === 'markdown-note'
        ? entries.find((item) => item.id === sidePane.target?.entryId) ?? null
        : null;
    const pairedMarkdownNoteTarget = resolveMarkdownNoteTarget(siblingTabId);
    const linkedSegment = linkedSegmentByEntryId[openEntry.id] ?? null;
    const siblingParsed = siblingTabId ? parseEntryContentTab(siblingTabId) : null;
    const pairedPdfPane = Boolean(
      siblingParsed?.entryId === openEntry.id && siblingParsed.contentId === 'pdf'
    );
    const linkedPdfJump = linkedPdfJumpByEntryId[parsed.entryId] ?? null;
    const externalPdfJump = pdfJumpByEntryId[parsed.entryId] ?? null;

    return (
      <EntryWorkspaceView
        activeContentId={parsed.contentId}
        entry={openEntry}
        standalone={standalone}
        workspaceRoot={workspaceRoot}
        tabValue={tabId}
        markdownNoteRefreshById={markdownNoteRefreshById}
        pdfJumpRequest={linkedPdfJump ?? externalPdfJump}
        pdfReaderReloadKey={pdfReaderReloadByEntryId[parsed.entryId] ?? 0}
        segmentRecordReloadKey={segmentNoteReloadByEntryId[parsed.entryId] ?? 0}
        pairedMarkdownNoteTarget={pairedMarkdownNoteTarget}
        focusedSegmentUid={focusedSegmentUid}
        initialRecordMode={initialRecordMode}
        linkedSegment={linkedSegment}
        segmentNotesLinkedToPdf={pairedPdfPane}
        sharedSegmentNoteDrafts={segmentNoteDraftsByEntryId[openEntry.id] ?? {}}
	        pendingSourceLinkInsertion={pendingSourceLinkInsertion}
	        pendingNoteImageInsertion={pendingNoteImageInsertion}
	        sourceBacklinksBySegmentUid={sourceBacklinksByEntryId[openEntry.id] ?? {}}
	        sidePane={sidePane}
        sidePaneEntry={sidePaneEntry}
        readerPreferences={readerPreferences}
        tags={tags}
        trashItems={trashItems.filter(
          (item) => item.entry_id === openEntry.id && item.kind !== 'entry' && !item.parent_entry_trashed
        )}
        onReaderPreferencesChange={onReaderPreferencesChange}
        onApplyEntryTagPaths={onApplyEntryTagPaths}
        onCreateMarkdownSourceLink={onCreateMarkdownSourceLink}
        onImportMarkdownNoteSegmentAsset={onImportMarkdownNoteSegmentAsset}
        onReadMarkdownNote={onReadMarkdownNote}
        onReadPdfReader={onReadPdfReader}
        onRetryPdfParse={onRetryPdfParse}
        onCloseSidePane={onCloseSidePane}
	        onOpenSourceLink={onOpenSourceLink}
	        onOpenSourceBacklink={(backlink) => onOpenEntryNote(backlink.noteEntryId, backlink.noteId)}
	        onOpenSegmentNotesSurface={(segmentUid, mode = 'note') => {
          focusLinkedSegment(
            openEntry.id,
            segmentUid,
            parsed.contentId === 'reflow' ? 'reflow' : 'pdf',
            mode
          );
          onOpenSurface(
            { kind: 'segment-notes', entryId: openEntry.id, mode, segmentUid },
            pane === 'left' ? 'right' : 'left'
          );
        }}
	        onOpenAnnotationsSurface={(segmentUid) => {
          focusLinkedSegment(openEntry.id, segmentUid, 'pdf', 'annotation');
          onOpenSurface(
            { kind: 'segment-notes', entryId: openEntry.id, mode: 'annotation', segmentUid },
            pane === 'left' ? 'right' : 'left'
          );
        }}
	        onShowAllSegmentNotes={() => onOpenSurface({ kind: 'segment-notes', entryId: openEntry.id }, pane)}
	        onAddAssistantContext={onAddAssistantContext}
        onActiveSegmentChange={(segment) => {
          onActiveSegmentChange?.(segment);
          if (segment) {
            focusLinkedSegment(segment.entryId, segment.segmentUid, 'pdf');
          }
        }}
        onFocusLinkedSegment={(segmentUid, mode) =>
          focusLinkedSegment(openEntry.id, segmentUid, 'segment-notes', mode)
        }
        onSharedSegmentNoteDraftChange={(segmentUid, text) =>
          updateLinkedSegmentNoteDraft(openEntry.id, segmentUid, text)
        }
        onLocateSegmentInPdf={(segmentUid, pageIdx) => {
          focusLinkedSegment(openEntry.id, segmentUid, 'segment-notes');
          setLinkedPdfJumpByEntryId((current) => ({
            ...current,
            [openEntry.id]: {
              kind: 'segment',
              pageIdx,
              requestKey: nextLinkedRequestKey(),
              segmentUid
            }
          }));
          if (!pairedPdfPane) {
            onOpenSurface(
              { kind: 'pdf', entryId: openEntry.id },
              pane === 'left' ? 'right' : 'left'
            );
          }
        }}
        onConsumePendingSourceLinkInsertion={consumePendingSourceLinkInsertion}
        onConsumePendingNoteImageInsertion={consumePendingNoteImageInsertion}
        onDeleteAnnotation={deleteLinkedAnnotation}
        onExportTranslationNote={onExportTranslationNote}
        onQueuePendingSourceLinkInsertion={(entryId, noteId, link) =>
          setPendingSourceLinkInsertion({ entryId, noteId, link })
        }
        onQueuePendingNoteImageInsertion={(entryId, noteId, image) =>
          setPendingNoteImageInsertion({ entryId, noteId, ...image })
        }
        onToggleSidePanePinned={onToggleSidePanePinned}
        onSaveMarkdownNote={onSaveMarkdownNote}
        onSaveAnnotation={saveLinkedAnnotation}
        onSaveSegmentNote={saveLinkedSegmentNote}
        onDeleteSegmentNote={deleteLinkedSegmentNote}
        onEmptyEntryTrash={onEmptyEntryTrash}
        onPurgeEntry={onPurgeEntry}
        onPurgeTrashItem={onPurgeTrashItem}
        onRestoreEntry={onRestoreEntry}
        onRestoreTrashItem={onRestoreTrashItem}
      />
    );
  };
  const renderCreateEntryPanel = () => (
    <CreateEntryPanel
      parserEndpoint={parserEndpoint}
      tags={tags}
      onCreateEntry={onCreateEntry}
      onCreateEntryFinished={onCreateEntryFinished}
    />
  );
  const renderTagEditorPage = () => (
    <TagEditorPage
      activeTag={activeTag}
      entries={entries}
      tags={tags}
      onCreateTagPath={onCreateTagPath}
      onDeleteTag={onDeleteTag}
      onRenameTag={onRenameTag}
      onSelectTag={onSelectTag}
    />
  );
  const renderSettingsPanel = () => (
    <SettingsPanel
      parserEndpoint={parserEndpoint}
      parserApiKey={parserApiKey}
      popoEnhancementEnabled={popoEnhancementEnabled}
      popoEnhancementEndpoint={popoEnhancementEndpoint}
      readerPreferences={readerPreferences}
      themePreset={themePreset}
      themePresets={themePresets}
      uiScale={uiScale}
      onParserEndpointChange={onParserEndpointChange}
      onParserApiKeyChange={onParserApiKeyChange}
      onPopoEnhancementEnabledChange={onPopoEnhancementEnabledChange}
      onPopoEnhancementEndpointChange={onPopoEnhancementEndpointChange}
      onReaderPreferencesChange={onReaderPreferencesChange}
      workspaceRoot={workspaceRoot}
      onBeforeWorkspaceChange={onBeforeWorkspaceChange}
      onCreateWorkspaceRoot={onCreateWorkspaceRoot}
      onResetWorkspaceRoot={onResetWorkspaceRoot}
      onThemePresetChange={onThemePresetChange}
      onUiScaleChange={onUiScaleChange}
      onSwitchWorkspaceRoot={onSwitchWorkspaceRoot}
    />
  );
  const renderSurface = (surface: WorkspaceSurface, sibling: WorkspaceSurface | null, pane: WorkspacePaneId) => {
    if (surface.kind === 'source-links') {
      const backlinks = Object.values(sourceBacklinksByEntryId[surface.entryId] ?? {}).flat();
      const entry = entries.find((item) => item.id === surface.entryId);
      return (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <EntryContentHeader contentTitle="来源链接" entryTitle={entry?.title ?? '条目'} />
          <ReaderSurfaceBody>
            {backlinks.length === 0 ? (
              <ReaderEmptyState
                description="在 PDF 或重排视图中复制或插入来源后，会显示在这里。"
                icon={Link2}
                title="暂无来源链接"
              />
            ) : (
              <div className="grid gap-2">
                {backlinks.map((backlink) => (
                  <button
                    className={readerSelectableItemClass}
                    key={`${backlink.linkId}:${backlink.segmentUid}`}
                    type="button"
                    onClick={() =>
                      onOpenSurface(
                        { kind: 'note', entryId: backlink.noteEntryId, noteId: backlink.noteId },
                        pane === 'left' ? 'right' : 'left'
                      )
                    }
                  >
                    <div className="truncate text-sm font-medium text-foreground">
                      {backlink.noteTitle}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {backlink.noteEntryTitle} · 原文片段 {backlink.segmentUid}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ReaderSurfaceBody>
        </div>
      );
    }
    const contentId = surface.kind === 'annotations' ? 'segment-notes' : entryContentId(surface);
    if (contentId && 'entryId' in surface) {
      const siblingContentId = sibling ? entryContentId(sibling) : null;
      const siblingTabId = sibling && siblingContentId && 'entryId' in sibling
        ? `entry-content:${sibling.entryId}|${siblingContentId}`
        : null;
      return renderEntryWorkspaceView(
        `entry-content:${surface.entryId}|${contentId}`,
        siblingTabId,
        true,
        pane,
        'segmentUid' in surface ? surface.segmentUid : undefined,
        surface.kind === 'annotations'
          ? 'annotation'
          : surface.kind === 'segment-notes'
            ? surface.mode ?? 'note'
            : 'note'
      );
    }
    switch (surface.kind) {
      case 'library':
        return renderLibraryView(true);
      case 'settings':
        return <div className="h-full min-h-0 overflow-hidden">{renderSettingsPanel()}</div>;
      case 'create-entry':
        return <div className="h-full min-h-0 overflow-y-auto">{renderCreateEntryPanel()}</div>;
      case 'tag-editor':
        return <TagEditorPage standalone activeTag={activeTag} entries={entries} tags={tags} onCreateTagPath={onCreateTagPath} onDeleteTag={onDeleteTag} onRenameTag={onRenameTag} onSelectTag={onSelectTag} />;
      default:
        return <EmptyPane />;
    }
  };
  const renderPaneSurfaces = (
    tabs: WorkspaceSurface[],
    active: WorkspaceSurface,
    sibling: WorkspaceSurface | null,
    pane: WorkspacePaneId
  ) => tabs.map((surface) => {
    const key = surfaceKey(surface);
    const activeSurface = key === surfaceKey(active);
    const shouldMount =
      activeSurface || !isHeavyReaderSurface(surface) || !expiredHeavySurfaceKeys.has(key);
    return (
      <div
        className={activeSurface ? 'workspace-pane-surface is-active' : 'workspace-pane-surface'}
        key={key}
      >
        {shouldMount ? renderSurface(surface, sibling, pane) : null}
      </div>
    );
  });
  return (
    <section className="app-editor">
        <div className="m-0 h-full min-h-0 min-w-0">
          <div
            className={
              surfaceLayout.right
                ? `workspace-split is-split${isWorkspaceSplitResizing ? ' is-resizing' : ''}`
                : 'workspace-split'
            }
          >
            <div
              className="workspace-pane"
              data-workspace-drop-pane="left"
              data-workspace-tab-count={surfaceLayout.leftTabs.length}
              onPointerDown={() => onFocusSurface('left')}
            >
              {renderPaneSurfaces(surfaceLayout.leftTabs, surfaceLayout.left, surfaceLayout.right, 'left')}
            </div>
            {surfaceLayout.right ? (
              <>
                <div
                  aria-label="调整分屏宽度"
                  className="workspace-pane-divider is-resizable"
                  role="separator"
                  tabIndex={0}
                  aria-orientation="vertical"
                  aria-valuemin={WORKSPACE_SPLIT_MIN_LEFT_WIDTH}
                  aria-valuenow={workspaceSplitLeftWidth ?? undefined}
                  onKeyDown={resizeWorkspaceSplitWithKeyboard}
                  onPointerDown={startWorkspaceSplitResize}
                />
                {workspaceSplitPreviewLeft !== null ? (
                  <div
                    aria-hidden="true"
                    className="workspace-split-resize-preview"
                    ref={workspaceSplitPreviewRef}
                    style={{ transform: `translate3d(${workspaceSplitPreviewLeft}px, 0, 0)` }}
                  />
                ) : null}
                <div
                  className="workspace-pane"
                  data-workspace-drop-pane="right"
                  data-workspace-tab-count={surfaceLayout.rightTabs.length}
                  onPointerDown={() => onFocusSurface('right')}
                >
                  {renderPaneSurfaces(surfaceLayout.rightTabs, surfaceLayout.right, surfaceLayout.left, 'right')}
                </div>
              </>
            ) : null}
          </div>
        </div>
    </section>
  );
}

function sameStringSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function EmptyPane() {
  return (
    <div className="grid h-full min-h-0 place-items-center rounded-md border border-dashed bg-muted/25 text-sm text-muted-foreground">
      选择一个标签页
    </div>
  );
}

function parseEntryContentTab(tabId: string) {
  const prefix = 'entry-content:';
  if (!tabId.startsWith(prefix)) {
    return null;
  }

  const raw = tabId.slice(prefix.length);
  const separatorIndex = raw.indexOf('|');
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) {
    return null;
  }

  return {
    contentId: raw.slice(separatorIndex + 1),
    entryId: raw.slice(0, separatorIndex)
  };
}
