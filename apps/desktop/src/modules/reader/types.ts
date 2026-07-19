export type PdfJumpRequest = {
  kind: 'annotation';
  annotationId: string;
  segmentUid: string;
  pageIdx: number;
  requestKey: number;
} | {
  kind: 'segment';
  segmentUid: string;
  pageIdx: number;
  requestKey: number;
} | {
  kind: 'page';
  pageIdx: number;
  requestKey: number;
};

export type SidePaneTarget = {
  kind: 'markdown-note';
  entryId: string;
  noteId: string;
};

export type SidePaneState = {
  pinned: boolean;
  requestKey: number;
  target: SidePaneTarget | null;
};

export type SourceClipboardItem = {
  pageIdx: number;
  segmentUid: string;
  sourceEntryId: string;
  sourceEntryTitle: string;
  snapshotText: string;
};

export type SourceBacklink = {
  anchorId: string;
  displayText: string;
  linkId: string;
  noteEntryId: string;
  noteEntryTitle: string;
  noteId: string;
  noteTitle: string;
  sourceEntryId: string;
  segmentUid: string;
};

export type SourceBacklinksBySegmentUid = Record<string, SourceBacklink[]>;

export type MarkdownNoteTarget = {
  entryId: string;
  entryTitle: string;
  noteId: string;
  noteTitle: string;
};
