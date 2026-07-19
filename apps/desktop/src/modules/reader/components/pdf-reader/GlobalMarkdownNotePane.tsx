import { ChevronRight, Pin, PinOff } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { Button } from '@/components/ui/button';
import type { NoteDocument, SourceLink } from '@/shared/types/domain';

import { MarkdownNoteEditor } from '../../../notes/components/MarkdownNoteEditor';
import type { SourceLinkOpenTarget } from '../../../notes/editor/SourceLinkNode';
import { ReaderModeSwitch } from '../ReaderSurfacePrimitives';

export function GlobalMarkdownNotePane({
  entryId,
  entryTitle,
  fallbackTitle,
  annotationAvailable,
  segmentAvailable,
  pinned,
  copiedSourceLabel,
  noteId,
  noteRefreshKey,
  sourceLinkToInsert,
  noteImageToInsert,
  pdfDocument,
  workspaceRoot,
  onClose,
  onLoadNote,
  onModeChange,
  onOpenSourceLink,
  onCreateSourceLinkFromPaste,
  onNoteImageInserted,
  onInsertCopiedSource,
  onSaveNote,
  onSourceLinkInserted,
  onTogglePinned
}: {
  entryId: string;
  entryTitle: string;
  fallbackTitle: string;
  annotationAvailable: boolean;
  copiedSourceLabel: string | null;
  noteId: string;
  noteRefreshKey: number;
  pinned: boolean;
  segmentAvailable: boolean;
  sourceLinkToInsert: SourceLink | null;
  noteImageToInsert?: {
    alt?: string | null;
    id: string;
    markdownPath: string;
  } | null;
  pdfDocument?: PDFDocumentProxy | null;
  workspaceRoot: string | null;
  onClose: () => void;
  onLoadNote: () => Promise<NoteDocument>;
  onModeChange: (mode: 'segment' | 'annotation') => void;
  onOpenSourceLink: (target: SourceLinkOpenTarget) => void;
  onCreateSourceLinkFromPaste: (sourceEntryId: string, segmentUid: string) => Promise<SourceLink>;
  onNoteImageInserted?: (imageId: string) => void;
  onInsertCopiedSource: () => void;
  onSaveNote: (title: string, markdown: string) => Promise<NoteDocument>;
  onSourceLinkInserted: (link: SourceLink) => void;
  onTogglePinned: () => void;
}) {
  return (
    <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] border-l bg-white">
      <div className="border-b bg-muted/40 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{fallbackTitle}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {entryTitle}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon-xs"
              title={pinned ? '取消固定' : '固定右侧笔记'}
              type="button"
              variant={pinned ? 'secondary' : 'ghost'}
              onClick={onTogglePinned}
            >
              {pinned ? <PinOff size={13} aria-hidden="true" /> : <Pin size={13} aria-hidden="true" />}
            </Button>
            <Button
              size="icon-xs"
              title="关闭笔记"
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              <ChevronRight size={13} aria-hidden="true" />
            </Button>
          </div>
        </div>

        <ReaderModeSwitch
          className="mt-2"
          items={[
            { disabled: !segmentAvailable, label: '片段笔记', value: 'segment' },
            { disabled: !annotationAvailable, label: '批注', value: 'annotation' }
          ]}
          value={null}
          onValueChange={onModeChange}
        />
        {copiedSourceLabel ? (
          <div className="mt-2 flex min-w-0 items-center justify-between gap-2 rounded-md border bg-white px-2 py-1.5">
            <div className="min-w-0 truncate text-[11px] text-muted-foreground">
              待插入来源：{copiedSourceLabel}
            </div>
            <Button size="xs" type="button" variant="outline" onClick={onInsertCopiedSource}>
              插入
            </Button>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 min-w-0 overflow-hidden p-3">
        <MarkdownNoteEditor
          compact
          entryId={entryId}
          fallbackTitle={fallbackTitle}
          noteId={noteId}
          pdfDocument={pdfDocument ?? null}
          refreshKey={noteRefreshKey}
          sourceLinkToInsert={sourceLinkToInsert}
          noteImageToInsert={noteImageToInsert ?? null}
          workspaceRoot={workspaceRoot}
          onCreateSourceLinkFromPaste={onCreateSourceLinkFromPaste}
          onLoadNote={onLoadNote}
          onOpenSourceLink={onOpenSourceLink}
          onNoteImageInserted={onNoteImageInserted}
          onSaveNote={onSaveNote}
          onSourceLinkInserted={onSourceLinkInserted}
        />
      </div>
    </aside>
  );
}
