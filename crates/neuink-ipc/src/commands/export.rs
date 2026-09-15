use neuink_domain::EntryId;
use neuink_workspace::export::reading::{
    self, ReadingExportCatalog, ReadingExportFormat, ReadingExportScope, ReadingExportSelection,
};
use neuink_workspace::{
    export::{
        self, PaperExportFormat, PaperExportInspection, PaperExportKind, PaperExportOptions,
        PaperExportPreview, RenderedExportDiagram,
    },
    Workspace,
};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
pub struct InspectReadingExportRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub note_id: Option<String>,
    #[serde(default)]
    pub scope: ReadingExportScope,
}

#[derive(Debug, Deserialize)]
pub struct ExportReadingRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub selected: Vec<ReadingExportSelection>,
    pub format: ReadingExportFormat,
    pub target_path: PathBuf,
    pub allow_incomplete: bool,
}

#[tauri::command]
pub async fn inspect_reading_export(
    request: InspectReadingExportRequest,
) -> Result<ReadingExportCatalog, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace =
            Workspace::open_existing(request.root).map_err(|error| error.to_string())?;
        reading::inspect_scoped(
            &workspace,
            &request.entry_id,
            request.note_id.as_deref(),
            &request.scope,
        )
    })
    .await
    .map_err(|_| "阅读成果检查异常，请重试".to_string())?
}

#[tauri::command]
pub async fn export_reading(request: ExportReadingRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace =
            Workspace::open_existing(request.root).map_err(|error| error.to_string())?;
        reading::export(
            &workspace,
            &request.entry_id,
            reading::ReadingExportRequest {
                selected: &request.selected,
                format: request.format,
                target: &request.target_path,
                allow_incomplete: request.allow_incomplete,
            },
        )
    })
    .await
    .map_err(|_| "阅读成果导出异常，请重试".to_string())?
}

#[derive(Debug, Deserialize)]
pub struct InspectPaperExportRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub kind: PaperExportKind,
    #[serde(default)]
    pub options: PaperExportOptions,
}

#[derive(Debug, Deserialize)]
pub struct ExportPaperRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub kind: PaperExportKind,
    pub format: PaperExportFormat,
    pub target_path: PathBuf,
    pub expected_fingerprint: String,
    pub allow_draft: bool,
    #[serde(default)]
    pub options: PaperExportOptions,
    #[serde(default)]
    pub rendered_diagrams: Vec<RenderedExportDiagram>,
}

#[derive(Debug, Deserialize)]
pub struct PreviewPaperExportRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub kind: PaperExportKind,
    pub options: PaperExportOptions,
    pub expected_fingerprint: String,
    pub segment_uid: String,
}

#[tauri::command]
pub async fn preview_paper_export(
    request: PreviewPaperExportRequest,
) -> Result<PaperExportPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace =
            Workspace::open_existing(request.root).map_err(|error| error.to_string())?;
        export::preview_paper_export(
            &workspace,
            &request.entry_id,
            export::PaperExportPreviewRequest {
                kind: request.kind,
                options: &request.options,
                expected_fingerprint: &request.expected_fingerprint,
                segment_uid: &request.segment_uid,
            },
        )
    })
    .await
    .map_err(|_| "内容预览任务异常，请重试".to_string())?
}

#[tauri::command]
pub async fn inspect_paper_export(
    request: InspectPaperExportRequest,
) -> Result<PaperExportInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace =
            Workspace::open_existing(request.root).map_err(|error| error.to_string())?;
        export::inspect_paper_export(
            &workspace,
            &request.entry_id,
            request.kind,
            &request.options,
        )
    })
    .await
    .map_err(|_| "内容检查任务异常，请重试".to_string())?
}

#[tauri::command]
pub async fn export_paper(request: ExportPaperRequest) -> Result<PaperExportInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace =
            Workspace::open_existing(request.root).map_err(|error| error.to_string())?;
        export::export_paper(
            &workspace,
            &request.entry_id,
            export::PaperExportRequest {
                kind: request.kind,
                format: request.format,
                target: &request.target_path,
                expected_fingerprint: &request.expected_fingerprint,
                allow_draft: request.allow_draft,
                options: &request.options,
                rendered_diagrams: &request.rendered_diagrams,
            },
        )
    })
    .await
    .map_err(|_| "导出任务异常，请重试".to_string())?
}
