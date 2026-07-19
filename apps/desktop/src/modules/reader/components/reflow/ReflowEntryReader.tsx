import { ListRestart, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { translateEntrySegment, type PdfReaderResponse } from '@/shared/ipc/workspaceApi';
import { useToast } from '@/shared/hooks/useToast';
import type { ReaderPreferences } from '@/shared/lib/readerPreferences';
import { formatSourceLinkClipboardMarker } from '@/shared/lib/sourceLinkClipboard';
import type { AssistantContextAddOptions, AssistantContextInput } from '@/shared/types/assistant';
import type { Annotation, AnnotationId, AnnotationImportance, AnnotationTextSelection, SegmentBlockNote, SourceLink, SourceSegment } from '@/shared/types/domain';

import type { LibraryEntry } from '../../../library/components/LibrarySidebar';
import type { MarkdownNoteTarget, SourceBacklink, SourceBacklinksBySegmentUid } from '../../types';
import {
  useEntryTranslationTask,
  type TranslationRunStrategy,
  type TranslationStartOptions
} from '../../translation/useEntryTranslationTask';
import {
  describeTranslationFailure,
  PARTIAL_TRANSLATION_FAILURE
} from '../../translation/translationErrorMessage';
import {
  buildTranslationExportMarkdown,
  buildTranslationExportTitle
} from '../../translation/translationExport';
import { ReaderMessage } from '../pdf-reader/ReaderMessage';
import { SegmentAnnotationEditor } from '../../../annotations/components/SegmentAnnotationEditor';
import { hasNoteText } from '../pdf-reader/readerUtils';
import { SegmentNoteEditor } from '../pdf-reader/SegmentNoteEditor';
import { FloatingSegmentPanel } from '../pdf-reader/FloatingSegmentPanel';
import { HoverPreviewControls } from '../pdf-reader/ReaderToolbar';
import { EntryContentHeader } from '../EntryContentHeader';
import { usePdfBytes } from '../pdf-reader/usePdfBytes';
import { usePdfDocument } from '../pdf-reader/usePdfDocument';
import { usePdfReaderData } from '../pdf-reader/usePdfReaderData';
import { useSegmentNoteDraft } from '../pdf-reader/useSegmentNoteDraft';
import { ReflowReader } from './ReflowReader';
import { useGuardedSegmentAction } from '../useGuardedSegmentAction';
import { TranslationTaskDialog } from '../../translation/TranslationTaskDialog';
import { UnsavedSegmentChangesDialog } from '../pdf-reader/UnsavedSegmentChangesDialog';
import {
  discardSegmentEditorsBeforeClose,
  hasUnsavedSegmentEditors,
  saveSegmentEditorsBeforeClose
} from '../segmentEditorDirtyRegistry';
const SEGMENT_FLASH_DURATION_MS = 1200;

const REFLOW_HIDDEN_SEGMENTS_STORAGE_KEY = 'neuink.reader.reflowHiddenSegments';

export function ReflowEntryReader({
  entry,
  editorScopeKey,
  pairedMarkdownNoteTarget,
  readerPreferences,
  sourceBacklinksBySegmentUid,
  onExportTranslationNote,
  onReaderPreferencesChange,
  onDeleteAnnotation,
  onCreateMarkdownSourceLink,
  onQueuePendingSourceLinkInsertion,
  onOpenSourceBacklink,
  onAddAssistantContext,
  onSaveAnnotation,
  workspaceRoot,
  onReadPdfReader,
  onSaveSegmentNote,
  onOpenSegmentNotesSurface,
  onOpenAnnotationsSurface
}: {
  entry: LibraryEntry;
  editorScopeKey: string;
  pairedMarkdownNoteTarget: MarkdownNoteTarget | null;
  readerPreferences: ReaderPreferences;
  sourceBacklinksBySegmentUid: SourceBacklinksBySegmentUid;
  onExportTranslationNote: (entryId: string, title: string, markdown: string) => Promise<void>;
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onDeleteAnnotation: (entryId: string, annotationId: AnnotationId) => Promise<Annotation[]>;
  onCreateMarkdownSourceLink: (entryId: string, noteId: string, sourceEntryId: string, segmentUid: string) => Promise<SourceLink>;
  onQueuePendingSourceLinkInsertion: (entryId: string, noteId: string, link: SourceLink) => void;
  onOpenSourceBacklink: (backlink: SourceBacklink) => void;
  onAddAssistantContext?: (context: AssistantContextInput, options?: AssistantContextAddOptions) => void;
  onSaveAnnotation: (entryId: string, annotation: {
    annotationId?: AnnotationId | null;
    content: string;
    importance: AnnotationImportance;
    kind: string;
    segmentUid: string;
    textSelection?: AnnotationTextSelection | null;
  }) => Promise<Annotation[]>;
  workspaceRoot: string | null;
  onReadPdfReader: (entryId: string) => Promise<PdfReaderResponse>;
  onSaveSegmentNote: (entryId: string, segmentUid: string, text: string) => Promise<SegmentBlockNote[]>;
  onOpenSegmentNotesSurface: (segmentUid: string) => void;
  onOpenAnnotationsSurface: (segmentUid: string) => void;
}) {
  const { notify } = useToast();
  const { annotations, loadState, segmentNotes, setAnnotations, setSegmentNotes } = usePdfReaderData({
    entry,
    onReadPdfReader
  });
  const [selectedSegmentUid, setSelectedSegmentUid] = useState<string | null>(null);
  const [flashSegmentUid, setFlashSegmentUid] = useState<string | null>(null);
  const [notePopoverSegmentUid, setNotePopoverSegmentUid] = useState<string | null>(null);
  const [segmentOverlayOpen, setSegmentOverlayOpen] = useState(false);
  const [confirmSegmentCloseOpen, setConfirmSegmentCloseOpen] = useState(false);
  const [segmentCloseBusy, setSegmentCloseBusy] = useState(false);
  const [segmentOverlayMode, setSegmentOverlayMode] = useState<'segment' | 'annotation'>('segment');
  const [translationTaskOpen, setTranslationTaskOpen] = useState(false);
  const [sourceLinkBusySegmentUid, setSourceLinkBusySegmentUid] = useState<string | null>(null);
  const [translatingSegmentUid, setTranslatingSegmentUid] = useState<string | null>(null);
  const [pdfDocumentRequested, setPdfDocumentRequested] = useState(false);
  const [hiddenSegmentUids, setHiddenSegmentUids] = useState<Set<string>>(
    () => readStoredHiddenSegmentUids(entry.id)
  );
  const handledTranslationJobKeyRef = useRef<string | null>(null);

  const segments = loadState.status === 'ready' ? loadState.data.segments : [];
  const {
    activeJob: translationJob,
    currentJobKey: translationJobKey,
    pauseTranslation: pauseTranslationTask,
    startTranslation: startTranslationTask,
    translation,
    translationBusy,
    translationDetail,
    translationMessage,
    reloadTranslation
  } = useEntryTranslationTask({
    entryId: entry.id,
    workspaceRoot
  });
  const pdfPath = loadState.status === 'ready' ? loadState.data.pdf_path : null;
  const pdfBytesState = usePdfBytes(pdfDocumentRequested ? pdfPath : null);
  const pdfState = usePdfDocument(pdfBytesState.status === 'ready' ? pdfBytesState.bytes : null);
  const notesBySegmentUid = useMemo(
    () =>
      new Map(
        segmentNotes
          .filter((note) => hasNoteText(note.text))
          .map((note) => [note.segment_uid, note])
      ),
    [segmentNotes]
  );
  const annotationCountBySegmentUid = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of annotations) {
      counts.set(annotation.segment_uid, (counts.get(annotation.segment_uid) ?? 0) + 1);
    }
    return counts;
  }, [annotations]);
  const annotationsBySegmentUid = useMemo(() => {
    const grouped = new Map<string, Annotation[]>();
    for (const annotation of annotations) {
      grouped.set(annotation.segment_uid, [
        ...(grouped.get(annotation.segment_uid) ?? []),
        annotation
      ]);
    }
    return grouped;
  }, [annotations]);
  const sourceLinkCountBySegmentUid = useMemo(
    () =>
      new Map(
        Object.entries(sourceBacklinksBySegmentUid).map(([segmentUid, links]) => [segmentUid, links.length])
      ),
    [sourceBacklinksBySegmentUid]
  );
  const translationBySegmentUid = useMemo(
    () =>
      new Map(
        (translation?.segments ?? [])
          .filter((segment) => segment.status === 'translated' && segment.translated_text)
          .map((segment) => [segment.segment_uid, segment])
      ),
    [translation]
  );
  const hasTranslation = Boolean(
    translation?.segments.some((segment) => segment.status === 'translated')
  );
  const overlaySegment = notePopoverSegmentUid
    ? segments.find((segment) => segment.uid === notePopoverSegmentUid) ?? null
    : null;
  const hiddenSegments = useMemo(
    () => segments.filter((segment) => hiddenSegmentUids.has(segment.uid)),
    [hiddenSegmentUids, segments]
  );
  const hasRetryableFailures = !translationBusy && (translation?.progress.failed ?? 0) > 0;
  const hasExportableTranslation = Boolean(
    translation?.segments.some((segment) => segment.status === 'translated' && segment.translated_text)
  );
  const {
    noteBusy,
    noteDirty,
    noteText,
    saveNote,
    selectedSegment,
    selectSegment,
    updateNoteText
  } = useSegmentNoteDraft({
    draftScopeKey: editorScopeKey,
    entryId: entry.id,
    notesBySegmentUid,
    onSegmentNotesSaved: setSegmentNotes,
    onSaveSegmentNote
  });

  const closeSegmentOverlayNow = () => setSegmentOverlayOpen(false);
  const requestCloseSegmentOverlay = () => {
    if (hasUnsavedSegmentEditors(editorScopeKey)) {
      setConfirmSegmentCloseOpen(true);
      return;
    }
    closeSegmentOverlayNow();
  };
  const discardAndCloseSegmentOverlay = () => {
    discardSegmentEditorsBeforeClose(editorScopeKey);
    setConfirmSegmentCloseOpen(false);
    closeSegmentOverlayNow();
  };
  const saveAndCloseSegmentOverlay = async () => {
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
  };

  useEffect(() => {
    handledTranslationJobKeyRef.current = null;
    setPdfDocumentRequested(false);
    setHiddenSegmentUids(readStoredHiddenSegmentUids(entry.id));
  }, [entry.id]);

  useEffect(() => {
    persistHiddenSegmentUids(entry.id, hiddenSegmentUids);
  }, [entry.id, hiddenSegmentUids]);

  useEffect(() => {
    if (!translationJobKey || !translationJob) {
      return;
    }
    if (handledTranslationJobKeyRef.current === translationJobKey) {
      return;
    }
    if (translationJob.status === 'processing' || translationJob.status === 'queued') {
      return;
    }

    handledTranslationJobKeyRef.current = translationJobKey;
    if (translationJob.status === 'failed') {
      notify({
        tone: 'danger',
        title: '翻译失败',
        description: describeTranslationFailure(
          translation?.error || translationJob.error || translationJob.message
        )
      });
      return;
    }

    if (translationJob.status === 'canceled') {
      notify({
        title: '已暂停翻译',
        description: '已保留当前翻译进度，可稍后继续。'
      });
      return;
    }

    if (
      translation?.status === 'partial' &&
      (translation.progress.failed > 0 || Boolean(translation.error))
    ) {
      notify({
        title: '翻译部分完成',
        description: PARTIAL_TRANSLATION_FAILURE
      });
      return;
    }

    notify({
      tone: 'success',
      title: translation?.status === 'partial' ? '所选内容翻译完成' : '翻译完成',
      description: translation?.status === 'partial'
        ? '已保存所选内容译文，其余内容仍可在翻译任务中继续选择。'
        : '已保存全文翻译。'
    });
  }, [notify, translation, translationJob, translationJobKey]);

  const activateSegment = (segment: SourceSegment) => {
    if (
      selectedSegment &&
      selectedSegment.uid !== segment.uid &&
      hasUnsavedSegmentEditors(editorScopeKey)
    ) {
      notify({
        tone: 'default',
        title: '当前修改尚未保存',
        description: '请先保存或放弃当前片段的修改，再切换片段。'
      });
      return false;
    }
    if (!selectSegment(segment)) return false;
    setSelectedSegmentUid(segment.uid);
    setFlashSegmentUid(segment.uid);
    window.setTimeout(() => {
      setFlashSegmentUid((current) => (current === segment.uid ? null : current));
    }, SEGMENT_FLASH_DURATION_MS);
    return true;
  };

  const hideSegment = (segment: SourceSegment) => {
    setHiddenSegmentUids((current) => {
      if (current.has(segment.uid)) {
        return current;
      }
      return new Set([...current, segment.uid]);
    });
    if (notePopoverSegmentUid === segment.uid) {
      requestCloseSegmentOverlay();
    }
  };

  const restoreSegment = (segmentUid: string) => {
    setHiddenSegmentUids((current) => {
      if (!current.has(segmentUid)) {
        return current;
      }
      const next = new Set(current);
      next.delete(segmentUid);
      return next;
    });
  };

  const restoreAllSegments = () => {
    setHiddenSegmentUids(new Set());
  };

  const startTranslation = async (
    strategy: TranslationRunStrategy,
    options: TranslationStartOptions = {},
  ) => {
    if (!workspaceRoot || translationBusy || loadState.status !== 'ready') {
      return;
    }

    try {
      await startTranslationTask(strategy, options);
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '翻译失败',
        description: describeTranslationFailure(caught)
      });
    }
  };

  const pauseTranslation = async () => {
    if (!translationBusy) {
      return;
    }

    try {
      await pauseTranslationTask();
    } catch (caught) {
      void caught;
      notify({
        tone: 'danger',
        title: '暂停翻译失败',
        description: '暂时无法暂停翻译，请稍后重试。'
      });
    }
  };

  const retryFailedTranslation = async () => {
    await startTranslation('resume');
  };

  const updateReflowTranslationMode = (mode: ReaderPreferences['reflowTranslationMode']) => {
    onReaderPreferencesChange({ ...readerPreferences, reflowTranslationMode: mode });
  };
  const activateSegmentFromClick = useGuardedSegmentAction((segment) => {
    if (!activateSegment(segment)) return;
    if (readerPreferences.leftClickOpensNotePane) {
      setSegmentOverlayMode('segment');
      setNotePopoverSegmentUid(segment.uid);
      setSegmentOverlayOpen(true);
    }
  });

  const addSourceLink = async (segment: SourceSegment) => {
    if (!pairedMarkdownNoteTarget || sourceLinkBusySegmentUid) return;
    setSourceLinkBusySegmentUid(segment.uid);
    try {
      const link = await onCreateMarkdownSourceLink(
        pairedMarkdownNoteTarget.entryId,
        pairedMarkdownNoteTarget.noteId,
        entry.id,
        segment.uid
      );
      onQueuePendingSourceLinkInsertion(
        pairedMarkdownNoteTarget.entryId,
        pairedMarkdownNoteTarget.noteId,
        link
      );
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '插入来源链接失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
    } finally {
      setSourceLinkBusySegmentUid(null);
    }
  };

  const copySourceLink = async (segment: SourceSegment) => {
    const segmentUid = segment.uid;
    const snapshot = (segment.markdown ?? segment.text).replace(/\s+/g, ' ').trim();
    const excerpt = snapshot.length > 160 ? `${snapshot.slice(0, 157).trimEnd()}...` : snapshot;
    const text = [
      `${entry.title} · p.${segment.page_idx + 1} · segment ${segmentUid}`,
      excerpt,
      formatSourceLinkClipboardMarker({ sourceEntryId: entry.id, segmentUid })
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      notify({ tone: 'success', title: '来源已复制', description: `${entry.title} · p.${segment.page_idx + 1}` });
    } catch (caught) {
      notify({ tone: 'danger', title: '复制来源失败', description: caught instanceof Error ? caught.message : String(caught) });
    }
  };

  const copyContent = async (segment: SourceSegment) => {
    const content = (segment.markdown ?? segment.text).trim();
    if (!content) {
      notify({ tone: 'danger', title: '片段没有可复制的内容' });
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      notify({ tone: 'success', title: '已复制片段内容' });
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '复制片段内容失败',
        description: caught instanceof Error ? caught.message : String(caught),
      });
    }
  };

  const translateSingleSegment = async (segment: SourceSegment) => {
    if (!workspaceRoot || translatingSegmentUid) return;
    setTranslatingSegmentUid(segment.uid);
    try {
      await translateEntrySegment(workspaceRoot, entry.id, segment.uid);
      await reloadTranslation();
      notify({ tone: 'success', title: 'Block 翻译完成', description: `第 ${segment.page_idx + 1} 页片段已更新。` });
    } catch (caught) {
      notify({ tone: 'danger', title: 'Block 翻译失败', description: describeTranslationFailure(caught) });
    } finally {
      setTranslatingSegmentUid(null);
    }
  };

  const exportTranslation = async () => {
    if (!translation) {
      return;
    }

    try {
      const markdown = buildTranslationExportMarkdown({
        entryTitle: entry.title,
        sourceSegments: segments,
        translation
      });
      await onExportTranslationNote(entry.id, buildTranslationExportTitle(entry.title), markdown);
      notify({
        tone: 'success',
        title: '导出完成',
        description: '已生成翻译笔记。'
      });
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '导出翻译失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
    }
  };

  if (loadState.status === 'loading' || loadState.status === 'idle') {
    return (
      <ReaderMessage
        icon={<Loader2 className="animate-spin" size={22} aria-hidden="true" />}
        title="正在加载重排版"
        description="正在加载已解析的 MinerU 原文片段和片段笔记。"
      />
    );
  }

  if (loadState.status === 'error') {
    return (
      <ReaderMessage
        title="无法打开重排版"
        description={loadState.error}
        tone="danger"
      />
    );
  }

  return (
    <div className="relative grid size-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-muted/30">
      <EntryContentHeader className="gap-2" contentTitle="重排视图" entryTitle={entry.title}>
        <span className="min-w-0 flex-1" />

        <HoverPreviewControls
          mode="reflow"
          preferences={readerPreferences}
          onChange={onReaderPreferencesChange}
        />

        {translationBusy ? (
          <Button size="sm" type="button" variant="outline" onClick={() => void pauseTranslation()}>
            暂停
          </Button>
        ) : null}

        {!translationBusy && hasRetryableFailures ? (
          <Button size="sm" type="button" variant="outline" onClick={() => void retryFailedTranslation()}>
            重试失败
          </Button>
        ) : null}

        {!translationBusy && hasExportableTranslation ? (
          <Button size="sm" type="button" variant="outline" onClick={() => void exportTranslation()}>
            导出
          </Button>
        ) : null}

        {entry.status === 'Parsed' ? (
          <Button
            size="sm"
            type="button"
            variant={translationBusy ? 'secondary' : 'outline'}
            onClick={() => setTranslationTaskOpen(true)}
          >
            {translationBusy ? '翻译任务进行中' : '翻译任务'}
          </Button>
        ) : null}

        {hasTranslation ? (
          <Select
            value={readerPreferences.reflowTranslationMode}
            onValueChange={(value) => updateReflowTranslationMode(value as ReaderPreferences['reflowTranslationMode'])}
          >
            <SelectTrigger className="h-8 w-[116px]" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="source">原文</SelectItem>
              <SelectItem value="translation">译文</SelectItem>
              <SelectItem value="bilingual">双语对照</SelectItem>
            </SelectContent>
          </Select>
        ) : null}

        <HiddenReflowSegmentsMenu
          hiddenSegments={hiddenSegments}
          onRestoreAll={restoreAllSegments}
          onRestoreSegment={restoreSegment}
        />
      </EntryContentHeader>

      <div className="relative size-full min-h-0 min-w-0 overflow-hidden">
        <ReflowReader
          activeSegmentUid={selectedSegment?.uid ?? selectedSegmentUid}
          annotationsBySegmentUid={annotationsBySegmentUid}
          entryId={entry.id}
          flashSegmentUid={flashSegmentUid}
          hoverPreviewEnabled={readerPreferences.reflowHoverSourceEnabled}
          hoverPreviewShowOriginal={readerPreferences.hoverPreviewShowOriginal}
          hoverPreviewShowTranslation={readerPreferences.hoverPreviewShowTranslation}
          hoverPreviewShowNote={readerPreferences.hoverPreviewShowNote}
          hoverPreviewShowAnnotation={readerPreferences.hoverPreviewShowAnnotation}
          notesBySegmentUid={notesBySegmentUid}
          pdfDocument={pdfState.status === 'ready' ? pdfState.document : null}
          reflowTranslationMode={readerPreferences.reflowTranslationMode}
          hiddenSegmentUids={hiddenSegmentUids}
          segments={segments}
          sourceLinkCountBySegmentUid={sourceLinkCountBySegmentUid}
          sourceBacklinksBySegmentUid={sourceBacklinksBySegmentUid}
          translationBySegmentUid={translationBySegmentUid}
          workspaceRoot={workspaceRoot}
          onActivateSegment={activateSegmentFromClick}
          onOpenSegmentAnnotation={(segment) => {
            setPdfDocumentRequested(true);
            if (!activateSegment(segment)) return;
            setSegmentOverlayMode('annotation');
            setNotePopoverSegmentUid(segment.uid);
            setSegmentOverlayOpen(true);
          }}
          onOpenSegmentNote={(segment) => {
            setPdfDocumentRequested(true);
            if (!activateSegment(segment)) return;
            setSegmentOverlayMode('segment');
            setNotePopoverSegmentUid(segment.uid);
            setSegmentOverlayOpen(true);
          }}
          onRequirePdfDocument={() => setPdfDocumentRequested(true)}
          onHideSegment={hideSegment}
          onAddSourceLink={pairedMarkdownNoteTarget ? addSourceLink : undefined}
          onCopyContent={copyContent}
          onCopySourceLink={copySourceLink}
          onOpenSourceBacklink={onOpenSourceBacklink}
          onAddAssistantContext={onAddAssistantContext ? (segment) => onAddAssistantContext({
            kind: 'segment',
            entryId: entry.id,
            entryTitle: entry.title,
            segmentUid: segment.uid,
            pageIdx: segment.page_idx,
            text: segment.markdown ?? segment.text
          }) : undefined}
          onTranslateSegment={!translationBusy ? translateSingleSegment : undefined}
        />
        {overlaySegment ? (
          <>
            {segmentOverlayOpen && readerPreferences.closeSegmentOverlayOnBlankClick ? (
              <button
                aria-label="关闭片段面板"
                className="absolute inset-0 z-30 cursor-default"
                type="button"
                onClick={requestCloseSegmentOverlay}
              />
            ) : null}
            <FloatingSegmentPanel
              onClose={requestCloseSegmentOverlay}
              open={segmentOverlayOpen}
              storageKey="neuink.reader.segmentPanel.reflow"
            >
              {segmentOverlayMode === 'annotation' ? (
                <SegmentAnnotationEditor
                  annotations={annotations}
                  busy={false}
                  draftScopeKey={editorScopeKey}
                  pdfDocument={pdfState.status === 'ready' ? pdfState.document : null}
                  showCloseButton={false}
                  segment={overlaySegment}
                  segments={segments}
                  sourceEntryId={entry.id}
                  workspaceRoot={workspaceRoot}
                  onClose={requestCloseSegmentOverlay}
                  onDelete={(annotationId) => void onDeleteAnnotation(entry.id, annotationId).then(setAnnotations)}
                  onModeChange={setSegmentOverlayMode}
                  onSave={(annotation) => onSaveAnnotation(entry.id, annotation).then((next) => {
                    setAnnotations(next);
                    return next;
                  })}
                />
              ) : (
                <SegmentNoteEditor
                  annotationCount={annotationCountBySegmentUid.get(overlaySegment.uid) ?? 0}
                  busy={noteBusy}
                  className="h-full border-0"
                  dirty={noteDirty}
                  noteText={noteText}
                  pdfDocument={pdfState.status === 'ready' ? pdfState.document : null}
                  segment={overlaySegment}
                  showCloseButton={false}
                  sourceEntryId={entry.id}
                  translatedText={translationBySegmentUid.get(overlaySegment.uid)?.translated_text ?? null}
                  workspaceRoot={workspaceRoot}
                  onClose={requestCloseSegmentOverlay}
                  onModeChange={setSegmentOverlayMode}
                  onNoteTextChange={updateNoteText}
                  onSave={() => saveNote().then(Boolean)}
                />
              )}
            </FloatingSegmentPanel>
          </>
        ) : null}
      </div>
      <UnsavedSegmentChangesDialog
        busy={segmentCloseBusy}
        open={confirmSegmentCloseOpen}
        onCancel={() => setConfirmSegmentCloseOpen(false)}
        onDiscard={discardAndCloseSegmentOverlay}
        onSave={() => void saveAndCloseSegmentOverlay()}
      />
      <TranslationTaskDialog
        busy={translationBusy || translatingSegmentUid !== null}
        detail={translationDetail}
        message={translationMessage}
        open={translationTaskOpen}
        progress={translationJob?.progress ?? null}
        segments={segments}
        translation={translation}
        onOpenChange={setTranslationTaskOpen}
        onTranslate={async (selected, mode) => {
          await startTranslation('resume', {
            force: mode === 'force',
            segmentUids: selected.map((segment) => segment.uid),
          });
        }}
      />

    </div>
  );
}

function HiddenReflowSegmentsMenu({
  hiddenSegments,
  onRestoreAll,
  onRestoreSegment
}: {
  hiddenSegments: SourceSegment[];
  onRestoreAll: () => void;
  onRestoreSegment: (segmentUid: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          className="shrink-0"
          disabled={hiddenSegments.length === 0}
          size="sm"
          title="查看已隐藏的重排版元素"
          type="button"
          variant={hiddenSegments.length > 0 ? 'secondary' : 'outline'}
        >
          <ListRestart size={14} aria-hidden="true" />
          隐藏列表{hiddenSegments.length > 0 ? ` ${hiddenSegments.length}` : ''}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" side="bottom" sideOffset={8}>
        <div className="border-b px-3 py-2">
          <div className="text-sm font-semibold">隐藏的重排版元素</div>
          <div className="text-xs text-muted-foreground">点击恢复可重新显示对应元素。</div>
        </div>
        {hiddenSegments.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            当前没有隐藏元素。
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto p-1.5">
            {hiddenSegments.map((segment) => (
              <button
                className="grid w-full min-w-0 gap-1 rounded-md px-2 py-2 text-left hover:bg-muted"
                key={segment.uid}
                type="button"
                onClick={() => onRestoreSegment(segment.uid)}
              >
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">第 {segment.page_idx + 1} 页</span>
                  <span>{segment.segment_type}</span>
                  <span className="ml-auto shrink-0 text-primary">恢复</span>
                </div>
                <div className="line-clamp-2 text-sm text-foreground">
                  {segmentPreviewText(segment)}
                </div>
              </button>
            ))}
          </div>
        )}
        {hiddenSegments.length > 0 ? (
          <div className="border-t p-2">
            <Button className="w-full" size="sm" type="button" variant="outline" onClick={onRestoreAll}>
              全部恢复
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function segmentPreviewText(segment: SourceSegment) {
  return (segment.markdown ?? segment.text).replace(/\s+/g, ' ').trim() || segment.uid;
}

function hiddenSegmentsStorageKey(entryId: string) {
  return `${REFLOW_HIDDEN_SEGMENTS_STORAGE_KEY}.${entryId}`;
}

function readStoredHiddenSegmentUids(entryId: string) {
  if (typeof window === 'undefined') {
    return new Set<string>();
  }

  try {
    const raw = window.localStorage.getItem(hiddenSegmentsStorageKey(entryId));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((uid): uid is string => typeof uid === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

function persistHiddenSegmentUids(entryId: string, segmentUids: Set<string>) {
  if (typeof window === 'undefined') {
    return;
  }

  const key = hiddenSegmentsStorageKey(entryId);
  if (segmentUids.size === 0) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify([...segmentUids]));
}
