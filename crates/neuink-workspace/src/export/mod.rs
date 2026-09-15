mod diagrams;
mod model;
mod prepare;
mod preview;
pub mod reading;
mod resources;
mod structure;
#[cfg(test)]
mod tests;
mod word_text;
mod writers;

use crate::{atomic_write, Workspace};
pub use model::{
    DiagramExportMode, ExportImageWidth, ExportIssue, PaperExportFormat, PaperExportInspection,
    PaperExportKind, PaperExportOptions, PaperExportPreview, PaperExportPreviewRequest,
    PaperExportRequest, RenderedExportDiagram,
};
use neuink_domain::EntryId;
use prepare::{prepare, source_text};
pub use preview::preview_paper_export;
#[cfg(test)]
use {model::PreparedExport, prepare::translation_source_hash, std::collections::BTreeMap};

pub fn inspect_paper_export(
    workspace: &Workspace,
    entry_id: &EntryId,
    kind: PaperExportKind,
    options: &PaperExportOptions,
) -> Result<PaperExportInspection, String> {
    Ok(prepare(workspace, entry_id, kind, options)?.report)
}

pub fn export_paper(
    workspace: &Workspace,
    entry_id: &EntryId,
    request: PaperExportRequest<'_>,
) -> Result<PaperExportInspection, String> {
    let PaperExportRequest {
        kind,
        format,
        target,
        expected_fingerprint,
        allow_draft,
        options,
        rendered_diagrams,
    } = request;
    if format == PaperExportFormat::Txt && options.diagrams == DiagramExportMode::Rendered {
        return Err("TXT 不支持渲染图，请选择 Mermaid 源码或其他文件格式".into());
    }
    let mut prepared = prepare(workspace, entry_id, kind, options)?;
    if prepared.report.fingerprint != expected_fingerprint {
        return Err("解析内容、译文或图片已变化，请重新检查后导出".into());
    }
    if prepared.report.requires_draft && !allow_draft {
        return Err(
            "仍有缺译、旧译文或缺失图片，请选择“继续导出（含待核对内容）”，或补全后重试".into(),
        );
    }
    let target = resources::validate_target(workspace.layout().root(), target, format.extension())?;
    diagrams::attach_rendered(&mut prepared, rendered_diagrams, format)?;
    let bytes = writers::write(&prepared, format)?;
    // Revalidate immediately before writing; the dialog's report is not a write authorization for a newer source.
    if prepare(workspace, entry_id, kind, options)?
        .report
        .fingerprint
        != expected_fingerprint
    {
        return Err("生成期间源内容发生变化，未写入文件，请重新检查".into());
    }
    resources::validate_target(workspace.layout().root(), &target, format.extension())?;
    atomic_write(&target, &bytes).map_err(|error| error.to_string())?;
    Ok(prepared.report)
}
