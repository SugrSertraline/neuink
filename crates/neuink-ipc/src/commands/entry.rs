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
    normalize_mineru_zip, CustomEndpointParserProvider, MineruQiniuParserProvider, ParseTask, ParseTaskState,
};
use neuink_workspace::note::NoteDocument;
use neuink_workspace::TrashItem;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

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
}

#[derive(Debug, Deserialize)]
pub struct QueuePdfParseRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub pdf_path: PathBuf,
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
    #[serde(default)] pub fields: BTreeMap<String, String>,
    #[serde(default)] pub tags: Vec<TagId>,
    pub zip_path: PathBuf,
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
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .update_note(
            &request.entry_id,
            &request.note_id,
            request.title,
            request.markdown,
        )
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

fn open_path_with_system(path: &std::path::Path) -> Result<(), String> {
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

fn reveal_path_in_file_manager(path: &std::path::Path) -> Result<(), String> {
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

fn note_asset_extension(path: &Path) -> Result<String, String> {
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

fn note_asset_extension_from_mime(mime_type: &str) -> Result<String, String> {
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
    workspace
        .import_pdf(&request.entry_id, &request.pdf_path)
        .map_err(|error| error.to_string())?;
    workspace
        .clear_segments(&request.entry_id)
        .map_err(|error| error.to_string())?;
    workspace
        .clear_mineru_outputs(&request.entry_id)
        .map_err(|error| error.to_string())?;
    set_parse_state(&workspace, &request.entry_id, PdfParseStatus::Queued, None)?;
    submit_pdf_parse_task(
        &workspace,
        &request.entry_id,
        request.endpoint,
        request.api_key,
    )
    .await
}

#[tauri::command]
pub fn queue_pdf_parse(request: QueuePdfParseRequest) -> Result<EntryMeta, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .import_pdf(&request.entry_id, &request.pdf_path)
        .map_err(|error| error.to_string())?;
    workspace
        .clear_segments(&request.entry_id)
        .map_err(|error| error.to_string())?;
    workspace
        .clear_mineru_outputs(&request.entry_id)
        .map_err(|error| error.to_string())?;
    set_parse_state(&workspace, &request.entry_id, PdfParseStatus::Queued, None)
}

#[tauri::command]
pub fn import_mineru_client_result(
    request: ImportMineruClientResultRequest,
) -> Result<ImportAndParsePdfResponse, String> {
    let workspace = neuink_workspace::Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let entry = workspace.read_entry(&request.entry_id).map_err(|error| error.to_string())?;
    if entry.pdf.is_none() {
        return Err("请先为条目上传对应的 PDF，再导入 MinerU 客户端结果。".to_string());
    }
    if request.zip_path.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("zip")) != Some(true) {
        return Err("请选择 MinerU 客户端导出的 ZIP 压缩包；不支持 RAR 或 7Z。".to_string());
    }
    let zip_bytes = fs::read(&request.zip_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(Cursor::new(&zip_bytes))
        .map_err(|error| format!("无法读取 MinerU 客户端 ZIP：{error}"))?;
    let has_images = (0..archive.len()).any(|index| {
        archive
            .by_index(index)
            .map(|file| {
                let name = file.name().replace('\\', "/");
                name.starts_with("images/") || name.contains("/images/")
            })
            .unwrap_or(false)
    });
    if !has_images {
        return Err("MinerU 客户端 ZIP 必须包含 images/ 文件夹。".to_string());
    }
    let document = normalize_mineru_zip(&zip_bytes).map_err(|error| error.to_string())?;
    if document.segments.is_empty() {
        return Err("压缩包未包含可导入的 MinerU content_list 结果。".to_string());
    }
    workspace.write_mineru_output_zip(&request.entry_id, &zip_bytes).map_err(|error| error.to_string())?;
    workspace.write_segments(&request.entry_id, &document.segments).map_err(|error| error.to_string())?;
    let entry = mark_mineru_client_import_succeeded(&workspace, &request.entry_id, document.segments.len())?;
    Ok(ImportAndParsePdfResponse { entry, segment_count: document.segments.len(), task_id: None })
}

#[tauri::command]
pub fn create_from_mineru_client_result(
    request: CreateFromMineruClientResultRequest,
) -> Result<ImportAndParsePdfResponse, String> {
    let workspace = neuink_workspace::Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let zip_bytes = fs::read(&request.zip_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(Cursor::new(&zip_bytes)).map_err(|error| format!("无法读取 MinerU 客户端 ZIP：{error}"))?;
    let names = (0..archive.len()).filter_map(|index| archive.by_index(index).ok().map(|file| file.name().replace('\\', "/"))).collect::<Vec<_>>();
    if !names.iter().any(|name| name.starts_with("images/") || name.contains("/images/")) {
        return Err("MinerU 客户端 ZIP 必须包含 images/ 文件夹。".to_string());
    }
    let origin_pdf = names.iter().find(|name| name.to_ascii_lowercase().ends_with("_origin.pdf")).or_else(|| names.iter().find(|name| name.to_ascii_lowercase().ends_with(".pdf"))).ok_or_else(|| "MinerU 客户端 ZIP 未包含 *_origin.pdf。".to_string())?.clone();
    let document = normalize_mineru_zip(&zip_bytes).map_err(|error| error.to_string())?;
    let entry = workspace.create_entry_with_meta(request.title, request.fields, request.tags).map_err(|error| error.to_string())?;
    workspace.write_mineru_output_zip(&entry.id, &zip_bytes).map_err(|error| error.to_string())?;
    let extracted_pdf = workspace.layout().entry_mineru_output_dir(&entry.id).join(origin_pdf);
    workspace.import_pdf(&entry.id, &extracted_pdf).map_err(|error| error.to_string())?;
    workspace.write_segments(&entry.id, &document.segments).map_err(|error| error.to_string())?;
    let entry = mark_mineru_client_import_succeeded(&workspace, &entry.id, document.segments.len())?;
    Ok(ImportAndParsePdfResponse { entry, segment_count: document.segments.len(), task_id: None })
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
    submit_pdf_parse_task(
        &workspace,
        &request.entry_id,
        request.endpoint,
        request.api_key,
    )
    .await
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
    if pdf.parse.status != PdfParseStatus::Failed {
        return Err("only failed PDF parse tasks can be retried".to_string());
    }

    workspace
        .clear_segments(&request.entry_id)
        .map_err(|error| error.to_string())?;
    workspace
        .clear_mineru_outputs(&request.entry_id)
        .map_err(|error| error.to_string())?;
    set_parse_state(&workspace, &request.entry_id, PdfParseStatus::Queued, None)?;
    submit_pdf_parse_task(
        &workspace,
        &request.entry_id,
        request.endpoint,
        request.api_key,
    )
    .await
}

async fn submit_pdf_parse_task(
    workspace: &neuink_workspace::Workspace,
    entry_id: &EntryId,
    endpoint: String,
    api_key: Option<String>,
) -> Result<ImportAndParsePdfResponse, String> {
    set_parse_state(workspace, entry_id, PdfParseStatus::Uploading, None)?;
    set_parse_state(workspace, entry_id, PdfParseStatus::Uploaded, None)?;
    let pdf_path = workspace
        .entry_pdf_path(entry_id)
        .map_err(|error| error.to_string())?;
    if is_mineru_qiniu_endpoint(&endpoint) {
        return submit_mineru_qiniu_parse_task(workspace, entry_id, &pdf_path).await;
    }
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

async fn submit_mineru_qiniu_parse_task(
    workspace: &neuink_workspace::Workspace,
    entry_id: &EntryId,
    pdf_path: &std::path::Path,
) -> Result<ImportAndParsePdfResponse, String> {
    let provider = match MineruQiniuParserProvider::from_env() {
        Ok(provider) => provider,
        Err(error) => {
            return parser_submit_failed_response(
                workspace,
                entry_id,
                error.to_string(),
                Some("mineru-cloud".to_string()),
            );
        }
    };

    match provider.submit_pdf_task(pdf_path, entry_id.as_str()).await {
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
                Some("mineru-cloud".to_string()),
            )?;
            Ok(ImportAndParsePdfResponse {
                entry,
                segment_count: 0,
                task_id: Some(task.task_id),
            })
        }
        Err(error) => parser_submit_failed_response(
            workspace,
            entry_id,
            error.to_string(),
            Some("mineru-cloud".to_string()),
        ),
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

    if is_mineru_qiniu_endpoint(&endpoint) {
        return refresh_mineru_qiniu_status(&app, &workspace, request.root, &request.entry_id)
            .await;
    }

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

async fn refresh_mineru_qiniu_status(
    app: &AppHandle<impl Runtime>,
    workspace: &neuink_workspace::Workspace,
    root: PathBuf,
    entry_id: &EntryId,
) -> Result<RefreshParseStatusResponse, String> {
    let entry = workspace
        .read_entry(entry_id)
        .map_err(|error| error.to_string())?;
    let task_id = entry
        .pdf
        .as_ref()
        .and_then(|pdf| pdf.parse.task_id.clone())
        .ok_or_else(|| "selected PDF has no parser task id".to_string())?;
    let provider = MineruQiniuParserProvider::from_env().map_err(|error| error.to_string())?;
    let task = provider
        .fetch_task_status(&task_id)
        .await
        .map_err(|error| error.to_string())?;

    match task.state {
        ParseTaskState::Succeeded => {
            let result = provider
                .fetch_task_result(&task.task_id)
                .await
                .map_err(|error| error.to_string())?;
            workspace
                .write_mineru_output_zip(entry_id, &result.zip_bytes)
                .map_err(|error| error.to_string())?;
            workspace
                .write_segments(entry_id, &result.document.segments)
                .map_err(|error| error.to_string())?;
            let entry = set_parse_state_with_task(
                workspace,
                entry_id,
                PdfParseStatus::Succeeded,
                Some(format!(
                    "Parsed {} segments; saved MinerU outputs from {}",
                    result.document.segments.len(),
                    result.full_zip_url
                )),
                Some(task.task_id),
                Some("mineru-cloud".to_string()),
            )?;
            let _ = start_configured_auto_translation(app, root, entry_id).await;
            Ok(RefreshParseStatusResponse {
                entry,
                segment_count: Some(result.document.segments.len()),
            })
        }
        ParseTaskState::Failed => {
            let entry = set_parse_state_with_task(
                workspace,
                entry_id,
                PdfParseStatus::Failed,
                task.message,
                Some(task.task_id),
                Some("mineru-cloud".to_string()),
            )?;
            Ok(RefreshParseStatusResponse {
                entry,
                segment_count: None,
            })
        }
        ParseTaskState::Canceled => {
            let entry = set_parse_state_with_task(
                workspace,
                entry_id,
                PdfParseStatus::Canceled,
                task.message,
                Some(task.task_id),
                Some("mineru-cloud".to_string()),
            )?;
            Ok(RefreshParseStatusResponse {
                entry,
                segment_count: None,
            })
        }
        ParseTaskState::Queued | ParseTaskState::Parsing | ParseTaskState::Unknown => {
            let entry = set_parse_state_with_task(
                workspace,
                entry_id,
                PdfParseStatus::Parsing,
                task.message
                    .clone()
                    .or_else(|| Some(task_status_message(&task))),
                Some(task.task_id),
                Some("mineru-cloud".to_string()),
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
    set_parse_state(workspace, entry_id, PdfParseStatus::Parsing, Some("正在写入 MinerU 客户端导入结果。".to_string()))?;
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

fn is_mineru_qiniu_endpoint(endpoint: &str) -> bool {
    matches!(
        endpoint.trim().to_ascii_lowercase().as_str(),
        "mineru-cloud" | "mineru-qiniu" | "qiniu-mineru"
    )
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
