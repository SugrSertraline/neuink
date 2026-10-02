//! Rebuildable, revision-bound PDF.js text. Never substitutes for parsed segments.
use crate::{atomic_write, Workspace, WorkspaceError};
use neuink_domain::{EntryId, SegmentType, SegmentUid, SourceSegment};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Read};

pub const PDF_TEXT_PREFIX: &str = "pdf-text-v1:";
pub const MAX_PDF_BYTES: u64 = 64 * 1024 * 1024;
const MAX_CACHE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PAGES: u32 = 2000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct PdfTextPage {
    pub page_idx: u32,
    pub text: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct PdfTextInfo {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub revision: String,
    pub page_count: Option<u32>,
    pub pages: Vec<PdfTextPage>,
}

#[derive(Debug, Deserialize, Serialize)]
struct PdfTextCache {
    revision: String,
    page_count: u32,
    pages: BTreeMap<u32, PdfTextPage>,
}

fn invalid(message: &str) -> WorkspaceError {
    WorkspaceError::PdfText(message.to_owned())
}

pub fn pdf_text_anchor(value: &str) -> Option<(&str, u32)> {
    let (revision, page) = value.strip_prefix(PDF_TEXT_PREFIX)?.split_once(':')?;
    if revision.len() != 64 || !revision.bytes().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let page: u32 = page.parse().ok()?;
    (page < MAX_PAGES).then_some((revision, page))
}

impl Workspace {
    /// The host derives the path from validated identity; no model-supplied paths or URLs.
    pub fn read_assistant_pdf_bytes(
        &self,
        entry_id: &EntryId,
        revision: Option<&str>,
    ) -> Result<Vec<u8>, WorkspaceError> {
        crate::tag_reading::validate_id(entry_id.as_str())?;
        let path = self.layout().entry_pdf_file(entry_id);
        self.validate_note_workspace_path(&path)?;
        self.read_entry(entry_id)?;
        let file = fs::File::open(&path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                WorkspaceError::PdfMissing(entry_id.to_string())
            } else {
                WorkspaceError::Io(e)
            }
        })?;
        if file.metadata()?.len() > MAX_PDF_BYTES {
            return Err(invalid("PDF 超过基础读取的 64 MiB 上限，请使用完整解析。"));
        }
        let mut bytes = Vec::new();
        file.take(MAX_PDF_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_PDF_BYTES {
            return Err(invalid("PDF 超过基础读取上限。"));
        }
        if !bytes
            .iter()
            .take(1024)
            .copied()
            .collect::<Vec<_>>()
            .windows(5)
            .any(|w| w == b"%PDF-")
        {
            return Err(invalid("文件不是有效的 PDF，请检查原文件。"));
        }
        if revision.is_some_and(|expected| blake3::hash(&bytes).to_hex().as_str() != expected) {
            return Err(invalid("PDF 已变化，请重新读取后再使用来源。"));
        }
        Ok(bytes)
    }

    pub fn inspect_pdf_text(
        &self,
        entry_id: &EntryId,
        start_page: u32,
        count: u32,
    ) -> Result<PdfTextInfo, WorkspaceError> {
        if start_page == 0 || start_page > MAX_PAGES || !(1..=20).contains(&count) {
            return Err(invalid("页码范围无效，每次最多读取 20 页。"));
        }
        let bytes = self.read_assistant_pdf_bytes(entry_id, None)?;
        let revision = blake3::hash(&bytes).to_hex().to_string();
        let cache = self.read_pdf_text_cache(entry_id, &revision)?;
        let pages = cache
            .as_ref()
            .map(|c| {
                c.pages
                    .values()
                    .filter(|p| p.page_idx >= start_page - 1 && p.page_idx < start_page - 1 + count)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        Ok(PdfTextInfo {
            entry_id: entry_id.clone(),
            entry_title: self.read_entry(entry_id)?.title,
            revision,
            page_count: cache.map(|c| c.page_count),
            pages,
        })
    }

    /// Called only by the trusted local PDF extractor, not registered as an Agent tool.
    pub fn cache_pdf_text(
        &self,
        entry_id: &EntryId,
        revision: &str,
        page_count: u32,
        pages: Vec<PdfTextPage>,
    ) -> Result<(), WorkspaceError> {
        if page_count == 0
            || page_count > MAX_PAGES
            || pages.len() > 20
            || pages
                .iter()
                .any(|p| p.page_idx >= page_count || p.text.chars().count() > 20_000)
        {
            return Err(invalid("PDF 文字缓存超出页数或文本上限。"));
        }
        let _guard = self.begin_tag_safe_mutation()?;
        self.read_assistant_pdf_bytes(entry_id, Some(revision))?;
        let mut cache = self
            .read_pdf_text_cache(entry_id, revision)?
            .unwrap_or_else(|| PdfTextCache {
                revision: revision.to_owned(),
                page_count,
                pages: BTreeMap::new(),
            });
        if cache.page_count != page_count {
            return Err(invalid("PDF 页数不一致，请重新读取。"));
        }
        for page in pages {
            if cache
                .pages
                .get(&page.page_idx)
                .is_some_and(|old| old != &page)
            {
                return Err(invalid("同一 PDF 页的文字快照发生冲突，请重新解析。"));
            }
            cache.pages.insert(page.page_idx, page);
        }
        let data = serde_json::to_vec(&cache)?;
        if data.len() as u64 > MAX_CACHE_BYTES {
            return Err(invalid("此 PDF 的基础文字缓存已达上限，请使用完整解析。"));
        }
        let path = self.pdf_text_cache_path(entry_id)?;
        fs::create_dir_all(path.parent().ok_or_else(|| invalid("缓存路径无效"))?)?;
        atomic_write(&path, &data)
    }

    pub(crate) fn resolve_pdf_text_segment(
        &self,
        entry_id: &EntryId,
        uid: &SegmentUid,
    ) -> Result<SourceSegment, WorkspaceError> {
        let (revision, page_idx) =
            pdf_text_anchor(uid.as_str()).ok_or_else(|| invalid("PDF 来源标识无效。"))?;
        self.read_assistant_pdf_bytes(entry_id, Some(revision))?;
        let page = self
            .read_pdf_text_cache(entry_id, revision)?
            .and_then(|mut c| c.pages.remove(&page_idx))
            .ok_or_else(|| WorkspaceError::SegmentMissing(uid.to_string()))?;
        if page.text.trim().is_empty() {
            return Err(invalid("该页没有可提取文字，不能作为文字证据。"));
        }
        let mut segment = SourceSegment::new(SegmentType::Paragraph, page_idx, None, page.text);
        segment.uid = uid.clone();
        segment.raw_type = Some("pdf_text_layer".to_owned());
        Ok(segment)
    }

    fn pdf_text_cache_path(
        &self,
        entry_id: &EntryId,
    ) -> Result<std::path::PathBuf, WorkspaceError> {
        crate::tag_reading::validate_id(entry_id.as_str())?;
        let path = self
            .layout()
            .cache_dir()
            .join("pdf-text-v1")
            .join(format!("{}.json", entry_id.as_str()));
        self.validate_note_workspace_path(&path)?;
        Ok(path)
    }

    fn read_pdf_text_cache(
        &self,
        entry_id: &EntryId,
        revision: &str,
    ) -> Result<Option<PdfTextCache>, WorkspaceError> {
        let path = self.pdf_text_cache_path(entry_id)?;
        if !path.is_file() {
            return Ok(None);
        }
        let file = fs::File::open(path)?;
        if file.metadata()?.len() > MAX_CACHE_BYTES {
            return Ok(None);
        }
        let mut bytes = Vec::new();
        file.take(MAX_CACHE_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_CACHE_BYTES {
            return Ok(None);
        }
        // Corrupt or old caches are rebuilt; documents and saved source snapshots stay untouched.
        let Ok(cache) = serde_json::from_slice::<PdfTextCache>(&bytes) else {
            return Ok(None);
        };
        if cache.revision != revision
            || cache.page_count == 0
            || cache.page_count > MAX_PAGES
            || cache.pages.len() > MAX_PAGES as usize
            || cache.pages.iter().any(|(key, p)| {
                *key != p.page_idx
                    || p.page_idx >= cache.page_count
                    || p.text.chars().count() > 20_000
            })
        {
            return Ok(None);
        }
        Ok(Some(cache))
    }
}

#[cfg(test)]
#[path = "pdf_text_tests.rs"]
mod tests;
