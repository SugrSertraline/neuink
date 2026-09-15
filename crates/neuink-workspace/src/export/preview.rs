use super::{prepare, resources, DiagramExportMode, PaperExportPreview, PaperExportPreviewRequest};
use crate::Workspace;
use base64::Engine;
use neuink_domain::EntryId;
use std::collections::{BTreeMap, BTreeSet};

pub fn preview_paper_export(
    workspace: &Workspace,
    entry_id: &EntryId,
    request: PaperExportPreviewRequest<'_>,
) -> Result<PaperExportPreview, String> {
    let prepared = prepare(workspace, entry_id, request.kind, request.options)?;
    if prepared.report.fingerprint != request.expected_fingerprint {
        return Err("解析内容、译文或图片已变化，请重新检查内容后预览".into());
    }
    let issue = prepared
        .report
        .issues
        .iter()
        .find(|issue| issue.segment_uid == request.segment_uid)
        .ok_or("这项内容不在当前检查清单中，请重新检查")?;
    let markdown = prepared
        .issue_content
        .get(request.segment_uid)
        .ok_or("对应片段已不可用，请重新检查")?
        .clone();
    let references: BTreeSet<_> = resources::image_references(&markdown).into_iter().collect();
    let mut assets = BTreeMap::new();
    let mut bytes = 0;
    // Only send the selected item's validated images, never expose local paths
    // or let the preview renderer fetch untrusted references from the document.
    for asset in prepared.assets.values() {
        if references.contains(&asset.name) && !assets.contains_key(&asset.name) {
            bytes += asset.png.len();
            if bytes > 48 * 1024 * 1024 {
                return Err("这个片段的图片总量过大，暂时无法预览；仍可按检查结果导出".into());
            }
            assets.insert(
                asset.name.clone(),
                format!(
                    "data:image/png;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(&asset.png)
                ),
            );
        }
    }
    let diagrams = if request.options.diagrams == DiagramExportMode::Rendered {
        prepared
            .report
            .diagrams
            .iter()
            .filter(|diagram| {
                diagram.segment_uid == request.segment_uid
                    && references.contains(&format!("diagrams/{}.png", diagram.id))
            })
            .cloned()
            .collect()
    } else {
        Vec::new()
    };
    Ok(PaperExportPreview {
        fingerprint: prepared.report.fingerprint.clone(),
        segment_uid: issue.segment_uid.clone(),
        page: issue.page,
        markdown,
        assets,
        diagrams,
    })
}
