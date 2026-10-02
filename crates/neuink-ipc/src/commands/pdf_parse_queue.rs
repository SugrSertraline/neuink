use neuink_domain::{EntryId, PdfParseStatus};
use neuink_workspace::{
    pdf_parse_queue::{ParseQueueMove, PdfParseQueue},
    Workspace,
};
use serde::Deserialize;
use std::path::PathBuf;

// No lock is held on a UI thread. Serial submission also makes interrupted uploads
// distinguishable from still-running native calls after a WebView reload.
static DISPATCH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Deserialize)]
pub struct QueueRequest {
    pub root: PathBuf,
}
#[derive(Deserialize)]
pub struct MoveRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub movement: ParseQueueMove,
}
#[derive(Deserialize)]
pub struct DispatchRequest {
    pub root: PathBuf,
    pub endpoint: String,
    pub api_key: Option<String>,
}

#[tauri::command]
pub async fn read_pdf_parse_queue(request: QueueRequest) -> Result<PdfParseQueue, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Workspace::open(request.root)
            .and_then(|w| w.read_pdf_parse_queue())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn move_pdf_parse_queue(request: MoveRequest) -> Result<PdfParseQueue, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Workspace::open(request.root)
            .and_then(|w| w.move_pdf_parse(&request.entry_id, request.movement))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn process_pdf_parse_queue(request: DispatchRequest) -> Result<(), String> {
    if request.endpoint.trim().is_empty() {
        return Ok(());
    }
    let Ok(_dispatch) = DISPATCH.try_lock() else {
        return Ok(());
    };
    let workspace = Workspace::open(request.root).map_err(|e| e.to_string())?;
    // No native submission is alive under this lock. Never re-upload an uncertain
    // interrupted request automatically; make it visible and allow explicit retry.
    for entry in workspace
        .read_pdf_parse_queue()
        .map_err(|e| e.to_string())?
        .active
    {
        let Some(pdf) = &entry.pdf else {
            continue;
        };
        let parse = &pdf.parse;
        if parse.task_id.is_none() {
            workspace.set_pdf_parse_state(&entry.id, PdfParseStatus::Failed,
                Some("上次提交已中断，未取得解析任务编号。请核对解析服务后再手动重试；不会自动重复上传。".into()))
                .map_err(|e| e.to_string())?;
        }
    }
    let Some(entry) = workspace
        .claim_next_pdf_parse()
        .map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    if let Err(error) = super::entry::submit_pdf_parse_task(
        &workspace,
        &entry.id,
        request.endpoint,
        request.api_key,
    )
    .await
    {
        // Includes local file/cleanup errors, not just remote submission errors.
        workspace
            .set_pdf_parse_state(&entry.id, PdfParseStatus::Failed, Some(error.clone()))
            .map_err(|e| e.to_string())?;
        return Err(error);
    }
    Ok(())
}
