use neuink_domain::{EntryMeta, TagId, TagMeta, TagReadingWorkspace};
use neuink_workspace::{tag_archive::TagArchive, tag_reading::TagReadingResponse, Workspace};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
pub struct ReadTagReadingRequest {
    pub root: PathBuf,
    pub tag_id: TagId,
}

#[derive(Debug, Deserialize)]
pub struct SaveTagReadingRequest {
    pub root: PathBuf,
    pub state: TagReadingWorkspace,
    pub expected_revision: u64,
}

#[derive(Debug, Deserialize)]
pub struct TagArchivesRequest {
    pub root: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct RestoreTagArchiveRequest {
    pub root: PathBuf,
    pub archive_id: TagId,
}

#[derive(Debug, Serialize)]
pub struct RestoreTagArchiveResponse {
    pub tags: Vec<TagMeta>,
    pub entries: Vec<EntryMeta>,
    pub missing_entries: usize,
}

#[tauri::command]
pub async fn read_tag_reading(
    request: ReadTagReadingRequest,
) -> Result<TagReadingResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Workspace::open_existing(request.root)?.read_tag_reading(&request.tag_id)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_tag_reading(
    request: SaveTagReadingRequest,
) -> Result<TagReadingWorkspace, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Workspace::open_existing(request.root)?
            .save_tag_reading(request.state, request.expected_revision)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_tag_archives(request: TagArchivesRequest) -> Result<Vec<TagArchive>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Workspace::open_existing(request.root)?.list_tag_archives()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_tag_archive(
    request: RestoreTagArchiveRequest,
) -> Result<RestoreTagArchiveResponse, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<_, neuink_workspace::WorkspaceError> {
        let workspace = Workspace::open_existing(request.root)?;
        let missing_entries = workspace.restore_tag_archive(&request.archive_id)?;
        Ok(RestoreTagArchiveResponse {
            tags: workspace.list_tags()?,
            entries: workspace.list_entries()?,
            missing_entries,
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
