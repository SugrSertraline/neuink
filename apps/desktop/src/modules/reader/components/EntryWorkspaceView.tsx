import {
  FileText,
  Highlighter,
  Link2,
  ListTodo,
  LocateFixed,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useToast } from '@/shared/hooks/useToast';
import type { PdfReaderResponse } from '@/shared/ipc/workspaceApi';
import type { ReaderPreferences } from '@/shared/lib/readerPreferences';
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
  SourceLink,
  TagMeta,
  TrashItem
} from '@/shared/types/domain';
import { MarkdownNoteEditor } from '../../notes/components/MarkdownNoteEditor';
import type { SourceLinkOpenTarget } from '../../notes/editor/SourceLinkNode';
import { SegmentAnnotationEditor } from '../../annotations/components/SegmentAnnotationEditor';

import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import type {
  MarkdownNoteTarget,
  PdfJumpRequest,
  SidePaneState,
  SourceBacklink,
  SourceBacklinksBySegmentUid
} from '../types';
import { MineruPdfReader } from './MineruPdfReader';
import { EntryContentHeader } from './EntryContentHeader';
import { EntryOverview } from './EntryOverview';
import { TrashItemsView } from './TrashItemsView';
import {
  ReaderEmptyState,
  ReaderSurfaceBody,
  readerSelectableItemClass
} from './ReaderSurfacePrimitives';
import { SegmentNoteEditor } from './pdf-reader/SegmentNoteEditor';
import { logicalSegmentUid } from './pdf-reader/readerUtils';
import { usePdfBytes } from './pdf-reader/usePdfBytes';
import { usePdfDocument } from './pdf-reader/usePdfDocument';
import { ReflowEntryReader } from './reflow/ReflowEntryReader';
import {
  hasUnsavedSegmentEditors,
  registerSegmentEditorCloseHandler,
  setSegmentEditorDirty
} from './segmentEditorDirtyRegistry';

type EntryWorkspaceViewProps = {
  activeContentId: string | null;
  entry: LibraryEntry;
  standalone?: boolean;
  tabValue: string;
  workspaceRoot: string | null;
  markdownNoteRefreshById: Record<string, number>;
  pdfJumpRequest: PdfJumpRequest | null;
  pdfReaderReloadKey: number;
  segmentRecordReloadKey: number;
  pairedMarkdownNoteTarget: MarkdownNoteTarget | null;
  focusedSegmentUid?: string;
  initialRecordMode: 'note' | 'annotation';
  linkedSegment: {
    mode: 'note' | 'annotation';
    requestKey: number;
    segmentUid: string;
    source: 'pdf' | 'segment-notes' | 'reflow';
  } | null;
  segmentNotesLinkedToPdf: boolean;
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
  tags: TagMeta[];
  trashItems: TrashItem[];
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onApplyEntryTagPaths: (entryId: string, tagPaths: string[]) => Promise<unknown> | unknown;
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
  onReadMarkdownNote: (entryId: string, noteId: string) => Promise<NoteDocument>;
  onReadPdfReader: (entryId: string) => Promise<PdfReaderResponse>;
  onRetryPdfParse: (entryId: string) => Promise<void> | void;
  onCloseSidePane: () => void;
  onOpenSourceLink: (target: SourceLinkOpenTarget) => void;
  onOpenSourceBacklink: (backlink: SourceBacklink) => void;
  onOpenSegmentNotesSurface: (segmentUid: string, mode?: 'note' | 'annotation') => void;
  onOpenAnnotationsSurface: (segmentUid: string) => void;
  onShowAllSegmentNotes: () => void;
  onAddAssistantContext?: (
    context: AssistantContextInput,
    options?: AssistantContextAddOptions
  ) => void;
  onActiveSegmentChange?: (segment: AssistantActiveSegment | null) => void;
  onFocusLinkedSegment: (segmentUid: string, mode?: 'note' | 'annotation') => void;
  onSharedSegmentNoteDraftChange: (segmentUid: string, text: string | null) => void;
  onLocateSegmentInPdf: (segmentUid: string, pageIdx: number) => void;
  onConsumePendingSourceLinkInsertion: (entryId: string, noteId: string, linkId: string) => void;
  onConsumePendingNoteImageInsertion: (entryId: string, noteId: string, imageId: string) => void;
  onExportTranslationNote: (entryId: string, title: string, markdown: string) => Promise<void>;
  onQueuePendingSourceLinkInsertion: (entryId: string, noteId: string, link: SourceLink) => void;
  onQueuePendingNoteImageInsertion: (
    entryId: string,
    noteId: string,
    image: { alt?: string | null; id: string; markdownPath: string }
  ) => void;
  onToggleSidePanePinned: () => void;
  onSaveMarkdownNote: (entryId: string, noteId: string, title: string, markdown: string) => Promise<NoteDocument>;
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
  onEmptyEntryTrash: (entryId: string) => Promise<void> | void;
  onPurgeEntry: (entryId: string) => Promise<void> | void;
  onPurgeTrashItem: (entryId: string, trashId: string) => Promise<void> | void;
  onRestoreEntry: (entryId: string) => Promise<void> | void;
  onRestoreTrashItem: (entryId: string, trashId: string) => Promise<void> | void;
};

export function EntryWorkspaceView({
  activeContentId,
  entry,
  standalone = false,
  tabValue,
  workspaceRoot,
  markdownNoteRefreshById,
  pdfJumpRequest,
  pdfReaderReloadKey,
  segmentRecordReloadKey,
  pairedMarkdownNoteTarget,
  focusedSegmentUid,
  initialRecordMode,
  linkedSegment,
  segmentNotesLinkedToPdf,
  sharedSegmentNoteDrafts,
  pendingSourceLinkInsertion,
  pendingNoteImageInsertion,
  sourceBacklinksBySegmentUid,
  sidePane,
  sidePaneEntry,
  readerPreferences,
  tags,
  trashItems,
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
  onShowAllSegmentNotes,
  onAddAssistantContext,
  onActiveSegmentChange,
  onFocusLinkedSegment,
  onSharedSegmentNoteDraftChange,
  onLocateSegmentInPdf,
  onConsumePendingSourceLinkInsertion,
  onConsumePendingNoteImageInsertion,
  onExportTranslationNote,
  onQueuePendingSourceLinkInsertion,
  onQueuePendingNoteImageInsertion,
  onToggleSidePanePinned,
  onSaveMarkdownNote,
  onSaveSegmentNote,
  onDeleteSegmentNote,
  onSaveAnnotation,
  onDeleteAnnotation,
  onEmptyEntryTrash,
  onPurgeEntry,
  onPurgeTrashItem,
  onRestoreEntry,
  onRestoreTrashItem
}: EntryWorkspaceViewProps) {
  const note = activeContentId?.startsWith('note:')
    ? entry.contents.find((content) => content.kind === 'note' && `note:${content.note_id}` === activeContentId)
    : null;
  const noteRefreshKey = note ? (markdownNoteRefreshById[`${entry.id}:${note.note_id}`] ?? 0) : 0;
  const pendingSourceLinkForCurrentNote =
    note &&
    pendingSourceLinkInsertion?.entryId === entry.id &&
    pendingSourceLinkInsertion.noteId === note.note_id
      ? pendingSourceLinkInsertion.link
      : null;
  const pendingNoteImageForCurrentNote =
    note &&
    pendingNoteImageInsertion?.entryId === entry.id &&
    pendingNoteImageInsertion.noteId === note.note_id
      ? pendingNoteImageInsertion
      : null;
  const [readerData, setReaderData] = useState<PdfReaderResponse | null>(null);
  const recordPdfBytes = usePdfBytes(
    activeContentId === 'segment-notes' ? readerData?.pdf_path ?? null : null
  );
  const recordPdfState = usePdfDocument(
    recordPdfBytes.status === 'ready' ? recordPdfBytes.bytes : null
  );
  useEffect(() => {
    if (activeContentId !== 'segment-notes' || !entry.pdfFileName) {
      return;
    }
    let cancelled = false;
    void onReadPdfReader(entry.id).then((data) => {
      if (!cancelled) setReaderData(data);
    }).catch(() => {
      if (!cancelled) setReaderData(null);
    });
    return () => { cancelled = true; };
  }, [
    activeContentId,
    entry.id,
    entry.pdfFileName,
    onReadPdfReader,
    pdfReaderReloadKey,
    segmentRecordReloadKey
  ]);

  const content = (
      <div className="grid h-full min-h-0 min-w-0 gap-3">
        <Card className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] rounded-none py-0">
          <CardContent className="min-h-0 min-w-0 overflow-hidden p-0">
            {entry.pdfFileName && activeContentId === 'pdf' ? (
              <div className={cn('size-full min-h-0 min-w-0')}>
                <MineruPdfReader
                  entry={entry}
                  editorScopeKey={tabValue}
                  workspaceRoot={workspaceRoot}
                  markdownNoteRefreshById={markdownNoteRefreshById}
                  jumpRequest={pdfJumpRequest}
                  recordReloadKey={segmentRecordReloadKey}
                  reloadKey={pdfReaderReloadKey}
                  pairedMarkdownNoteTarget={pairedMarkdownNoteTarget}
                  sharedSegmentNoteDrafts={sharedSegmentNoteDrafts}
	                  pendingSourceLinkInsertion={pendingSourceLinkInsertion}
	                  pendingNoteImageInsertion={pendingNoteImageInsertion}
	                  sourceBacklinksBySegmentUid={sourceBacklinksBySegmentUid}
	                  sidePane={sidePane}
                  sidePaneEntry={sidePaneEntry}
                  readerPreferences={readerPreferences}
                  onReaderPreferencesChange={onReaderPreferencesChange}
                  onApplyEntryTagPaths={onApplyEntryTagPaths}
                  onCreateMarkdownSourceLink={onCreateMarkdownSourceLink}
                  onImportMarkdownNoteSegmentAsset={onImportMarkdownNoteSegmentAsset}
                  onReadMarkdownNote={onReadMarkdownNote}
                  onReadPdfReader={onReadPdfReader}
                  onRetryPdfParse={onRetryPdfParse}
	                  onCloseSidePane={onCloseSidePane}
	                  onOpenSourceLink={onOpenSourceLink}
                  onOpenSourceBacklink={onOpenSourceBacklink}
                  onOpenSegmentNotesSurface={onOpenSegmentNotesSurface}
                  onOpenAnnotationsSurface={onOpenAnnotationsSurface}
	                  onAddAssistantContext={onAddAssistantContext}
                  onActiveSegmentChange={onActiveSegmentChange}
                  onConsumePendingSourceLinkInsertion={onConsumePendingSourceLinkInsertion}
                  onConsumePendingNoteImageInsertion={onConsumePendingNoteImageInsertion}
                  onDeleteAnnotation={onDeleteAnnotation}
                  onExportTranslationNote={onExportTranslationNote}
                  onQueuePendingSourceLinkInsertion={onQueuePendingSourceLinkInsertion}
                  onQueuePendingNoteImageInsertion={onQueuePendingNoteImageInsertion}
                  onToggleSidePanePinned={onToggleSidePanePinned}
                  onSaveMarkdownNote={onSaveMarkdownNote}
                  onSaveAnnotation={onSaveAnnotation}
                  onSaveSegmentNote={onSaveSegmentNote}
                  onSharedSegmentNoteDraftChange={onSharedSegmentNoteDraftChange}
                />
              </div>
            ) : null}
            {entry.pdfFileName && activeContentId === 'reflow' ? (
              <div className="size-full min-h-0 min-w-0">
                <ReflowEntryReader
                  entry={entry}
                  editorScopeKey={tabValue}
                  pairedMarkdownNoteTarget={pairedMarkdownNoteTarget}
                  readerPreferences={readerPreferences}
                  sourceBacklinksBySegmentUid={sourceBacklinksBySegmentUid}
                  onDeleteAnnotation={onDeleteAnnotation}
                  onCreateMarkdownSourceLink={onCreateMarkdownSourceLink}
                  onQueuePendingSourceLinkInsertion={onQueuePendingSourceLinkInsertion}
                  onOpenSourceBacklink={onOpenSourceBacklink}
                  onAddAssistantContext={onAddAssistantContext}
                  onSaveAnnotation={onSaveAnnotation}
                  onExportTranslationNote={onExportTranslationNote}
                  onReaderPreferencesChange={onReaderPreferencesChange}
                  workspaceRoot={workspaceRoot}
                  onReadPdfReader={onReadPdfReader}
                  onOpenSegmentNotesSurface={onOpenSegmentNotesSurface}
                  onOpenAnnotationsSurface={onOpenAnnotationsSurface}
                  onSaveSegmentNote={onSaveSegmentNote}
                />
              </div>
            ) : null}
            {note ? (
              <div className="size-full min-h-0 overflow-auto">
                <MarkdownNoteEditor
                  entryId={entry.id}
                  entryTitle={entry.title}
                  fallbackTitle={note.title}
                  noteId={note.note_id}
                  refreshKey={noteRefreshKey}
                  sourceLinkToInsert={pendingSourceLinkForCurrentNote}
                  noteImageToInsert={pendingNoteImageForCurrentNote}
                  workspaceRoot={workspaceRoot}
                  onCreateSourceLinkFromPaste={(sourceEntryId, segmentUid) =>
                    onCreateMarkdownSourceLink(entry.id, note.note_id, sourceEntryId, segmentUid)
                  }
                  onLoadNote={() => onReadMarkdownNote(entry.id, note.note_id)}
                  onOpenSourceLink={onOpenSourceLink}
                  onNoteImageInserted={(imageId) =>
                    onConsumePendingNoteImageInsertion(entry.id, note.note_id, imageId)
                  }
                  onSaveNote={(title, markdown) =>
                    onSaveMarkdownNote(entry.id, note.note_id, title, markdown)
                  }
                  onSourceLinkInserted={(link) =>
                    onConsumePendingSourceLinkInsertion(entry.id, note.note_id, link.link_id)
                  }
                />
              </div>
            ) : null}
            {activeContentId === 'overview' ? (
              <EntryOverview
                entry={entry}
                sourceBacklinksBySegmentUid={sourceBacklinksBySegmentUid}
                tags={tags}
              />
            ) : null}
            {activeContentId === 'segment-notes' ? (
              <SegmentNotesOverview
                entry={entry}
                editorScopeKey={tabValue}
                focusedSegmentUid={focusedSegmentUid}
                initialMode={initialRecordMode}
                linkedSegment={linkedSegment}
                linkedToPdf={segmentNotesLinkedToPdf}
                pdfDocument={recordPdfState.status === 'ready' ? recordPdfState.document : null}
                readerData={readerData}
                sharedDrafts={sharedSegmentNoteDrafts}
                workspaceRoot={workspaceRoot}
                onFocusSegment={onFocusLinkedSegment}
                onLocateSegment={onLocateSegmentInPdf}
                onDeleteAnnotation={onDeleteAnnotation}
                onSaveSegmentNote={onSaveSegmentNote}
                onDeleteSegmentNote={onDeleteSegmentNote}
                onSaveAnnotation={onSaveAnnotation}
                onSharedDraftChange={onSharedSegmentNoteDraftChange}
              />
            ) : null}
            {activeContentId === 'entry-trash' ? (
              <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
                <EntryContentHeader contentTitle="回收站" entryTitle={entry.title} />
                <div className="min-h-0 overflow-auto p-3">
                  <TrashItemsView
                    items={trashItems}
                    showEntry={false}
                    onEmpty={() => onEmptyEntryTrash(entry.id)}
                    onPurgeEntry={onPurgeEntry}
                    onPurgeItem={onPurgeTrashItem}
                    onRestoreEntry={onRestoreEntry}
                    onRestoreItem={onRestoreTrashItem}
                  />
                </div>
              </div>
            ) : null}
            {!activeContentId || (!note && !['pdf', 'reflow', 'overview', 'segment-notes', 'entry-trash'].includes(activeContentId)) ? (
              <div className="p-4">
                <EmptyWorkspace entry={entry} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
  );

  if (standalone) {
    return content;
  }

  return (
    <TabsContent className="m-0 h-full min-h-0 min-w-0" forceMount value={tabValue}>
      {content}
    </TabsContent>
  );
}

function SegmentNotesOverview({
  entry,
  editorScopeKey,
  focusedSegmentUid,
  initialMode,
  linkedSegment,
  linkedToPdf,
  pdfDocument,
  readerData,
  sharedDrafts,
  workspaceRoot,
  onFocusSegment,
  onLocateSegment,
  onDeleteAnnotation,
  onSaveAnnotation,
  onSaveSegmentNote,
  onDeleteSegmentNote,
  onSharedDraftChange
}: {
  entry: LibraryEntry;
  editorScopeKey: string;
  focusedSegmentUid?: string;
  initialMode: 'note' | 'annotation';
  linkedSegment: EntryWorkspaceViewProps['linkedSegment'];
  linkedToPdf: boolean;
  pdfDocument: import('pdfjs-dist').PDFDocumentProxy | null;
  readerData: PdfReaderResponse | null;
  sharedDrafts: Record<string, string>;
  workspaceRoot: string | null;
  onFocusSegment: (segmentUid: string, mode?: 'note' | 'annotation') => void;
  onLocateSegment: (segmentUid: string, pageIdx: number) => void;
  onDeleteAnnotation: (entryId: string, annotationId: AnnotationId) => Promise<Annotation[]>;
  onSaveAnnotation: (entryId: string, annotation: {
    annotationId?: AnnotationId | null;
    content: string;
    importance: AnnotationImportance;
    kind: string;
    segmentUid: string;
    textSelection?: AnnotationTextSelection | null;
  }) => Promise<Annotation[]>;
  onSaveSegmentNote: (
    entryId: string,
    segmentUid: string,
    text: string
  ) => Promise<SegmentBlockNote[]>;
  onDeleteSegmentNote: (entryId: string, segmentUid: string) => Promise<SegmentBlockNote[]>;
  onSharedDraftChange: (segmentUid: string, text: string | null) => void;
}) {
  const { notify } = useToast();
  const noteDraftOwnerId = `segment-record-note:${useId()}`;
  const notes = useMemo(() => readerData?.segment_notes ?? [], [readerData?.segment_notes]);
  const sourceSegments = useMemo(() => readerData?.segments ?? [], [readerData?.segments]);
  const sourceAnnotations = useMemo(() => readerData?.annotations ?? [], [readerData?.annotations]);
  const [followPdf, setFollowPdf] = useState(true);
  const [recordListCollapsed, setRecordListCollapsed] = useState(false);
  const [recordFilter, setRecordFilter] = useState<'all' | 'note' | 'annotation' | 'highlight'>(
    initialMode === 'annotation' ? 'annotation' : 'all'
  );
  const [detailMode, setDetailMode] = useState<'note' | 'annotation'>(
    linkedSegment?.mode ?? initialMode
  );
  const [annotations, setAnnotations] = useState(sourceAnnotations);
  const [annotationBusy, setAnnotationBusy] = useState(false);
  const [selectedSegmentUid, setSelectedSegmentUid] = useState<string | null>(
    linkedSegment?.segmentUid ?? focusedSegmentUid ?? null
  );
  const [pendingSegmentUid, setPendingSegmentUid] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [baseline, setBaseline] = useState('');
  const [busy, setBusy] = useState(false);
  const lastSharedDraftRef = useRef<{ segmentUid: string; text: string | undefined } | null>(null);

  const segmentByUid = useMemo(() => {
    const next = new Map<string, (typeof sourceSegments)[number]>();
    for (const segment of sourceSegments) {
      next.set(segment.uid, segment);
      if (!next.has(logicalSegmentUid(segment))) {
        next.set(logicalSegmentUid(segment), segment);
      }
    }
    return next;
  }, [sourceSegments]);
  const noteBySegmentUid = useMemo(
    () => new Map(notes.map((note) => [note.segment_uid, note])),
    [notes]
  );
  const recordItems = useMemo(() => {
    const records = new Map<string, {
      annotations: Annotation[];
      logicalUid: string;
      note: SegmentBlockNote | null;
      segment: (typeof sourceSegments)[number] | null;
    }>();
    const ensureRecord = (segmentUid: string) => {
      const segment = segmentByUid.get(segmentUid) ?? null;
      const logicalUid = segment ? logicalSegmentUid(segment) : segmentUid;
      const current = records.get(logicalUid) ?? {
        annotations: [],
        logicalUid,
        note: null,
        segment
      };
      if (!current.segment && segment) current.segment = segment;
      records.set(logicalUid, current);
      return current;
    };
    for (const note of notes) ensureRecord(note.segment_uid).note = note;
    for (const annotation of annotations) ensureRecord(annotation.segment_uid).annotations.push(annotation);
    return Array.from(records.values())
      .filter((record) => {
        if (recordFilter === 'note') return Boolean(record.note);
        if (recordFilter === 'annotation') return record.annotations.length > 0;
        if (recordFilter === 'highlight') {
          return record.annotations.some((annotation) => annotation.kind === 'highlight');
        }
        return true;
      })
      .sort((left, right) =>
        (left.segment?.page_idx ?? Number.MAX_SAFE_INTEGER) -
        (right.segment?.page_idx ?? Number.MAX_SAFE_INTEGER)
      );
  }, [annotations, notes, recordFilter, segmentByUid, sourceSegments]);
  const selectedSegment = selectedSegmentUid ? segmentByUid.get(selectedSegmentUid) ?? null : null;
  const selectedLogicalUid = selectedSegment
    ? logicalSegmentUid(selectedSegment)
    : selectedSegmentUid;
  const dirty = draft !== baseline;
  const selectedRelatedSegmentUids = useMemo(
    () => selectedLogicalUid
      ? sourceSegments
          .filter((segment) => logicalSegmentUid(segment) === selectedLogicalUid)
          .map((segment) => segment.uid)
      : [],
    [selectedLogicalUid, sourceSegments]
  );
  const selectedAnnotations = selectedSegment
    ? annotations.filter((annotation) => selectedRelatedSegmentUids.includes(annotation.segment_uid))
    : [];

  useEffect(() => setAnnotations(sourceAnnotations), [sourceAnnotations]);
  useEffect(() => {
    const nextMode = linkedSegment?.mode ?? initialMode;
    setDetailMode(nextMode);
    if (nextMode === 'annotation' && initialMode === 'annotation') {
      setRecordFilter('annotation');
    }
  }, [initialMode, linkedSegment?.mode, linkedSegment?.requestKey]);

  const applySelection = (segmentUid: string) => {
    const segment = segmentByUid.get(segmentUid) ?? null;
    const logicalUid = segment ? logicalSegmentUid(segment) : segmentUid;
    const savedText = noteBySegmentUid.get(logicalUid)?.text ?? '';
    const nextDraft = sharedDrafts[logicalUid] ?? savedText;
    lastSharedDraftRef.current = { segmentUid: logicalUid, text: sharedDrafts[logicalUid] };
    setSelectedSegmentUid(segment?.uid ?? segmentUid);
    setDraft(nextDraft);
    setBaseline(savedText);
    setPendingSegmentUid(null);
  };

  const requestSelection = (segmentUid: string, locate = false) => {
    const segment = segmentByUid.get(segmentUid) ?? null;
    const nextUid = segment?.uid ?? segmentUid;
    if (
      selectedSegmentUid !== nextUid &&
      hasUnsavedSegmentEditors(editorScopeKey)
    ) {
      notify({
        tone: 'default',
        title: '当前修改尚未保存',
        description: '请先保存或取消当前编辑，再切换片段。'
      });
      return;
    }
    if (dirty && selectedSegmentUid !== nextUid) {
      setPendingSegmentUid(nextUid);
      return;
    }
    applySelection(nextUid);
    onFocusSegment(nextUid, detailMode);
    if (locate && segment) {
      onLocateSegment(segment.uid, segment.page_idx);
    }
  };

  const externalSegmentUid = linkedSegment?.segmentUid ?? focusedSegmentUid ?? null;
  useEffect(() => {
    if (!externalSegmentUid || !followPdf) {
      return;
    }
    const segment = segmentByUid.get(externalSegmentUid) ?? null;
    const nextUid = segment?.uid ?? externalSegmentUid;
    if (selectedSegmentUid === nextUid) {
      return;
    }
    if (hasUnsavedSegmentEditors(editorScopeKey)) {
      return;
    }
    if (dirty) {
      setPendingSegmentUid(nextUid);
      return;
    }
    applySelection(nextUid);
  }, [externalSegmentUid, followPdf, linkedSegment?.requestKey, segmentByUid]);

  useEffect(() => {
    if (selectedSegmentUid || recordItems.length === 0) {
      return;
    }
    const firstSegmentUid = recordItems[0].segment?.uid ?? recordItems[0].logicalUid;
    applySelection(firstSegmentUid);
  }, [recordItems, selectedSegmentUid]);

  useEffect(() => {
    if (!selectedLogicalUid || busy) {
      return;
    }
    const savedText = noteBySegmentUid.get(selectedLogicalUid)?.text ?? '';
    if (savedText === draft) {
      setBaseline(savedText);
      return;
    }
    if (!dirty) {
      setDraft(sharedDrafts[selectedLogicalUid] ?? savedText);
      setBaseline(savedText);
    }
  }, [busy, draft, dirty, noteBySegmentUid, selectedLogicalUid, sharedDrafts]);

  useEffect(() => {
    if (!selectedLogicalUid) {
      return;
    }
    const sharedDraft = sharedDrafts[selectedLogicalUid];
    if (
      lastSharedDraftRef.current?.segmentUid === selectedLogicalUid &&
      lastSharedDraftRef.current.text === sharedDraft
    ) {
      return;
    }
    lastSharedDraftRef.current = { segmentUid: selectedLogicalUid, text: sharedDraft };
    if (sharedDraft !== undefined && sharedDraft !== draft && !busy) {
      setDraft(sharedDraft);
    }
  }, [busy, draft, selectedLogicalUid, sharedDrafts]);

  const save = async () => {
    if (!selectedLogicalUid || busy) return false;
    if (!dirty) return true;
    setBusy(true);
    try {
      await onSaveSegmentNote(entry.id, selectedLogicalUid, draft);
      setBaseline(draft);
      onSharedDraftChange(selectedLogicalUid, null);
      notify({ tone: 'success', title: '已保存', description: '片段笔记已更新' });
      return true;
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '保存失败',
        description: caught instanceof Error ? caught.message : undefined
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const discardDraft = () => {
    if (selectedLogicalUid) {
      onSharedDraftChange(selectedLogicalUid, null);
    }
    setDraft(baseline);
  };

  const deleteNote = async () => {
    if (!selectedLogicalUid || busy || !noteBySegmentUid.has(selectedLogicalUid)) {
      return false;
    }
    setBusy(true);
    try {
      await onDeleteSegmentNote(entry.id, selectedLogicalUid);
      setDraft('');
      setBaseline('');
      onSharedDraftChange(selectedLogicalUid, null);
      notify({ tone: 'success', title: '已删除', description: '片段笔记已删除' });
      return true;
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '删除失败',
        description: caught instanceof Error ? caught.message : undefined
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setSegmentEditorDirty(editorScopeKey, noteDraftOwnerId, dirty);
    return () => setSegmentEditorDirty(editorScopeKey, noteDraftOwnerId, false);
  }, [dirty, editorScopeKey, noteDraftOwnerId]);

  useEffect(() => registerSegmentEditorCloseHandler(
    editorScopeKey,
    noteDraftOwnerId,
    { discard: discardDraft, save }
  ), [discardDraft, editorScopeKey, noteDraftOwnerId, save]);

  const locateSelectedSegment = () => {
    if (!selectedSegment) return;
    onFocusSegment(selectedSegment.uid, detailMode);
    onLocateSegment(selectedSegment.uid, selectedSegment.page_idx);
  };

  const changeDetailMode = (mode: 'note' | 'annotation') => {
    setDetailMode(mode);
    if (selectedSegment) {
      onFocusSegment(selectedSegment.uid, mode);
    }
  };

  const saveAnnotation = async (annotation: {
    annotationId?: AnnotationId | null;
    content: string;
    importance: AnnotationImportance;
    kind: string;
    segmentUid: string;
  }) => {
    setAnnotationBusy(true);
    try {
      setAnnotations(await onSaveAnnotation(entry.id, annotation));
      return true;
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '保存批注失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
      return false;
    } finally {
      setAnnotationBusy(false);
    }
  };

  const deleteAnnotation = async (annotationId: AnnotationId) => {
    setAnnotationBusy(true);
    try {
      setAnnotations(await onDeleteAnnotation(entry.id, annotationId));
      notify({ tone: 'success', title: '已删除', description: '批注已删除' });
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '删除批注失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
    } finally {
      setAnnotationBusy(false);
    }
  };

  const saveAndFollowPending = async () => {
    if (!pendingSegmentUid) return;
    const nextSegmentUid = pendingSegmentUid;
    if (await save()) {
      applySelection(nextSegmentUid);
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden">
      <EntryContentHeader contentTitle="片段记录" entryTitle={entry.title}>
        <Badge variant="outline">笔记 {notes.length}</Badge>
        <Badge variant="outline">批注 {annotations.length}</Badge>
        <Badge className="gap-1" variant={linkedToPdf ? 'secondary' : 'outline'}>
          <Link2 size={12} aria-hidden="true" />
          {linkedToPdf ? '已与 PDF 联动' : '未联动'}
        </Badge>
        <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Switch
            aria-label="跟随 PDF 当前片段"
            checked={followPdf}
            onCheckedChange={setFollowPdf}
          />
          跟随 PDF
        </label>
        <Button
          disabled={!selectedSegment}
          size="sm"
          type="button"
          variant={linkedToPdf ? 'outline' : 'default'}
          onClick={locateSelectedSegment}
        >
          <LocateFixed size={14} aria-hidden="true" />
          {linkedToPdf ? '定位原文' : '在 PDF 中打开'}
        </Button>
      </EntryContentHeader>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-b bg-muted/15 px-3 py-2">
        <Button
          aria-label={recordListCollapsed ? '展开片段列表' : '折叠片段列表'}
          size="xs"
          title={recordListCollapsed ? '展开片段列表' : '折叠片段列表'}
          type="button"
          variant="ghost"
          onClick={() => setRecordListCollapsed((current) => !current)}
        >
          {recordListCollapsed ? (
            <PanelLeftOpen size={14} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={14} aria-hidden="true" />
          )}
          {recordListCollapsed ? '展开列表' : '收起列表'}
        </Button>
        {([
          ['all', '全部'],
          ['note', '有笔记'],
          ['annotation', '有批注'],
          ['highlight', '仅高亮']
        ] as const).map(([value, label]) => (
          <Button
            key={value}
            size="xs"
            type="button"
            variant={recordFilter === value ? 'secondary' : 'ghost'}
            onClick={() => setRecordFilter(value)}
          >
            {value === 'highlight' ? <Highlighter size={13} aria-hidden="true" /> : null}
            {label}
          </Button>
        ))}
      </div>

      {!readerData ? (
        <ReaderSurfaceBody>
          <div className="text-sm text-muted-foreground">正在读取片段记录…</div>
        </ReaderSurfaceBody>
      ) : notes.length === 0 && annotations.length === 0 && !selectedSegment ? (
        <ReaderSurfaceBody>
          <ReaderEmptyState
            description="请在 PDF 或重排视图中选择原文片段后创建笔记、批注或高亮。"
            icon={ListTodo}
            title="暂无片段记录"
          />
        </ReaderSurfaceBody>
      ) : (
        <div
          className={cn(
            'grid h-full min-h-0 min-w-0 overflow-hidden border-t',
            recordListCollapsed
              ? 'grid-cols-1 grid-rows-1'
              : 'grid-cols-1 grid-rows-[minmax(180px,0.75fr)_minmax(320px,1.25fr)] md:grid-cols-[minmax(220px,0.72fr)_minmax(340px,1.28fr)] md:grid-rows-1'
          )}
        >
          {!recordListCollapsed ? (
            <aside className="min-h-0 min-w-0 overflow-y-auto border-b bg-muted/15 p-2 md:border-b-0 md:border-r">
              <div className="grid gap-2">
                {recordItems.map(({ annotations: itemAnnotations, logicalUid, note, segment }) => {
                  const itemUid = segment?.uid ?? logicalUid;
                  const active = selectedSegment
                    ? logicalSegmentUid(selectedSegment) === logicalUid
                    : selectedSegmentUid === itemUid;
                  const sourceText = segment?.markdown ?? segment?.text ?? '';
                  return (
                    <button
                      className={cn(
                        readerSelectableItemClass,
                        'px-3 py-2.5',
                        active && 'border-primary/40 bg-primary/5 ring-1 ring-primary/15'
                      )}
                      key={logicalUid}
                      type="button"
                      onClick={() => requestSelection(itemUid, linkedToPdf)}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {segment ? `第 ${segment.page_idx + 1} 页 · 原文片段` : '原文片段'}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          {note ? <FileText className="text-primary" size={14} /> : null}
                          {itemAnnotations.length > 0 ? (
                            <MessageSquareText className="text-amber-600" size={14} />
                          ) : null}
                        </div>
                      </div>
                      {sourceText ? (
                        <div className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {sourceText}
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
                        {note ? <Badge variant="secondary">笔记</Badge> : null}
                        {itemAnnotations.length > 0 ? (
                          <Badge variant="outline">批注 {itemAnnotations.length}</Badge>
                        ) : null}
                        {itemAnnotations.some((annotation) => annotation.kind === 'highlight') ? (
                          <Badge variant="outline">高亮</Badge>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>
          ) : null}

          <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
            {pendingSegmentUid ? (
              <div className="absolute inset-x-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-950 shadow-sm">
                <span className="min-w-0 flex-1">PDF 已定位到另一个片段，当前笔记还有未保存内容。</span>
                <Button size="xs" type="button" variant="outline" onClick={() => setPendingSegmentUid(null)}>
                  保持当前
                </Button>
                <Button disabled={busy} size="xs" type="button" onClick={() => void saveAndFollowPending()}>
                  保存并跟随
                </Button>
              </div>
            ) : null}
            {detailMode === 'annotation' ? (
              <SegmentAnnotationEditor
                annotations={annotations}
                busy={annotationBusy}
                className="h-full border-l-0"
                draftScopeKey={editorScopeKey}
                pdfDocument={pdfDocument}
                relatedSegmentUids={selectedRelatedSegmentUids}
                segment={selectedSegment}
                segments={sourceSegments}
                selectedAnnotationId={null}
                showCloseButton={false}
                sourceInitiallyExpanded
                sourceEntryId={entry.id}
                workspaceRoot={workspaceRoot}
                onClose={() => undefined}
                onDelete={(annotationId) => void deleteAnnotation(annotationId)}
                onModeChange={(mode) => changeDetailMode(mode === 'segment' ? 'note' : 'annotation')}
                onSave={(annotation) => void saveAnnotation(annotation)}
              />
            ) : (
              <SegmentNoteEditor
                annotationCount={selectedAnnotations.length}
                busy={busy}
                className="h-full border-l-0"
                dirty={dirty}
                noteText={draft}
                pdfDocument={pdfDocument}
                segment={selectedSegment}
                showCloseButton={false}
                sourceInitiallyExpanded
                highlightSelections={selectedAnnotations.flatMap((annotation) =>
                  annotation.text_selection ? [annotation.text_selection] : []
                )}
                sourceEntryId={entry.id}
                workspaceRoot={workspaceRoot}
                onClose={() => undefined}
                onModeChange={(mode) => changeDetailMode(mode === 'segment' ? 'note' : 'annotation')}
                onNoteTextChange={(value) => {
                  setDraft(value);
                  if (selectedLogicalUid) {
                    onSharedDraftChange(selectedLogicalUid, value);
                  }
                }}
                onSave={() => void save()}
                onDelete={noteBySegmentUid.has(selectedLogicalUid ?? '') ? deleteNote : undefined}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyWorkspace({ entry }: { entry: LibraryEntry }) {
  return (
    <div className="grid min-h-[520px] place-items-center rounded-md border bg-muted/20 text-center text-sm text-muted-foreground">
      <div className="grid gap-2">
        <Badge variant="outline">{entry.contents.length} 篇笔记</Badge>
        从资源管理器中选择 PDF 或笔记文件。
      </div>
    </div>
  );
}
