import { MessageSquare, PanelRight, Search, Settings } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  entryContentSurface,
  entryContentId,
  initialWorkspaceSurfaceLayout,
  surfaceKey,
  workspaceSurfaceReducer,
  type WorkspacePaneId,
  type WorkspaceSurface
} from './workspaceSurface';
import {
  resolveActiveActivityPanel,
  type SidePanel
} from './activityBarState';
import { WorkspaceTabsBar } from './WorkspaceTabsBar';
import {
  clampWorkspaceSplitLeftWidth,
  WORKSPACE_SPLIT_DIVIDER_WIDTH,
  WORKSPACE_SPLIT_MIN_LEFT_WIDTH,
  WORKSPACE_SPLIT_MIN_RIGHT_WIDTH
} from './workspaceSplit';
import { AssistantPanel } from '../modules/assistant/components/AssistantPanel';
import type { AssistantComposerDraft } from '../modules/assistant/components/AssistantComposerEditor';
import type { SourceLinkOpenTarget } from '../modules/notes/editor/SourceLinkNode';
import {
  hasAnyUnsavedMarkdownNotes,
  hasUnsavedMarkdownNote,
  saveAllMarkdownNotesBeforeWorkspaceChange,
  saveMarkdownNoteBeforeClose
} from '../modules/notes/editor/noteDirtyRegistry';
import { LibrarySidebar, type LibraryEntry, type LibraryView } from '../modules/library/components/LibrarySidebar';
import { buildTagPathById } from '../modules/library/utils/tagTree';
import { ReaderPane } from '../modules/reader/components/ReaderPane';
import {
  discardSegmentEditorsBeforeClose,
  hasUnsavedSegmentEditors,
  saveSegmentEditorsBeforeClose
} from '../modules/reader/components/segmentEditorDirtyRegistry';
import type { PdfJumpRequest, SidePaneState, SidePaneTarget } from '../modules/reader/types';
import { SearchDialog } from '../modules/search/components/SearchDialog';
import { SearchPanel } from '../modules/search/components/SearchPanel';
import { useSearchIndexBuildStatus } from '../modules/search/hooks/useSearchIndexBuildStatus';
import { useSearchIndexStatus } from '../modules/search/hooks/useSearchIndexStatus';
import { JobStatusDock } from '../shared/components/JobStatusDock';
import { TitleBar } from '../shared/components/TitleBar';
import { useToast } from '../shared/hooks/useToast';
import { useWorkspace } from '../shared/hooks/useWorkspace';
import { useWorkspaceJobs } from '../shared/hooks/useWorkspaceJobs';
import {
  APP_THEME_STORAGE_KEY,
  APP_THEME_PRESETS,
  readStoredThemePreset,
  type AppThemePresetId
} from '../shared/lib/themePresets';
import {
  adjacentUiScale,
  applyUiScale,
  persistUiScale,
  readStoredUiScale,
  type UiScale
} from '../shared/lib/uiScale';
import {
  persistReaderPreferences,
  readStoredReaderPreferences,
  type ReaderPreferences
} from '../shared/lib/readerPreferences';
import {
  CLOUD_PARSER_ENDPOINT,
  getEffectiveParserEndpoint
} from '../shared/lib/parserSettings';
import {
  applyNoteProposal,
  type Conversation,
  type ConversationSourceLink
} from '../shared/ipc/assistantApi';
import type {
  AssistantActiveNote,
  AssistantActiveSegment,
  AssistantContext,
  AssistantContextAddOptions,
  AssistantContextInput,
  AssistantNoteProposal,
  AssistantEntryMetaProposal,
  AssistantTagProposal
} from '../shared/types/assistant';
import type {
  AnnotationCatalogRecord,
  SearchHit
} from '../shared/ipc/workspaceApi';

type PendingNoteTabClose = {
  pane: WorkspacePaneId;
  surface: Extract<WorkspaceSurface, { kind: 'note' }>;
};

type PendingSegmentTabClose = {
  pane: WorkspacePaneId;
  surface: WorkspaceSurface;
};

import {
  ACTIVE_PARSE_STATUSES,
  ActivityButton,
  DEFAULT_MINERU_ENDPOINT,
  DEFAULT_POPO_ENHANCEMENT_ENDPOINT,
  EMPTY_SIDE_PANE,
  LEGACY_MINERU_ENDPOINTS,
  LIBRARY_VIEW_STORAGE_KEY,
  PARSER_API_KEY_STORAGE_KEY,
  PARSER_ENDPOINT_STORAGE_KEY,
  PARSE_POLL_INTERVAL_MS,
  POPO_ENHANCEMENT_ENABLED_STORAGE_KEY,
  POPO_ENHANCEMENT_ENDPOINT_STORAGE_KEY,
  RECENT_READING_STORAGE_KEY,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_OPEN_STORAGE_KEY,
  SIDEBAR_WIDTH_STORAGE_KEY,
  SIDE_PANEL_STORAGE_KEY,
  WORKSPACE_SPLIT_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  conversationToMarkdown,
  firstContentId,
  formatVectorStatus,
  getDefaultWorkspaceSplitLeftWidth,
  noteIdFromContentId,
  readStoredBoolean,
  readStoredLibraryView,
  readStoredRecentReading,
  readStoredSidePanel,
  readStoredSidebarWidth,
  readStoredWorkspaceSplitLeftWidth,
  toLibraryEntry
} from './appSupport';

export function App() {
  const workspace = useWorkspace();
  const { dismiss, notify } = useToast();
  const [mineruEndpoint, setMineruEndpoint] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_MINERU_ENDPOINT;
    }
    const saved = window.localStorage.getItem(PARSER_ENDPOINT_STORAGE_KEY)?.trim();
    if (!saved || LEGACY_MINERU_ENDPOINTS.has(saved)) {
      return DEFAULT_MINERU_ENDPOINT;
    }
    return saved;
  });
  const [parserApiKey, setParserApiKey] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return window.localStorage.getItem(PARSER_API_KEY_STORAGE_KEY) ?? '';
  });
  const [popoEnhancementEnabled, setPopoEnhancementEnabled] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(POPO_ENHANCEMENT_ENABLED_STORAGE_KEY) === '1';
  });
  const [popoEnhancementEndpoint, setPopoEnhancementEndpoint] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_POPO_ENHANCEMENT_ENDPOINT;
    }
    return window.localStorage.getItem(POPO_ENHANCEMENT_ENDPOINT_STORAGE_KEY)
      ?? DEFAULT_POPO_ENHANCEMENT_ENDPOINT;
  });
  const [surfaceLayout, dispatchSurface] = useReducer(
    workspaceSurfaceReducer,
    initialWorkspaceSurfaceLayout
  );
  const [workspaceSplitLeftWidth, setWorkspaceSplitLeftWidth] = useState<number | null>(
    readStoredWorkspaceSplitLeftWidth
  );
  const appShellRef = useRef<HTMLElement | null>(null);
  const workspaceSplitPreviewWidthRef = useRef<number | null>(workspaceSplitLeftWidth);
  const [activeContentByEntryId, setActiveContentByEntryId] = useState<Record<string, string | null>>({});
  const [sidePane, setSidePane] = useState<SidePaneState>(EMPTY_SIDE_PANE);
  const [markdownNoteRefreshById, setMarkdownNoteRefreshById] = useState<Record<string, number>>({});
  const [pdfJumpByEntryId, setPdfJumpByEntryId] = useState<Record<string, PdfJumpRequest | null>>({});
  const [pdfReaderReloadByEntryId, setPdfReaderReloadByEntryId] = useState<Record<string, number>>({});
  const [libraryView, setLibraryView] = useState<LibraryView>(readStoredLibraryView);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [assistantContext, setAssistantContext] = useState<AssistantContext>({ items: [] });
  const [assistantComposerDraft, setAssistantComposerDraft] =
    useState<AssistantComposerDraft | null>(null);
  const [activeAssistantSegment, setActiveAssistantSegment] =
    useState<AssistantActiveSegment | null>(null);
  const [assistantDraftQuestion, setAssistantDraftQuestion] = useState<string | null>(null);
  const [sidePanel, setSidePanel] = useState<SidePanel>(readStoredSidePanel);
  const [sidebarOpen, setSidebarOpen] = useState(() => readStoredBoolean(SIDEBAR_OPEN_STORAGE_KEY, true));
  const [recentReadingEntryIds, setRecentReadingEntryIds] = useState<string[]>(readStoredRecentReading);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [sidebarResizePreviewWidth, setSidebarResizePreviewWidth] = useState<number | null>(null);
  const [themePreset, setThemePreset] = useState<AppThemePresetId>(readStoredThemePreset);
  const [uiScale, setUiScale] = useState<UiScale>(readStoredUiScale);
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(
    readStoredReaderPreferences
  );
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [pendingNoteTabClose, setPendingNoteTabClose] = useState<PendingNoteTabClose | null>(null);
  const [pendingSegmentTabClose, setPendingSegmentTabClose] = useState<PendingSegmentTabClose | null>(null);
  const [savingNoteBeforeClose, setSavingNoteBeforeClose] = useState(false);
  const [savingSegmentBeforeClose, setSavingSegmentBeforeClose] = useState(false);
  const parseRefreshDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parserErrorToastRef = useRef<{ message: string; id: string } | null>(null);
  const pendingMarkdownDeleteRef = useRef(new Set<string>());
  const pdfJumpCounter = useRef(0);
  const tagPathById = useMemo(() => buildTagPathById(workspace.tags), [workspace.tags]);
  const entries = useMemo(
    () => workspace.entries.map((entry) => toLibraryEntry(entry, tagPathById)),
    [tagPathById, workspace.entries]
  );
  const hasActiveParseTasks = useMemo(
    () =>
      workspace.entries.some((entry) => {
        const parse = entry.pdf?.parse;
        return Boolean(parse?.task_id && ACTIVE_PARSE_STATUSES.has(parse.status));
      }),
    [workspace.entries]
  );
  const { searchIndexBuildStatus: vectorBuildStatus } = useSearchIndexBuildStatus({
    enabled: workspace.status === 'ready',
    root: workspace.root
  });
  const vectorStatusRefreshKey = [
    workspace.entries.length,
    workspace.isParsingPdf,
    workspace.isRefreshingParseStatus,
    vectorBuildStatus?.updated_at_ms ?? 0
  ].join(':');
  const { searchIndexError: vectorIndexError, searchIndexStatus: vectorIndexStatus } =
    useSearchIndexStatus({
      enabled: workspace.status === 'ready',
      refreshKey: vectorStatusRefreshKey,
      root: workspace.root
    });
  const vectorStatusText = useMemo(
    () => formatVectorStatus(vectorIndexStatus, vectorIndexError, vectorBuildStatus),
    [vectorBuildStatus, vectorIndexError, vectorIndexStatus]
  );
  const { activeJobs, jobs: recentJobs } = useWorkspaceJobs(workspace.root);
  const prepareWorkspaceChange = useCallback(async () => {
    if (activeJobs.length > 0) {
      throw new Error('当前仍有解析、索引或翻译任务运行。请等待任务完成后再切换工作区。');
    }
    if (hasAnyUnsavedMarkdownNotes()) {
      const saved = await saveAllMarkdownNotesBeforeWorkspaceChange();
      if (!saved) {
        throw new Error('有笔记未能保存，已取消切换工作区。');
      }
    }
  }, [activeJobs.length]);
  const resetWorkspaceUi = useCallback(() => {
    dispatchSurface({ type: 'reset' });
    setActiveContentByEntryId({});
    setSidePane(EMPTY_SIDE_PANE);
    setMarkdownNoteRefreshById({});
    setPdfJumpByEntryId({});
    setPdfReaderReloadByEntryId({});
    setActiveTag(null);
    setAssistantContext({ items: [] });
    setAssistantComposerDraft(null);
    setActiveAssistantSegment(null);
    setAssistantDraftQuestion(null);
    setSearchDialogOpen(false);
    setRecentReadingEntryIds([]);
    window.localStorage.removeItem(RECENT_READING_STORAGE_KEY);
  }, []);
  const switchWorkspace = useCallback(async (root: string) => {
    await workspace.switchWorkspaceRoot(root);
    resetWorkspaceUi();
  }, [resetWorkspaceUi, workspace.switchWorkspaceRoot]);
  const createWorkspace = useCallback(async (root: string) => {
    await workspace.createWorkspaceRoot(root);
    resetWorkspaceUi();
  }, [resetWorkspaceUi, workspace.createWorkspaceRoot]);
  const openDefaultWorkspace = useCallback(async () => {
    await workspace.resetWorkspaceToDefault();
    resetWorkspaceUi();
  }, [resetWorkspaceUi, workspace.resetWorkspaceToDefault]);
  const shellStyle = useMemo(
    () =>
      ({
        '--app-sidebar-width': sidebarWidth + 'px',
        ...((workspaceSplitPreviewWidthRef.current ?? workspaceSplitLeftWidth) !== null
          ? { '--app-workspace-left-width': (workspaceSplitPreviewWidthRef.current ?? workspaceSplitLeftWidth) + 'px' }
          : {})
      }) as CSSProperties,
    [sidebarWidth, workspaceSplitLeftWidth]
  );

  const previewWorkspaceSplitLeft = useCallback((width: number) => {
    workspaceSplitPreviewWidthRef.current = width;
    appShellRef.current?.style.setProperty('--app-workspace-left-width', `${width}px`);
  }, []);

  useEffect(() => {
    const split = document.querySelector('.workspace-split');
    if (!(split instanceof HTMLElement)) {
      return undefined;
    }

    const clampStoredWidth = () => {
      const containerWidth = split.getBoundingClientRect().width;
      if (containerWidth <= 0) {
        return;
      }
      setWorkspaceSplitLeftWidth((current) => {
        if (current === null) {
          return current;
        }
        const nextWidth = clampWorkspaceSplitLeftWidth(current, containerWidth);
        workspaceSplitPreviewWidthRef.current = nextWidth;
        return nextWidth;
      });
    };

    clampStoredWidth();
    const observer = new ResizeObserver(clampStoredWidth);
    observer.observe(split);
    return () => observer.disconnect();
  }, [surfaceLayout.right]);

  const startSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      let nextWidth = startWidth;

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        nextWidth = clampSidebarWidth(startWidth + pointerEvent.clientX - startX);
        setSidebarResizePreviewWidth(nextWidth);
      };
      const handlePointerUp = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setSidebarResizePreviewWidth(null);
        setSidebarWidth(nextWidth);
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
      };

      setSidebarResizePreviewWidth(startWidth);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp, { once: true });
      window.addEventListener('pointercancel', handlePointerUp, { once: true });
    },
    [sidebarWidth]
  );
  const resizeSidebarWithKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    setSidebarWidth((current) => {
      const next = clampSidebarWidth(current + (event.key === 'ArrowRight' ? 16 : -16));
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
      return next;
    });
  }, []);
  const trashedEntries = useMemo(
    () => workspace.trashedEntries.map((entry) => toLibraryEntry(entry, tagPathById)),
    [tagPathById, workspace.trashedEntries]
  );
  const selectedEntry = useMemo(
    () => (workspace.selectedEntry ? toLibraryEntry(workspace.selectedEntry, tagPathById) : null),
    [tagPathById, workspace.selectedEntry]
  );
  const focusedSurface = surfaceLayout.focusedPane === 'right' && surfaceLayout.right
    ? surfaceLayout.right
    : surfaceLayout.left;
  const activeActivityPanel = resolveActiveActivityPanel({
    focusedSurfaceKind: focusedSurface.kind,
    sidebarOpen,
    sidePanel
  });
  const activeEntryId = 'entryId' in focusedSurface ? focusedSurface.entryId : null;
  const activeEntry = useMemo(
    () => (activeEntryId ? entries.find((entry) => entry.id === activeEntryId) ?? null : null),
    [activeEntryId, entries]
  );
  const activeContentId = entryContentId(focusedSurface);
  const activeAssistantNote = useMemo<AssistantActiveNote | null>(() => {
    const sidePaneNoteTarget = sidePane.target?.kind === 'markdown-note' ? sidePane.target : null;
    const noteEntry = sidePaneNoteTarget
      ? entries.find((entry) => entry.id === sidePaneNoteTarget.entryId) ?? null
      : activeEntry;
    if (!noteEntry) {
      return null;
    }

    const noteId =
      sidePaneNoteTarget?.noteId ??
      (noteEntry.id === activeEntry?.id ? noteIdFromContentId(activeContentId) : null);
    const note = noteId
      ? noteEntry.contents.find(
          (content) => content.kind === 'note' && content.note_id === noteId
        )
      : null;

    if (!note) {
      return null;
    }

    return {
      entryId: noteEntry.id,
      entryTitle: noteEntry.title,
      noteId: note.note_id,
      noteTitle: note.title
    };
  }, [activeContentId, activeEntry, entries, sidePane.target]);
  const activeAssistantSegmentForPanel = useMemo(() => {
    const panelEntry = activeEntry ?? selectedEntry;
    if (!panelEntry || activeAssistantSegment?.entryId !== panelEntry.id) {
      return null;
    }
    return activeAssistantSegment;
  }, [activeAssistantSegment, activeEntry, selectedEntry]);
  const openContentTabs = [];


  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(
      PARSER_ENDPOINT_STORAGE_KEY,
      getEffectiveParserEndpoint(mineruEndpoint)
    );
  }, [mineruEndpoint]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (parserApiKey.trim()) {
      window.localStorage.setItem(PARSER_API_KEY_STORAGE_KEY, parserApiKey);
    } else {
      window.localStorage.removeItem(PARSER_API_KEY_STORAGE_KEY);
    }
  }, [parserApiKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (popoEnhancementEnabled) {
      window.localStorage.setItem(POPO_ENHANCEMENT_ENABLED_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(POPO_ENHANCEMENT_ENABLED_STORAGE_KEY);
    }
  }, [popoEnhancementEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const trimmed = popoEnhancementEndpoint.trim();
    if (trimmed) {
      window.localStorage.setItem(POPO_ENHANCEMENT_ENDPOINT_STORAGE_KEY, trimmed);
    } else {
      window.localStorage.removeItem(POPO_ENHANCEMENT_ENDPOINT_STORAGE_KEY);
    }
  }, [popoEnhancementEndpoint]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.dataset.theme = themePreset;
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, themePreset);
  }, [themePreset]);

  useEffect(() => {
    persistUiScale(uiScale);
    void applyUiScale(uiScale).catch((caught) => {
      console.error('Failed to apply UI scale', caught);
    });
  }, [uiScale]);

  useEffect(() => {
    const handleUiScaleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key === '0') {
        event.preventDefault();
        setUiScale(1);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        setUiScale((current) => adjacentUiScale(current, -1));
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setUiScale((current) => adjacentUiScale(current, 1));
      }
    };
    window.addEventListener('keydown', handleUiScaleShortcut);
    return () => window.removeEventListener('keydown', handleUiScaleShortcut);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, sidebarOpen ? '1' : '0');
    window.localStorage.setItem(SIDE_PANEL_STORAGE_KEY, sidePanel);
  }, [sidebarOpen, sidePanel]);

  useEffect(() => {
    window.localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, libraryView);
  }, [libraryView]);

  useEffect(() => {
    const viewedEntryIds = [surfaceLayout.left, surfaceLayout.right]
      .flatMap((surface) => surface && 'entryId' in surface ? [surface.entryId] : []);
    if (viewedEntryIds.length === 0) return;
    setRecentReadingEntryIds((current) => {
      const next = [...viewedEntryIds.reverse(), ...current.filter((id) => !viewedEntryIds.includes(id))].slice(0, 20);
      window.localStorage.setItem(RECENT_READING_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [surfaceLayout.left, surfaceLayout.right]);

  const updateReaderPreferences = useCallback((nextPreferences: ReaderPreferences) => {
    setReaderPreferences(nextPreferences);
  }, []);

  useEffect(() => {
    persistReaderPreferences(readerPreferences);
  }, [readerPreferences]);

  useEffect(() => {
    const message = workspace.error?.trim() ?? '';
    const isParserError =
      message.toLowerCase().includes('parser') ||
      message.toLowerCase().includes('parse') ||
      message.toLowerCase().includes('解析');
    const currentToast = parserErrorToastRef.current;

    if (!message || !isParserError) {
      if (currentToast) {
        dismiss(currentToast.id);
        parserErrorToastRef.current = null;
      }
      return;
    }

    if (currentToast?.message === message) {
      return;
    }

    if (currentToast) {
      dismiss(currentToast.id);
    }

    const id = notify({
      durationMs: Infinity,
      tone: 'danger',
      title: '解析请求失败',
      description: message
    });
    parserErrorToastRef.current = { id, message };
  }, [dismiss, notify, workspace.error]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        event.preventDefault();
        return;
      }

      if (target.closest('[data-allow-context-menu="true"]')) {
        return;
      }

      event.preventDefault();
    };

    document.addEventListener('contextmenu', handleContextMenu, true);
    return () => document.removeEventListener('contextmenu', handleContextMenu, true);
  }, []);

  const openCreateEntryTab = () => {
    dispatchSurface({ type: 'open', surface: { kind: 'create-entry' } });
  };

  const openSettingsTab = () => {
    dispatchSurface({ type: 'open', surface: { kind: 'settings' } });
  };

  const toggleSidePanel = (panel: SidePanel) => {
    if (sidebarOpen && sidePanel === panel) {
      setSidebarOpen(false);
      return;
    }

    setSidePanel(panel);
    setSidebarOpen(true);
  };

  const openTagEditorTab = () => {
    dispatchSurface({ type: 'open', surface: { kind: 'tag-editor' } });
  };

  const openEntryContentTab = (
    entryId: string,
    contentId: string,
    pane?: WorkspacePaneId
  ) => {
    dispatchSurface({
      type: 'open',
      pane,
      surface: entryContentSurface(entryId, contentId)
    });
    if (workspace.selectedEntryId !== entryId) {
      workspace.setSelectedEntryId(entryId);
    }
    if (pane === 'right' && !surfaceLayout.right && workspaceSplitLeftWidth === null) {
      setWorkspaceSplitLeftWidth(getDefaultWorkspaceSplitLeftWidth());
    }
    setActiveContentByEntryId((current) =>
      current[entryId] === contentId ? current : { ...current, [entryId]: contentId }
    );
    if (contentId !== 'pdf') {
      setActiveAssistantSegment((current) =>
        current?.entryId === entryId ? null : current
      );
    }
  };

  const openEntryTab = (entryId: string) => {
    const target = entries.find((entry) => entry.id === entryId) ?? null;
    const contentId = target
      ? activeContentByEntryId[entryId] ?? firstContentId(target)
      : null;
    if (!contentId) {
      workspace.setSelectedEntryId(entryId);
      return;
    }

    openEntryContentTab(entryId, contentId);
  };

  const openEntryTabToRight = (entryId: string) => {
    const target = entries.find((entry) => entry.id === entryId) ?? null;
    const contentId = target
      ? activeContentByEntryId[entryId] ?? firstContentId(target)
      : null;
    if (!contentId) {
      workspace.setSelectedEntryId(entryId);
      return;
    }

    openEntryContentTab(entryId, contentId, 'right');
  };

  const openEntryContentTabToRight = (entryId: string, contentId: string) => {
    openEntryContentTab(entryId, contentId, 'right');
  };

  const clearEntryUiState = (entryId: string) => {
    setActiveContentByEntryId((current) => {
      const next = { ...current };
      delete next[entryId];
      return next;
    });
    setSidePane((current) =>
      current.target?.kind === 'markdown-note' && current.target.entryId === entryId
        ? { ...current, target: null }
        : current
    );
    setPdfJumpByEntryId((current) => {
      const next = { ...current };
      delete next[entryId];
      return next;
    });
    setMarkdownNoteRefreshById((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (key.startsWith(entryId + ':')) {
          delete next[key];
        }
      }
      return next;
    });
  };

  const resizeWorkspaceSplitLeft = (width: number) => {
    workspaceSplitPreviewWidthRef.current = width;
    setWorkspaceSplitLeftWidth(width);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(WORKSPACE_SPLIT_WIDTH_STORAGE_KEY, String(width));
    }
  };

  const selectEntryContent = (contentId: string) => {
    if (!activeEntryId) {
      return;
    }

    openEntryContentTab(activeEntryId, contentId);
  };

  const openSidePaneMarkdownNote = (target: SidePaneTarget) => {
    setSidePane((current) => ({
      ...current,
      requestKey: current.requestKey + 1,
      target
    }));
  };

  const closeSidePane = () => {
    setSidePane((current) => ({
      ...current,
      target: null
    }));
  };

  const toggleSidePanePinned = () => {
    setSidePane((current) => ({
      ...current,
      pinned: !current.pinned
    }));
  };

  const openMarkdownInPdfPane = (entryId: string, noteId: string) => {
    const target = entries.find((entry) => entry.id === entryId);
    if (!target?.pdfFileName) {
      return;
    }
    openEntryContentTab(entryId, 'pdf', 'left');
    openEntryContentTabToRight(entryId, 'note:' + noteId);
  };

  const createMarkdownNote = async () => {
    const targetEntryId = activeEntryId ?? workspace.selectedEntryId;
    if (!targetEntryId) {
      return;
    }
    const updated = await workspace.createMarkdownNote(targetEntryId, 'Untitled note');
    if (!updated) {
      return;
    }
    const note = updated.contents[updated.contents.length - 1];
    if (note?.kind === 'note') {
      openEntryContentTab(updated.id, 'note:' + note.note_id);
    }
  };

  const deleteMarkdownNoteNow = async (entryId: string, noteId: string) => {
    pendingMarkdownDeleteRef.current.delete(entryId + ':' + noteId);
    const updated = await workspace.deleteMarkdownNote(entryId, noteId);
    if (!updated) {
      return;
    }

    const deletedContentId = 'note:' + noteId;
    const nextNote = updated.contents.find((content) => content.kind === 'note') ?? null;
    const nextContentId = updated.pdf
      ? 'pdf'
      : nextNote
        ? 'note:' + nextNote.note_id
        : null;

    setActiveContentByEntryId((current) => {
      if (current[entryId] !== deletedContentId) {
        return current;
      }
      return { ...current, [entryId]: nextContentId };
    });
    if (nextContentId) {
      const nextSurface = entryContentSurface(entryId, nextContentId);
      if ('entryId' in surfaceLayout.left && surfaceLayout.left.entryId === entryId && entryContentId(surfaceLayout.left) === deletedContentId) {
        dispatchSurface({ type: 'open', pane: 'left', surface: nextSurface });
      }
      if (surfaceLayout.right && 'entryId' in surfaceLayout.right && surfaceLayout.right.entryId === entryId && entryContentId(surfaceLayout.right) === deletedContentId) {
        dispatchSurface({ type: 'open', pane: 'right', surface: nextSurface });
      }
    }
    setSidePane((current) =>
      current.target?.kind === 'markdown-note' &&
      current.target.entryId === entryId &&
      current.target.noteId === noteId
        ? { ...current, target: null }
        : current
    );
    notify({
      tone: 'success',
      title: '笔记已移到回收站',
      description: nextContentId === 'pdf' ? '已切回 PDF，可从条目回收站恢复。' : '可从条目回收站恢复。'
    });
  };

  const deleteMarkdownNote = (entryId: string, noteId: string) => {
    const key = entryId + ':' + noteId;
    if (pendingMarkdownDeleteRef.current.has(key)) {
      return;
    }

    const targetEntry = entries.find((entry) => entry.id === entryId) ?? null;
    const note = targetEntry?.contents.find(
      (content) => content.kind === 'note' && content.note_id === noteId
    );
    pendingMarkdownDeleteRef.current.add(key);
    let toastId = '';
    toastId = notify({
      action: (
        <button
          className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
          type="button"
          onClick={() => {
            pendingMarkdownDeleteRef.current.delete(key);
            dismiss(toastId);
          }}
        >
          撤销
        </button>
      ),
      description: note
        ? '倒计时结束后将《' + note.title + '》移到回收站。'
        : '倒计时结束后将这篇笔记移到回收站。',
      durationMs: 5200,
      onExpire: () => {
        if (!pendingMarkdownDeleteRef.current.has(key)) {
          return;
        }
        void deleteMarkdownNoteNow(entryId, noteId);
      },
      showProgress: true,
      title: '笔记即将移到回收站'
    });
  };

  const reloadPdfReaders = useCallback(
    (entryIds: string[]) => {
      if (entryIds.length === 0) {
        return;
      }
      setPdfReaderReloadByEntryId((current) => {
        const next = { ...current };
        for (const entryId of entryIds) {
          next[entryId] = (next[entryId] ?? 0) + 1;
        }
        return next;
      });
    },
    []
  );

  const refreshParseStatus = useCallback(
    async (force = false) => {
      const result = await workspace.refreshParsingEntries(mineruEndpoint, {
        apiKey: parserApiKey,
        force
      });
      if (result) {
        reloadPdfReaders(result.completedEntryIds);
      }
    },
    [mineruEndpoint, parserApiKey, reloadPdfReaders, workspace.refreshParsingEntries]
  );

  const selectLibraryView = (view: LibraryView) => {
    setLibraryView(view);
    dispatchSurface({ type: 'open', surface: { kind: 'library' } });
    if (parseRefreshDebounce.current) {
      clearTimeout(parseRefreshDebounce.current);
    }
    if (view === 'parsing') {
      parseRefreshDebounce.current = setTimeout(() => {
        void refreshParseStatus(false);
      }, 300);
    }
  };

  const deleteEntry = async (entryId: string) => {
    await workspace.deleteWorkspaceEntry(entryId);
    clearEntryUiState(entryId);
    dispatchSurface({ type: 'removeEntry', entryId });
  };

  const restoreEntry = async (entryId: string) => {
    await workspace.restoreWorkspaceEntry(entryId);
    setActiveTag(null);
    setLibraryView('all');
    dispatchSurface({ type: 'open', surface: { kind: 'library' } });
  };

  const purgeEntry = async (entryId: string) => {
    await workspace.purgeWorkspaceEntry(entryId);
  };

  const openSearchResult = (hit: SearchHit) => {
    const entryId = hit.target.entry_id;
    const targetEntry = entries.find((entry) => entry.id === entryId) ?? null;
    if (!targetEntry) {
      return;
    }

    const nextContentId =
      hit.target.kind === 'segment' || hit.target.kind === 'page'
        ? 'pdf'
        : hit.target.kind === 'note'
          ? 'note:' + hit.target.note_id
          : activeContentByEntryId[entryId] ?? firstContentId(targetEntry);
    if (!nextContentId) {
      return;
    }

    const target = hit.target;
    if (target.kind === 'segment') {
      pdfJumpCounter.current += 1;
      setPdfJumpByEntryId((current) => ({
        ...current,
        [entryId]: {
          kind: 'segment',
          segmentUid: target.segment_uid,
          pageIdx: target.page_idx,
          requestKey: pdfJumpCounter.current
        }
      }));
    } else if (target.kind === 'page') {
      pdfJumpCounter.current += 1;
      setPdfJumpByEntryId((current) => ({
        ...current,
        [entryId]: {
          kind: 'page',
          pageIdx: target.page_idx,
          requestKey: pdfJumpCounter.current
        }
      }));
    } else {
      setPdfJumpByEntryId((current) => ({ ...current, [entryId]: null }));
    }

    openEntryContentTab(entryId, nextContentId);
  };

  const openAssistantSource = (source: ConversationSourceLink) => {
    openPdfSegment(source.entry_id, source.segment_uid, source.page_idx);
  };

  const openMarkdownSourceLink = (target: SourceLinkOpenTarget) => {
    if (!target.sourceEntryId || !target.segmentUid) {
      return;
    }

    const pageIdx =
      typeof target.page === 'number' && Number.isFinite(target.page)
        ? Math.max(0, target.page - 1)
        : 0;
    openPdfSegment(target.sourceEntryId, target.segmentUid, pageIdx);
  };

  const openPdfSegment = (entryId: string, segmentUid: string, pageIdx: number) => {
    const targetEntry = entries.find((entry) => entry.id === entryId) ?? null;
    if (!targetEntry) {
      return;
    }

    pdfJumpCounter.current += 1;
    setPdfJumpByEntryId((current) => ({
      ...current,
      [entryId]: {
        kind: 'segment',
        segmentUid,
        pageIdx,
        requestKey: pdfJumpCounter.current
      }
    }));
    openEntryContentTab(entryId, 'pdf');
  };

  const openAnnotationRecord = (record: AnnotationCatalogRecord) => {
    const targetEntry = entries.find((entry) => entry.id === record.entry_id) ?? null;
    if (!targetEntry) {
      return;
    }
    const segment = record.segment;

    if (segment && record.segment_status === 'current') {
      pdfJumpCounter.current += 1;
      setPdfJumpByEntryId((current) => ({
        ...current,
        [record.entry_id]: {
          kind: 'annotation',
          annotationId: record.annotation.annotation_id,
          segmentUid: record.annotation.segment_uid,
          pageIdx: segment.page_idx,
          requestKey: pdfJumpCounter.current
        }
      }));
    }
    openEntryContentTab(record.entry_id, 'pdf');
  };

  const reloadPdfReader = (entryId: string) => {
    reloadPdfReaders([entryId]);
  };

  const refreshMarkdownNote = (entryId: string, noteId: string) => {
    setMarkdownNoteRefreshById((current) => ({
      ...current,
      [entryId + ':' + noteId]: (current[entryId + ':' + noteId] ?? 0) + 1
    }));
  };

  const saveMarkdownNote = async (
    entryId: string,
    noteId: string,
    title: string,
    markdown: string
  ) => {
    const saved = await workspace.saveMarkdownNote(entryId, noteId, title, markdown);
    refreshMarkdownNote(entryId, noteId);
    return saved;
  };

  const renameMarkdownNote = async (
    entryId: string,
    noteId: string,
    title: string
  ) => {
    const note = await workspace.readMarkdownNote(entryId, noteId);
    return saveMarkdownNote(entryId, noteId, title, note.markdown);
  };

  const addAssistantContext = (
    item: AssistantContextInput,
    options: AssistantContextAddOptions = {}
  ) => {
    const itemId =
      item.id ??
      (item.kind === 'segment'
        ? item.kind + ':' + item.entryId + ':' + item.segmentUid
        : item.kind + ':' + item.entryId + (item.contentKind && item.contentKind !== 'entry' ? ':' + item.contentKind + ':' + (item.contentId ?? item.contentKind) : ''));
    setAssistantContext((current) => {
      const exists = current.items.some((contextItem) => contextItem.id === itemId);
      if (exists) {
        return current;
      }

      return {
        items: [
          ...current.items.filter(
            (contextItem) =>
              !(
                item.kind === 'entry' &&
                item.contentKind &&
                item.contentKind !== 'entry' &&
                contextItem.kind === 'entry' &&
                contextItem.entryId === item.entryId &&
                !contextItem.contentKind
              )
          ),
          {
            ...item,
            id: itemId,
            addedAt: new Date().toISOString()
          }
        ]
      };
    });
    if (options.draftQuestion) {
      setAssistantDraftQuestion(options.draftQuestion);
    }
    setSidePanel('assistant');
    setSidebarOpen(true);
  };

  const replaceAssistantContext = (items: AssistantContextInput[]) => {
    setAssistantContext({
      items: items.map((item) => {
        const itemId =
          item.id ??
          (item.kind === 'segment'
            ? item.kind + ':' + item.entryId + ':' + item.segmentUid
            : item.kind + ':' + item.entryId + (
                item.contentKind && item.contentKind !== 'entry'
                  ? ':' + item.contentKind + ':' + (item.contentId ?? item.contentKind)
                  : ''
              ));
        return {
          ...item,
          id: itemId,
          addedAt: new Date().toISOString()
        };
      })
    });
    setSidePanel('assistant');
    setSidebarOpen(true);
  };

  const applyAssistantNoteProposal = async (proposal: AssistantNoteProposal) => {
    if (!workspace.root || !proposal.taskId || !proposal.verifiedAt || !proposal.proposalDigest) {
      throw new Error('This note proposal is not a persisted Verified Proposal.');
    }
    const result = await applyNoteProposal(workspace.root, proposal.taskId, proposal.id);
    if (result.kind === 'conflict') {
      throw new Error(
        'The target note changed after this proposal was generated. Generate a new Diff before applying.'
      );
    }
    await workspace.refreshEntries(workspace.root);
    if (result.receipt.segmentUid) {
      reloadPdfReader(result.receipt.entryId);
      openPdfSegment(
        result.receipt.entryId,
        result.receipt.segmentUid,
        proposal.pageIdx ?? 0
      );
      return proposal;
    }
    if (!result.receipt.noteId) {
      throw new Error('Apply completed without an exact noteId.');
    }
    refreshMarkdownNote(result.receipt.entryId, result.receipt.noteId);
    openEntryNote(result.receipt.entryId, result.receipt.noteId);
    return {
      ...proposal,
      noteId: result.receipt.noteId,
      noteTitle: proposal.title
    };
  };

  const applyAssistantTagProposal = async (proposal: AssistantTagProposal) => {
    await workspace.applyWorkspaceTagProposal(proposal);
  };

  const applyAssistantEntryMetaProposal = async (
    proposal: AssistantEntryMetaProposal
  ) => {
    await workspace.applyWorkspaceEntryMetaProposal(proposal);
  };

  const exportAssistantConversation = async (conversation: Conversation) => {
    const targetEntryId =
      activeEntry?.id ??
      selectedEntry?.id ??
      conversation.scope_snapshot.entry_ids[0] ??
      workspace.selectedEntryId;
    if (!targetEntryId) {
      throw new Error('Open an Entry before exporting this conversation.');
    }

    const targetEntry = entries.find((entry) => entry.id === targetEntryId) ?? null;
    if (!targetEntry) {
      throw new Error('The export target Entry is not available.');
    }

    const existingNoteIds = new Set(
      targetEntry.contents
        .filter((content) => content.kind === 'note')
        .map((content) => content.note_id)
    );
    const title = 'AI Conversation - ' + conversation.title;
    const updated = await workspace.createMarkdownNote(targetEntryId, title);
    if (!updated) {
      throw new Error('Unable to create export note.');
    }

    const createdNote = updated.contents.find(
      (content) => content.kind === 'note' && !existingNoteIds.has(content.note_id)
    );
    if (!createdNote) {
      throw new Error('Created export note could not be located.');
    }

    await saveMarkdownNote(
      targetEntryId,
      createdNote.note_id,
      title,
      conversationToMarkdown(conversation)
    );
    openEntryNote(targetEntryId, createdNote.note_id);
  };

  const exportEntryTranslation = async (entryId: string, title: string, markdown: string) => {
    const targetEntry = entries.find((entry) => entry.id === entryId) ?? null;
    if (!targetEntry) {
      throw new Error('The export target Entry is not available.');
    }

    const existingNoteIds = new Set(
      targetEntry.contents
        .filter((content) => content.kind === 'note')
        .map((content) => content.note_id)
    );
    const updated = await workspace.createMarkdownNote(entryId, title);
    if (!updated) {
      throw new Error('Unable to create export note.');
    }

    const createdNote = updated.contents.find(
      (content) => content.kind === 'note' && !existingNoteIds.has(content.note_id)
    );
    if (!createdNote) {
      throw new Error('Created export note could not be located.');
    }

    await saveMarkdownNote(entryId, createdNote.note_id, title, markdown);
    openEntryNote(entryId, createdNote.note_id);
  };

  const openEntryNote = (entryId: string, noteId: string) => {
    openEntryContentTab(entryId, 'note:' + noteId);
  };

  const removeAssistantContextItem = (itemId: string) => {
    setAssistantContext((current) => ({
      items: current.items.filter((item) => item.id !== itemId)
    }));
  };

  useEffect(() => {
    return () => {
      if (parseRefreshDebounce.current) {
        clearTimeout(parseRefreshDebounce.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasActiveParseTasks) {
      return undefined;
    }

    void refreshParseStatus(false);
    const interval = window.setInterval(() => {
      void refreshParseStatus(false);
    }, PARSE_POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [hasActiveParseTasks, refreshParseStatus]);

  const closeSurfaceTab = (pane: WorkspacePaneId, surface: WorkspaceSurface) => {
    dispatchSurface({ type: 'close', pane, key: surfaceKey(surface) });
  };

  const requestCloseSurfaceTab = (pane: WorkspacePaneId, surface: WorkspaceSurface) => {
    if (surface.kind === 'note' && hasUnsavedMarkdownNote(surface.entryId, surface.noteId)) {
      setPendingNoteTabClose({ pane, surface });
      return;
    }
    if (hasUnsavedSegmentEditors(surfaceKey(surface))) {
      setPendingSegmentTabClose({ pane, surface });
      return;
    }
    closeSurfaceTab(pane, surface);
  };

  const discardAndClosePendingNoteTab = () => {
    if (!pendingNoteTabClose) {
      return;
    }
    closeSurfaceTab(pendingNoteTabClose.pane, pendingNoteTabClose.surface);
    setPendingNoteTabClose(null);
  };

  const saveAndClosePendingNoteTab = async () => {
    if (!pendingNoteTabClose || savingNoteBeforeClose) {
      return;
    }
    setSavingNoteBeforeClose(true);
    try {
      const { pane, surface } = pendingNoteTabClose;
      const saved = await saveMarkdownNoteBeforeClose(surface.entryId, surface.noteId);
      if (!saved) {
        notify({
          tone: 'danger',
          title: '保存失败',
          description: '笔记未保存，标签页仍保持打开。'
        });
        return;
      }
      closeSurfaceTab(pane, surface);
      setPendingNoteTabClose(null);
    } finally {
      setSavingNoteBeforeClose(false);
    }
  };

  const discardAndClosePendingSegmentTab = () => {
    if (!pendingSegmentTabClose) return;
    const { pane, surface } = pendingSegmentTabClose;
    discardSegmentEditorsBeforeClose(surfaceKey(surface));
    closeSurfaceTab(pane, surface);
    setPendingSegmentTabClose(null);
  };

  const saveAndClosePendingSegmentTab = async () => {
    if (!pendingSegmentTabClose || savingSegmentBeforeClose) return;
    setSavingSegmentBeforeClose(true);
    try {
      const { pane, surface } = pendingSegmentTabClose;
      if (!(await saveSegmentEditorsBeforeClose(surfaceKey(surface)))) {
        notify({
          tone: 'danger',
          title: '保存失败',
          description: '片段笔记或批注未保存，标签页仍保持打开。'
        });
        return;
      }
      closeSurfaceTab(pane, surface);
      setPendingSegmentTabClose(null);
    } finally {
      setSavingSegmentBeforeClose(false);
    }
  };

  return (
    <div className="app gap-0">
      <TitleBar onOpenSearch={() => setSearchDialogOpen(true)} />
      <SearchDialog
        open={searchDialogOpen}
        root={workspace.root}
        status={workspace.status}
        onOpenChange={setSearchDialogOpen}
        onOpenResult={openSearchResult}
      />
      <Dialog
        open={Boolean(pendingNoteTabClose)}
        onOpenChange={(open) => {
          if (!open && !savingNoteBeforeClose) {
            setPendingNoteTabClose(null);
          }
        }}
      >
        <DialogContent showCloseButton={!savingNoteBeforeClose}>
          <DialogHeader>
            <DialogTitle>保存笔记后再关闭？</DialogTitle>
            <DialogDescription>
              “{pendingNoteTabClose?.surface.kind === 'note'
                ? entries.find((entry) => entry.id === pendingNoteTabClose.surface.entryId)?.contents.find(
                    (content) => content.kind === 'note' && content.note_id === pendingNoteTabClose.surface.noteId
                  )?.title ?? '当前笔记'
                : '当前笔记'}”有未保存的修改。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-wrap">
            <Button
              disabled={savingNoteBeforeClose}
              type="button"
              variant="outline"
              onClick={() => setPendingNoteTabClose(null)}
            >
              取消
            </Button>
            <Button
              disabled={savingNoteBeforeClose}
              type="button"
              variant="destructive"
              onClick={discardAndClosePendingNoteTab}
            >
              不保存并关闭
            </Button>
            <Button disabled={savingNoteBeforeClose} type="button" onClick={() => void saveAndClosePendingNoteTab()}>
              {savingNoteBeforeClose ? '保存中…' : '保存并关闭'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(pendingSegmentTabClose)}
        onOpenChange={(open) => {
          if (!open && !savingSegmentBeforeClose) setPendingSegmentTabClose(null);
        }}
      >
        <DialogContent showCloseButton={!savingSegmentBeforeClose}>
          <DialogHeader>
            <DialogTitle>保存修改后再关闭？</DialogTitle>
            <DialogDescription>
              当前标签页内的片段笔记或批注包含未保存修改。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-wrap">
            <Button
              disabled={savingSegmentBeforeClose}
              type="button"
              variant="outline"
              onClick={() => setPendingSegmentTabClose(null)}
            >
              继续编辑
            </Button>
            <Button
              disabled={savingSegmentBeforeClose}
              type="button"
              variant="destructive"
              onClick={discardAndClosePendingSegmentTab}
            >
              不保存并关闭
            </Button>
            <Button
              disabled={savingSegmentBeforeClose}
              type="button"
              onClick={() => void saveAndClosePendingSegmentTab()}
            >
              {savingSegmentBeforeClose ? '保存中…' : '保存并关闭'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <main
        ref={appShellRef}
        className={'app-shell ' + (sidebarResizePreviewWidth !== null ? 'is-sidebar-resizing' : '') + ' ' + (sidebarOpen ? '' : 'is-sidebar-collapsed')}
        style={shellStyle}
      >
        <WorkspaceTabsBar
          entries={entries}
          layout={surfaceLayout}
          onClose={requestCloseSurfaceTab}
          onMove={(surface, pane, targetIndex) => {
            if (pane === 'right' && !surfaceLayout.right && workspaceSplitLeftWidth === null) {
              setWorkspaceSplitLeftWidth(getDefaultWorkspaceSplitLeftWidth());
            }
            dispatchSurface({ type: 'move', key: surfaceKey(surface), pane, targetIndex });
          }}
          onSwap={() => dispatchSurface({ type: 'swap' })}
          onSelect={(pane, surface) => dispatchSurface({ type: 'open', pane, surface })}
        />
        <nav className="activitybar" aria-label="主导航">
          <ActivityButton
            active={activeActivityPanel === 'library'}
            label="条目库"
            onClick={() => toggleSidePanel('library')}
            onContextMenu={() => dispatchSurface({ type: 'open', pane: 'right', surface: { kind: 'library' } })}
          >
            <PanelRight size={18} aria-hidden="true" />
          </ActivityButton>
          <ActivityButton
            active={activeActivityPanel === 'search'}
            label="搜索"
            onClick={() => toggleSidePanel('search')}
          >
            <Search size={18} aria-hidden="true" />
          </ActivityButton>
          <ActivityButton
            active={activeActivityPanel === 'assistant'}
            label="助手"
            onClick={() => toggleSidePanel('assistant')}
          >
            <MessageSquare size={18} aria-hidden="true" />
          </ActivityButton>
          <div className="spacer" />
          <ActivityButton
            active={focusedSurface.kind === 'settings'}
            label="设置"
            onClick={openSettingsTab}
            onContextMenu={() => dispatchSurface({ type: 'open', pane: 'right', surface: { kind: 'settings' } })}
          >
            <Settings size={18} aria-hidden="true" />
          </ActivityButton>
        </nav>
        {sidebarOpen && sidePanel === 'library' ? (
          <LibrarySidebar
            activeTag={activeTag}
            activeView={libraryView}
            activeContentId={activeContentId}
            entries={entries}
            trashItemCount={workspace.trashItems.length}
            error={workspace.error}
            entryExplorerOpen={Boolean(activeEntry)}
            recentReadingEntryIds={recentReadingEntryIds}
            selectedEntry={activeEntry}
            status={workspace.status}
            tags={workspace.tags}
            onBackToLibraryExplorer={() => {
              dispatchSurface({ type: 'open', surface: { kind: 'library' } });
            }}
            onCreateMarkdownNote={createMarkdownNote}
            onDeleteMarkdownNote={deleteMarkdownNote}
            onOpenMarkdownInPdfPane={(noteId) => {
              if (activeEntryId) {
                openMarkdownInPdfPane(activeEntryId, noteId);
              }
            }}
            onOpenContentInRight={(contentId) => {
              if (activeEntryId) openEntryContentTabToRight(activeEntryId, contentId);
            }}
            onRenameMarkdownNote={renameMarkdownNote}
            onRenamePdfDisplayName={workspace.renameWorkspacePdfDisplayName}
            onOpenCreateEntryTab={openCreateEntryTab}
            onOpenTagEditorTab={openTagEditorTab}
            onSelectContent={selectEntryContent}
            onSelectTag={setActiveTag}
            onSelectView={selectLibraryView}
            onUpdateEntry={workspace.updateWorkspaceEntry}
          />
        ) : sidebarOpen && sidePanel === 'search' ? (
          <SearchPanel
            buildStatus={vectorBuildStatus}
            root={workspace.root}
            status={workspace.status}
            onOpenResult={openSearchResult}
          />
        ) : sidebarOpen && sidePanel === 'assistant' ? (
          <AssistantPanel
            activeEntry={activeEntry ?? selectedEntry}
            activeNote={activeAssistantNote}
            activeSegment={activeAssistantSegmentForPanel}
            activeTag={activeTag}
            assistantContext={assistantContext}
            composerDraft={assistantComposerDraft}
            draftQuestion={assistantDraftQuestion}
            entries={entries}
            root={workspace.root}
            status={workspace.status}
            tags={workspace.tags}
            onApplyNoteProposal={applyAssistantNoteProposal}
            onApplyEntryMetaProposal={applyAssistantEntryMetaProposal}
            onApplyTagProposal={applyAssistantTagProposal}
            onAddAssistantContext={addAssistantContext}
            onClearAssistantContext={() => setAssistantContext({ items: [] })}
            onComposerDraftChange={setAssistantComposerDraft}
            onCreateAssistantEntry={async (title) => {
              const created = await workspace.createWorkspaceEntry(title);
              if (!created) {
                throw new Error('新建条目失败，请检查工作区状态后重试。');
              }
              return toLibraryEntry(created, tagPathById);
            }}
            onDraftQuestionConsumed={() => setAssistantDraftQuestion(null)}
            onExportConversation={exportAssistantConversation}
            onOpenSettings={openSettingsTab}
            onOpenSource={openAssistantSource}
            onReplaceAssistantContext={replaceAssistantContext}
            onRemoveAssistantContextItem={removeAssistantContextItem}
          />
        ) : null}
        {sidebarOpen ? (
        <div
          aria-label="璋冩暣渚ф爮瀹藉害"
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuenow={sidebarWidth}
          className="app-sidebar-resizer"
          role="separator"
          tabIndex={0}
          title="鎷栧姩璋冩暣渚ф爮瀹藉害"
          onKeyDown={resizeSidebarWithKeyboard}
          onPointerDown={startSidebarResize}
        />
        ) : null}
        {sidebarOpen && sidebarResizePreviewWidth !== null ? (
          <div
            aria-hidden="true"
            className="app-sidebar-resize-preview"
            style={{
              left: 'calc(var(--app-activity-width) + ' + sidebarResizePreviewWidth + 'px)'
            }}
          />
        ) : null}
        <ReaderPane
          surfaceLayout={surfaceLayout}
          onOpenSurface={(surface: WorkspaceSurface, pane?: WorkspacePaneId) =>
            dispatchSurface({ type: 'open', pane, surface })
          }
          onFocusSurface={(pane) => dispatchSurface({ type: 'focus', pane })}
          activeTag={activeTag}
          annotationRecords={workspace.annotationRecords}
          markdownNoteRefreshById={markdownNoteRefreshById}
          pdfJumpByEntryId={pdfJumpByEntryId}
          pdfReaderReloadByEntryId={pdfReaderReloadByEntryId}
          sidePane={sidePane}
          entries={entries}
          trashedEntries={trashedEntries}
          trashItems={workspace.trashItems}
          isRefreshingParseStatus={workspace.isRefreshingParseStatus}
          libraryView={libraryView}
          recentReadingEntryIds={recentReadingEntryIds}
          tags={workspace.tags}
          themePreset={themePreset}
          themePresets={APP_THEME_PRESETS}
          uiScale={uiScale}
          workspaceRoot={workspace.root}
          onCreateEntry={(request) =>
            workspace.createLibraryEntry(request, mineruEndpoint, parserApiKey)
          }
          onCreateEntryFinished={(result) => {
            if (result.parseSubmissionFailed) {
              dispatchSurface({ type: 'open', surface: { kind: 'create-entry' } });
              return;
            }

            // A successful creation is complete in the library. Close the creation tab
            // regardless of which pane it occupies, then return to the entry list.
            dispatchSurface({ type: 'close', pane: 'left', key: 'create-entry' });
            dispatchSurface({ type: 'close', pane: 'right', key: 'create-entry' });
            dispatchSurface({ type: 'open', pane: 'left', surface: { kind: 'library' } });
            setLibraryView(result.createdWithPdf ? 'parsing' : 'all');
            setActiveTag(null);
          }}
          onCreateMarkdownSourceLink={workspace.createMarkdownSourceLink}
          onImportMarkdownNoteSegmentAsset={workspace.importMarkdownNoteSegmentAsset}
          onCreateTagPath={workspace.createTagPath}
          onDeleteEntry={deleteEntry}
          onDeleteMarkdownNote={deleteMarkdownNote}
          onDeleteTag={async (tagId) => {
            await workspace.deleteWorkspaceTag(tagId);
            setActiveTag(null);
          }}
          onOpenCreateEntryTab={openCreateEntryTab}
          onOpenEntryExplorer={openEntryTab}
          onOpenEntryInSidePane={openEntryTabToRight}
          onOpenEntryNote={openEntryNote}
          onOpenAnnotation={openAnnotationRecord}
          onOpenSourceLink={openMarkdownSourceLink}
          onCloseSidePane={closeSidePane}
          onPurgeEntry={purgeEntry}
          onEmptyEntryTrash={workspace.emptyWorkspaceEntryTrash}
          onPurgeTrashItem={workspace.purgeWorkspaceTrashItem}
          onRenameTag={workspace.renameWorkspaceTag}
          onRefreshParseStatus={() => refreshParseStatus(true)}
          onRetryPdfParse={(entryId) =>
            workspace.retryPdfParseForEntry(entryId, mineruEndpoint, parserApiKey)
          }
          onRefreshAnnotations={workspace.refreshAnnotationCatalog}
          onBeforeWorkspaceChange={prepareWorkspaceChange}
          onCreateWorkspaceRoot={createWorkspace}
          onResetWorkspaceRoot={openDefaultWorkspace}
          parserEndpoint={mineruEndpoint}
          parserApiKey={parserApiKey}
          readerPreferences={readerPreferences}
          onParserEndpointChange={setMineruEndpoint}
          onParserApiKeyChange={setParserApiKey}
          popoEnhancementEnabled={popoEnhancementEnabled}
          popoEnhancementEndpoint={popoEnhancementEndpoint}
          onPopoEnhancementEnabledChange={setPopoEnhancementEnabled}
          onPopoEnhancementEndpointChange={setPopoEnhancementEndpoint}
          onReaderPreferencesChange={updateReaderPreferences}
          onThemePresetChange={setThemePreset}
          onUiScaleChange={setUiScale}
          onReadPdfReader={workspace.readEntryPdfReader}
          onReadMarkdownNote={workspace.readMarkdownNote}
          onToggleSidePanePinned={toggleSidePanePinned}
          onRestoreEntry={restoreEntry}
          onRestoreTrashItem={workspace.restoreWorkspaceTrashItem}
          onAddAssistantContext={addAssistantContext}
          onActiveSegmentChange={setActiveAssistantSegment}
          onApplyEntryTagPaths={workspace.applyEntryTagPaths}
          onExportTranslationNote={exportEntryTranslation}
          onSaveAnnotation={workspace.saveAnnotation}
          onDeleteAnnotation={workspace.removeAnnotation}
          onSaveSegmentNote={async (entryId, segmentUid, text) => {
            return workspace.saveSegmentNote(entryId, segmentUid, text);
          }}
          onDeleteSegmentNote={(entryId, segmentUid) =>
            workspace.removeSegmentNote(entryId, segmentUid)
          }
          onSaveMarkdownNote={saveMarkdownNote}
          onSelectEntry={workspace.setSelectedEntryId}
          onSelectTag={setActiveTag}
          onSwitchWorkspaceRoot={switchWorkspace}
          onWorkspaceSplitLeftWidthChange={resizeWorkspaceSplitLeft}
          onWorkspaceSplitLeftWidthPreview={previewWorkspaceSplitLeft}
          workspaceSplitLeftWidth={workspaceSplitLeftWidth}
          selectedEntryId={workspace.selectedEntryId}
          status={workspace.status}
        />
      </main>
      <footer className="statusbar">
        <button type="button">侧栏</button>
        <span>严格来源：已开启</span>
        <span>解析器：{workspace.isParsingPdf ? '运行中' : '就绪'}</span>
        <span title={mineruEndpoint}>Parser: {mineruEndpoint}</span>
        <span>{vectorStatusText}</span>
        <span>{entries.length} 个条目</span>
        <span>{selectedEntry?.title ?? '未选择条目'}</span>
        <JobStatusDock activeCount={activeJobs.length} jobs={recentJobs} />
        <button type="button">辅助栏</button>
      </footer>
    </div>
  );
}
