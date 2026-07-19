import { invoke } from '@tauri-apps/api/core';

import type {
  EntryId,
  Annotation,
  AnnotationId,
  AnnotationImportance,
  AnnotationTextSelection,
  EntryMeta,
  NoteDocument,
  NoteId,
  SegmentBlockNote,
  SourceLink,
  SourceSegment,
  TrashItem,
  TagId,
  TagMeta
} from '../types/domain';
import type { AssistantEntryMetaProposal } from '../types/assistant';

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export type SearchTarget =
  | {
      kind: 'entry';
      entry_id: EntryId;
    }
  | {
      kind: 'note';
      entry_id: EntryId;
      note_id: NoteId;
    }
  | {
      kind: 'page';
      entry_id: EntryId;
      page_idx: number;
    }
  | {
      kind: 'segment';
      entry_id: EntryId;
      segment_uid: string;
      page_idx: number;
    };

export type SearchDocumentSourceKind =
  | 'entry_title'
  | 'entry_field'
  | 'entry_tag'
  | 'note_title'
  | 'note_body'
  | 'segment_note'
  | 'annotation'
  | 'pdf_page'
  | 'segment';

export type SearchDocumentSource = {
  kind: SearchDocumentSourceKind;
  label: string;
  field_name: string | null;
  tag_id: TagId | null;
  note_id: NoteId | null;
  segment_uid: string | null;
  page_idx: number | null;
};

export type SearchHit = {
  entry_id: EntryId;
  entry_title: string;
  source: SearchDocumentSource;
  target: SearchTarget;
  title: string;
  snippet: string;
  score: number;
  matched_terms: string[];
};

export type SearchEntryGroup = {
  entry_id: EntryId;
  entry_title: string;
  hit_count: number;
  max_score: number;
  hits: SearchHit[];
};

export type SearchResults = {
  query: string;
  mode: string;
  index_generation: number;
  total_hit_count: number;
  entries: SearchEntryGroup[];
  warnings?: string[];
};

export type EmbeddingProviderStatus = {
  available: boolean;
  provider: string;
  model_name?: string | null;
  model_path?: string | null;
  dimensions?: number | null;
  message?: string | null;
};

export type SearchIndexStatus = {
  scope: string;
  semantic_status: 'empty' | 'needs_build' | 'ready_disk' | 'ready_memory';
  document_count: number;
  semantic_document_count: number;
  records_fingerprint: string;
  keyword_memory_cache_ready: boolean;
  semantic_memory_cache_ready: boolean;
  semantic_disk_cache_ready: boolean;
  semantic_disk_cache_path: string;
  semantic_disk_cache_record_count: number | null;
  semantic_disk_cache_modified_at_ms: number | null;
  message: string;
};

export type SearchIndexBuildStatus = {
  root: string;
  state: 'idle' | 'queued' | 'running' | 'ready' | 'failed';
  scope: 'all' | 'global' | 'segments' | string;
  phase: string;
  completed: number;
  total: number;
  message: string;
  error: string | null;
  started_at_ms: number;
  updated_at_ms: number;
};

export type RebuildSearchIndexResponse = {
  rebuilt_vector_count: number;
  status: SearchIndexStatus;
};

export type OpenDevWorkspaceResponse = {
  root: string;
  entries: EntryMeta[];
  trashed_entries: EntryMeta[];
  tags: TagMeta[];
};

export type WorkspaceSettings = {
  default_root: string;
  root: string;
  custom_root: string | null;
  recent_workspaces: RecentWorkspace[];
  translation_automation: TranslationAutomationSettings;
};

export type RecentWorkspace = {
  root: string;
  last_opened_at_ms: number;
};

export type WorkspacePathInspection = {
  root: string;
  kind:
    | 'valid_workspace'
    | 'empty_directory'
    | 'not_workspace'
    | 'invalid_workspace'
    | 'same_as_current';
  entry_count: number;
  trashed_entry_count: number;
  message: string;
};

export type TranslationAutomationSettings = {
  auto_translate_pdf: boolean;
  segment_types: string[];
};

export type MigrateWorkspaceRootResponse = {
  from_root: string;
  root: string;
  restart_requested: boolean;
};

export async function openDevWorkspace(): Promise<OpenDevWorkspaceResponse> {
  return invoke<OpenDevWorkspaceResponse>('open_dev_workspace');
}

export async function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return invoke<WorkspaceSettings>('get_workspace_settings');
}

export async function forgetRecentWorkspace(root: string): Promise<WorkspaceSettings> {
  return invoke<WorkspaceSettings>('forget_recent_workspace', {
    request: { root }
  });
}

export async function updateTranslationAutomationSettings(
  autoTranslatePdf: boolean,
  segmentTypes: string[]
): Promise<WorkspaceSettings> {
  return invoke<WorkspaceSettings>('update_translation_automation_settings', {
    request: {
      auto_translate_pdf: autoTranslatePdf,
      segment_types: segmentTypes
    }
  });
}

export async function setWorkspaceRoot(root: string): Promise<OpenDevWorkspaceResponse> {
  return invoke<OpenDevWorkspaceResponse>('set_workspace_root', {
    request: { root }
  });
}

export async function migrateWorkspaceRoot(root: string): Promise<MigrateWorkspaceRootResponse> {
  return invoke<MigrateWorkspaceRootResponse>('migrate_workspace_root', {
    request: { root }
  });
}

export async function resetWorkspaceRoot(): Promise<OpenDevWorkspaceResponse> {
  return invoke<OpenDevWorkspaceResponse>('reset_workspace_root');
}

export async function createEntry(
  root: string,
  title: string,
  fields: Record<string, string> = {},
  tags: TagId[] = []
): Promise<EntryMeta> {
  return invoke<EntryMeta>('create_entry', {
    request: {
      root,
      title,
      fields,
      tags
    }
  });
}

export async function listEntries(root: string): Promise<EntryMeta[]> {
  return invoke<EntryMeta[]>('list_entries', {
    request: {
      root
    }
  });
}

export async function listTrashedEntries(root: string): Promise<EntryMeta[]> {
  return invoke<EntryMeta[]>('list_trashed_entries', {
    request: {
      root
    }
  });
}

export async function updateEntryMeta(
  root: string,
  entryId: EntryId,
  title: string,
  fields: Record<string, string>,
  tags: TagId[]
): Promise<EntryMeta> {
  return invoke<EntryMeta>('update_entry_meta', {
    request: {
      root,
      entry_id: entryId,
      title,
      fields,
      tags
    }
  });
}

export async function createTag(root: string, name: string, parentId: TagId | null): Promise<TagMeta> {
  return invoke<TagMeta>('create_tag', {
    request: {
      root,
      name,
      parent_id: parentId
    }
  });
}

export async function renameTag(root: string, tagId: TagId, name: string): Promise<TagMeta> {
  return invoke<TagMeta>('rename_tag', {
    request: {
      root,
      tag_id: tagId,
      name
    }
  });
}

export type DeleteTagResponse = {
  tags: TagMeta[];
  entries: EntryMeta[];
};

export async function deleteTag(root: string, tagId: TagId): Promise<DeleteTagResponse> {
  return invoke<DeleteTagResponse>('delete_tag', {
    request: {
      root,
      tag_id: tagId
    }
  });
}

export async function deleteEntry(root: string, entryId: EntryId): Promise<void> {
  return invoke<void>('delete_entry', {
    request: {
      root,
      entry_id: entryId
    }
  });
}

export async function restoreEntry(root: string, entryId: EntryId): Promise<EntryMeta> {
  return invoke<EntryMeta>('restore_entry', {
    request: {
      root,
      entry_id: entryId
    }
  });
}

export async function purgeEntry(root: string, entryId: EntryId): Promise<void> {
  return invoke<void>('purge_entry', {
    request: {
      root,
      entry_id: entryId
    }
  });
}

export async function createNote(root: string, entryId: EntryId, title: string): Promise<EntryMeta> {
  return invoke<EntryMeta>('create_note', {
    request: {
      root,
      entry_id: entryId,
      title
    }
  });
}

export async function readNote(root: string, entryId: EntryId, noteId: NoteId): Promise<NoteDocument> {
  return invoke<NoteDocument>('read_note', {
    request: {
      root,
      entry_id: entryId,
      note_id: noteId
    }
  });
}

export async function deleteNote(root: string, entryId: EntryId, noteId: NoteId): Promise<EntryMeta> {
  return invoke<EntryMeta>('delete_note', {
    request: {
      root,
      entry_id: entryId,
      note_id: noteId
    }
  });
}

export async function updateNote(
  root: string,
  entryId: EntryId,
  noteId: NoteId,
  title: string,
  markdown: string
): Promise<NoteDocument> {
  return invoke<NoteDocument>('update_note', {
    request: {
      root,
      entry_id: entryId,
      note_id: noteId,
      title,
      markdown
    }
  });
}

export async function applyEntryMetaProposal(
  root: string,
  proposal: AssistantEntryMetaProposal
): Promise<EntryMeta> {
  return invoke<EntryMeta>('apply_entry_meta_proposal', {
    request: {
      base_updated_at: proposal.baseUpdatedAt,
      description: proposal.afterDescription,
      entry_id: proposal.entryId,
      root,
      title: proposal.afterTitle
    }
  });
}

export type ApplyTagProposalResponse = {
  entries: EntryMeta[];
  tags: TagMeta[];
};

export async function applyTagProposal(
  root: string,
  proposal: {
    action: 'attach' | 'create' | 'detach' | 'rename';
    entryIds: EntryId[];
    name?: string;
    newName?: string;
    tagId?: TagId;
  }
): Promise<ApplyTagProposalResponse> {
  return invoke<ApplyTagProposalResponse>('apply_tag_proposal', {
    request: {
      root,
      action: proposal.action,
      entry_ids: proposal.entryIds,
      name: proposal.name ?? null,
      new_name: proposal.newName ?? null,
      tag_id: proposal.tagId ?? null
    }
  });
}

export async function getNoteFilePath(root: string, entryId: EntryId, noteId: NoteId): Promise<string> {
  return invoke<string>('get_note_file_path', {
    request: {
      root,
      entry_id: entryId,
      note_id: noteId
    }
  });
}

export async function openNoteFile(root: string, entryId: EntryId, noteId: NoteId): Promise<void> {
  return invoke<void>('open_note_file', {
    request: {
      root,
      entry_id: entryId,
      note_id: noteId
    }
  });
}

export async function revealNoteFile(root: string, entryId: EntryId, noteId: NoteId): Promise<void> {
  return invoke<void>('reveal_note_file', {
    request: {
      root,
      entry_id: entryId,
      note_id: noteId
    }
  });
}

export type ImportNoteAssetResponse = {
  markdown_path: string;
  file_path: string;
};

export async function importNoteAsset(
  root: string,
  entryId: EntryId,
  noteId: NoteId,
  sourcePath: string
): Promise<ImportNoteAssetResponse> {
  return invoke<ImportNoteAssetResponse>('import_note_asset', {
    request: {
      root,
      entry_id: entryId,
      note_id: noteId,
      source_path: sourcePath
    }
  });
}

export async function listTrashItems(root: string, entryId?: EntryId): Promise<TrashItem[]> {
  return invoke<TrashItem[]>('list_trash_items', {
    request: {
      root,
      entry_id: entryId ?? null
    }
  });
}

export async function restoreTrashItem(
  root: string,
  entryId: EntryId,
  trashId: string
): Promise<void> {
  return invoke<void>('restore_trash_item', {
    request: { root, entry_id: entryId, trash_id: trashId }
  });
}

export async function purgeTrashItem(
  root: string,
  entryId: EntryId,
  trashId: string
): Promise<void> {
  return invoke<void>('purge_trash_item', {
    request: { root, entry_id: entryId, trash_id: trashId }
  });
}

export async function emptyEntryTrash(root: string, entryId: EntryId): Promise<void> {
  return invoke<void>('empty_entry_trash', {
    request: { root, entry_id: entryId }
  });
}

export async function inspectWorkspacePath(root: string): Promise<WorkspacePathInspection> {
  return invoke<WorkspacePathInspection>('inspect_workspace_path', {
    request: { root }
  });
}

export async function switchWorkspaceRoot(root: string): Promise<OpenDevWorkspaceResponse> {
  return invoke<OpenDevWorkspaceResponse>('switch_workspace_root', {
    request: { root }
  });
}

export async function createAndSetWorkspaceRoot(root: string): Promise<OpenDevWorkspaceResponse> {
  return invoke<OpenDevWorkspaceResponse>('create_and_set_workspace_root', {
    request: { root }
  });
}

export async function renamePdfDisplayName(
  root: string,
  entryId: EntryId,
  fileName: string
): Promise<EntryMeta> {
  return invoke<EntryMeta>('rename_pdf_display_name', {
    request: {
      root,
      entry_id: entryId,
      file_name: fileName
    }
  });
}

export async function saveNoteAssetBytes(
  root: string,
  entryId: EntryId,
  noteId: NoteId,
  mimeType: string,
  dataBase64: string,
  fileName?: string | null
): Promise<ImportNoteAssetResponse> {
  return invoke<ImportNoteAssetResponse>('save_note_asset_bytes', {
    request: {
      root,
      entry_id: entryId,
      note_id: noteId,
      mime_type: mimeType,
      data_base64: dataBase64,
      file_name: fileName ?? null
    }
  });
}

export async function importNoteSegmentAsset(
  root: string,
  entryId: EntryId,
  noteId: NoteId,
  sourceEntryId: EntryId,
  segmentUid: string
): Promise<ImportNoteAssetResponse> {
  return invoke<ImportNoteAssetResponse>('import_note_segment_asset', {
    request: {
      root,
      entry_id: entryId,
      note_id: noteId,
      source_entry_id: sourceEntryId,
      segment_uid: segmentUid
    }
  });
}

export async function saveNoteMarkdownAs(targetPath: string, markdown: string): Promise<void> {
  return invoke<void>('save_note_markdown_as', {
    request: {
      target_path: targetPath,
      markdown
    }
  });
}

export async function createNoteSourceLink(
  root: string,
  entryId: EntryId,
  noteId: NoteId,
  sourceEntryId: EntryId,
  segmentUid: string
): Promise<SourceLink> {
  return invoke<SourceLink>('create_note_source_link', {
    request: {
      root,
      entry_id: entryId,
      note_id: noteId,
      source_entry_id: sourceEntryId,
      segment_uid: segmentUid
    }
  });
}

export type ImportAndParsePdfResponse = {
  entry: EntryMeta;
  segment_count: number;
  task_id: string | null;
};

export type RefreshParseStatusResponse = {
  entry: EntryMeta;
  segment_count: number | null;
};

export type PdfReaderResponse = {
  pdf_path: string;
  segments: SourceSegment[];
  segment_notes: SegmentBlockNote[];
  annotations: Annotation[];
};

export type AnnotationCatalogSegment = {
  asset_path?: string | null;
  bbox: [number, number, number, number] | null;
  markdown: string | null;
  page_idx: number;
  segment_type: SourceSegment['segment_type'];
  segment_uid: string;
  text: string;
};

export type AnnotationCatalogRecord = {
  annotation: Annotation;
  entry_id: EntryId;
  entry_tag_ids: TagId[];
  entry_title: string;
  segment: AnnotationCatalogSegment | null;
  segment_status: 'current' | 'orphaned' | 'missing';
};

export type TranslationStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'partial';

export type TranslatedSegmentStatus = 'pending' | 'translated' | 'skipped' | 'failed';

export type TranslationTerm = {
  note: string | null;
  source: string;
  target: string;
};

export type TranslationPaperContext = {
  generated_at: string;
  summary: string;
  terminology: TranslationTerm[];
};

export type TranslationProgress = {
  failed: number;
  skipped: number;
  total: number;
  translated: number;
};

export type TranslatedSegment = {
  error: string | null;
  page_idx: number;
  segment_type: SourceSegment['segment_type'];
  segment_uid: string;
  source_hash: string;
  source_text: string;
  status: TranslatedSegmentStatus;
  translated_text: string | null;
  updated_at: string;
};

export type EntryTranslation = {
  created_at: string;
  entry_id: EntryId;
  error: string | null;
  model: string | null;
  paper_context: TranslationPaperContext | null;
  progress: TranslationProgress;
  schema_version: number;
  segments: TranslatedSegment[];
  source_language: string;
  status: TranslationStatus;
  target_language: string;
  updated_at: string;
};

export type EntryTranslationResponse = {
  translation: EntryTranslation | null;
};

export type JobKind =
  | 'pdf_import'
  | 'parser'
  | 'index_build'
  | 'translation'
  | 'vectorize'
  | 'llm';

export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'canceled';

export type JobProgress = {
  current: number;
  total: number;
  percent: number;
};

export type Job = {
  created_at: string;
  error: string | null;
  id: string;
  kind: JobKind;
  message: string | null;
  progress: JobProgress;
  scope: unknown | null;
  status: JobStatus;
  updated_at: string;
};

export type JobEvent = {
  emitted_at: string;
  job: Job;
  kind: 'queued' | 'started' | 'progress' | 'succeeded' | 'failed' | 'canceled';
  payload: unknown;
};

export type RunEntryTranslationResponse = {
  job: Job;
  translation: EntryTranslation;
};

export async function importAndParsePdf(
  root: string,
  entryId: EntryId,
  pdfPath: string,
  endpoint: string,
  apiKey?: string
): Promise<ImportAndParsePdfResponse> {
  return invoke<ImportAndParsePdfResponse>('import_and_parse_pdf', {
    request: {
      root,
      entry_id: entryId,
      pdf_path: pdfPath,
      endpoint,
      api_key: apiKey || null
    }
  });
}

export async function queuePdfParse(
  root: string,
  entryId: EntryId,
  pdfPath: string
): Promise<EntryMeta> {
  return invoke<EntryMeta>('queue_pdf_parse', {
    request: {
      root,
      entry_id: entryId,
      pdf_path: pdfPath
    }
  });
}

export async function submitQueuedPdfParse(
  root: string,
  entryId: EntryId,
  endpoint: string,
  apiKey?: string
): Promise<ImportAndParsePdfResponse> {
  return invoke<ImportAndParsePdfResponse>('submit_queued_pdf_parse', {
    request: {
      root,
      entry_id: entryId,
      endpoint,
      api_key: apiKey || null
    }
  });
}

export async function retryPdfParse(
  root: string,
  entryId: EntryId,
  endpoint: string,
  apiKey?: string
): Promise<ImportAndParsePdfResponse> {
  return invoke<ImportAndParsePdfResponse>('retry_pdf_parse', {
    request: {
      root,
      entry_id: entryId,
      endpoint,
      api_key: apiKey || null
    }
  });
}

export async function refreshParseStatus(
  root: string,
  entryId: EntryId,
  endpoint?: string,
  apiKey?: string
): Promise<RefreshParseStatusResponse> {
  return invoke<RefreshParseStatusResponse>('refresh_parse_status', {
    request: {
      root,
      entry_id: entryId,
      endpoint: endpoint || null,
      api_key: apiKey || null
    }
  });
}

export async function readPdfReader(root: string, entryId: EntryId): Promise<PdfReaderResponse> {
  return invoke<PdfReaderResponse>('read_pdf_reader', {
    request: {
      root,
      entry_id: entryId
    }
  });
}

export async function readPdfBytes(pdfPath: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_pdf_bytes', {
    request: {
      pdf_path: pdfPath
    }
  });
}

export async function readEntryTranslation(
  root: string,
  entryId: EntryId
): Promise<EntryTranslationResponse> {
  return invoke<EntryTranslationResponse>('read_entry_translation', {
    request: {
      root,
      entry_id: entryId
    }
  });
}

export async function runEntryTranslation(
  root: string,
  entryId: EntryId,
  options: {
    force?: boolean;
    segmentUids?: string[];
    sourceLanguage?: string;
    strategy?: 'restart' | 'resume';
    targetLanguage?: string;
  } = {}
): Promise<RunEntryTranslationResponse> {
  return invoke<RunEntryTranslationResponse>('run_entry_translation', {
    request: {
      root,
      entry_id: entryId,
      force: options.force ?? false,
      segment_uids: options.segmentUids ?? null,
      source_language: options.sourceLanguage ?? 'en',
      strategy: options.strategy ?? 'resume',
      target_language: options.targetLanguage ?? 'zh-CN'
    }
  });
}

export async function translateEntrySegment(
  root: string,
  entryId: EntryId,
  segmentUid: string
): Promise<EntryTranslationResponse> {
  return invoke<EntryTranslationResponse>('translate_entry_segment', {
    request: { root, entry_id: entryId, segment_uid: segmentUid }
  });
}

export async function pauseEntryTranslation(jobId: string): Promise<Job | null> {
  return invoke<Job | null>('pause_entry_translation', {
    request: {
      job_id: jobId
    }
  });
}

export async function getJob(jobId: string): Promise<Job | null> {
  return invoke<Job | null>('get_job', {
    request: {
      job_id: jobId
    }
  });
}

export async function listJobs(): Promise<Job[]> {
  return invoke<Job[]>('list_jobs');
}

export async function listJobEvents(jobId?: string | null): Promise<JobEvent[]> {
  return invoke<JobEvent[]>('list_job_events', {
    request: {
      job_id: jobId ?? null
    }
  });
}

export async function beginEntryTranslation(
  root: string,
  entryId: EntryId,
  options: {
    model?: string | null;
    sourceLanguage?: string;
    targetLanguage?: string;
    total: number;
  }
): Promise<EntryTranslationResponse> {
  return invoke<EntryTranslationResponse>('begin_entry_translation', {
    request: {
      root,
      entry_id: entryId,
      model: options.model ?? null,
      source_language: options.sourceLanguage ?? 'en',
      target_language: options.targetLanguage ?? 'zh-CN',
      total: options.total
    }
  });
}

export async function saveTranslationContext(
  root: string,
  entryId: EntryId,
  context: {
    summary: string;
    terminology: TranslationTerm[];
  }
): Promise<EntryTranslationResponse> {
  return invoke<EntryTranslationResponse>('save_translation_context', {
    request: {
      root,
      entry_id: entryId,
      context
    }
  });
}

export async function upsertTranslatedSegments(
  root: string,
  entryId: EntryId,
  segments: Array<{
    error?: string | null;
    page_idx: number;
    segment_type: SourceSegment['segment_type'];
    segment_uid: string;
    source_hash: string;
    source_text: string;
    status: TranslatedSegmentStatus;
    translated_text?: string | null;
  }>
): Promise<EntryTranslationResponse> {
  return invoke<EntryTranslationResponse>('upsert_translated_segments', {
    request: {
      root,
      entry_id: entryId,
      segments
    }
  });
}

export async function finishEntryTranslation(
  root: string,
  entryId: EntryId,
  status: TranslationStatus,
  error?: string | null
): Promise<EntryTranslationResponse> {
  return invoke<EntryTranslationResponse>('finish_entry_translation', {
    request: {
      root,
      entry_id: entryId,
      status,
      error: error ?? null
    }
  });
}

export async function upsertSegmentNote(
  root: string,
  entryId: EntryId,
  segmentUid: string,
  text: string
): Promise<SegmentBlockNote[]> {
  return invoke<SegmentBlockNote[]>('upsert_segment_note', {
    request: {
      root,
      entry_id: entryId,
      segment_uid: segmentUid,
      text
    }
  });
}

export async function listAnnotations(root: string): Promise<AnnotationCatalogRecord[]> {
  return invoke<AnnotationCatalogRecord[]>('list_annotations', {
    request: {
      root
    }
  });
}

export async function createAnnotation(
  root: string,
  entryId: EntryId,
  segmentUid: string,
  kind: string,
  content: string,
  importance: AnnotationImportance,
  textSelection?: AnnotationTextSelection | null
): Promise<Annotation[]> {
  return invoke<Annotation[]>('create_annotation', {
    request: {
      root,
      entry_id: entryId,
      segment_uid: segmentUid,
      kind,
      content,
      importance,
      text_selection: textSelection ?? null
    }
  });
}

export async function updateAnnotation(
  root: string,
  entryId: EntryId,
  annotationId: AnnotationId,
  kind: string,
  content: string,
  importance: AnnotationImportance
): Promise<Annotation[]> {
  return invoke<Annotation[]>('update_annotation', {
    request: {
      root,
      entry_id: entryId,
      annotation_id: annotationId,
      kind,
      content,
      importance
    }
  });
}

export async function deleteAnnotation(
  root: string,
  entryId: EntryId,
  annotationId: AnnotationId
): Promise<Annotation[]> {
  return invoke<Annotation[]>('delete_annotation', {
    request: {
      root,
      entry_id: entryId,
      annotation_id: annotationId
    }
  });
}

export async function searchEntries(
  root: string,
  query: string,
  options: {
    limit?: number;
    mode?: SearchMode;
    scopeEntryIds?: EntryId[];
  } = {}
): Promise<SearchResults> {
  return invoke<SearchResults>('search_entries', {
    request: {
      root,
      query,
      limit: options.limit ?? null,
      mode: options.mode ?? 'keyword',
      scope_entry_ids: options.scopeEntryIds ?? []
    }
  });
}

export async function searchSegments(
  root: string,
  query: string,
  options: {
    topK?: number;
    mode?: SearchMode;
    scopeEntryIds?: EntryId[];
  } = {}
): Promise<SearchResults> {
  return invoke<SearchResults>('search_segments', {
    request: {
      root,
      query,
      top_k: options.topK ?? null,
      mode: options.mode ?? 'keyword',
      scope_entry_ids: options.scopeEntryIds ?? []
    }
  });
}

export async function getEmbeddingStatus(): Promise<EmbeddingProviderStatus> {
  return invoke<EmbeddingProviderStatus>('get_embedding_status');
}

export async function getSearchIndexStatus(
  root: string,
  options: {
    segmentsOnly?: boolean;
  } = {}
): Promise<SearchIndexStatus> {
  return invoke<SearchIndexStatus>('get_search_index_status', {
    request: {
      root,
      segments_only: options.segmentsOnly ?? false
    }
  });
}

export async function deleteSegmentNote(
  root: string,
  entryId: EntryId,
  segmentUid: string
): Promise<SegmentBlockNote[]> {
  return invoke<SegmentBlockNote[]>('delete_segment_note', {
    request: {
      root,
      entry_id: entryId,
      segment_uid: segmentUid
    }
  });
}

export async function getSearchIndexBuildStatus(
  root: string
): Promise<SearchIndexBuildStatus> {
  return invoke<SearchIndexBuildStatus>('get_search_index_build_status', {
    request: {
      root,
      segments_only: false
    }
  });
}

export async function rebuildSearchIndex(
  root: string,
  options: {
    segmentsOnly?: boolean;
  } = {}
): Promise<RebuildSearchIndexResponse> {
  return invoke<RebuildSearchIndexResponse>('rebuild_search_index', {
    request: {
      root,
      segments_only: options.segmentsOnly ?? false
    }
  });
}
