//! Install a complete, isolated demo through a same-volume staging workspace.
use crate::{
    atomic_write, atomic_write_json, EntryTranslation, TranslatedSegment, TranslatedSegmentStatus,
    TranslationProgress, TranslationStatus, Workspace, WorkspaceError,
};
use chrono::Utc;
use neuink_domain::{
    AnnotationImportance, ContentItem, EntryId, EntryMeta, PdfParseState, PdfParseStatus,
    SourceSegment,
};
use serde::Deserialize;
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::{Cursor, Read},
    path::{Component, PathBuf},
    sync::Mutex,
};

pub const DEMO_ID: &str = "attention-v1";
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

#[derive(Deserialize)]
pub struct OnboardingDemo {
    pub version: String,
    pub pdf_hash: String,
    pub segment_uid: String,
    pub note_title: String,
    pub note_markdown: String,
    pub segment_note: String,
    pub annotation: String,
    pub translation: String,
}

impl Workspace {
    pub fn find_onboarding_demo(&self) -> Result<Option<EntryMeta>, WorkspaceError> {
        for entry in self.list_entries()? {
            if entry.fields.get("tutorial_demo").map(String::as_str) != Some(DEMO_ID) {
                continue;
            }
            let Ok(mut file) = fs::File::open(self.layout().entry_pdf_file(&entry.id)) else {
                continue;
            };
            let mut header = [0; 5];
            if file.read_exact(&mut header).is_ok() && &header == b"%PDF-" {
                return Ok(Some(entry));
            }
        }
        Ok(None)
    }

    /// Publish the finished directory once; any failure leaves the library unchanged.
    /// Existing demos and ordinary copies of the paper are never overwritten.
    pub fn install_onboarding_demo(
        &self,
        demo: &OnboardingDemo,
        pdf: &[u8],
        segments: &[SourceSegment],
        mineru: &[u8],
    ) -> Result<EntryMeta, WorkspaceError> {
        let _lock = INSTALL_LOCK
            .lock()
            .map_err(|_| WorkspaceError::Onboarding("演示资料准备锁不可用".into()))?;
        if let Some(entry) = self.find_onboarding_demo()? {
            return Ok(entry);
        }
        validate(demo, pdf, segments, mineru)?;
        let staging_path = self
            .layout()
            .cache_dir()
            .join(format!("onboarding-{}", EntryId::new()));
        fs::create_dir_all(self.layout().cache_dir())?;
        fs::create_dir(&staging_path)?;
        let _staging = Staging(staging_path.clone());
        let staged = Workspace::create(&staging_path)?;
        let entry = staged.create_entry_with_meta("Attention Is All You Need（演示版）", BTreeMap::from([
            ("tutorial_demo".into(), DEMO_ID.into()),
            ("tutorial_source".into(), "https://arxiv.org/abs/1706.03762v7".into()),
            ("arxiv_id".into(), "1706.03762v7".into()),
            ("description".into(), "新手教程演示版：内置 PDF、MinerU 解析结果、摘要示例译文、阅读笔记、片段记录及批注。可自由练习，不影响自己的论文；回放不会覆盖修改。".into()),
        ]), vec![])?;
        let source = staging_path.join("Attention Is All You Need.pdf");
        atomic_write(&source, pdf)?;
        let mut entry = staged.import_pdf(&entry.id, source)?;
        staged.write_mineru_output_zip(&entry.id, mineru)?;
        staged.write_segments(&entry.id, segments)?;
        // Importing a verified saved result is not a running parser job.
        if let Some(pdf) = entry.pdf.as_mut() {
            pdf.parse = PdfParseState {
                status: PdfParseStatus::Succeeded,
                updated_at: Utc::now(),
                message: Some(format!("内置演示解析结果 · {} 个片段", segments.len())),
                task_id: None,
                endpoint: None,
            };
        }
        atomic_write_json(staged.layout().entry_meta_file(&entry.id), &entry)?;
        let segment = segments
            .iter()
            .find(|segment| segment.uid.as_str() == demo.segment_uid)
            .ok_or_else(|| WorkspaceError::Onboarding("演示引用片段缺失".into()))?;
        staged.upsert_segment_note(&entry.id, segment.uid.clone(), demo.segment_note.clone())?;
        staged.create_annotation(
            &entry.id,
            segment.uid.clone(),
            "演示批注".into(),
            demo.annotation.clone(),
            AnnotationImportance::Important,
        )?;
        let entry = staged.create_note(&entry.id, &demo.note_title)?;
        let Some(ContentItem::Note { note_id, .. }) = entry.contents.last() else {
            return Err(WorkspaceError::Onboarding("演示笔记创建失败".into()));
        };
        let link =
            staged.build_note_source_link(&entry.id, note_id, &entry.id, segment.uid.clone())?;
        let markdown = demo
            .note_markdown
            .replace("{source}", &format!("[^{}]", link.anchor_id));
        staged.update_note_document_if_revision(
            &entry.id,
            note_id,
            &demo.note_title,
            markdown,
            &[link],
            None,
        )?;
        let now = Utc::now();
        let text = segment
            .markdown
            .clone()
            .unwrap_or_else(|| segment.text.clone());
        staged.write_entry_translation(
            &entry.id,
            &EntryTranslation {
                schema_version: 1,
                entry_id: entry.id.clone(),
                task: None,
                source_language: "en".into(),
                target_language: "zh-CN".into(),
                status: TranslationStatus::Partial,
                progress: TranslationProgress {
                    total: segments.len(),
                    translated: 1,
                    skipped: 0,
                    failed: 0,
                },
                paper_context: None,
                model: Some("内置演示译文（非实时模型生成）".into()),
                error: None,
                created_at: now,
                updated_at: now,
                segments: vec![TranslatedSegment {
                    segment_uid: segment.uid.clone(),
                    page_idx: segment.page_idx,
                    segment_type: segment.segment_type,
                    source_hash: translation_hash(&text),
                    source_text: text,
                    translated_text: Some(demo.translation.clone()),
                    status: TranslatedSegmentStatus::Translated,
                    error: None,
                    updated_at: now,
                }],
            },
        )?;
        // The metadata guard is global: acquire only after all staging API calls finish.
        let _guard = self.begin_tag_safe_mutation()?;
        if let Some(existing) = self.find_onboarding_demo()? {
            return Ok(existing);
        }
        fs::rename(
            staged.layout().entry_dir(&entry.id),
            self.layout().entry_dir(&entry.id),
        )?;
        self.read_entry(&entry.id)
    }
}

fn validate(
    demo: &OnboardingDemo,
    pdf: &[u8],
    segments: &[SourceSegment],
    mineru: &[u8],
) -> Result<(), WorkspaceError> {
    let invalid = |message: &str| WorkspaceError::Onboarding(message.into());
    if demo.version != DEMO_ID
        || !pdf.starts_with(b"%PDF-")
        || blake3::hash(pdf).to_hex().as_str() != demo.pdf_hash
    {
        return Err(invalid("演示 PDF 与资源清单不匹配"));
    }
    if segments.is_empty()
        || !segments
            .iter()
            .any(|segment| segment.uid.as_str() == demo.segment_uid)
        || !demo.note_markdown.contains("{source}")
        || demo.translation.trim().is_empty()
    {
        return Err(invalid("演示解析结果或笔记不完整"));
    }
    let mut ids = HashSet::new();
    for segment in segments {
        if !ids.insert(&segment.uid) {
            return Err(invalid("演示片段标识重复"));
        }
        if let Some(path) = &segment.asset_path {
            if path.contains('\\')
                || !std::path::Path::new(path)
                    .components()
                    .all(|part| matches!(part, Component::Normal(_)))
            {
                return Err(invalid("演示图片路径不安全"));
            }
        }
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(mineru))?;
    let mut size = 0u64;
    if zip.len() > 500 {
        return Err(invalid("演示解析资源过多"));
    }
    for index in 0..zip.len() {
        let file = zip.by_index(index)?;
        size = size.saturating_add(file.size());
        if file.enclosed_name().is_none()
            || size > 64 * 1024 * 1024
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(invalid("演示解析资源无效或过大"));
        }
    }
    if zip.is_empty() {
        return Err(invalid("演示解析资源为空"));
    }
    Ok(())
}

// This path is exclusively created by this installer under its cache directory.
struct Staging(PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

// Keep the UTF-16 cache identity used by the reader and translation runtime.
fn translation_hash(text: &str) -> String {
    let mut hash = 2166136261u32;
    for unit in text.encode_utf16() {
        hash = (hash ^ u32::from(unit)).wrapping_mul(16777619);
    }
    format!("{hash:08x}")
}

#[cfg(test)]
#[path = "onboarding_tests.rs"]
mod tests;
