use std::{
    collections::BTreeMap,
    fs,
    io::Cursor,
    path::{Component, Path, PathBuf},
    process::Command,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::{DateTime, Utc};
use neuink_domain::{
    ContentItem, EntryId, EntryMeta, NoteId, PdfParseStatus, SegmentUid, SourceLink, TagId,
};
use neuink_parser::{
    normalize_mineru_zip, CustomEndpointParserProvider, ParseTask, ParseTaskState,
};
use neuink_workspace::note::NoteDocument;
use neuink_workspace::reading_pdf::{PdfPairSummary, ReadingPdfVerifier};
use neuink_workspace::TrashItem;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

pub(crate) mod mineru_source;
#[cfg(test)]
mod mineru_import_tests;
use mineru_source::{read_mineru_source, source_pdf, source_pdf_hash, validate_single_result};
use neuink_workspace::pdf_duplicate::{hash_pdf_file, PdfDuplicate};

#[derive(Debug, Deserialize)]
pub struct CreateEntryRequest {
    pub root: PathBuf,
    pub title: String,
    #[serde(default)]
    pub fields: BTreeMap<String, String>,
    #[serde(default)]
    pub tags: Vec<TagId>,
}

#[derive(Debug, Deserialize)]
pub struct ListEntriesRequest {
    pub root: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct ListTrashedEntriesRequest {
    pub root: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEntryMetaRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub title: String,
    pub fields: BTreeMap<String, String>,
    #[serde(default)]
    pub tags: Vec<TagId>,
}

#[derive(Debug, Deserialize)]
pub struct ApplyEntryTagPathsRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct RenamePdfDisplayNameRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub file_name: String,
}

#[derive(Debug, Deserialize)]
pub struct ApplyEntryMetaProposalRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub base_updated_at: DateTime<Utc>,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Deserialize)]
pub struct DeleteEntryRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
}

#[derive(Debug, Deserialize)]
pub struct EntryDeletionImpactRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
}

#[derive(Debug, Serialize)]
pub struct EntryDeletionImpact {
    pub has_pdf: bool,
    pub parsed_block_count: usize,
    pub note_count: usize,
    pub annotation_count: usize,
    pub incoming_source_link_count: usize,
}

#[derive(Debug, Deserialize)]
pub struct RestoreEntryRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
}

#[derive(Debug, Deserialize)]
pub struct PurgeEntryRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
}

#[derive(Debug, Deserialize)]
pub struct ListTrashItemsRequest {
    pub root: PathBuf,
    pub entry_id: Option<EntryId>,
}

#[derive(Debug, Deserialize)]
pub struct TrashItemRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub trash_id: String,
}

#[derive(Debug, Deserialize)]
pub struct EmptyEntryTrashRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
}

#[derive(Debug, Deserialize)]
pub struct CreateNoteRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct ReadNoteRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub note_id: NoteId,
}

#[derive(Debug, Deserialize)]
pub struct DeleteNoteRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub note_id: NoteId,
}

#[derive(Debug, Deserialize)]
pub struct UpdateNoteRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub note_id: NoteId,
    pub title: String,
    pub markdown: String,
    #[serde(default)]
    pub links: Option<Vec<SourceLink>>,
    #[serde(default)]
    pub expected_revision: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NoteFileRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub note_id: NoteId,
}

#[derive(Debug, Deserialize)]
pub struct ImportNoteAssetRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub note_id: NoteId,
    pub source_path: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct SaveNoteAssetBytesRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub note_id: NoteId,
    pub mime_type: String,
    pub data_base64: String,
    pub file_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImportNoteSegmentAssetRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub note_id: NoteId,
    pub source_entry_id: EntryId,
    pub segment_uid: SegmentUid,
}

#[derive(Debug, Serialize)]
pub struct ImportNoteAssetResponse {
    pub markdown_path: String,
    pub file_path: String,
}

#[derive(Debug, Deserialize)]
pub struct SaveNoteMarkdownAsRequest {
    pub target_path: PathBuf,
    pub markdown: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateNoteSourceLinkRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub note_id: NoteId,
    pub source_entry_id: EntryId,
    pub segment_uid: SegmentUid,
}

#[derive(Debug, Deserialize)]
pub struct ImportAndParsePdfRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub pdf_path: PathBuf,
    pub endpoint: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub confirmed_duplicate_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct QueuePdfParseRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub pdf_path: PathBuf,
    #[serde(default)]
    pub enqueue: bool,
    #[serde(default)]
    pub confirmed_duplicate_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PdfDuplicateSource {
    Pdf,
    Mineru,
}

#[derive(Debug, Deserialize)]
pub struct CheckPdfDuplicateRequest {
    pub root: PathBuf,
    pub path: PathBuf,
    pub source: PdfDuplicateSource,
}

#[tauri::command]
pub fn check_pdf_duplicate(request: CheckPdfDuplicateRequest) -> Result<Option<PdfDuplicate>, String> {
    let workspace = neuink_workspace::Workspace::open_existing(&request.root)
        .map_err(|error| error.to_string())?;
    let hash = match request.source {
        PdfDuplicateSource::Pdf => hash_pdf_file(&request.path).map_err(|error| error.to_string())?,
        PdfDuplicateSource::Mineru => {
            let bytes = read_mineru_source(&request.path)?;
            let name = source_pdf(&bytes)?
                .ok_or_else(|| "新建条目时，MinerU 结果还需包含原 PDF。".to_string())?;
            source_pdf_hash(&bytes, &name)?
        }
    };
    workspace.find_pdf_duplicate(&hash).map_err(|error| error.to_string())
}

fn reject_duplicate_pdf(workspace: &neuink_workspace::Workspace, hash: &str, confirmed_hash: Option<&str>) -> Result<(), String> {
    if confirmed_hash == Some(hash) { return Ok(()); }
    if let Some(found) = workspace.find_pdf_duplicate(hash).map_err(|error| error.to_string())? {
        let location = if found.in_trash { "回收站" } else { "条目库" };
        return Err(format!("相同内容的 PDF 已在{location}：“{}”。未重复保存。", found.title));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ImportMineruClientResultRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub zip_path: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct CreateFromMineruClientResultRequest {
    pub root: PathBuf,
    pub title: String,
    #[serde(default)]
    pub fields: BTreeMap<String, String>,
    #[serde(default)]
    pub tags: Vec<TagId>,
    pub zip_path: PathBuf,
    #[serde(default)]
    pub confirmed_duplicate_hash: Option<String>,
    /// Original PDF to use as the reading file. Required with `pdf_verification`
    /// and checked against the ZIP's origin PDF before anything is written.
    #[serde(default)]
    pub pdf_path: Option<PathBuf>,
    #[serde(default)]
    pub pdf_verification: Option<PdfPairSummary>,
}

#[derive(Debug, Deserialize)]
pub struct ReplaceEntryReadingPdfRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub pdf_path: PathBuf,
    pub expected_content_hash: String,
    pub verification: PdfPairSummary,
}

#[derive(Debug, Deserialize)]
pub struct ReadMineruZipOriginPdfRequest {
    pub zip_path: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct ReadEntryMineruOriginPdfRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
}

#[derive(Debug, Deserialize)]
pub struct SubmitQueuedPdfParseRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub endpoint: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RetryPdfParseRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub endpoint: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RefreshParseStatusRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub endpoint: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct ImportAndParsePdfResponse {
    pub entry: EntryMeta,
    pub segment_count: usize,
    pub task_id: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct RefreshParseStatusResponse {
    pub entry: EntryMeta,
    pub segment_count: Option<usize>,
}

#[tauri::command]
pub fn create_entry(request: CreateEntryRequest) -> Result<EntryMeta, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .create_entry_with_meta(request.title, request.fields, request.tags)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_entries(request: ListEntriesRequest) -> Result<Vec<EntryMeta>, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace.list_entries().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_entry_sources(request: ListEntriesRequest) -> Result<std::collections::HashMap<String, neuink_workspace::entry_sources::EntrySourceInfo>, String> {
    let workspace = neuink_workspace::Workspace::open_existing(request.root).map_err(|error| error.to_string())?;
    workspace.entry_source_kinds().map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
pub struct SetEntrySourceHiddenRequest { pub root: PathBuf, pub entry_id: EntryId, pub hidden: bool }

#[tauri::command]
pub fn set_entry_source_hidden(request: SetEntrySourceHiddenRequest) -> Result<(), String> {
    let workspace = neuink_workspace::Workspace::open_existing(request.root).map_err(|error| error.to_string())?;
    workspace.set_source_entry_hidden(&request.entry_id, request.hidden).map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
pub struct CopySourceToLocalRequest { pub root: PathBuf, pub entry_id: EntryId, #[serde(default)] pub force_new: bool }

#[tauri::command]
pub async fn copy_source_to_local(request: CopySourceToLocalRequest) -> Result<neuink_workspace::local_copy::LocalCopyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = neuink_workspace::Workspace::open_existing(request.root).map_err(|error| error.to_string())?;
        workspace.copy_source_to_local(&request.entry_id, request.force_new).map_err(|error| error.to_string())
    }).await.map_err(|_| "导入本地副本的任务被中断，请检查条目库后重试。".to_owned())?
}

#[tauri::command]
pub fn list_trashed_entries(request: ListTrashedEntriesRequest) -> Result<Vec<EntryMeta>, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .list_trashed_entries()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_entry_meta(request: UpdateEntryMetaRequest) -> Result<EntryMeta, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .update_entry_meta(
            &request.entry_id,
            request.title,
            request.fields,
            request.tags,
        )
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
pub struct TitleConsistencyRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
}

#[derive(Debug, Deserialize)]
pub struct ApplyTitleConsistencyRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub expected_title: String,
    pub expected_pdf_file_name: String,
    pub expected_source_revision: String,
    pub suggested_title: String,
    pub update_entry_title: bool,
    pub update_pdf_file_name: bool,
}

#[derive(Debug, Deserialize)]
pub struct ConfirmTitleConsistencyRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub expected_title: String,
    pub expected_pdf_file_name: String,
    pub expected_source_revision: String,
}

#[tauri::command]
pub fn inspect_title_consistency(
    request: TitleConsistencyRequest,
) -> Result<Option<neuink_workspace::title_consistency::TitleConsistency>, String> {
    let workspace = neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace.inspect_title_consistency(&request.entry_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn confirm_title_consistency(request: ConfirmTitleConsistencyRequest) -> Result<(), String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .confirm_title_consistency(
            &request.entry_id,
            &request.expected_title,
            &request.expected_pdf_file_name,
            &request.expected_source_revision,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn apply_title_consistency(request: ApplyTitleConsistencyRequest) -> Result<EntryMeta, String> {
    let workspace = neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace.apply_title_consistency(&request.entry_id, &request.expected_title,
        &request.expected_pdf_file_name, &request.expected_source_revision, &request.suggested_title,
        request.update_entry_title, request.update_pdf_file_name).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn apply_entry_tag_paths(
    request: ApplyEntryTagPathsRequest,
) -> Result<neuink_workspace::tag_details::ApplyEntryTagPathsResponse, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .apply_entry_tag_paths(&request.entry_id, request.paths)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn rename_pdf_display_name(request: RenamePdfDisplayNameRequest) -> Result<EntryMeta, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .rename_pdf_display_name(&request.entry_id, request.file_name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn apply_entry_meta_proposal(
    request: ApplyEntryMetaProposalRequest,
) -> Result<EntryMeta, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .apply_entry_meta_patch(
            &request.entry_id,
            request.base_updated_at,
            request.title,
            request.description,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_entry(request: DeleteEntryRequest) -> Result<(), String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .delete_entry(&request.entry_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_entry_deletion_impact(
    request: EntryDeletionImpactRequest,
) -> Result<EntryDeletionImpact, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    let entry = workspace
        .read_entry(&request.entry_id)
        .map_err(|error| error.to_string())?;
    let mut incoming_source_link_count = 0;

    for candidate in workspace
        .list_entries()
        .map_err(|error| error.to_string())?
    {
        for content in &candidate.contents {
            let ContentItem::Note { note_id, .. } = content;
            let links = workspace
                .read_note_source_links(&candidate.id, note_id)
                .map_err(|error| error.to_string())?;
            incoming_source_link_count += links
                .iter()
                .filter(|link| {
                    link.sources
                        .iter()
                        .any(|source| source.entry_id == request.entry_id)
                })
                .count();
        }
    }

    Ok(EntryDeletionImpact {
        has_pdf: entry.pdf.is_some(),
        parsed_block_count: workspace
            .read_segments(&request.entry_id)
            .map_err(|error| error.to_string())?
            .len(),
        note_count: entry
            .contents
            .iter()
            .filter(|content| matches!(content, ContentItem::Note { .. }))
            .count(),
        annotation_count: workspace
            .read_annotations(&request.entry_id)
            .map_err(|error| error.to_string())?
            .len(),
        incoming_source_link_count,
    })
}

#[tauri::command]
pub fn restore_entry(request: RestoreEntryRequest) -> Result<EntryMeta, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .restore_entry(&request.entry_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn purge_entry(request: PurgeEntryRequest) -> Result<(), String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .purge_entry(&request.entry_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_trash_items(request: ListTrashItemsRequest) -> Result<Vec<TrashItem>, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    match request.entry_id {
        Some(entry_id) => workspace.list_entry_trash_items(&entry_id),
        None => workspace.list_trash_items(),
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn restore_trash_item(request: TrashItemRequest) -> Result<(), String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .restore_trash_item(&request.entry_id, &request.trash_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn purge_trash_item(request: TrashItemRequest) -> Result<(), String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .purge_trash_item(&request.entry_id, &request.trash_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn empty_entry_trash(request: EmptyEntryTrashRequest) -> Result<(), String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .empty_entry_trash(&request.entry_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_note(request: CreateNoteRequest) -> Result<EntryMeta, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .create_note(&request.entry_id, request.title)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_note(request: ReadNoteRequest) -> Result<NoteDocument, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .read_note(&request.entry_id, &request.note_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_note(request: DeleteNoteRequest) -> Result<EntryMeta, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .delete_note(&request.entry_id, &request.note_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_note(request: UpdateNoteRequest) -> Result<NoteDocument, String> {
    let UpdateNoteRequest {
        root,
        entry_id,
        note_id,
        title,
        markdown,
        links,
        expected_revision,
    } = request;
    let workspace = neuink_workspace::Workspace::open(root).map_err(|error| error.to_string())?;
    match links {
        Some(links) => workspace.update_note_document_if_revision(
            &entry_id,
            &note_id,
            title,
            markdown,
            &links,
            expected_revision.as_deref(),
        ),
        None => workspace.update_note_if_revision(
            &entry_id,
            &note_id,
            title,
            markdown,
            expected_revision.as_deref(),
        ),
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_note_file_path(request: NoteFileRequest) -> Result<String, String> {
    let workspace =
        neuink_workspace::Workspace::open(&request.root).map_err(|error| error.to_string())?;
    workspace
        .read_note(&request.entry_id, &request.note_id)
        .map_err(|error| error.to_string())?;
    let path = neuink_workspace::WorkspaceLayout::new(request.root)
        .entry_note_file(&request.entry_id, &request.note_id);
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_note_file(request: NoteFileRequest) -> Result<(), String> {
    let path = note_file_path(request)?;
    open_path_with_system(&path)
}

#[tauri::command]
pub fn reveal_note_file(request: NoteFileRequest) -> Result<(), String> {
    let path = note_file_path(request)?;
    reveal_path_in_file_manager(&path)
}

#[tauri::command]
pub fn import_note_asset(
    request: ImportNoteAssetRequest,
) -> Result<ImportNoteAssetResponse, String> {
    let workspace =
        neuink_workspace::Workspace::open(&request.root).map_err(|error| error.to_string())?;
    workspace
        .read_note(&request.entry_id, &request.note_id)
        .map_err(|error| error.to_string())?;

    let source_path = std::fs::canonicalize(&request.source_path).map_err(|error| {
        format!(
            "unable to read asset {}: {error}",
            request.source_path.to_string_lossy()
        )
    })?;
    if !source_path.is_file() {
        return Err(format!(
            "asset source is not a file: {}",
            source_path.to_string_lossy()
        ));
    }

    let extension = note_asset_extension(&source_path)?;
    let bytes = std::fs::read(&source_path).map_err(|error| error.to_string())?;
    let stem = source_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(sanitize_asset_stem)
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "image".to_string());

    write_note_asset_bytes(
        request.root,
        &request.entry_id,
        &request.note_id,
        &stem,
        &extension,
        &bytes,
    )
}

#[tauri::command]
pub fn save_note_asset_bytes(
    request: SaveNoteAssetBytesRequest,
) -> Result<ImportNoteAssetResponse, String> {
    let workspace =
        neuink_workspace::Workspace::open(&request.root).map_err(|error| error.to_string())?;
    workspace
        .read_note(&request.entry_id, &request.note_id)
        .map_err(|error| error.to_string())?;

    let extension = note_asset_extension_from_mime(&request.mime_type)?;
    let bytes = BASE64_STANDARD
        .decode(request.data_base64.as_bytes())
        .map_err(|error| format!("invalid image data: {error}"))?;
    if bytes.is_empty() {
        return Err("image data is empty".to_string());
    }
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("image is larger than 20 MB".to_string());
    }

    let stem = request
        .file_name
        .as_deref()
        .and_then(|name| Path::new(name).file_stem())
        .and_then(|stem| stem.to_str())
        .map(sanitize_asset_stem)
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "clipboard-image".to_string());

    write_note_asset_bytes(
        request.root,
        &request.entry_id,
        &request.note_id,
        &stem,
        &extension,
        &bytes,
    )
}

#[tauri::command]
pub fn import_note_segment_asset(
    request: ImportNoteSegmentAssetRequest,
) -> Result<ImportNoteAssetResponse, String> {
    let workspace =
        neuink_workspace::Workspace::open(&request.root).map_err(|error| error.to_string())?;
    workspace
        .read_note(&request.entry_id, &request.note_id)
        .map_err(|error| error.to_string())?;

    let segment = workspace
        .read_segments(&request.source_entry_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|segment| {
            segment.uid == request.segment_uid
                || segment
                    .continuation_group_id
                    .as_deref()
                    .is_some_and(|group_id| group_id == request.segment_uid.as_str())
        })
        .ok_or_else(|| format!("segment not found: {}", request.segment_uid.as_str()))?;
    let asset_path = segment
        .asset_path
        .ok_or_else(|| "selected segment has no image asset".to_string())?;
    let safe_asset_path = safe_relative_asset_path(&asset_path)?;
    let source_path = workspace
        .layout()
        .entry_mineru_output_dir(&request.source_entry_id)
        .join(&safe_asset_path);
    if !source_path.is_file() {
        return Err(format!(
            "segment image asset is missing: {}",
            source_path.to_string_lossy()
        ));
    }

    let extension = note_asset_extension(&source_path)?;
    let bytes = std::fs::read(&source_path).map_err(|error| error.to_string())?;
    let stem = source_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(sanitize_asset_stem)
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "segment-image".to_string());

    write_note_asset_bytes(
        request.root,
        &request.entry_id,
        &request.note_id,
        &stem,
        &extension,
        &bytes,
    )
}

#[tauri::command]
pub fn save_note_markdown_as(request: SaveNoteMarkdownAsRequest) -> Result<(), String> {
    if let Some(parent) = request.target_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    neuink_workspace::atomic_write(request.target_path, request.markdown.as_bytes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_note_source_link(request: CreateNoteSourceLinkRequest) -> Result<SourceLink, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .create_note_source_link(
            &request.entry_id,
            &request.note_id,
            &request.source_entry_id,
            request.segment_uid,
        )
        .map_err(|error| error.to_string())
}

fn note_file_path(request: NoteFileRequest) -> Result<PathBuf, String> {
    let workspace =
        neuink_workspace::Workspace::open(&request.root).map_err(|error| error.to_string())?;
    workspace
        .read_note(&request.entry_id, &request.note_id)
        .map_err(|error| error.to_string())?;
    Ok(neuink_workspace::WorkspaceLayout::new(request.root)
        .entry_note_file(&request.entry_id, &request.note_id))
}

pub(crate) fn open_path_with_system(path: &std::path::Path) -> Result<(), String> {
    let path = std::fs::canonicalize(path)
        .map_err(|error| format!("unable to open path {}: {error}", path.to_string_lossy()))?;
    if !path.is_file() {
        return Err(format!("path is not a file: {}", path.to_string_lossy()));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(windows_explorer_path(&path))
            .spawn()
            .map_err(|error| format!("failed to open file {}: {error}", path.to_string_lossy()))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|error| format!("failed to open file {}: {error}", path.to_string_lossy()))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|error| format!("failed to open file {}: {error}", path.to_string_lossy()))?;
        return Ok(());
    }
}

pub(crate) fn reveal_path_in_file_manager(path: &std::path::Path) -> Result<(), String> {
    let path = std::fs::canonicalize(path)
        .map_err(|error| format!("unable to reveal path {}: {error}", path.to_string_lossy()))?;
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.to_string_lossy()));
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", windows_explorer_path(&path)))
            .spawn()
            .map_err(|error| {
                format!("failed to reveal path {}: {error}", path.to_string_lossy())
            })?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|error| {
                format!("failed to reveal path {}: {error}", path.to_string_lossy())
            })?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let containing_dir = path
            .parent()
            .map(|parent| parent.to_path_buf())
            .unwrap_or_else(|| path.clone());
        Command::new("xdg-open")
            .arg(&containing_dir)
            .spawn()
            .map_err(|error| {
                format!(
                    "failed to reveal path {}: {error}",
                    containing_dir.to_string_lossy()
                )
            })?;
        return Ok(());
    }
}

pub(super) fn note_asset_extension(path: &Path) -> Result<String, String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .ok_or_else(|| "image file has no extension".to_string())?;
    match extension.as_str() {
        "avif" | "gif" | "jpeg" | "jpg" | "png" | "webp" => Ok(extension),
        _ => Err(format!("unsupported image extension: {extension}")),
    }
}

pub(super) fn note_asset_extension_from_mime(mime_type: &str) -> Result<String, String> {
    match mime_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/avif" => Ok("avif".to_string()),
        "image/gif" => Ok("gif".to_string()),
        "image/jpeg" | "image/jpg" => Ok("jpg".to_string()),
        "image/png" => Ok("png".to_string()),
        "image/webp" => Ok("webp".to_string()),
        other => Err(format!("unsupported image MIME type: {other}")),
    }
}

fn write_note_asset_bytes(
    root: PathBuf,
    entry_id: &EntryId,
    note_id: &NoteId,
    stem: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<ImportNoteAssetResponse, String> {
    let hash = blake3::hash(bytes).to_hex().to_string();
    let file_name = format!("{}-{}.{}", stem, &hash[..12], extension);
    let layout = neuink_workspace::WorkspaceLayout::new(root);
    let asset_dir = layout.entry_note_assets_dir(entry_id, note_id);
    let target_path = asset_dir.join(&file_name);
    neuink_workspace::atomic_write(&target_path, bytes).map_err(|error| error.to_string())?;

    Ok(ImportNoteAssetResponse {
        markdown_path: format!("./{}.assets/{}", note_id.as_str(), file_name),
        file_path: target_path.to_string_lossy().to_string(),
    })
}

fn safe_relative_asset_path(value: &str) -> Result<PathBuf, String> {
    let mut safe = PathBuf::new();
    for component in Path::new(value).components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            _ => return Err(format!("unsafe segment asset path: {value}")),
        }
    }
    if safe.as_os_str().is_empty() {
        return Err("segment asset path is empty".to_string());
    }
    Ok(safe)
}

fn sanitize_asset_stem(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_ascii_lowercase()
}

#[cfg(target_os = "windows")]
fn windows_explorer_path(path: &std::path::Path) -> String {
    let text = path.to_string_lossy();
    if let Some(stripped) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{stripped}")
    } else if let Some(stripped) = text.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        text.to_string()
    }
}

#[tauri::command]
pub async fn import_and_parse_pdf(
    request: ImportAndParsePdfRequest,
) -> Result<ImportAndParsePdfResponse, String> {
    if request.endpoint.trim().is_empty() {
        return Err("parser endpoint is required".to_string());
    }

    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    let hash = hash_pdf_file(&request.pdf_path).map_err(|error| error.to_string())?;
    reject_duplicate_pdf(&workspace, &hash, request.confirmed_duplicate_hash.as_deref())?;
    workspace
        .import_pdf_with_confirmation(&request.entry_id, &request.pdf_path, request.confirmed_duplicate_hash.as_deref())
        .map_err(|error| error.to_string())?;
    workspace
        .clear_segments(&request.entry_id)
        .map_err(|error| error.to_string())?;
    workspace
        .clear_mineru_outputs(&request.entry_id)
        .map_err(|error| error.to_string())?;
    set_parse_state(&workspace, &request.entry_id, PdfParseStatus::Queued, None)?;
    queued_parse_response(&workspace, &request.entry_id)
}

#[tauri::command]
pub fn queue_pdf_parse(request: QueuePdfParseRequest) -> Result<EntryMeta, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    let hash = hash_pdf_file(&request.pdf_path).map_err(|error| error.to_string())?;
    reject_duplicate_pdf(&workspace, &hash, request.confirmed_duplicate_hash.as_deref())?;
    workspace
        .import_pdf_with_confirmation(&request.entry_id, &request.pdf_path, request.confirmed_duplicate_hash.as_deref())
        .map_err(|error| error.to_string())?;
    workspace
        .clear_segments(&request.entry_id)
        .map_err(|error| error.to_string())?;
    workspace
        .clear_mineru_outputs(&request.entry_id)
        .map_err(|error| error.to_string())?;
    if request.enqueue {
        workspace
            .enqueue_pdf_parse(&request.entry_id)
            .map_err(|error| error.to_string())
    } else {
        workspace
            .read_entry(&request.entry_id)
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn import_mineru_client_result(
    request: ImportMineruClientResultRequest,
) -> Result<ImportAndParsePdfResponse, String> {
    let workspace =
        neuink_workspace::Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let entry = workspace
        .read_entry(&request.entry_id)
        .map_err(|error| error.to_string())?;
    if entry.pdf.is_none() {
        return Err("请先为条目上传对应的 PDF，再导入 MinerU 客户端结果。".to_string());
    }
    let zip_bytes = read_mineru_source(&request.zip_path)?;
    validate_single_result(&zip_bytes)?;
    let document = normalize_mineru_zip(&zip_bytes).map_err(|error| error.to_string())?;
    if document.segments.is_empty() {
        return Err("所选结果未包含可导入的 MinerU content_list。".to_string());
    }
    workspace
        .write_mineru_output_zip(&request.entry_id, &zip_bytes)
        .map_err(|error| error.to_string())?;
    workspace
        .write_segments(&request.entry_id, &document.segments)
        .map_err(|error| error.to_string())?;
    let entry = mark_mineru_client_import_succeeded(
        &workspace,
        &request.entry_id,
        document.segments.len(),
    )?;
    Ok(ImportAndParsePdfResponse {
        entry,
        segment_count: document.segments.len(),
        task_id: None,
    })
}

#[tauri::command]
pub fn create_from_mineru_client_result(
    mut request: CreateFromMineruClientResultRequest,
) -> Result<ImportAndParsePdfResponse, String> {
    let verification = request.pdf_verification.take();
    create_from_mineru_client_result_with(
        request,
        verification.as_ref().map(|value| value as &dyn ReadingPdfVerifier),
    )
}

/// `verifier` is required whenever `request.pdf_path` is set. A missing verifier
/// rejects the import, so an unchecked PDF is never written.
pub(crate) fn create_from_mineru_client_result_with(
    request: CreateFromMineruClientResultRequest,
    verifier: Option<&dyn ReadingPdfVerifier>,
) -> Result<ImportAndParsePdfResponse, String> {
    let zip_bytes = read_mineru_source(&request.zip_path)?;
    create_from_mineru_source_bytes_with(request, zip_bytes, verifier)
}

pub(crate) fn create_from_mineru_source_bytes(
    mut request: CreateFromMineruClientResultRequest,
    zip_bytes: Vec<u8>,
) -> Result<ImportAndParsePdfResponse, String> {
    let verification = request.pdf_verification.take();
    create_from_mineru_source_bytes_with(
        request,
        zip_bytes,
        verification.as_ref().map(|value| value as &dyn ReadingPdfVerifier),
    )
}

fn create_from_mineru_source_bytes_with(
    request: CreateFromMineruClientResultRequest,
    zip_bytes: Vec<u8>,
    verifier: Option<&dyn ReadingPdfVerifier>,
) -> Result<ImportAndParsePdfResponse, String> {
    let source_id = request.zip_path.canonicalize().ok()
        .map(|path| blake3::hash(path.to_string_lossy().as_bytes()).to_hex().to_string());
    let source_hash = blake3::hash(&zip_bytes).to_hex().to_string();
    let workspace =
        neuink_workspace::Workspace::open_existing(&request.root).map_err(|error| error.to_string())?;
    validate_single_result(&zip_bytes)?;
    let origin_pdf = source_pdf(&zip_bytes)?
        .ok_or_else(|| "新建条目时，MinerU 结果还需包含原 PDF。".to_string())?;
    let document = normalize_mineru_zip(&zip_bytes).map_err(|error| error.to_string())?;
    if document.segments.is_empty() {
        return Err("所选结果未包含可导入的 MinerU content_list。".to_string());
    }
    // Keep the verified bytes rather than reading the selected path again later.
    let (reading_pdf_name, reading_pdf_bytes) = match &request.pdf_path {
        Some(pdf_path) => {
            let verifier = verifier.ok_or_else(|| {
                "缺少原始 PDF 的校验摘要，未创建条目。请让界面先完成 PDF 校验后再导入。".to_string()
            })?;
            let bytes = verify_reading_pdf_against_zip(&zip_bytes, &origin_pdf, pdf_path, verifier)
                .map_err(|reason| format!("原始 PDF 未通过校验，未创建条目：{reason}"))?;
            let name = pdf_path.file_name().and_then(|name| name.to_str())
                .unwrap_or("paper.pdf").to_string();
            (name, bytes)
        }
        None => {
            let name = Path::new(&origin_pdf).file_name().and_then(|name| name.to_str())
                .unwrap_or("paper.pdf").to_string();
            (name, read_zip_entry(&zip_bytes, &origin_pdf)?)
        }
    };
    let pdf_hash = blake3::hash(&reading_pdf_bytes).to_hex().to_string();
    reject_duplicate_pdf(&workspace, &pdf_hash, request.confirmed_duplicate_hash.as_deref())?;
    let entry = workspace
        .create_entry_with_meta(request.title, request.fields, request.tags)
        .map_err(|error| error.to_string())?;
    let imported = (|| -> Result<EntryMeta, String> {
        workspace
            .write_mineru_output_zip(&entry.id, &zip_bytes)
            .map_err(|error| error.to_string())?;
        workspace
            .import_pdf_bytes_with_confirmation(
                &entry.id, &reading_pdf_name, &reading_pdf_bytes,
                request.confirmed_duplicate_hash.as_deref(),
            )
            .map_err(|error| error.to_string())?;
        workspace
            .write_segments(&entry.id, &document.segments)
            .map_err(|error| error.to_string())?;
        let complete = mark_mineru_client_import_succeeded(&workspace, &entry.id, document.segments.len())?;
        if let Some(item_id) = source_id.clone() {
            workspace.record_mineru_source(&entry.id, item_id, source_hash.clone()).map_err(|error| error.to_string())?;
        }
        Ok(complete)
    })();
    let entry = match imported {
        Ok(entry) => entry,
        Err(error) => {
            workspace.delete_entry(&entry.id).map_err(|cleanup| {
                format!("{error}；清理未完成条目失败：{cleanup}")
            })?;
            return Err(error);
        }
    };
    Ok(ImportAndParsePdfResponse {
        entry,
        segment_count: document.segments.len(),
        task_id: None,
    })
}

/// Compares `pdf_path` with the ZIP's origin copy and returns the candidate bytes
/// that were verified. Callers must write those returned bytes, not read the path again.
fn verify_reading_pdf_against_zip(
    zip_bytes: &[u8],
    origin_pdf: &str,
    pdf_path: &Path,
    verifier: &dyn ReadingPdfVerifier,
) -> Result<Vec<u8>, String> {
    let candidate = fs::read(pdf_path).map_err(|error| error.to_string())?;
    neuink_workspace::reading_pdf::validate_pdf_bytes(&candidate)
        .map_err(|error| error.to_string())?;
    let origin = read_zip_entry(zip_bytes, origin_pdf)?;
    verifier.verify(&candidate, &origin)?;
    Ok(candidate)
}

#[derive(Debug, Deserialize)]
pub struct CheckMineruZipReadingPdfRequest {
    pub zip_path: PathBuf,
    pub pdf_path: PathBuf,
    pub pdf_verification: PdfPairSummary,
}

/// Runs the combined-import PDF check without creating anything. The frontend
/// calls this before it writes tags, so a rejected PDF leaves no tags behind.
/// `create_from_mineru_client_result` repeats the same check before it writes.
#[tauri::command]
pub fn check_mineru_zip_reading_pdf(request: CheckMineruZipReadingPdfRequest) -> Result<(), String> {
    let zip_bytes = read_mineru_source(&request.zip_path)?;
    validate_single_result(&zip_bytes)?;
    let origin_pdf = source_pdf(&zip_bytes)?
        .ok_or_else(|| "新建条目时，MinerU 结果还需包含原 PDF。".to_string())?;
    verify_reading_pdf_against_zip(&zip_bytes, &origin_pdf, &request.pdf_path, &request.pdf_verification)
        .map(|_| ())
        .map_err(|reason| format!("原始 PDF 未通过校验：{reason}"))
}

fn read_zip_entry(zip_bytes: &[u8], normalized_name: &str) -> Result<Vec<u8>, String> {
    use std::io::Read;

    let mut archive = zip::ZipArchive::new(Cursor::new(zip_bytes))
        .map_err(|error| format!("无法读取 MinerU 客户端 ZIP：{error}"))?;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
        if file.name().replace('\\', "/") != normalized_name.replace('\\', "/") {
            continue;
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        return Ok(bytes);
    }
    Err(format!("MinerU 客户端 ZIP 中找不到 {normalized_name}。"))
}

/// Replaces the reading PDF of an existing entry. The verifier and the optimistic hash check run before any write.
#[tauri::command]
pub fn replace_entry_reading_pdf(
    request: ReplaceEntryReadingPdfRequest,
) -> Result<EntryMeta, String> {
    let workspace =
        neuink_workspace::Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let file_name = request
        .pdf_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "PDF 文件名无效。".to_string())?
        .to_string();
    let candidate = fs::read(&request.pdf_path).map_err(|error| error.to_string())?;
    workspace
        .replace_reading_pdf(
            &request.entry_id,
            &file_name,
            &candidate,
            &request.expected_content_hash,
            &request.verification,
        )
        .map_err(|error| error.to_string())
}

/// Returns the origin PDF bytes inside a MinerU client ZIP for frontend verification.
#[tauri::command]
pub fn read_mineru_zip_origin_pdf(
    request: ReadMineruZipOriginPdfRequest,
) -> Result<tauri::ipc::Response, String> {
    let zip_bytes = read_mineru_source(&request.zip_path)?;
    validate_single_result(&zip_bytes)?;
    let origin_name = source_pdf(&zip_bytes)?
        .ok_or_else(|| "新建条目时，MinerU 结果还需包含原 PDF。".to_string())?;
    read_zip_entry(&zip_bytes, &origin_name).map(tauri::ipc::Response::new)
}

/// Returns the `paper_origin.pdf` stored for an entry, for replacement verification.
#[tauri::command]
pub fn read_entry_mineru_origin_pdf(
    request: ReadEntryMineruOriginPdfRequest,
) -> Result<tauri::ipc::Response, String> {
    let workspace =
        neuink_workspace::Workspace::open(&request.root).map_err(|error| error.to_string())?;
    workspace
        .mineru_origin_pdf_bytes(&request.entry_id)
        .map(tauri::ipc::Response::new)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn submit_queued_pdf_parse(
    request: SubmitQueuedPdfParseRequest,
) -> Result<ImportAndParsePdfResponse, String> {
    if request.endpoint.trim().is_empty() {
        return Err("parser endpoint is required".to_string());
    }

    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    queued_parse_response(&workspace, &request.entry_id)
}

#[tauri::command]
pub async fn retry_pdf_parse(
    request: RetryPdfParseRequest,
) -> Result<ImportAndParsePdfResponse, String> {
    if request.endpoint.trim().is_empty() {
        return Err("parser endpoint is required".to_string());
    }

    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    let entry = workspace
        .read_entry(&request.entry_id)
        .map_err(|error| error.to_string())?;
    let Some(pdf) = entry.pdf else {
        return Err("entry has no PDF to parse".to_string());
    };
    if !matches!(
        pdf.parse.status,
        PdfParseStatus::Failed | PdfParseStatus::Succeeded | PdfParseStatus::Canceled
    ) {
        return Err("只有解析失败或已完成的 PDF 可以重新解析".to_string());
    }

    queued_parse_response(&workspace, &request.entry_id)
}

fn queued_parse_response(
    workspace: &neuink_workspace::Workspace,
    entry_id: &EntryId,
) -> Result<ImportAndParsePdfResponse, String> {
    let entry = workspace
        .enqueue_pdf_parse(entry_id)
        .map_err(|error| error.to_string())?;
    Ok(ImportAndParsePdfResponse {
        task_id: entry.pdf.as_ref().and_then(|pdf| pdf.parse.task_id.clone()),
        entry,
        segment_count: 0,
    })
}

pub(super) async fn submit_pdf_parse_task(
    workspace: &neuink_workspace::Workspace,
    entry_id: &EntryId,
    endpoint: String,
    api_key: Option<String>,
) -> Result<ImportAndParsePdfResponse, String> {
    // The scheduler has atomically claimed Queued -> Uploading before reaching here.
    workspace
        .clear_segments(entry_id)
        .map_err(|error| error.to_string())?;
    workspace
        .clear_mineru_outputs(entry_id)
        .map_err(|error| error.to_string())?;
    let pdf_path = workspace
        .entry_pdf_path(entry_id)
        .map_err(|error| error.to_string())?;
    let provider = match CustomEndpointParserProvider::with_api_key(endpoint.clone(), api_key) {
        Ok(provider) => provider,
        Err(error) => {
            return parser_submit_failed_response(
                workspace,
                entry_id,
                error.to_string(),
                Some(endpoint),
            );
        }
    };
    match provider.submit_pdf_task(&pdf_path).await {
        Ok(task) => {
            set_parse_state(
                workspace,
                entry_id,
                PdfParseStatus::Uploaded,
                Some(task_status_message(&task)),
            )?;
            let entry = set_parse_state_with_task(
                workspace,
                entry_id,
                PdfParseStatus::Parsing,
                Some(task_status_message(&task)),
                Some(task.task_id.clone()),
                Some(endpoint),
            )?;
            Ok(ImportAndParsePdfResponse {
                entry,
                segment_count: 0,
                task_id: Some(task.task_id),
            })
        }
        Err(error) => {
            let message = error.to_string();
            parser_submit_failed_response(workspace, entry_id, message, Some(endpoint))
        }
    }
}

#[tauri::command]
pub async fn refresh_parse_status<R: Runtime>(
    app: AppHandle<R>,
    request: RefreshParseStatusRequest,
) -> Result<RefreshParseStatusResponse, String> {
    let workspace = neuink_workspace::Workspace::open(request.root.clone())
        .map_err(|error| error.to_string())?;
    let entry = workspace
        .read_entry(&request.entry_id)
        .map_err(|error| error.to_string())?;
    let parse = entry
        .pdf
        .as_ref()
        .ok_or_else(|| "selected entry has no PDF".to_string())?
        .parse
        .clone();
    let task_id = parse
        .task_id
        .clone()
        .ok_or_else(|| "selected PDF has no parser task id".to_string())?;
    let endpoint = request
        .endpoint
        .filter(|value| !value.trim().is_empty())
        .or(parse.endpoint.clone())
        .ok_or_else(|| "parser endpoint is required".to_string())?;

    let provider = CustomEndpointParserProvider::with_api_key(endpoint.clone(), request.api_key)
        .map_err(|error| error.to_string())?;

    let task = provider
        .fetch_task_status(&task_id)
        .await
        .map_err(|error| error.to_string())?;

    match task.state {
        ParseTaskState::Succeeded => {
            let result = match provider.fetch_task_result_with_raw(&task.task_id).await {
                Ok(result) => result,
                Err(error) => {
                    let message = error.to_string();
                    let entry = set_parse_state_with_task(
                        &workspace,
                        &request.entry_id,
                        PdfParseStatus::Parsing,
                        Some(format!("任务完成，但结果暂不可用：{message}")),
                        Some(task.task_id),
                        Some(endpoint),
                    )?;
                    return Ok(RefreshParseStatusResponse {
                        entry,
                        segment_count: None,
                    });
                }
            };
            if let Some(zip_bytes) = &result.zip_bytes {
                workspace
                    .write_mineru_output_zip(&request.entry_id, zip_bytes)
                    .map_err(|error| error.to_string())?;
            }
            if let Some(raw_response) = &result.raw_response {
                workspace
                    .write_mineru_output_response(&request.entry_id, raw_response)
                    .map_err(|error| error.to_string())?;
            }
            workspace
                .write_segments(&request.entry_id, &result.document.segments)
                .map_err(|error| error.to_string())?;
            let entry = set_parse_state_with_task(
                &workspace,
                &request.entry_id,
                PdfParseStatus::Succeeded,
                Some(format!(
                    "Parsed {} segments; saved MinerU outputs",
                    result.document.segments.len()
                )),
                Some(task.task_id),
                Some(endpoint),
            )?;
            let _ =
                start_configured_auto_translation(&app, request.root.clone(), &request.entry_id)
                    .await;
            Ok(RefreshParseStatusResponse {
                entry,
                segment_count: Some(result.document.segments.len()),
            })
        }
        ParseTaskState::Failed => {
            let message = failure_status_message(&provider, &task).await;
            let entry = set_parse_state_with_task(
                &workspace,
                &request.entry_id,
                PdfParseStatus::Failed,
                Some(message),
                Some(task.task_id),
                Some(endpoint),
            )?;
            Ok(RefreshParseStatusResponse {
                entry,
                segment_count: None,
            })
        }
        ParseTaskState::Canceled => {
            let entry = set_parse_state_with_task(
                &workspace,
                &request.entry_id,
                PdfParseStatus::Canceled,
                Some(task_status_message(&task)),
                Some(task.task_id),
                Some(endpoint),
            )?;
            Ok(RefreshParseStatusResponse {
                entry,
                segment_count: None,
            })
        }
        ParseTaskState::Queued | ParseTaskState::Parsing | ParseTaskState::Unknown => {
            let entry = set_parse_state_with_task(
                &workspace,
                &request.entry_id,
                PdfParseStatus::Parsing,
                Some(task_status_message(&task)),
                Some(task.task_id),
                Some(endpoint),
            )?;
            Ok(RefreshParseStatusResponse {
                entry,
                segment_count: None,
            })
        }
    }
}

async fn start_configured_auto_translation<R: Runtime>(
    app: &AppHandle<R>,
    root: PathBuf,
    entry_id: &EntryId,
) -> Result<(), String> {
    let settings = super::workspace::read_settings(app)?;
    let automation = settings.translation_automation;
    if !automation.auto_translate_pdf {
        return Ok(());
    }
    super::translation::start_auto_entry_translation(
        app.clone(),
        root,
        entry_id.clone(),
        &automation.segment_types,
    )
    .await?;
    Ok(())
}

fn set_parse_state(
    workspace: &neuink_workspace::Workspace,
    entry_id: &EntryId,
    status: PdfParseStatus,
    message: Option<String>,
) -> Result<EntryMeta, String> {
    workspace
        .set_pdf_parse_state(entry_id, status, message)
        .map_err(|error| error.to_string())
}

fn set_parse_state_with_task(
    workspace: &neuink_workspace::Workspace,
    entry_id: &EntryId,
    status: PdfParseStatus,
    message: Option<String>,
    task_id: Option<String>,
    endpoint: Option<String>,
) -> Result<EntryMeta, String> {
    workspace
        .set_pdf_parse_state_with_task(entry_id, status, message, task_id, endpoint)
        .map_err(|error| error.to_string())
}

fn mark_mineru_client_import_succeeded(
    workspace: &neuink_workspace::Workspace,
    entry_id: &EntryId,
    segment_count: usize,
) -> Result<EntryMeta, String> {
    set_parse_state(workspace, entry_id, PdfParseStatus::Queued, None)?;
    set_parse_state(workspace, entry_id, PdfParseStatus::Uploading, None)?;
    set_parse_state(workspace, entry_id, PdfParseStatus::Uploaded, None)?;
    set_parse_state(
        workspace,
        entry_id,
        PdfParseStatus::Parsing,
        Some("正在写入 MinerU 客户端导入结果。".to_string()),
    )?;
    set_parse_state_with_task(
        workspace,
        entry_id,
        PdfParseStatus::Succeeded,
        Some(format!("已从 MinerU 客户端导入 {segment_count} 个解析片段")),
        None,
        Some("mineru-client-import".to_string()),
    )
}

fn parser_submit_failed_response(
    workspace: &neuink_workspace::Workspace,
    entry_id: &EntryId,
    message: String,
    endpoint: Option<String>,
) -> Result<ImportAndParsePdfResponse, String> {
    let entry = set_parse_state_with_task(
        workspace,
        entry_id,
        PdfParseStatus::Failed,
        Some(message),
        None,
        endpoint,
    )?;
    Ok(ImportAndParsePdfResponse {
        entry,
        segment_count: 0,
        task_id: None,
    })
}

fn task_status_message(task: &ParseTask) -> String {
    let state = match task.state {
        ParseTaskState::Queued => "queued",
        ParseTaskState::Parsing => "parsing",
        ParseTaskState::Succeeded => "succeeded",
        ParseTaskState::Failed => "failed",
        ParseTaskState::Canceled => "canceled",
        ParseTaskState::Unknown => "unknown",
    };
    match &task.message {
        Some(message) => format!("{state}: {message}"),
        None => state.to_string(),
    }
}

async fn failure_status_message(
    provider: &CustomEndpointParserProvider,
    task: &ParseTask,
) -> String {
    if let Some(message) = task
        .message
        .as_ref()
        .filter(|message| !message.trim().is_empty())
    {
        return format!("failed: {message}");
    }

    match provider.fetch_task_failure_message(&task.task_id).await {
        Ok(Some(message)) if !message.trim().is_empty() => format!("failed: {message}"),
        Ok(_) => "failed: MinerU reported that parsing failed, but did not return an error detail"
            .to_string(),
        Err(error) => format!(
            "failed: MinerU reported that parsing failed; failed to fetch error detail: {error}"
        ),
    }
}
