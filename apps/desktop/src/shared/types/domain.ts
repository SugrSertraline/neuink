export type EntryId = string;
export type NoteId = string;
export type TagId = string;
export type AnnotationId = string;

export type EntryMeta = {
  id: EntryId;
  title: string;
  tags: TagId[];
  fields: Record<string, string>;
  pdf: PdfAsset | null;
  contents: ContentItem[];
  created_at: string;
  updated_at: string;
};

export type TagMeta = {
  description?: string;
  id: TagId;
  name: string;
  parent_id: TagId | null;
  created_at: string;
  updated_at: string;
};

export type PdfAsset = {
  file_name: string;
  content_hash: string;
  imported_at: string;
  parse: PdfParseState;
};

export type PdfParseState = {
  status: PdfParseStatus;
  updated_at: string;
  message: string | null;
  task_id: string | null;
  endpoint: string | null;
};

export type PdfParseStatus =
  | 'not_started'
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'parsing'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export type ReadingMode = 'pdf' | 'reflow';

export type EntryReadingState = {
  entry_id: EntryId;
  version: number;
  document_hash: string | null;
  mode: ReadingMode;
  current_page_idx: number | null;
  page_count: number;
  visited_pages: number[];
  total_active_ms: number;
  session_count: number;
  last_read_at: string | null;
  daily_active_ms: Record<string, number>;
};

export type ReadingStateUpdate = {
  mode: ReadingMode;
  current_page_idx: number | null;
  page_count: number;
  visited_pages: number[];
  active_ms_delta: number;
  session_start: boolean;
  local_date: string | null;
};

export type ContentItem = {
  kind: 'note';
  note_id: NoteId;
  title: string;
};

export type NoteOwner = { kind: 'entry'; entry_id: string } | { kind: 'tag_reading'; tag_id: string };
export type NoteTarget = { owner: NoteOwner; note_id: string };

export type NoteDocument = {
  note_id: NoteId;
  title: string;
  markdown: string;
  links: SourceLink[];
  revision: string;
};

export type SourceLink = {
  link_id: string;
  anchor_id: string;
  owner: {
    kind: 'note';
    entry_id: EntryId;
    note_id: NoteId;
  } | { kind: 'tag_note'; tag_id: string; note_id: NoteId };
  sources: SegmentRef[];
  display_text: string;
  created_at: string;
};

export type SegmentRef = {
  entry_id: EntryId;
  segment_uid: string;
  page: number;
  bbox?: [number, number, number, number] | null;
  segment_type?: SegmentType | null;
  snapshot_text: string;
  snapshot_asset_path?: string | null;
  quote_hash: string;
};

export type TrashItemKind =
  | 'entry'
  | 'markdown_note'
  | 'segment_note'
  | 'annotation'
  | 'highlight';

export type TrashItem = {
  trash_id: string;
  entry_id: EntryId;
  entry_title: string;
  kind: TrashItemKind;
  item_id: string;
  title: string;
  preview: string;
  deleted_at: string;
  parent_entry_trashed: boolean;
  restorable: boolean;
  stored_trash_item: boolean;
};

export type SourceSegment = {
  uid: string;
  segment_type: SegmentType;
  page_idx: number;
  bbox: [number, number, number, number] | null;
  text: string;
  markdown: string | null;
  asset_path?: string | null;
  raw_type?: string | null;
  sub_type?: string | null;
  block_role?: string | null;
  mineru_metadata?: Record<string, string>;
  continuation_group_id?: string | null;
  visual_group_id?: string | null;
};

export type SegmentBlockNote = {
  segment_uid: string;
  text: string;
  created_at: string;
  updated_at: string;
};

export type AnnotationImportance = 'core' | 'important' | 'normal';

export type AnnotationHighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export type AnnotationTextSelection = {
  color: AnnotationHighlightColor;
  page_idx: number;
  rects: Array<[number, number, number, number]>;
  text: string;
};

export type AnnotationSegmentSnapshot = {
  asset_path?: string | null;
  bbox?: [number, number, number, number] | null;
  markdown?: string | null;
  page_idx: number;
  segment_type: SegmentType;
  segment_uid: string;
  text: string;
};

export type Annotation = {
  annotation_id: AnnotationId;
  segment_uid: string;
  anchor_kind?: 'segment' | 'pdf_page';
  kind: string;
  content: string;
  importance: AnnotationImportance;
  segment_snapshot?: AnnotationSegmentSnapshot | null;
  text_selection?: AnnotationTextSelection | null;
  created_at: string;
  updated_at: string;
};

export type SegmentType =
  | 'paragraph'
  | 'heading'
  | 'table'
  | 'math'
  | 'figure'
  | 'code'
  | 'list'
  | 'page_header'
  | 'page_footer'
  | 'page_number'
  | 'aside_text'
  | 'page_footnote';
