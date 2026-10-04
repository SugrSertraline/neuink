use super::{OnboardingDemo, DEMO_ID};
use crate::{Workspace, WorkspaceError};
use neuink_domain::{EntryMeta, PdfParseStatus, SourceSegment};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::{Cursor, Read},
    path::{Component, Path},
};

pub(super) struct Artifact {
    size: usize,
    hash: blake3::Hash,
}

fn unavailable(message: impl std::fmt::Display) -> WorkspaceError {
    WorkspaceError::Onboarding(format!("缺少演示数据，无法演示：{message}"))
}

fn safe_relative(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

pub(super) fn validate_bundle(
    demo: &OnboardingDemo,
    pdf: &[u8],
    segments: &[SourceSegment],
    mineru: &[u8],
) -> Result<BTreeMap<String, Artifact>, WorkspaceError> {
    if demo.version != DEMO_ID
        || !pdf.starts_with(b"%PDF-")
        || blake3::hash(pdf).to_hex().as_str() != demo.pdf_hash
    {
        return Err(unavailable("演示 PDF 与资源清单不匹配"));
    }
    if segments.is_empty()
        || !segments
            .iter()
            .any(|segment| segment.uid.as_str() == demo.segment_uid)
        || !demo.note_markdown.contains("{source}")
        || demo.translation.trim().is_empty()
    {
        return Err(unavailable("演示解析结果或笔记不完整"));
    }
    let mut ids = HashSet::new();
    for segment in segments {
        if !ids.insert(&segment.uid) {
            return Err(unavailable("演示片段标识重复"));
        }
        if let Some(path) = &segment.asset_path {
            if path.contains('\\') || !safe_relative(Path::new(path)) {
                return Err(unavailable("演示图片路径不安全"));
            }
        }
    }
    let mut zip =
        zip::ZipArchive::new(Cursor::new(mineru)).map_err(|_| unavailable("演示解析压缩包损坏"))?;
    if zip.len() > 500 {
        return Err(unavailable("演示解析资源过多"));
    }
    let mut total_size = 0u64;
    let mut artifacts = BTreeMap::new();
    let mut middle = false;
    let mut content = false;
    for index in 0..zip.len() {
        let mut file = zip
            .by_index(index)
            .map_err(|_| unavailable("演示解析压缩包损坏"))?;
        total_size = total_size.saturating_add(file.size());
        let name = file.name().to_string();
        if file.enclosed_name().is_none()
            || name.contains('\\')
            || !safe_relative(Path::new(&name))
            || total_size > 64 * 1024 * 1024
            || name == "full.zip"
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(unavailable("演示解析资源无效或过大"));
        }
        if file.is_dir() {
            continue;
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|_| unavailable("演示解析文件损坏"))?;
        if bytes.is_empty() {
            return Err(unavailable(format!("演示解析文件为空：{name}")));
        }
        if name == "paper_middle.json"
            || name == "paper_content_list.json"
            || name == "paper_content_list_v2.json"
        {
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| unavailable(format!("演示解析文件损坏：{name}")))?;
            if name == "paper_middle.json" {
                middle = value
                    .get("pdf_info")
                    .and_then(Value::as_array)
                    .is_some_and(|pages| !pages.is_empty());
            } else {
                content |= value.as_array().is_some_and(|blocks| !blocks.is_empty());
            }
        }
        if artifacts
            .insert(
                name,
                Artifact {
                    size: bytes.len(),
                    hash: blake3::hash(&bytes),
                },
            )
            .is_some()
        {
            return Err(unavailable("演示解析压缩包包含重复文件"));
        }
    }
    if !middle || !content {
        return Err(unavailable("演示解析页面或内容列表缺失"));
    }
    for segment in segments {
        if segment
            .asset_path
            .as_ref()
            .is_some_and(|path| !artifacts.contains_key(path))
        {
            return Err(unavailable("演示解析图片缺失"));
        }
    }
    Ok(artifacts)
}

fn verify_file(path: &Path, size: usize, hash: blake3::Hash) -> Result<(), WorkspaceError> {
    if fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.len() == size as u64) {
        if fs::read(path).is_ok_and(|bytes| blake3::hash(&bytes) == hash) {
            return Ok(());
        }
    }
    Err(unavailable(
        "资料库中的演示 PDF 或解析文件缺失、损坏；已有笔记和批注保持不变",
    ))
}

/// Check only installed source data. User notes, annotations, translations and
/// reading progress are intentionally neither compared nor rewritten.
pub(super) fn validate_entry(
    workspace: &Workspace,
    entry: &EntryMeta,
    demo: &OnboardingDemo,
    pdf: &[u8],
    segments: &[SourceSegment],
    mineru: &[u8],
    artifacts: &BTreeMap<String, Artifact>,
) -> Result<(), WorkspaceError> {
    if entry.pdf.as_ref().is_none_or(|asset| {
        asset.content_hash != demo.pdf_hash || asset.parse.status != PdfParseStatus::Succeeded
    }) {
        return Err(unavailable(
            "资料库中的演示 PDF 或解析状态不完整；已有编辑保持不变",
        ));
    }
    verify_file(
        &workspace.layout().entry_pdf_file(&entry.id),
        pdf.len(),
        blake3::hash(pdf),
    )?;
    let segments_path = workspace.layout().entry_segments_file(&entry.id);
    if !fs::metadata(&segments_path)
        .is_ok_and(|meta| meta.is_file() && meta.len() <= 5 * 1024 * 1024)
    {
        return Err(unavailable("资料库中的演示片段缺失或损坏"));
    }
    let stored: Vec<SourceSegment> = serde_json::from_slice(
        &fs::read(segments_path).map_err(|_| unavailable("资料库中的演示片段不可读"))?,
    )
    .map_err(|_| unavailable("资料库中的演示片段损坏"))?;
    if stored != segments {
        return Err(unavailable(
            "资料库中的演示片段不完整或已变化；已有编辑保持不变",
        ));
    }
    verify_file(
        &workspace.layout().entry_mineru_output_zip(&entry.id),
        mineru.len(),
        blake3::hash(mineru),
    )?;
    let output = workspace.layout().entry_mineru_output_dir(&entry.id);
    for (name, artifact) in artifacts {
        verify_file(&output.join(name), artifact.size, artifact.hash)?;
    }
    Ok(())
}
