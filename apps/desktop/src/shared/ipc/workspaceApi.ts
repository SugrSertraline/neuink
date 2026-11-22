import { invoke } from '@tauri-apps/api/core';
import { runLocalBackgroundJob } from '../lib/localBackgroundJobs';
import { noteMutation, SEGMENT_BOOKMARK_CHANGED } from './noteCatalogApi';

import type {
  EntryId,
  Annotation,
  AnnotationId,
  AnnotationImportance,
  AnnotationTextSelection,
  EntryMeta,
  EntryReadingState,
  NoteDocument,
  NoteId,
  SegmentBlockNote,
  SourceLink,
  SourceSegment,
  ReadingStateUpdate,
  TrashItem,
  TagId,
  TagMeta
} from '../types/domain';
import type { AssistantEntryMetaProposal, AssistantTagProposal } from '../types/assistant';
import { decideAssistantProposal, type AssistantProposalConfirmation } from './assistantProposalApi';

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
  section_id?: string | null;
  section_path?: string | null;
  section_role?: string | null;
  segment_type?: string | null;
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
  surrounding_context?: string | null;
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
  data_root?: string | null;
  legacy_import_notice?: string | null;
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

export async function listReadingStates(root: string): Promise<EntryReadingState[]> {
  return invoke<EntryReadingState[]>('list_reading_states', {
    request: { root }
  });
}

export async function readReadingState(
  root: string,
  entryId: EntryId
): Promise<EntryReadingState> {
  return invoke<EntryReadingState>('read_reading_state', {
    request: { root, entry_id: entryId }
  });
}

export async function updateReadingState(
  root: string,
  entryId: EntryId,
  update: ReadingStateUpdate
): Promise<EntryReadingState> {
  return invoke<EntryReadingState>('update_reading_state', {
    request: { root, entry_id: entryId, ...update }
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

export async function applyEntryTagPaths(
  root: string,
  entryId: EntryId,
  paths: string[]
): Promise<{ entry: EntryMeta; tags: TagMeta[] }> {
  return invoke('apply_entry_tag_paths', {
    request: { root, entry_id: entryId, paths }
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

export type EntryDeletionImpact = {
  has_pdf: boolean;
  parsed_block_count: number;
  note_count: number;
  annotation_count: number;
  incoming_source_link_count: number;
};

export async function getEntryDeletionImpact(
  root: string,
  entryId: EntryId
): Promise<EntryDeletionImpact> {
  return invoke<EntryDeletionImpact>('get_entry_deletion_impact', {
    request: { root, entry_id: entryId }
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
  markdown: string,
  links?: SourceLink[] | null,
  expectedRevision?: string | null
): Promise<NoteDocument> {
  return invoke<NoteDocument>('update_note', {
    request: {
      root,
      entry_id: entryId,
      note_id: noteId,
      title,
      markdown,
      links: links ?? null,
      expected_revision: expectedRevision ?? null
    }
  });
}

export async function applyEntryMetaProposal(
  root: string,
  proposal: AssistantEntryMetaProposal,
  confirmation: AssistantProposalConfirmation
): Promise<EntryMeta> {
  const result = await decideAssistantProposal(root, proposal, confirmation, 'apply');
  const entry = result.entries.find(value => value.id === proposal.entryId);
  if (!entry) throw new Error('条目已提交，但无法刷新显示，请重新打开资料库核对。');
  return entry;
}

export type ApplyTagProposalResponse = {
  entries: EntryMeta[];
  tags: TagMeta[];
};

export async function applyTagProposal(
  root: string,
  proposal: AssistantTagProposal,
  confirmation: AssistantProposalConfirmation
): Promise<ApplyTagProposalResponse> {
  return decideAssistantProposal(root, proposal, confirmation, 'apply');
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

export async function setSegmentNoteBookmark(root: string, entryId: string, segmentUid: string, bookmarked: boolean) {
  const notes = await noteMutation(root, invoke<SegmentBlockNote[]>('set_segment_note_bookmark', {
    request: { root, entry_id: entryId, segment_uid: segmentUid, bookmarked }
  }));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SEGMENT_BOOKMARK_CHANGED, { detail: { root, entryId } }));
  return notes;
}

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
  segment_status: 'current' | 'page_anchored' | 'orphaned' | 'missing';
};

export type TranslationStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'partial' | 'paused' | 'canceled';

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
  task?: { job_id: string; profile_id: string; force: boolean; source_hashes: Record<string, string>; remaining_segment_uids: string[]; created_at: string } | null;
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
  | 'paragraph_translation'
  | 'pdf_import'
  | 'parser'
  | 'index_build'
  | 'translation'
  | 'vectorize'
  | 'llm';

export type JobStatus = 'queued' | 'processing' | 'paused' | 'succeeded' | 'failed' | 'canceled';

// Rust 侧 JobScope 用内部标签 + 扁平字段序列化：
// {"kind":"entry","root":...,"entry_id":...} / {"kind":"workspace","root":...}
export type JobScope =
  | { kind: 'entry'; root: string; entry_id: string }
  | { kind: 'workspace'; root: string };

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
  scope: JobScope | null;
  status: JobStatus;
  updated_at: string;
};

export type JobEvent = {
  emitted_at: string;
  job: Job;
  kind: 'queued' | 'started' | 'progress' | 'paused' | 'succeeded' | 'failed' | 'canceled';
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
  pdfPath: string,
  enqueue = true
): Promise<EntryMeta> {
  return invoke<EntryMeta>('queue_pdf_parse', {
    request: {
      root,
      entry_id: entryId,
      pdf_path: pdfPath,
      enqueue
    }
  });
}

export async function importMineruClientResult(
  root: string,
  entryId: EntryId,
  zipPath: string
): Promise<ImportAndParsePdfResponse> {
  return invoke<ImportAndParsePdfResponse>('import_mineru_client_result', {
    request: { root, entry_id: entryId, zip_path: zipPath }
  });
}

export async function createFromMineruClientResult(
  root: string, title: string, fields: Record<string, string>, tags: string[], zipPath: string
): Promise<ImportAndParsePdfResponse> {
  return invoke<ImportAndParsePdfResponse>('create_from_mineru_client_result', {
    request: { root, title, fields, tags, zip_path: zipPath }
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

export async function openPdfFile(pdfPath: string): Promise<void> {
  return invoke<void>('open_pdf_file', {
    request: {
      pdf_path: pdfPath
    }
  });
}

export async function revealPdfFile(pdfPath: string): Promise<void> {
  return invoke<void>('reveal_pdf_file', {
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
  return runLocalBackgroundJob({
    idPrefix: 'single-segment-translation',
    kind: 'paragraph_translation',
    scope: { kind: 'entry', root, entry_id: entryId },
    message: '正在翻译片段',
    successMessage: '片段翻译完成',
    failureMessage: '片段翻译未完成，请返回论文重试。'
  }, async () => {
    const response = await invoke<EntryTranslationResponse>('translate_entry_segment', {
      request: { root, entry_id: entryId, segment_uid: segmentUid }
    });
    const segment = response.translation?.segments.find(item => item.segment_uid === segmentUid);
    if (!segment || segment.status !== 'translated' || !segment.translated_text?.trim()) {
      throw new Error('片段翻译未返回有效译文，请返回论文重试。');
    }
    return response;
  });
}

export async function resumeEntryTranslation(root: string, entryId: string, jobId: string): Promise<RunEntryTranslationResponse> {
  return invoke('resume_entry_translation', { request: { root, entry_id: entryId, job_id: jobId } });
}

export async function cancelTranslationTask(root: string, entryId: string, jobId: string): Promise<RunEntryTranslationResponse> {
  return invoke('cancel_translation_task', { request: { root, entry_id: entryId, job_id: jobId } });
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
  return noteMutation(root, invoke<SegmentBlockNote[]>('upsert_segment_note', {
    request: {
      root,
      entry_id: entryId,
      segment_uid: segmentUid,
      text
    }
  }));
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
    englishQuery?: string;
    subQueries?: string[];
    sectionFilter?: string;
    segmentTypes?: string[];
  } = {}
): Promise<SearchResults> {
  return invoke<SearchResults>('search_entries', {
    request: {
      root,
      query,
      limit: options.limit ?? null,
      mode: options.mode ?? 'keyword',
      scope_entry_ids: options.scopeEntryIds ?? [],
      english_query: options.englishQuery ?? null,
      sub_queries: options.subQueries ?? [],
      section_filter: options.sectionFilter ?? null,
      segment_types: options.segmentTypes ?? []
    }
  });
}

export type SearchSegmentsBatchTask = {
  task_id: string;
  query: string;
  mode: SearchMode;
  top_k: number;
  scope_entry_ids: EntryId[];
  english_query: string | null;
  sub_queries: string[];
  section_filter: string | null;
  segment_types: string[];
};

/** Ordered like the submitted tasks. `error` codes are fixed, path-free strings from the backend. */
export type SearchSegmentsBatchItem = {
  task_id: string;
  results?: SearchResults | null;
  error?: { code: string; message: string } | null;
  /** Which rerank rung ran for this task: `off`, `heuristic`, `cross_encoder`, `cross_encoder+scope_v6`, `fused`. */
  rerank_used?: string | null;
  /** Why a rung was skipped: `model_unavailable`, `provider_error`, `api_unconfigured`, `scope_refine_unconfigured`, `scope_refine_error`. */
  rerank_reason?: string | null;
  /** Tail swaps. Empty when the encoder order stands. */
  scope_swaps?: ScopeSwapSummary[];
  /** `single_vector`, `colbert`, or `bge_m3_hybrid`. Absent when the pool is off. */
  pool_used?: string | null;
  /** `colbert_head_missing`, `sparse_head_missing`, `provider_unsupported`, or `provider_error`. */
  pool_reason?: string | null;
};

/** One IPC call that prepares the workspace index once for every task in the batch. */
export function searchSegmentsBatch(
  root: string,
  tasks: SearchSegmentsBatchTask[]
): Promise<SearchSegmentsBatchItem[]> {
  return invoke<SearchSegmentsBatchItem[]>('search_segments_batch', {
    request: { root, tasks }
  });
}

/** Composed retrieval: document routing, carrier binding, the visual vote, evidence. */
export type UnifiedSearchRequest = {
  question: string;
  english_query?: string | null;
  sub_questions?: string[];
  scope_entry_ids?: EntryId[];
  mandated_entry_ids?: EntryId[];
  section_filter?: string | null;
  segment_types?: string[];
  mode?: SearchMode;
  top_k?: number;
  head_units?: number;
  max_documents?: number;
  bind_carriers?: boolean;
};

export type UnifiedCarrierWire = { kind: 'section' | 'table' | 'figure'; label: string };

export type UnifiedSearchTaskWire = {
  question: string;
  carrier_applied: boolean;
  visual_evidence_applied?: boolean;
  mode: string;
  total_hit_count: number;
  /** Which rerank rung ran: `off`, `heuristic`, `cross_encoder`, `cross_encoder+scope_v6`, `fused`. */
  rerank_used: string;
  /** Why a rung was skipped or the tail was kept. */
  rerank_reason?: string | null;
  scope_swaps?: ScopeSwapSummary[];
  pool_used?: string | null;
  pool_reason?: string | null;
  results: SearchResults;
};

/** Fixed, path-free degradation codes. Copy is host-owned. */
export type UnifiedSearchResponse = {
  question: string;
  routed_documents: string[];
  routing_skip: string | null;
  truncated: boolean;
  text_entries: number;
  visual_entries: number;
  /** `ready` | `disabled` | `model_unavailable` | `index_missing`. */
  visual_status: string;
  /** Present only under gated append: whether the gate admitted visual entries. */
  visual_gate_open?: boolean | null;
  carriers: UnifiedCarrierWire[];
  tasks: UnifiedSearchTaskWire[];
  degradations: string[];
};

export function searchUnified(
  root: string,
  request: UnifiedSearchRequest
): Promise<UnifiedSearchResponse> {
  return invoke<UnifiedSearchResponse>('search_unified', {
    request: { root, ...request }
  });
}

/** How visual votes enter the document order. */
export type VisualFusionMode = 'weighted' | 'append_gated';

/** Gold-free gate for `append_gated`: thin text head, or weak question/hit overlap. */
export type VisualAppendGate = {
  min_head_entries: number;
  max_snippet_overlap: number;
};

export type VisualFusionSettings = {
  mode: VisualFusionMode;
  text_weight: number;
  visual_weight: number;
  rrf_k: number;
  gate: VisualAppendGate;
};

/** The visual channel runs Qwen3-VL-Embedding-2B, locally or behind an API. */
export type VisualEmbeddingProviderKind = 'qwen_local' | 'qwen_api';

export type VisualEmbeddingSettings = {
  provider: VisualEmbeddingProviderKind;
  endpoint: string | null;
  timeout_ms: number;
  fusion: VisualFusionSettings;
  startup: 'on_demand' | 'manual';
};
/** Status view. `has_api_key` reports whether a token is stored; the token is not returned. */
export type VisualEmbeddingSettingsState = {
  provider: 'qwen_local' | 'qwen_api' | 'retired';
  has_api_key: boolean;
  endpoint: string | null;
  timeout_ms: number;
  fusion: VisualFusionSettings;
  startup: 'on_demand' | 'manual';
};

export type VisualEmbeddingSettingsInput = VisualEmbeddingSettings & {
  /** Omit to keep the stored key; pass an empty string to clear it. */
  api_key?: string | null;
};

export function getVisualEmbeddingSettings(): Promise<VisualEmbeddingSettingsState> {
  return invoke('get_visual_embedding_settings');
}

/** Validated backend-side; a configuration that cannot run is rejected at save time. */
export function saveVisualEmbeddingSettings(
  settings: VisualEmbeddingSettingsInput
): Promise<VisualEmbeddingSettingsState> {
  return invoke('save_visual_embedding_settings', { settings });
}

/** Which rerank stage runs after fusion. */
export type RerankMode = 'off' | 'heuristic' | 'cross_encoder';

/** Optional v6 tail after a successful cross-encoder pass. The key is write-only. */
export type ScopeRefineSettings = {
  enabled: boolean;
  use_assistant_llm: boolean;
  api_endpoint: string | null;
  api_model: string | null;
  api_key?: string | null;
  timeout_ms: number;
  max_concurrency: number;
};

export type ScopeSwapSummary = {
  slot: number;
  path: string;
  challenger_uid: string;
  incumbent_uid: string;
};

/** Rerank ladder: cross-encoder -> optional scope v6 -> field coverage -> fused order. */
export type ListwiseRefineSettings = {
  enabled: boolean;
  use_assistant_llm: boolean;
  api_endpoint: string | null;
  api_model: string | null;
  api_key?: string | null;
  top_n: number;
  fuse_rrf: boolean;
  /** Single-paper scope uses substantive-evidence prompt and direct L1 order (no RRF). */
  single_paper_mode?: boolean;
  timeout_ms: number;
};

export type ListwiseRefineState = Omit<ListwiseRefineSettings, 'api_key'> & {
  has_api_key: boolean;
};

export type RerankSettings = {
  /** `local` runs ONNX in-process; `api` calls a hosted rerank endpoint. */
  transport: 'local' | 'api';
  /** Hosted endpoint, used only by the `api` transport. */
  api_endpoint: string | null;
  /** `protocol` = Jina/Cohere shape; `dashscope` = Model Studio native shape. */
  api_style: 'protocol' | 'dashscope';
  /** Hosted model name. */
  api_model: string | null;
  /** Write-only: omit to keep the stored token. */
  api_key?: string | null;
  mode: RerankMode;
  /** Cross-encoder directory; `null` means the bundled resource path. */
  model_dir: string | null;
  /** Head of the fused list a cross-encoder may score. */
  max_candidates: number;
  /** Fall back to field coverage when the encoder cannot run. */
  fallback_heuristic: boolean;
  /** Absent on older saved payloads; the screen treats that as off. */
  scope_refine?: ScopeRefineSettings;
  /** Blank omits the field, matching the previous request bytes. */
  api_instruction?: string | null;
  /** Fuse the cross-encoder order with the first-stage pool. Default off. */
  fuse_with_pool?: boolean;
  /** Prefix cross-encoder passages with `[Section] [Type]` (zero neighbor text). Default off. */
  structured_input?: boolean;
  /** Zero-API offline soft demotion of Abstract and bare Headings. Default off. */
  structural_soft_demotion?: boolean;
  listwise?: ListwiseRefineSettings;
};

export type ScopeRefineState = Omit<ScopeRefineSettings, 'api_key'> & {
  has_api_key: boolean;
};

export type RerankSettingsState = RerankSettings & {
  /** Whether a model file is actually present at the resolved directory. */
  /** Whether a token is stored; the token itself is never returned. */
  has_api_key: boolean;
  model_present: boolean;
  scope_refine?: ScopeRefineState;
  api_instruction?: string | null;
  fuse_with_pool?: boolean;
  structured_input?: boolean;
  structural_soft_demotion?: boolean;
  listwise?: ListwiseRefineState;
};

export function getRerankSettings(): Promise<RerankSettingsState> {
  return invoke('get_rerank_settings');
}

export function saveRerankSettings(settings: RerankSettings): Promise<RerankSettingsState> {
  return invoke('save_rerank_settings', { settings });
}

/** Which retrieval path the assistant's library tool uses. */
export type MultivectorPoolMode = 'colbert' | 'bge_m3_hybrid';

export type MultivectorPoolSettings = {
  enabled: boolean;
  mode: MultivectorPoolMode;
  max_full_scope_segments: number;
  rescore_window: number;
};

export type RetrievalSettingsState = {
  /** Composed path: document routing, carrier binding, visual vote and rerank. */
  unified: boolean;
  multivector?: MultivectorPoolSettings;
};

export function getRetrievalSettings(): Promise<RetrievalSettingsState> {
  return invoke('get_retrieval_settings');
}

export function saveRetrievalSettings(settings: RetrievalSettingsState): Promise<RetrievalSettingsState> {
  return invoke('save_retrieval_settings', { settings });
}

/** Whether a visual snapshot already exists; cheap to read, does not start the encoder. */
export type VisualIndexStatus = {
  built: boolean;
  snapshot_count: number;
  updated_at_ms: number | null;
};

export function getVisualIndexStatus(root: string): Promise<VisualIndexStatus> {
  return invoke('get_visual_index_status', { request: { root } });
}
/** Encodes every page, region and MinerU asset once and writes the visual snapshot. */
export function prepareVisualSearchIndex(
  root: string
): Promise<{
  provider: string;
  model_name: string | null;
  dimensions: number | null;
  identity: string;
  namespace: string;
  entry_count: number;
  asset_count: number;
  document_count: number;
  embedded_count: number;
}> {
  return invoke('prepare_visual_search_index', {
    request: { root }
  });
}

export async function searchSegments(
  root: string,
  query: string,
  options: {
    topK?: number;
    mode?: SearchMode;
    scopeEntryIds?: EntryId[];
    englishQuery?: string;
    subQueries?: string[];
    sectionFilter?: string;
    segmentTypes?: string[];
  } = {}
): Promise<SearchResults> {
  return invoke<SearchResults>('search_segments', {
    request: {
      root,
      query,
      top_k: options.topK ?? null,
      mode: options.mode ?? 'keyword',
      scope_entry_ids: options.scopeEntryIds ?? [],
      english_query: options.englishQuery ?? null,
      sub_queries: options.subQueries ?? [],
      section_filter: options.sectionFilter ?? null,
      segment_types: options.segmentTypes ?? []
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
  return noteMutation(root, invoke<SegmentBlockNote[]>('delete_segment_note', {
    request: {
      root,
      entry_id: entryId,
      segment_uid: segmentUid
    }
  }));
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


/** One selectable text embedding model directory that carries a manifest and ONNX file. */
export type TextModelChoice = {
  id: string;
  model_name: string | null;
  dimensions: number | null;
  pooling: string | null;
  path: string;
  bundled: boolean;
};

/** Where text embeddings come from: local ONNX weights or an OpenAI-compatible API. */
export type TextEmbeddingProviderKind = 'local_onnx' | 'api';

/** Configured transport plus the facts of what would actually be loaded. */
export type TextModelSettingsState = {
  provider: TextEmbeddingProviderKind;
  model_dir: string | null;
  endpoint: string | null;
  has_api_key: boolean;
  model: string | null;
  dimensions: number | null;
  timeout_ms: number;
  resolved_dir: string;
  loaded_model_name: string | null;
  loaded_dimensions: number | null;
  available: boolean;
  message: string | null;
  colbert_head_present?: boolean;
  sparse_head_present?: boolean;
};

/** Settings payload; the key is write-only, so omit it to keep the stored value. */
export type TextModelSettingsInput = {
  provider: TextEmbeddingProviderKind;
  model_dir: string | null;
  endpoint: string | null;
  api_key?: string;
  model: string | null;
  dimensions: number | null;
  timeout_ms: number;
};

export type TextEmbeddingProbeState = {
  provider: string;
  model_name: string | null;
  dimensions: number;
  latency_ms: number;
};

export function listTextModels(): Promise<TextModelChoice[]> {
  return invoke('list_text_models');
}

export function getTextModelSettings(): Promise<TextModelSettingsState> {
  return invoke('get_text_model_settings');
}

export function saveTextModelSettings(
  settings: TextModelSettingsInput
): Promise<TextModelSettingsState> {
  return invoke('save_text_model_settings', { settings });
}

/** Live probe: embeds a fixed probe string through the configured transport. */
export function testTextEmbeddingConnection(
  settings: TextModelSettingsInput
): Promise<TextEmbeddingProbeState> {
  return invoke('test_text_embedding_connection', { settings });
}

/** One curated text model the app can install and run as-is. */
export type RecommendedTextModel = {
  id: string;
  display_name: string;
  repository: string;
  dimensions: number;
  pooling: string;
  onnx_path: string;
  onnx_megabytes: number;
  languages: string;
  license: string;
  note: string;
  directly_installable: boolean;
  /** Model page, so an entry is never a dead end. */
  homepage: string;
  /** Copyable export command when the repository publishes no ONNX. */
  export_hint: string;
};

export type RecommendedTextModelState = {
  model: RecommendedTextModel;
  installed_dir: string | null;
  installed: boolean;
};

export function listRecommendedTextModels(): Promise<RecommendedTextModelState[]> {
  return invoke('list_recommended_text_models');
}

/** Downloads a self-contained export; rejects entries that would need an export step. */
export function installRecommendedTextModel(id: string): Promise<RecommendedTextModelState> {
  return invoke('install_recommended_text_model', { id });
}


/** A reranker directory that is already on disk and can be selected as-is. */
export type InstalledRerankModel = {
  id: string;
  path: string;
  label: string;
};

export function listInstalledRerankModels(): Promise<InstalledRerankModel[]> {
  return invoke('list_installed_rerank_models');
}
/** One curated reranker the app can install in one click. */
export type RecommendedRerankModel = {
  id: string;
  display_name: string;
  repository: string;
  onnx_megabytes: number;
  note: string;
  homepage: string;
};

export type RecommendedRerankModelState = {
  model: RecommendedRerankModel;
  installed_dir: string | null;
  installed: boolean;
};

export function listRecommendedRerankModels(): Promise<RecommendedRerankModelState[]> {
  return invoke('list_recommended_rerank_models');
}

export function installRecommendedRerankModel(id: string): Promise<RecommendedRerankModelState> {
  return invoke('install_recommended_rerank_model', { id });
}

/** One line of the on-device retrieval self check. */
export type RetrievalCheck = {
  name: 'text_model' | 'library' | 'visual_model' | 'rerank';
  ok: boolean;
  detail: string;
  ms: number;
};

export function runRetrievalSelfCheck(root: string): Promise<RetrievalCheck[]> {
  return invoke('run_retrieval_self_check', { root });
}

/** One visual encoder the local service can host. */
export type RecommendedVisualModel = {
  id: string;
  display_name: string;
  repository: string;
  homepage: string;
  weights_megabytes: number;
  dimensions: number;
  note: string;
  install_path: string;
  install_commands: string[];
  current_default: boolean;
};

export function listRecommendedVisualModels(): Promise<RecommendedVisualModel[]> {
  return invoke('list_recommended_visual_models');
}

/** Prepared state of the optional local visual service for one model. */
export type VisualRuntimeState = {
  model_id: string;
  env_dir: string;
  model_dir: string;
  python: string;
  dependencies_installed: boolean;
  model_present: boolean;
  /** Why the weights are missing, when they are. */
  model_error?: string | null;
};

export function getVisualRuntimeState(id: string): Promise<VisualRuntimeState | null> {
  return invoke('get_visual_runtime_state', { id });
}

/**
 * One action: isolated Python env, CPU inference dependencies, and weights.
 * Passing `reuse_model_dir` skips the multi-gigabyte download.
 */
export function installVisualRuntime(
  id: string,
  reuseModelDir?: string | null
): Promise<VisualRuntimeState> {
  return invoke('install_visual_runtime', {
    id,
    reuse_model_dir: reuseModelDir ?? null
  });
}

/** Whether the configured visual transport is actually answering right now. */
export type VisualServiceStatus = {
  running: boolean;
  model: string | null;
  dimensions: number | null;
  endpoint: string | null;
  message: string | null;
};

export function getVisualServiceStatus(): Promise<VisualServiceStatus> {
  return invoke('get_visual_service_status');
}
/** Retries only the weight download for an already prepared environment. */
export function downloadVisualWeights(
  id: string,
  reuseModelDir?: string | null
): Promise<VisualRuntimeState> {
  return invoke('download_visual_weights', {
    id,
    reuse_model_dir: reuseModelDir ?? null
  });
}

/** Starts the prepared service; resolves to its process id. */
export function startVisualService(id: string): Promise<number> {
  return invoke('start_visual_service', { id });
}




