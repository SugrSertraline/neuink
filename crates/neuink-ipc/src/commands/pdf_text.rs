use neuink_domain::EntryId;
use neuink_workspace::{
    pdf_text::{PdfTextInfo, PdfTextPage},
    Workspace,
};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize)]
pub struct PdfTextRequest {
    root: PathBuf,
    entry_id: EntryId,
    start_page: u32,
    page_count: u32,
}

#[derive(Deserialize)]
pub struct PdfBytesRequest {
    root: PathBuf,
    entry_id: EntryId,
    revision: String,
}

#[derive(Deserialize)]
pub struct CachePdfTextRequest {
    root: PathBuf,
    entry_id: EntryId,
    revision: String,
    page_count: u32,
    pages: Vec<PdfTextPage>,
}

#[tauri::command]
pub async fn inspect_pdf_text(request: PdfTextRequest) -> Result<PdfTextInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = Workspace::open(request.root).map_err(|e| e.to_string())?;
        workspace
            .inspect_pdf_text(&request.entry_id, request.start_page, request.page_count)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_assistant_pdf_bytes(
    request: PdfBytesRequest,
) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = Workspace::open(request.root).map_err(|e| e.to_string())?;
        workspace
            .read_assistant_pdf_bytes(&request.entry_id, Some(&request.revision))
            .map(tauri::ipc::Response::new)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cache_pdf_text(request: CachePdfTextRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = Workspace::open(request.root).map_err(|e| e.to_string())?;
        workspace
            .cache_pdf_text(
                &request.entry_id,
                &request.revision,
                request.page_count,
                request.pages,
            )
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
