use super::{
    diagrams,
    model::{PreparedExport, COVERAGE_NOTICE},
    resources, structure, DiagramExportMode, ExportIssue, PaperExportInspection, PaperExportKind,
    PaperExportOptions,
};
use crate::{TranslatedSegmentStatus, Workspace};
use neuink_domain::{EntryId, SegmentType, SourceSegment};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn prepare(
    workspace: &Workspace,
    entry_id: &EntryId,
    kind: PaperExportKind,
    options: &PaperExportOptions,
) -> Result<PreparedExport, String> {
    if entry_id.as_str().is_empty()
        || !entry_id
            .as_str()
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("条目标识无效".into());
    }
    let workspace_root = workspace
        .layout()
        .root()
        .canonicalize()
        .map_err(|_| "资料库不可用")?;
    let entry_root = workspace
        .layout()
        .entry_dir(entry_id)
        .canonicalize()
        .map_err(|_| "条目目录不存在")?;
    if !entry_root.starts_with(workspace_root.join("entries")) {
        return Err("条目目录越过资料库边界".into());
    }
    let entry = workspace
        .read_entry(entry_id)
        .map_err(|error| error.to_string())?;
    let segments = workspace
        .read_segments(entry_id)
        .map_err(|error| error.to_string())?;
    if segments.is_empty() {
        return Err("没有可导出的解析内容，请先解析 PDF 或导入 MinerU 结果".into());
    }
    let translation = if kind == PaperExportKind::Source {
        None
    } else {
        workspace
            .read_entry_translation(entry_id)
            .map_err(|error| error.to_string())?
    };
    if translation
        .as_ref()
        .is_some_and(|item| item.entry_id != *entry_id)
    {
        return Err("译文与当前条目不匹配".into());
    }
    if translation.as_ref().is_some_and(|item| {
        let language = item.target_language.to_ascii_lowercase();
        language != "zh" && !language.starts_with("zh-")
    }) {
        return Err("当前保存的译文不是中文，请先运行中文翻译".into());
    }
    let serialized = serde_json::to_vec(&(&entry.title, &segments, &translation, kind, options))
        .map_err(|error| error.to_string())?;
    if serialized.len() > 64 * 1024 * 1024 {
        return Err("解析文本超过 64 MB 导出限制".into());
    }
    let mut fingerprint = blake3::Hasher::new();
    fingerprint.update(&serialized);
    let translated = translation
        .as_ref()
        .map(|item| {
            item.segments
                .iter()
                .map(|item| (item.segment_uid.as_str(), item))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    let mut report = PaperExportInspection::new(segments.len());
    let mut assets = BTreeMap::new();
    let mut failed_assets = BTreeSet::new();
    let mut content = Vec::new();
    let mut issue_content = BTreeMap::new();
    let mut diagram_sources = BTreeMap::new();
    let mut appendix = Vec::new();
    let asset_root = workspace.layout().entry_mineru_output_dir(entry_id);
    if asset_root.exists()
        && !asset_root
            .canonicalize()
            .map_err(|_| "图片目录不可用")?
            .starts_with(&entry_root)
    {
        return Err("解析资源目录越过条目边界".into());
    }
    for segment in &segments {
        let issue_count = report.issues.len();
        let source = source_text(segment);
        let raw_body = diagrams::source_body(segment);
        let has_diagrams = !diagrams::extract(&raw_body, segment).is_empty();
        let use_original = !has_diagrams
            || matches!(
                options.diagrams,
                DiagramExportMode::Original | DiagramExportMode::OriginalWithSource
            );
        let raw_body =
            if has_diagrams && !use_original && segment.segment_type == SegmentType::Figure {
                diagrams::without_images(&raw_body)
            } else {
                raw_body
            };
        let blocks = diagrams::extract(&raw_body, segment);
        if report.diagrams.len() + blocks.len() > 200
            || blocks
                .iter()
                .any(|block| block.diagram.code.len() > 100_000)
        {
            return Err("流程图数量或源码过大，请拆分资料后重试".into());
        }
        let mut references = resources::image_references(&raw_body);
        if let Some(asset) = segment.asset_path.as_ref().filter(|_| use_original) {
            references.push(asset.clone());
        }
        references.sort();
        references.dedup();
        let mut image_suffix = String::new();
        for reference in &references {
            if !assets.contains_key(reference) && !failed_assets.contains(reference) {
                match resources::load_asset(&asset_root, reference) {
                    Ok(asset) => {
                        resources::insert_asset(&mut assets, reference, asset)?;
                    }
                    Err(message) => {
                        failed_assets.insert(reference.clone());
                        report.missing_assets += 1;
                        issue(&mut report, segment, &message);
                    }
                }
            }
            if let Some(asset) = assets.get(reference) {
                if !resources::image_references(&raw_body).contains(reference) {
                    image_suffix.push_str(&format!("\n\n![原图]({})", asset.name));
                }
            }
        }
        let original_available = references
            .iter()
            .any(|reference| assets.contains_key(reference));
        if segment.segment_type == SegmentType::Figure && references.is_empty() && use_original {
            report.missing_assets += 1;
            issue(&mut report, segment, "图片片段没有可用资源引用，原图未导出");
        }
        if !blocks.is_empty() && use_original && !original_available {
            issue(
                &mut report,
                segment,
                "原图不可用，已保留 Mermaid 源码，未静默丢弃流程图",
            );
        }
        let mut original =
            diagrams::apply_mode(&raw_body, &blocks, options.diagrams, original_available);
        original.push_str(&image_suffix);
        for block in blocks {
            if options.diagrams != DiagramExportMode::Original {
                diagram_sources.insert(
                    format!("diagrams/{}.mmd", block.diagram.id),
                    block.diagram.code.clone(),
                );
            }
            if options.diagrams == DiagramExportMode::OriginalWithSource && original_available {
                appendix.push(format!(
                    "### 第 {} 页流程图 {}\n\n```mermaid\n{}\n```",
                    block.diagram.page,
                    report.diagrams.len() + 1,
                    block.diagram.code
                ));
            }
            report.diagrams.push(block.diagram);
        }
        let has_image = segment.segment_type == SegmentType::Figure || !references.is_empty();
        if kind != PaperExportKind::Source && has_image {
            report.unverified_images += 1;
            issue(
                &mut report,
                segment,
                "图中文字未做 OCR 翻译核验，仅作提醒；图片是否缺失另行检查",
            );
        }
        let keep = kind == PaperExportKind::Source
            || has_diagrams
            || source.trim().is_empty()
            || matches!(
                segment.segment_type,
                SegmentType::Math
                    | SegmentType::Code
                    | SegmentType::PageNumber
                    | SegmentType::Figure
            );
        let body = if keep {
            report.preserved += 1;
            original
        } else if let Some(item) = translated.get(segment.uid.as_str()) {
            if item.source_hash != translation_source_hash(source) || item.source_text != source {
                report.stale += 1;
                issue(&mut report, segment, "源内容已变化，旧译文未使用");
                format!("**待重译，保留原文**\n\n{original}")
            } else if matches!(item.status, TranslatedSegmentStatus::Translated)
                && item
                    .translated_text
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
            {
                report.translated += 1;
                let text = item.translated_text.as_deref().unwrap_or_default();
                if kind == PaperExportKind::Bilingual {
                    format!("**原文**\n\n{original}\n\n**译文**\n\n{text}")
                } else {
                    let mut text = text.to_string();
                    for reference in &references {
                        if let Some(asset) = assets.get(reference) {
                            text.push_str(&format!("\n\n![原图]({})", asset.name));
                        }
                    }
                    text
                }
            } else {
                report.missing += 1;
                issue(&mut report, segment, "没有成功的非空译文，保留原文待翻译");
                format!("**待翻译，保留原文**\n\n{original}")
            }
        } else {
            report.missing += 1;
            issue(&mut report, segment, "尚未翻译，保留原文");
            format!("**待翻译，保留原文**\n\n{original}")
        };
        for reference in resources::image_references(&body) {
            if !references.contains(&reference)
                && !assets.values().any(|asset| asset.name == reference)
                && !(options.diagrams == DiagramExportMode::Rendered
                    && report
                        .diagrams
                        .iter()
                        .any(|diagram| reference == format!("diagrams/{}.png", diagram.id)))
                && failed_assets.insert(reference)
            {
                report.missing_assets += 1;
                issue(&mut report, segment, "译文引用了未验证的图片，未读取该资源");
            }
        }
        let mut body = structure::format_segment(segment, &body);
        if options.include_source_refs {
            body.push_str(&format!(
                "\n\n> 来源：第 {} 页 · 片段 {}",
                segment.page_idx.saturating_add(1),
                segment.uid
            ));
        }
        if report.issues.len() > issue_count {
            issue_content.insert(segment.uid.to_string(), body.clone());
        }
        content.push(body);
    }
    for (reference, asset) in &assets {
        fingerprint.update(reference.as_bytes());
        fingerprint.update(&asset.png);
    }
    fingerprint.update(&serde_json::to_vec(&report).map_err(|error| error.to_string())?);
    report.fingerprint = fingerprint.finalize().to_hex().to_string();
    // Unverified image text is a coverage notice, not evidence of missing content.
    report.requires_draft = report.missing + report.stale + report.missing_assets > 0;
    let suffix = match kind {
        PaperExportKind::Source => "解析全文",
        PaperExportKind::Translation => "中文译稿",
        PaperExportKind::Bilingual => "中英对照",
    };
    let title = format!(
        "{} {}{}",
        entry.title,
        suffix,
        if report.requires_draft { " 草稿" } else { "" }
    );
    let mut markdown = format!("# {title}\n\n{COVERAGE_NOTICE}\n\n共 {} 项；已翻译 {}；原样保留 {}；缺译 {}；旧译文 {}；图中文字未核对 {}；缺失图片 {}。\n\n{}\n",
        report.total, report.translated, report.preserved, report.missing, report.stale, report.unverified_images, report.missing_assets, content.join("\n\n"));
    let mut mappings: BTreeMap<_, _> = assets
        .iter()
        .map(|(path, asset)| (path.clone(), asset.name.clone()))
        .collect();
    for reference in failed_assets {
        mappings.insert(reference, "missing-asset".into());
    }
    markdown = resources::rewrite_images(&markdown, &mappings);
    for body in issue_content.values_mut() {
        *body = resources::rewrite_images(body, &mappings);
    }
    if !appendix.is_empty() {
        markdown.push_str(&format!(
            "\n## Mermaid 源码附录\n\n{}\n",
            appendix.join("\n\n")
        ));
    }
    if !report.issues.is_empty() {
        markdown.push_str("\n## 内容检查清单\n\n");
        for issue in &report.issues {
            markdown.push_str(&format!(
                "- 第 {} 页 · {}：{}\n",
                issue.page, issue.segment_uid, issue.message
            ));
        }
    }
    Ok(PreparedExport {
        title,
        markdown,
        assets,
        report,
        options: options.clone(),
        diagram_sources,
        issue_content,
    })
}

fn issue(report: &mut PaperExportInspection, segment: &SourceSegment, message: &str) {
    report.issues.push(ExportIssue {
        segment_uid: segment.uid.to_string(),
        page: segment.page_idx.saturating_add(1),
        message: message.into(),
    });
}

pub(super) fn source_text(segment: &SourceSegment) -> &str {
    segment
        .markdown
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&segment.text)
}

// Keep compatibility with persisted TranslationPipeline hashes (FNV-1a over UTF-16 code units).
pub(super) fn translation_source_hash(text: &str) -> String {
    let hash = text.encode_utf16().fold(2166136261u32, |hash, unit| {
        (hash ^ u32::from(unit)).wrapping_mul(16777619)
    });
    format!("{hash:08x}")
}
