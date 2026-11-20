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

fn mark_account_submitted(workspace: &Workspace, entry_id: &EntryId, id: &str) -> Result<(), String> {
    let entry = workspace.read_entry(entry_id).map_err(|e| e.to_string())?;
    let parse = &entry.pdf.as_ref().ok_or("条目没有 PDF")?.parse;
    let marker = parse.endpoint.as_deref().filter(|value| value.starts_with("neuink-account:"))
        .ok_or("解析任务已变化，请重新读取状态")?;
    workspace.update_account_parse_state_if_current(entry_id, id, marker, PdfParseStatus::Uploading, PdfParseStatus::Parsing, Some("等待服务器解析".into())).map_err(|e| e.to_string())?;
    Ok(())
}

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
pub async fn process_pdf_parse_queue<R: tauri::Runtime>(app: tauri::AppHandle<R>, request: DispatchRequest) -> Result<(), String> {
    process_pdf_parse_queue_impl(request, move |submission| {
        let app = app.clone();
        async move { super::cloud_account::cloud_account(app, submission).await.map(|_| ()) }
    }).await
}

pub(super) async fn process_pdf_parse_queue_impl<F, Fut>(request: DispatchRequest, submit_account: F) -> Result<(), String>
where
    F: Fn(super::cloud_account::Request) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    if request.endpoint.trim().is_empty() {
        return Ok(());
    }
    let Ok(_dispatch) = DISPATCH.try_lock() else {
        return Ok(());
    };
    let workspace = Workspace::open(request.root.clone()).map_err(|e| e.to_string())?;
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
        if request.endpoint == "neuink-account" && parse.status == PdfParseStatus::Uploading && parse.endpoint.as_deref().is_some_and(|value| value.starts_with("neuink-account:")) {
            if let Some(id) = &parse.task_id {
                submit_account(super::cloud_account::Request::ParseTaskSubmit {
                    root: request.root.clone(), entry_id: entry.id.clone(), request_id: id.clone(),
                }).await?;
                mark_account_submitted(&workspace, &entry.id, id)?;
                return Ok(());
            }
        }
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
    if request.endpoint == "neuink-account" {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "系统时间无效")?.as_nanos();
        let id = blake3::hash(format!("{}:{nonce}", entry.id).as_bytes()).to_hex().to_string();
        let result = submit_account(super::cloud_account::Request::ParseTaskSubmit {
            root: request.root.clone(), entry_id: entry.id.clone(), request_id: id.clone(),
        }).await;
        match result {
            Ok(_) => {
                mark_account_submitted(&workspace, &entry.id, &id)?;
            }
            Err(error) => {
                return Err(error);
            }
        }
        return Ok(());
    }
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
