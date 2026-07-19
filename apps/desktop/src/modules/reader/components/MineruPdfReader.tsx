import { Loader2 } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { saveNoteAssetBytes, type PdfReaderResponse } from "@/shared/ipc/workspaceApi";
import { useToast } from "@/shared/hooks/useToast";
import type { ReaderPreferences } from "@/shared/lib/readerPreferences";
import type {
  Annotation,
  AnnotationId,
  AnnotationImportance,
  AnnotationTextSelection,
  NoteDocument,
  SegmentBlockNote,
  SourceLink,
  SourceSegment,
} from "@/shared/types/domain";
import type {
  AssistantContextAddOptions,
  AssistantActiveSegment,
  AssistantContextInput,
} from "@/shared/types/assistant";
import type { SourceLinkOpenTarget } from "../../notes/editor/SourceLinkNode";

import type { LibraryEntry } from "../../library/components/LibrarySidebar";
import { SegmentAnnotationEditor } from "../../annotations/components/SegmentAnnotationEditor";
import type {
  MarkdownNoteTarget,
  PdfJumpRequest,
  SidePaneState,
  SourceBacklink,
  SourceBacklinksBySegmentUid,
} from "../types";
import { GlobalMarkdownNotePane } from "./pdf-reader/GlobalMarkdownNotePane";
import { FloatingSegmentPanel } from "./pdf-reader/FloatingSegmentPanel";
import { PdfReaderDocumentPane } from "./pdf-reader/PdfReaderDocumentPane";
import { ReaderMessage } from "./pdf-reader/ReaderMessage";
import { PdfParseFailureMessage } from "./pdf-reader/PdfParseFailureMessage";
import {
  findSegmentByLogicalOrRealUid,
  formatPdfParseStatus,
} from "./pdf-reader/pdfReaderSupport";
import { ReaderToolbar } from "./pdf-reader/ReaderToolbar";
import { SegmentNoteEditor } from "./pdf-reader/SegmentNoteEditor";
import { SegmentRail } from "./pdf-reader/SegmentRail";
import { SegmentRailLayout } from "./pdf-reader/SegmentRailLayout";
import {
  PDF_RAIL_WIDTH,
  PDF_ZOOM_STEP,
} from "./pdf-reader/readerConstants";
import {
  groupSegmentsByPage,
  hasNoteText,
  inferPageCount,
  logicalSegmentUid,
  scrollToPage,
  scrollToSegment,
} from "./pdf-reader/readerUtils";
import { usePdfBytes } from "./pdf-reader/usePdfBytes";
import { usePdfDocument } from "./pdf-reader/usePdfDocument";
import { usePdfReaderData } from "./pdf-reader/usePdfReaderData";
import { usePdfReaderZoom } from "./pdf-reader/usePdfReaderZoom";
import { usePdfAnnotationActions } from "./pdf-reader/usePdfAnnotationActions";
import { usePdfSegmentNavigation } from "./pdf-reader/usePdfSegmentNavigation";
import { usePdfSourceLinkActions } from "./pdf-reader/usePdfSourceLinkActions";
import { usePdfTranslationController } from "./pdf-reader/usePdfTranslationController";
import { usePdfViewportMetrics } from "./pdf-reader/usePdfViewportMetrics";
import { useEntryTagSuggestions } from "./pdf-reader/useEntryTagSuggestions";
import {
  NOTE_PANE_MAX_WIDTH,
  NOTE_PANE_MIN_WIDTH,
  useResizableNotePane,
} from "./pdf-reader/useResizableNotePane";
import { useSegmentNoteDraft } from "./pdf-reader/useSegmentNoteDraft";
import { useGuardedSegmentAction } from "./useGuardedSegmentAction";
import {
  discardSegmentEditorsBeforeClose,
  hasUnsavedSegmentEditors,
  saveSegmentEditorsBeforeClose,
} from "./segmentEditorDirtyRegistry";
import { translateTextSelection } from "../translation/entryTranslation";
import { TranslationTaskDialog } from "../translation/TranslationTaskDialog";
import { UnsavedSegmentChangesDialog } from "./pdf-reader/UnsavedSegmentChangesDialog";

type MineruPdfReaderProps = {
  entry: LibraryEntry;
  editorScopeKey: string;
  workspaceRoot: string | null;
  markdownNoteRefreshById: Record<string, number>;
  jumpRequest: PdfJumpRequest | null;
  reloadKey: number;
  pairedMarkdownNoteTarget: MarkdownNoteTarget | null;
  sharedSegmentNoteDrafts: Record<string, string>;
  pendingSourceLinkInsertion: {
    entryId: string;
    noteId: string;
    link: SourceLink;
  } | null;
  pendingNoteImageInsertion: {
    alt?: string | null;
    entryId: string;
    id: string;
    markdownPath: string;
    noteId: string;
  } | null;
  sourceBacklinksBySegmentUid: SourceBacklinksBySegmentUid;
  sidePane: SidePaneState;
  sidePaneEntry: LibraryEntry | null;
  readerPreferences: ReaderPreferences;
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onApplyEntryTagPaths: (
    entryId: string,
    tagPaths: string[],
  ) => Promise<unknown> | unknown;
  onCreateMarkdownSourceLink: (
    entryId: string,
    noteId: string,
    sourceEntryId: string,
    segmentUid: string,
  ) => Promise<SourceLink>;
  onImportMarkdownNoteSegmentAsset: (
    entryId: string,
    noteId: string,
    sourceEntryId: string,
    segmentUid: string,
  ) => Promise<{ markdown_path: string; file_path: string }>;
  onReadMarkdownNote: (
    entryId: string,
    noteId: string,
  ) => Promise<NoteDocument>;
  onReadPdfReader: (entryId: string) => Promise<PdfReaderResponse>;
  onRetryPdfParse: (entryId: string) => Promise<void> | void;
  onCloseSidePane: () => void;
  onOpenSourceLink: (target: SourceLinkOpenTarget) => void;
  onOpenSourceBacklink: (backlink: SourceBacklink) => void;
  onOpenSegmentNotesSurface: (segmentUid: string, mode?: 'note' | 'annotation') => void;
  onOpenAnnotationsSurface: (segmentUid: string) => void;
  onAddAssistantContext?: (
    context: AssistantContextInput,
    options?: AssistantContextAddOptions,
  ) => void;
  onActiveSegmentChange?: (segment: AssistantActiveSegment | null) => void;
  onConsumePendingSourceLinkInsertion: (
    entryId: string,
    noteId: string,
    linkId: string,
  ) => void;
  onConsumePendingNoteImageInsertion: (
    entryId: string,
    noteId: string,
    imageId: string,
  ) => void;
  onSaveSegmentNote: (
    entryId: string,
    segmentUid: string,
    text: string,
  ) => Promise<SegmentBlockNote[]>;
  onSharedSegmentNoteDraftChange: (segmentUid: string, text: string | null) => void;
  onSaveAnnotation: (
    entryId: string,
    annotation: {
      annotationId?: AnnotationId | null;
      content: string;
      importance: AnnotationImportance;
      kind: string;
      segmentUid: string;
      textSelection?: AnnotationTextSelection | null;
    },
  ) => Promise<Annotation[]>;
  onDeleteAnnotation: (
    entryId: string,
    annotationId: AnnotationId,
  ) => Promise<Annotation[]>;
  onExportTranslationNote: (
    entryId: string,
    title: string,
    markdown: string,
  ) => Promise<void>;
  onQueuePendingSourceLinkInsertion: (
    entryId: string,
    noteId: string,
    link: SourceLink,
  ) => void;
  onQueuePendingNoteImageInsertion: (
    entryId: string,
    noteId: string,
    image: { alt?: string | null; id: string; markdownPath: string },
  ) => void;
  onToggleSidePanePinned: () => void;
  onSaveMarkdownNote: (
    entryId: string,
    noteId: string,
    title: string,
    markdown: string,
  ) => Promise<NoteDocument>;
};

export function MineruPdfReader({
  entry,
  editorScopeKey,
  workspaceRoot,
  markdownNoteRefreshById,
  jumpRequest,
  reloadKey,
  pairedMarkdownNoteTarget,
  sharedSegmentNoteDrafts,
  pendingSourceLinkInsertion,
  pendingNoteImageInsertion,
  sourceBacklinksBySegmentUid,
  sidePane,
  sidePaneEntry,
  readerPreferences,
  onReaderPreferencesChange,
  onApplyEntryTagPaths,
  onCreateMarkdownSourceLink,
  onImportMarkdownNoteSegmentAsset,
  onReadMarkdownNote,
  onReadPdfReader,
  onRetryPdfParse,
  onCloseSidePane,
  onOpenSourceLink,
  onOpenSourceBacklink,
  onOpenSegmentNotesSurface,
  onOpenAnnotationsSurface,
  onAddAssistantContext,
  onActiveSegmentChange,
  onConsumePendingSourceLinkInsertion,
  onConsumePendingNoteImageInsertion,
  onDeleteAnnotation,
  onExportTranslationNote,
  onQueuePendingSourceLinkInsertion,
  onQueuePendingNoteImageInsertion,
  onToggleSidePanePinned,
  onSaveSegmentNote,
  onSharedSegmentNoteDraftChange,
  onSaveAnnotation,
  onSaveMarkdownNote,
}: MineruPdfReaderProps) {
  const { dismiss, notify } = useToast();
  const {
    annotations,
    loadState,
    segmentNotes,
    setAnnotations,
    setSegmentNotes,
  } = usePdfReaderData({
    entry,
    onReadPdfReader,
    reloadKey,
  });
  const [hoveredSegmentUid, setHoveredSegmentUid] = useState<string | null>(
    null,
  );
  const [notePaneOpen, setNotePaneOpen] = useState(false);
  const [segmentOverlayOpen, setSegmentOverlayOpen] = useState(false);
  const [confirmSegmentCloseOpen, setConfirmSegmentCloseOpen] = useState(false);
  const [segmentCloseBusy, setSegmentCloseBusy] = useState(false);
  const {
    previewWidth: notePaneResizePreviewWidth,
    resizeWithKeyboard: resizeNotePaneWithKeyboard,
    startResize: startNotePaneResize,
    width: notePaneWidth,
  } = useResizableNotePane();
  const [noteMode, setNoteMode] = useState<"segment" | "annotation" | "global">(
    "segment",
  );
  const [parseRetryBusy, setParseRetryBusy] = useState(false);
  const parseStatusToastRef = useRef<{ key: string; id: string } | null>(null);

  const {
    busy: annotationBusy,
    focusId: annotationFocusId,
    save: saveAnnotation,
    scheduleDelete: scheduleAnnotationDelete,
    setFocusId: setAnnotationFocusId,
  } = usePdfAnnotationActions({
    annotations,
    entryId: entry.id,
    onDeleteAnnotation,
    onSaveAnnotation,
    setAnnotations,
  });

  const pdfPath = loadState.status === "ready" ? loadState.data.pdf_path : null;
  const pdfBytesState = usePdfBytes(pdfPath);
  const pdfState = usePdfDocument(
    pdfBytesState.status === "ready" ? pdfBytesState.bytes : null,
  );

  const segments = loadState.status === "ready" ? loadState.data.segments : [];
  const {
    apply: applyRecommendedTags,
    busy: tagSuggestionBusy,
    dismiss: dismissTagSuggestions,
    open: tagSuggestionsOpen,
    recommendations: recommendedTags,
    selectedPaths: selectedSuggestedTagPaths,
    setOpen: setTagSuggestionsOpen,
    toggleRecommendation: toggleRecommendedTag,
  } = useEntryTagSuggestions({
    entry,
    onApplyEntryTagPaths,
    segments,
    workspaceRoot,
  });
  const notesBySegmentUid = useMemo(() => {
    const next = new Map<string, SegmentBlockNote>();
    for (const note of segmentNotes) {
      if (!hasNoteText(note.text)) {
        continue;
      }
      next.set(note.segment_uid, note);
    }
    return next;
  }, [segmentNotes]);
  const annotationsBySegmentUid = useMemo(() => {
    const next = new Map<string, Annotation[]>();
    for (const annotation of annotations) {
      const current = next.get(annotation.segment_uid) ?? [];
      current.push(annotation);
      next.set(annotation.segment_uid, current);
    }
    return next;
  }, [annotations]);
  const sidePaneNoteTarget =
    sidePane.target?.kind === "markdown-note" ? sidePane.target : null;
  const globalNote = useMemo(() => {
    if (!sidePaneNoteTarget || !sidePaneEntry) {
      return null;
    }

    return (
      sidePaneEntry.contents.find(
        (content) =>
          content.kind === "note" && content.note_id === sidePaneNoteTarget.noteId,
      ) ?? null
    );
  }, [sidePaneEntry, sidePaneNoteTarget]);
  const sidePaneMarkdownNoteTarget = useMemo<MarkdownNoteTarget | null>(() => {
    if (!sidePaneNoteTarget || !globalNote) {
      return null;
    }

    return {
      entryId: sidePaneNoteTarget.entryId,
      entryTitle: sidePaneEntry?.title ?? entry.title,
      noteId: sidePaneNoteTarget.noteId,
      noteTitle: globalNote.title,
    };
  }, [entry.title, globalNote, sidePaneEntry?.title, sidePaneNoteTarget]);
  const activeMarkdownNoteTarget =
    pairedMarkdownNoteTarget ?? sidePaneMarkdownNoteTarget;
  const {
    clipboard: sourceClipboard,
    copy: copySourceLink,
    copyContent,
    createFromSegment: createSourceLinkForMarkdownNote,
    insertCopied: insertCopiedSourceLink,
  } = usePdfSourceLinkActions({
    activeTarget: activeMarkdownNoteTarget,
    entryId: entry.id,
    entryTitle: entry.title,
    onCreateMarkdownSourceLink,
    onEnsureNotePaneOpen: () => {
      if (!pairedMarkdownNoteTarget) {
        setNotePaneOpen(true);
        setNoteMode("global");
        setSegmentOverlayOpen(false);
      }
    },
    onQueuePendingSourceLinkInsertion,
  });
  const globalNotePaneOpen = notePaneOpen && Boolean(globalNote);
  const pendingSourceLinkForGlobalNote =
    globalNote &&
    sidePaneNoteTarget &&
    pendingSourceLinkInsertion?.entryId === sidePaneNoteTarget.entryId &&
    pendingSourceLinkInsertion.noteId === sidePaneNoteTarget.noteId
      ? pendingSourceLinkInsertion.link
      : null;
  const pendingNoteImageForGlobalNote =
    globalNote &&
    sidePaneNoteTarget &&
    pendingNoteImageInsertion?.entryId === sidePaneNoteTarget.entryId &&
    pendingNoteImageInsertion.noteId === sidePaneNoteTarget.noteId
      ? pendingNoteImageInsertion
      : null;
  const segmentOverlayVisible = segmentOverlayOpen && noteMode !== "global";
  const {
    noteBusy,
    noteDirty,
    noteText,
    saveNote,
    selectedSegment,
    selectSegment,
    updateNoteText,
  } = useSegmentNoteDraft({
    draftScopeKey: editorScopeKey,
    entryId: entry.id,
    notesBySegmentUid,
    onSegmentNotesSaved: setSegmentNotes,
    onSaveSegmentNote,
    onSharedDraftChange: onSharedSegmentNoteDraftChange,
    sharedDrafts: sharedSegmentNoteDrafts,
  });

  const {
    bySegmentUid: translationBySegmentUid,
    exportTranslation,
    hasRetryableFailures,
    pause: pauseTranslation,
    retryFailed: retryFailedTranslation,
    setTaskOpen: setTranslationTaskOpen,
    start: startTranslation,
    taskOpen: translationTaskOpen,
    translateSegment: translateSingleSegment,
    translatingSegmentUid,
    translation,
    translationBusy,
    translationDetail,
    translationJobProgress,
    translationMessage,
    translationMode,
    visible: translationVisible,
  } = usePdfTranslationController({
    entryId: entry.id,
    entryTitle: entry.title,
    loadReady: loadState.status === "ready",
    onExportTranslationNote,
    segments,
    workspaceRoot,
  });
  const { activeScrollSegmentUid, pdfScrollRef, pdfViewportWidth } =
    usePdfViewportMetrics({
      notePaneOpen: globalNotePaneOpen,
      segments,
    });
  const {
    handleCtrlWheelZoom,
    pageWidth,
    updateZoom,
    zoom,
    zoomSuppressRegions,
  } = usePdfReaderZoom({
    entryId: entry.id,
    onInteractionStart: () => setHoveredSegmentUid(null),
    viewportWidth: pdfViewportWidth,
  });
  const {
    flashSegment,
    flashSegmentUid,
    restartSegmentHighlight,
    scrollToMountedOrPendingSegment,
  } = usePdfSegmentNavigation({
    entryId: entry.id,
    entryTitle: entry.title,
    layoutVersion: pageWidth,
    onActiveSegmentChange,
    pdfScrollRef,
  });

  const pageCount =
    pdfState.status === "ready"
      ? pdfState.document.numPages
      : inferPageCount(segments);

  const pages = useMemo(
    () => groupSegmentsByPage(segments, pageCount),
    [pageCount, segments],
  );
  const parseStatus = entry.status;
  const parseMessage = entry.parseMessage;
  useEffect(() => {
    const currentToast = parseStatusToastRef.current;
    if (entry.status === "Parsed") {
      if (currentToast) {
        dismiss(currentToast.id);
        parseStatusToastRef.current = null;
      }
      return;
    }

    if (!entry.pdfFileName) {
      return;
    }

    const isFailed = entry.status === "Failed";
    const key = `${entry.id}:${parseStatus}:${parseMessage ?? ""}`;
    if (currentToast?.key === key) {
      return;
    }

    if (currentToast) {
      dismiss(currentToast.id);
    }

    const id = notify({
      durationMs: Infinity,
      tone: isFailed ? "danger" : "default",
      title: isFailed ? "PDF 解析失败" : "PDF 正在解析",
      description: isFailed
        ? parseMessage || "解析任务失败，请检查解析服务配置后重新提交。"
        : `当前解析状态为 ${formatPdfParseStatus(parseStatus)}。解析成功后才会显示完整区域热区。`,
    });
    parseStatusToastRef.current = { id, key };

    return () => {
      if (parseStatusToastRef.current?.id === id) {
        dismiss(id);
        parseStatusToastRef.current = null;
      }
    };
  }, [
    dismiss,
    entry.id,
    entry.pdfFileName,
    entry.status,
    notify,
    parseMessage,
    parseStatus,
  ]);

  useEffect(() => {
    if (sidePaneNoteTarget && globalNote) {
      setNotePaneOpen(true);
      setNoteMode("global");
      setSegmentOverlayOpen(false);
    }
  }, [globalNote, sidePane.requestKey, sidePaneNoteTarget]);

  const activateSegment = (
    segment: SourceSegment,
    options: { mode?: "segment" | "annotation" } = {},
  ) => {
    if (
      selectedSegment &&
      logicalSegmentUid(selectedSegment) !== logicalSegmentUid(segment) &&
      hasUnsavedSegmentEditors(editorScopeKey)
    ) {
      notify({
        tone: "default",
        title: "当前修改尚未保存",
        description: "请先保存或放弃当前片段的修改，再切换片段。",
      });
      return false;
    }
    if (!selectSegment(segment)) return false;
    setAnnotationFocusId(null);
    setNoteMode(options.mode ?? "segment");
    flashSegment(segment);
    return true;
  };

  const closeSegmentOverlayNow = useCallback(() => {
    setSegmentOverlayOpen(false);
    setAnnotationFocusId(null);
  }, []);
  const closeSegmentOverlay = useCallback(() => {
    if (hasUnsavedSegmentEditors(editorScopeKey)) {
      setConfirmSegmentCloseOpen(true);
      return;
    }
    closeSegmentOverlayNow();
  }, [closeSegmentOverlayNow, editorScopeKey]);
  const discardAndCloseSegmentOverlay = useCallback(() => {
    discardSegmentEditorsBeforeClose(editorScopeKey);
    setConfirmSegmentCloseOpen(false);
    closeSegmentOverlayNow();
  }, [closeSegmentOverlayNow, editorScopeKey]);
  const saveAndCloseSegmentOverlay = useCallback(async () => {
    if (segmentCloseBusy) return;
    setSegmentCloseBusy(true);
    try {
      if (await saveSegmentEditorsBeforeClose(editorScopeKey)) {
        setConfirmSegmentCloseOpen(false);
        closeSegmentOverlayNow();
      }
    } finally {
      setSegmentCloseBusy(false);
    }
  }, [closeSegmentOverlayNow, editorScopeKey, segmentCloseBusy]);

  const toggleSegment = (segment: SourceSegment) => {
    const currentSegmentUid = selectedSegment
      ? logicalSegmentUid(selectedSegment)
      : null;
    const nextSegmentUid = logicalSegmentUid(segment);

    if (
      readerPreferences.closeSegmentOverlayOnSameSegmentClick &&
      segmentOverlayOpen &&
      currentSegmentUid === nextSegmentUid
    ) {
      closeSegmentOverlay();
      return;
    }

    if (!activateSegment(segment, {
      mode: noteMode === "annotation" ? "annotation" : "segment",
    })) return;
    if (readerPreferences.leftClickOpensNotePane) {
      setSegmentOverlayOpen(true);
    }
  };
  const guardedToggleSegment = useGuardedSegmentAction(toggleSegment);

  const openSegmentNotePane = (segment: SourceSegment) => {
    if (!activateSegment(segment, { mode: "segment" })) return;
    setSegmentOverlayOpen(true);
  };

  const openSegmentAnnotationPane = (segment: SourceSegment) => {
    if (!activateSegment(segment, { mode: "annotation" })) return;
    setSegmentOverlayOpen(true);
  };

  const createTextSelectionAnnotation = useCallback(
    async ({
      content,
      importance,
      segment,
      selection,
    }: {
      content: string;
      importance: AnnotationImportance;
      segment: SourceSegment;
      selection: AnnotationTextSelection;
    }) => {
      const existing = annotations.find((annotation) =>
        annotation.segment_uid === segment.uid &&
        sameTextSelection(annotation.text_selection, selection)
      );
      await saveAnnotation({
        annotationId: existing?.annotation_id,
        content: content.trim() || existing?.content || '',
        importance: content.trim() ? importance : existing?.importance ?? importance,
        kind: "highlight",
        segmentUid: segment.uid,
        textSelection: selection,
      });
    },
    [annotations, saveAnnotation],
  );
  const translateSelectedText = useCallback(
    ({ segment, text }: { segment: SourceSegment; text: string }) =>
      translateTextSelection({
        context: segment.markdown ?? segment.text,
        entryTitle: entry.title,
        text
      }),
    [entry.title]
  );

  const insertSegmentImageIntoMarkdownNote = useCallback(
    async (segment: SourceSegment) => {
      const target = activeMarkdownNoteTarget;
      if (!target) {
        notify({
          tone: "danger",
          title: "没有可插入的笔记",
          description: "请先打开或分屏一个 Markdown 笔记。",
        });
        return;
      }
      try {
        if (!pairedMarkdownNoteTarget) {
          setNotePaneOpen(true);
          setNoteMode("global");
          setSegmentOverlayOpen(false);
        }
        let markdownPath: string | null = null;
        if (workspaceRoot && pdfState.status === "ready") {
          const screenshot = await capturePdfSegmentScreenshot(
            pdfState.document,
            pageWidth,
            segment,
          );
          const imported = await saveNoteAssetBytes(
            workspaceRoot,
            target.entryId,
            target.noteId,
            "image/png",
            screenshot.dataBase64,
            `segment-${segment.uid}.png`,
          );
          markdownPath = imported.markdown_path;
        }
        if (!markdownPath && segment.asset_path) {
          const imported = await onImportMarkdownNoteSegmentAsset(
            target.entryId,
            target.noteId,
            entry.id,
            segment.uid,
          );
          markdownPath = imported.markdown_path;
        }
        if (!markdownPath) {
          throw new Error("当前片段没有可截图的 PDF 区域，也没有解析出的原始图片。");
        }
        onQueuePendingNoteImageInsertion(target.entryId, target.noteId, {
          alt: segment.text.trim().slice(0, 80) || segment.segment_type,
          id: `${segment.uid}:${Date.now()}`,
          markdownPath,
        });
      } catch (caught) {
        notify({
          tone: "danger",
          title: "片段图片插入失败",
          description: caught instanceof Error ? caught.message : String(caught),
        });
      }
    },
    [
      activeMarkdownNoteTarget,
      entry.id,
      notify,
      onImportMarkdownNoteSegmentAsset,
      onQueuePendingNoteImageInsertion,
      pageWidth,
      pairedMarkdownNoteTarget,
      pdfState,
      workspaceRoot,
    ],
  );

  const openSourceLinkInReader = useCallback(
    (target: SourceLinkOpenTarget) => {
      if (!target.segmentUid || target.sourceEntryId !== entry.id) {
        onOpenSourceLink(target);
        return;
      }

      const segment = findSegmentByLogicalOrRealUid(
        segments,
        target.segmentUid,
      );
      if (!segment) {
        onOpenSourceLink(target);
        return;
      }

      if (!selectSegment(segment)) return;
      setAnnotationFocusId(null);
      flashSegment(segment);
      setHoveredSegmentUid(segment.uid);
      window.requestAnimationFrame(() => {
        scrollToMountedOrPendingSegment(segment);
      });
    },
    [
      entry.id,
      flashSegment,
      onOpenSourceLink,
      scrollToMountedOrPendingSegment,
      segments,
      selectSegment,
      setHoveredSegmentUid,
    ],
  );

  const sourceLinkHint =
    activeMarkdownNoteTarget
      ? undefined
      : globalNote
        ? "要添加到笔记，请在左侧用分屏按钮打开笔记。"
        : "要添加到笔记，请先在左侧新建笔记，并用分屏按钮打开。";

  useEffect(() => {
    if (!jumpRequest || loadState.status !== "ready") {
      return;
    }

    if (jumpRequest.kind === "page") {
      window.requestAnimationFrame(() => {
        scrollToPage(jumpRequest.pageIdx, pdfScrollRef.current);
      });
      return;
    }

    const segment = findSegmentByLogicalOrRealUid(
      segments,
      jumpRequest.segmentUid,
    );
    if (!segment) {
      window.requestAnimationFrame(() => {
        scrollToPage(jumpRequest.pageIdx, pdfScrollRef.current);
      });
      return;
    }

    if (!activateSegment(segment)) return;
    if (jumpRequest.kind === "annotation") {
      setNoteMode("annotation");
      setAnnotationFocusId(jumpRequest.annotationId);
      onOpenAnnotationsSurface(logicalSegmentUid(segment));
    }
    window.requestAnimationFrame(() => {
      scrollToMountedOrPendingSegment(segment);
    });
  }, [
    jumpRequest?.requestKey,
    loadState.status,
    scrollToMountedOrPendingSegment,
    segments,
  ]);

  const saveSegmentNote = async () => {
    return Boolean(await saveNote());
  };

  const switchReaderPanelMode = useCallback(
    (mode: "segment" | "annotation" | "global") => {
      setNoteMode(mode);
      if (mode === "global") {
        setSegmentOverlayOpen(false);
        if (globalNote) {
          setNotePaneOpen(true);
        }
        return;
      }
      setSegmentOverlayOpen(true);
    },
    [globalNote],
  );

  const addSegmentToAssistantContext = (
    segment: SourceSegment,
    options?: AssistantContextAddOptions,
  ) => {
    onAddAssistantContext?.(
      {
        kind: "segment",
        entryId: entry.id,
        entryTitle: entry.title,
        // The assistant backend resolves this value against persisted segment_uid.
        segmentUid: segment.uid,
        pageIdx: segment.page_idx,
        text: segment.markdown ?? segment.text,
      },
      options,
    );
    restartSegmentHighlight(segment.uid);
  };

  const retryPdfParse = async () => {
    if (parseRetryBusy) {
      return;
    }
    setParseRetryBusy(true);
    try {
      await onRetryPdfParse(entry.id);
      notify({
        title: "已重新提交解析",
        description: "PDF 解析任务已重新提交，请等待解析服务返回结果。",
      });
    } catch (caught) {
      notify({
        tone: "danger",
        title: "重新解析失败",
        description: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setParseRetryBusy(false);
    }
  };

  if (!entry.pdfFileName) {
    return (
      <ReaderMessage title="无 PDF" description="这个条目还没有导入 PDF。" />
    );
  }

  if (entry.status === "Failed") {
    return (
      <PdfParseFailureMessage
        busy={parseRetryBusy}
        message={parseMessage}
        onRetry={() => void retryPdfParse()}
      />
    );
  }

  if (loadState.status === "loading" || loadState.status === "idle") {
    return (
      <ReaderMessage
        icon={<Loader2 className="animate-spin" size={22} aria-hidden="true" />}
        title="正在加载 PDF"
        description="正在加载本地 PDF、MinerU 原文片段和片段笔记。"
      />
    );
  }

  if (loadState.status === "error") {
    return (
      <ReaderMessage
        title="无法打开 PDF"
        description={loadState.error}
        tone="danger"
      />
    );
  }

  return (
    <div className="relative grid size-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-muted/30">
      <ReaderToolbar
        entry={entry}
        pageCount={pageCount}
        segmentCount={segments.length}
        recommendedTags={recommendedTags}
        selectedRecommendedTagPaths={[...selectedSuggestedTagPaths]}
        tagSuggestionBusy={tagSuggestionBusy}
        tagSuggestionsOpen={tagSuggestionsOpen}
        hasRetryableFailures={hasRetryableFailures}
        translation={translation}
        translationBusy={translationBusy}
        zoom={zoom}
        readerPreferences={readerPreferences}
        onExportTranslation={() => void exportTranslation()}
        onApplyRecommendedTags={() => void applyRecommendedTags()}
        onDismissRecommendedTags={dismissTagSuggestions}
        onRecommendedTagToggle={toggleRecommendedTag}
        onPauseTranslation={() => void pauseTranslation()}
        onRetryFailedTranslation={() => void retryFailedTranslation()}
        onOpenTranslationTask={() => setTranslationTaskOpen(true)}
        onReaderPreferencesChange={onReaderPreferencesChange}
        onTagSuggestionsOpenChange={setTagSuggestionsOpen}
        onZoomIn={() =>
          updateZoom((currentZoom) => currentZoom + PDF_ZOOM_STEP)
        }
        onZoomOut={() =>
          updateZoom((currentZoom) => currentZoom - PDF_ZOOM_STEP)
        }
      />

      <TranslationTaskDialog
        busy={translationBusy || translatingSegmentUid !== null}
        detail={translationDetail}
        message={translationMessage}
        open={translationTaskOpen}
        progress={translationJobProgress}
        segments={segments}
        translation={translation}
        onOpenChange={setTranslationTaskOpen}
        onTranslate={async (selected, mode) => {
          await startTranslation("resume", {
            force: mode === "force",
            segmentUids: selected.map((segment) => segment.uid),
          });
        }}
      />

      <UnsavedSegmentChangesDialog
        busy={segmentCloseBusy}
        open={confirmSegmentCloseOpen}
        onCancel={() => setConfirmSegmentCloseOpen(false)}
        onDiscard={discardAndCloseSegmentOverlay}
        onSave={() => void saveAndCloseSegmentOverlay()}
      />

      <div
        className={`relative grid h-full min-h-0 min-w-0 overflow-hidden ${notePaneResizePreviewWidth !== null ? "is-note-pane-resizing" : ""}`}
        style={{
          gridTemplateColumns: globalNotePaneOpen
            ? `minmax(0, 1fr) 8px ${notePaneWidth}px`
            : "minmax(0, 1fr)",
          gridTemplateRows: "minmax(0, 1fr)",
        }}
      >
        <SegmentRailLayout
          overlay={
            selectedSegment ? (
              <FloatingSegmentPanel
                onClose={closeSegmentOverlay}
                open={segmentOverlayVisible}
                storageKey="neuink.reader.segmentPanel.pdf"
              >
                {noteMode === "annotation" ? (
                  <SegmentAnnotationEditor
                    annotations={annotations}
                    busy={annotationBusy}
                    draftScopeKey={editorScopeKey}
                    pdfDocument={pdfState.status === "ready" ? pdfState.document : null}
                    selectedAnnotationId={annotationFocusId}
                    showCloseButton={false}
                    segments={segments}
                    segment={selectedSegment}
                    sourceEntryId={entry.id}
                    workspaceRoot={workspaceRoot}
                    onClose={closeSegmentOverlay}
                    onDelete={scheduleAnnotationDelete}
                    onModeChange={switchReaderPanelMode}
                    onSave={saveAnnotation}
                  />
                ) : (
                  <SegmentNoteEditor
                    annotationCount={
                      annotationsBySegmentUid.get(selectedSegment.uid)?.length ?? 0
                    }
                    busy={noteBusy}
                    dirty={noteDirty}
                    noteText={noteText}
                    pdfDocument={pdfState.status === "ready" ? pdfState.document : null}
                    segment={selectedSegment}
                    showCloseButton={false}
                    sourceEntryId={entry.id}
                    translatedText={
                      translationBySegmentUid.get(selectedSegment.uid)?.translated_text ?? null
                    }
                    workspaceRoot={workspaceRoot}
                    onClose={closeSegmentOverlay}
                    onModeChange={switchReaderPanelMode}
                    onNoteTextChange={updateNoteText}
                    onSave={saveSegmentNote}
                  />
                )}
              </FloatingSegmentPanel>
            ) : null
          }
          rail={
            <SegmentRail
              flashSegmentUid={flashSegmentUid}
              activeSegmentUid={activeScrollSegmentUid}
              annotationsBySegmentUid={annotationsBySegmentUid}
              notesBySegmentUid={notesBySegmentUid}
              pages={pages}
              pageCount={pageCount}
              selectedSegmentUid={
                selectedSegment ? logicalSegmentUid(selectedSegment) : null
              }
              onJumpToSegment={(segmentUid) => {
                const segment = findSegmentByLogicalOrRealUid(
                  segments,
                  segmentUid,
                );

                if (segment) {
                  scrollToMountedOrPendingSegment(segment);
                  return;
                }

                scrollToSegment(segmentUid, pdfScrollRef.current);
              }}
            />
          }
        >

          <PdfReaderDocumentPane
            autoTranslateTextSelection={readerPreferences.autoTranslateTextSelection}
            entry={entry}
            flashSegmentUid={flashSegmentUid}
            hoveredSegmentUid={hoveredSegmentUid}
            annotationsBySegmentUid={annotationsBySegmentUid}
            notesBySegmentUid={notesBySegmentUid}
            pages={pages}
            pageWidth={pageWidth}
            leftInset={PDF_RAIL_WIDTH}
            hoverPreviewEnabled={readerPreferences.hoverPreviewEnabled}
            hoverPreviewShowRegion={readerPreferences.hoverPreviewShowRegion}
            hoverPreviewShowOriginal={readerPreferences.hoverPreviewShowOriginal}
            hoverPreviewShowNote={readerPreferences.hoverPreviewShowNote}
            hoverPreviewShowAnnotation={readerPreferences.hoverPreviewShowAnnotation}
            hoverPreviewShowTranslation={readerPreferences.hoverPreviewShowTranslation}
            pdfScrollRef={pdfScrollRef}
            pdfState={pdfState}
            pdfAvailable={Boolean(pdfPath)}
            pdfBytesState={pdfBytesState}
            showRegions={readerPreferences.showRegions}
            sourceLinkHint={sourceLinkHint}
            sourceBacklinksBySegmentUid={sourceBacklinksBySegmentUid}
            suppressRegions={zoomSuppressRegions}
            translationBySegmentUid={translationBySegmentUid}
            translationStatus={translation?.status ?? null}
            translationMode={translationMode}
            translationVisible={translationVisible}
            workspaceRoot={workspaceRoot}
            onCtrlWheelZoom={handleCtrlWheelZoom}
            onOpenSegmentAnnotation={openSegmentAnnotationPane}
            onOpenSegmentNote={openSegmentNotePane}
            onOpenSegmentWorkspace={(segment) =>
              onOpenSegmentNotesSurface(logicalSegmentUid(segment), "note")
            }
            onOpenSourceBacklink={onOpenSourceBacklink}
            onCopyContent={copyContent}
            onCopySourceLink={copySourceLink}
            onInsertSegmentImage={
              activeMarkdownNoteTarget ? insertSegmentImageIntoMarkdownNote : undefined
            }
            onTranslateSegment={!translationBusy ? translateSingleSegment : undefined}
            onAddSourceLink={activeMarkdownNoteTarget ? createSourceLinkForMarkdownNote : undefined}
            onAddAssistantContext={addSegmentToAssistantContext}
            onCloseSegmentOverlay={() => {
              if (readerPreferences.closeSegmentOverlayOnBlankClick) {
                closeSegmentOverlay();
              }
            }}
            onCreateTextSelectionAnnotation={createTextSelectionAnnotation}
            onTranslateTextSelection={translateSelectedText}
            onToggleSegment={guardedToggleSegment}
          />
        </SegmentRailLayout>

        {globalNotePaneOpen ? (
          <div
            aria-label="调整右侧笔记宽度"
            aria-valuemax={NOTE_PANE_MAX_WIDTH}
            aria-valuemin={NOTE_PANE_MIN_WIDTH}
            aria-valuenow={notePaneWidth}
            className="app-note-pane-resizer"
            role="separator"
            tabIndex={0}
            title="拖动调整右侧笔记宽度"
            onKeyDown={resizeNotePaneWithKeyboard}
            onPointerDown={startNotePaneResize}
          />
        ) : null}
        {notePaneResizePreviewWidth !== null ? (
          <div
            aria-hidden="true"
            className="app-note-pane-resize-preview"
            style={{ right: `${notePaneResizePreviewWidth + 4}px` }}
          />
        ) : null}

        {globalNotePaneOpen && globalNote ? (
          <GlobalMarkdownNotePane
            annotationAvailable={Boolean(selectedSegment)}
            entryId={sidePaneNoteTarget?.entryId ?? entry.id}
            entryTitle={sidePaneEntry?.title ?? entry.title}
            fallbackTitle={globalNote.title}
            pinned={sidePane.pinned}
            copiedSourceLabel={
              sourceClipboard
                ? `${sourceClipboard.sourceEntryTitle} · p.${sourceClipboard.pageIdx + 1}`
                : null
            }
            noteId={globalNote.note_id}
            pdfDocument={pdfState.status === "ready" ? pdfState.document : null}
            noteRefreshKey={
              markdownNoteRefreshById[
                `${sidePaneNoteTarget?.entryId ?? entry.id}:${globalNote.note_id}`
              ] ?? 0
            }
            segmentAvailable={Boolean(selectedSegment)}
            sourceLinkToInsert={pendingSourceLinkForGlobalNote}
            noteImageToInsert={pendingNoteImageForGlobalNote}
            workspaceRoot={workspaceRoot}
            onClose={() => {
              setNotePaneOpen(false);
              onCloseSidePane();
            }}
            onLoadNote={() =>
              onReadMarkdownNote(sidePaneNoteTarget?.entryId ?? entry.id, globalNote.note_id)
            }
            onModeChange={switchReaderPanelMode}
            onOpenSourceLink={openSourceLinkInReader}
            onNoteImageInserted={(imageId) => {
              onConsumePendingNoteImageInsertion(
                sidePaneNoteTarget?.entryId ?? entry.id,
                globalNote.note_id,
                imageId,
              );
            }}
            onCreateSourceLinkFromPaste={(sourceEntryId, segmentUid) =>
              onCreateMarkdownSourceLink(
                sidePaneNoteTarget?.entryId ?? entry.id,
                globalNote.note_id,
                sourceEntryId,
                segmentUid,
              )
            }
            onSaveNote={(title, markdown) =>
              onSaveMarkdownNote(
                sidePaneNoteTarget?.entryId ?? entry.id,
                globalNote.note_id,
                title,
                markdown,
              )
            }
            onInsertCopiedSource={insertCopiedSourceLink}
            onSourceLinkInserted={(link) => {
              onConsumePendingSourceLinkInsertion(
                sidePaneNoteTarget?.entryId ?? entry.id,
                globalNote.note_id,
                link.link_id,
              );
            }}
            onTogglePinned={onToggleSidePanePinned}
          />
        ) : null}
      </div>

    </div>
  );
}

function sameTextSelection(
  left: AnnotationTextSelection | null | undefined,
  right: AnnotationTextSelection
) {
  if (
    !left ||
    left.page_idx !== right.page_idx ||
    left.text.trim() !== right.text.trim() ||
    left.rects.length !== right.rects.length
  ) {
    return false;
  }
  return left.rects.every((rect, index) =>
    rect.every((coordinate, coordinateIndex) =>
      Math.abs(coordinate - right.rects[index][coordinateIndex]) < 0.5
    )
  );
}

async function capturePdfSegmentScreenshot(
  pdfDocument: PDFDocumentProxy,
  pageWidth: number,
  segment: SourceSegment,
) {
  if (!segment.bbox) {
    throw new Error("当前片段没有可截图的 PDF 区域。");
  }

  const page = await pdfDocument.getPage(segment.page_idx + 1);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = pageWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const outputScale = window.devicePixelRatio || 1;
  const fullCanvas = document.createElement("canvas");
  const fullContext = fullCanvas.getContext("2d");
  if (!fullContext) {
    throw new Error("无法创建 PDF 截图画布。");
  }

  fullCanvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  fullCanvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
  const renderTask = page.render({
    canvas: fullCanvas,
    canvasContext: fullContext,
    viewport,
    transform:
      outputScale === 1
        ? undefined
        : [outputScale, 0, 0, outputScale, 0, 0],
  });
  await renderTask.promise;

  const [x0, y0, x1, y1] = segment.bbox;
  const sx0 = clampCanvasCoordinate((x0 / 1000) * fullCanvas.width, fullCanvas.width);
  const sy0 = clampCanvasCoordinate((y0 / 1000) * fullCanvas.height, fullCanvas.height);
  const sx1 = clampCanvasCoordinate((x1 / 1000) * fullCanvas.width, fullCanvas.width);
  const sy1 = clampCanvasCoordinate((y1 / 1000) * fullCanvas.height, fullCanvas.height);
  const sx = Math.min(sx0, sx1);
  const sy = Math.min(sy0, sy1);
  const sw = Math.max(1, Math.abs(sx1 - sx0));
  const sh = Math.max(1, Math.abs(sy1 - sy0));
  const cropCanvas = document.createElement("canvas");
  const cropContext = cropCanvas.getContext("2d");
  if (!cropContext) {
    throw new Error("无法创建片段截图画布。");
  }

  cropCanvas.width = sw;
  cropCanvas.height = sh;
  cropContext.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const dataUrl = cropCanvas.toDataURL("image/png");
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("片段截图编码失败。");
  }
  return { dataBase64: dataUrl.slice(commaIndex + 1) };
}

function clampCanvasCoordinate(value: number, max: number) {
  return Math.min(Math.max(0, Math.round(value)), max);
}
