use super::{configured_client, read_settings, PrepareSciversePaperImportRequest};
use neuink_domain::{EntryId, EntryMeta};
use neuink_sciverse::SciverseClient;
use neuink_workspace::{Workspace, WorkspaceError};
use serde::Deserialize;
use std::{path::PathBuf, sync::OnceLock, time::Duration};
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Deserialize)]
pub struct FetchEntryPdfRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
}

#[tauri::command]
pub async fn fetch_entry_pdf<R: Runtime>(
    app: AppHandle<R>,
    request: FetchEntryPdfRequest,
) -> Result<EntryMeta, String> {
    let settings = read_settings(&app)?;
    let client = if settings.sciverse.enabled {
        Some(configured_client(&settings.sciverse))
    } else {
        None
    };
    let result = fetch_saved_entry(
        &request,
        client.as_ref().and_then(|value| value.as_ref().ok()),
    )
    .await;
    if result.is_ok() {
        let _ = app.emit(
            "research-library-changed",
            serde_json::json!({"root":request.root}),
        );
    }
    result
}

pub(super) async fn fetch_saved_entry(
    request: &FetchEntryPdfRequest,
    client: Option<&SciverseClient>,
) -> Result<EntryMeta, String> {
    // One retry at a time bounds memory and makes duplicate requests re-read the
    // entry after the first download has committed, including across split panes.
    static DOWNLOAD: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    let _permit = DOWNLOAD
        .get_or_init(|| tokio::sync::Semaphore::new(1))
        .acquire()
        .await
        .map_err(|_| "PDF 下载队列不可用")?;
    let workspace =
        Workspace::open_existing(&request.root).map_err(|_| "资料库不可用，请重新打开后重试。")?;
    let entry = workspace
        .read_entry(&request.entry_id)
        .map_err(|_| "条目已移除或不可用。")?;
    if entry.pdf.is_some() {
        return Ok(entry);
    }
    let fields = &entry.fields;
    let field = |names: &[&str]| {
        names
            .iter()
            .find_map(|name| fields.get(*name).filter(|v| !v.trim().is_empty()).cloned())
    };
    let doc_id = field(&["Sciverse 文档 ID", "sciverse_doc_id"]).unwrap_or_default();
    let doi = field(&["DOI", "doi"]).map(|v| {
        v.trim()
            .trim_start_matches("https://doi.org/")
            .trim_start_matches("http://doi.org/")
            .to_string()
    });
    let access_oa_url = field(&[
        "开放获取链接",
        "access_oa_url",
        "pdf_source_url",
        "pdf_url",
        "PDF 来源",
    ]);
    if doc_id.is_empty() && doi.is_none() && access_oa_url.is_none() {
        return Err(
            "此条目缺少论文来源。请在编辑条目中补充 DOI 或开放获取链接，也可以上传本地 PDF。"
                .into(),
        );
    }
    if client.is_none() && access_oa_url.is_none() {
        return Err(
            "请先在设置 → 工具与扩展中启用并配置 Sciverse，或为条目补充开放获取链接。".into(),
        );
    }
    let preparation = tokio::time::timeout(
        Duration::from_secs(120),
        super::paper_import::prepare_paper_import(
            client,
            PrepareSciversePaperImportRequest {
                doc_id,
                doi,
                title: entry.title.clone(),
                access_oa_url,
                resource_file_name: field(&["sciverse_resource_file_name"]),
            },
        ),
    )
    .await
    .map_err(|_| "获取 PDF 超时，请稍后重试。")??;
    let path = preparation.pdf_path.ok_or_else(|| {
        preparation
            .degradation_reason
            .unwrap_or_else(|| "尚未找到可下载的 PDF，可以稍后重试或上传本地文件。".into())
    })?;
    let result = std::fs::read(&path)
        .map_err(|_| "读取下载文件失败，请重试。".to_string())
        .and_then(|bytes| {
            workspace
                .attach_downloaded_pdf(&entry, &bytes, preparation.pdf_source_url.as_deref())
                .map_err(|error| match error {
                    WorkspaceError::PdfAlreadyExists(_) => {
                        "此条目已存在 PDF，未覆盖文件。请刷新详情。".into()
                    }
                    WorkspaceError::EntryRevisionConflict(_) => {
                        "下载期间条目信息发生变化，请重试。".into()
                    }
                    _ => "PDF 已下载但未能保存到条目，请检查资料库后重试。".into(),
                })
        });
    // This path was allocated by the import service, never supplied by the model or UI.
    let _ = std::fs::remove_file(path);
    result
}
