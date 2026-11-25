//! Replaces the reading PDF of an existing entry while keeping its parsed data.
//!
//! Only `paper.pdf`, `entry.meta.json`, and `paper.reading.json` (when its
//! `document_hash` still names the old PDF) are written. Each file is written
//! atomically, and a failed step restores the files already written.
//!
//! Page-level verification does not parse PDF in Rust. The frontend renders both
//! PDFs with PDF.js and sends a summary (page count, visible box, rotation, text
//! anchors) for each file. The summary is bound to the file bytes by SHA-256,
//! which this module recomputes from the bytes it receives, so a summary can only
//! be applied to the exact bytes it describes. The two summaries are then
//! compared here, not in the frontend.

use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use chrono::Utc;
use neuink_domain::{EntryId, EntryMeta, PdfAsset, ReadingState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{atomic_write, Workspace, WorkspaceError};

/// Largest accepted difference, in PDF points, for a box coordinate. Identical
/// files give identical PDF.js values, so anything above this is a layout change.
pub const GEOMETRY_TOLERANCE_PT: f64 = 0.1;

/// Number of characters kept from each page's text as an anchor.
pub const TEXT_ANCHOR_MAX_CHARS: usize = 64;

/// Decides whether a candidate PDF may be paired with a MinerU result.
///
/// Any `Err` stops the caller before a byte is written.
pub trait ReadingPdfVerifier {
    fn verify(&self, candidate_pdf: &[u8], mineru_origin_pdf: &[u8]) -> Result<(), String>;
}

/// Whether the frontend read MediaBox and CropBox independently for every page.
/// PDF.js exposes only the intersection, so the frontend parses the boxes itself,
/// and a document without a complete, cross-checked parse is `Unavailable`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GeometryProof {
    Independent,
    #[default]
    Unavailable,
}

/// One page as PDF.js reports it, plus the page boxes read from the file structure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PdfPageSummary {
    /// Visible box `[x0, y0, x1, y1]` in default user space. PDF.js reports the
    /// CropBox intersected with the MediaBox, so it cannot prove either box alone.
    pub view_box: [f64; 4],
    /// MediaBox read from the page structure. `None` when it is not proven.
    #[serde(default)]
    pub media_box: Option<[f64; 4]>,
    /// CropBox read from the page structure. `None` when it is not proven.
    #[serde(default)]
    pub crop_box: Option<[f64; 4]>,
    /// Page rotation in degrees, as PDF.js normalizes it (0, 90, 180, or 270).
    pub rotate: i64,
    pub user_unit: f64,
    /// Normalized leading text of the page, at most `TEXT_ANCHOR_MAX_CHARS` characters.
    pub text_anchor: String,
}

/// Summary of one PDF file, bound to its bytes by `sha256` (lowercase hex).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PdfDocumentSummary {
    pub sha256: String,
    pub page_count: usize,
    /// Missing in summaries from older builds, which then count as unproven.
    #[serde(default)]
    pub geometry_proof: GeometryProof,
    pub pages: Vec<PdfPageSummary>,
}

/// Summaries for a candidate reading PDF and the MinerU origin copy it must match.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PdfPairSummary {
    pub candidate: PdfDocumentSummary,
    pub origin: PdfDocumentSummary,
}

impl ReadingPdfVerifier for PdfPairSummary {
    fn verify(&self, candidate_pdf: &[u8], mineru_origin_pdf: &[u8]) -> Result<(), String> {
        check_bytes_match("候选 PDF", candidate_pdf, &self.candidate)?;
        check_bytes_match("MinerU 原件 paper_origin.pdf", mineru_origin_pdf, &self.origin)?;
        compare_documents(&self.candidate, &self.origin)
    }
}

/// Rejects bytes that do not start with the PDF header. This is a shape check only.
pub fn validate_pdf_bytes(bytes: &[u8]) -> Result<(), WorkspaceError> {
    if bytes.starts_with(b"%PDF-") {
        Ok(())
    } else {
        Err(WorkspaceError::ReadingPdfInvalid(
            "缺少 %PDF- 文件头".to_string(),
        ))
    }
}

/// Lowercase hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn check_bytes_match(label: &str, bytes: &[u8], summary: &PdfDocumentSummary) -> Result<(), String> {
    if sha256_hex(bytes) != summary.sha256.to_ascii_lowercase() {
        return Err(format!(
            "{label}的内容与校验摘要不一致，文件可能在校验后被修改。请重新选择文件后再导入。"
        ));
    }
    Ok(())
}

fn compare_documents(candidate: &PdfDocumentSummary, origin: &PdfDocumentSummary) -> Result<(), String> {
    if candidate.page_count == 0 {
        return Err("候选 PDF 没有页面，未写入。".into());
    }
    if candidate.page_count != origin.page_count {
        return Err(format!(
            "页数不一致：候选 PDF {} 页，MinerU 原件 {} 页。请确认选择的是同一篇论文的原始 PDF。",
            candidate.page_count, origin.page_count
        ));
    }
    if candidate.pages.len() != candidate.page_count || origin.pages.len() != origin.page_count {
        return Err("校验摘要的页面记录与页数不一致，未写入。".into());
    }
    if candidate.geometry_proof != GeometryProof::Independent
        || origin.geometry_proof != GeometryProof::Independent
    {
        return Err(
            "无法独立读取候选 PDF 或 MinerU 原件的 MediaBox/CropBox，不能证明页面几何一致，未写入。"
                .into(),
        );
    }
    // Empty anchors on every page of both files prove nothing about identity, since
    // any two text-free PDFs would match. A single empty page is still allowed.
    let has_text_anchor = |doc: &PdfDocumentSummary| {
        doc.pages
            .iter()
            .any(|page| !normalize_anchor(&page.text_anchor).is_empty())
    };
    if !has_text_anchor(candidate) && !has_text_anchor(origin) {
        return Err(
            "候选 PDF 与 MinerU 原件均无文本层，无法证明两者是同一文档，未写入。".into(),
        );
    }
    for (index, (cand, orig)) in candidate.pages.iter().zip(&origin.pages).enumerate() {
        compare_page(index + 1, cand, orig)?;
    }
    Ok(())
}

fn compare_page(page: usize, cand: &PdfPageSummary, orig: &PdfPageSummary) -> Result<(), String> {
    let cand_rotate = normalize_rotate(cand.rotate)
        .ok_or_else(|| format!("第 {page} 页候选 PDF 的旋转角度 {} 无效。", cand.rotate))?;
    let orig_rotate = normalize_rotate(orig.rotate)
        .ok_or_else(|| format!("第 {page} 页 MinerU 原件的旋转角度 {} 无效。", orig.rotate))?;
    if cand_rotate != orig_rotate {
        return Err(format!(
            "第 {page} 页旋转角度不一致：候选 PDF {cand_rotate}°，MinerU 原件 {orig_rotate}°。"
        ));
    }

    compare_independent_box(page, "MediaBox", cand.media_box, orig.media_box)?;
    compare_independent_box(page, "CropBox", cand.crop_box, orig.crop_box)?;

    let cand_box = normalize_box(page, "候选 PDF", &cand.view_box)?;
    let orig_box = normalize_box(page, "MinerU 原件", &orig.view_box)?;
    let labels = ["左边界", "下边界", "右边界", "上边界"];
    for (i, label) in labels.iter().enumerate() {
        if (cand_box[i] - orig_box[i]).abs() > GEOMETRY_TOLERANCE_PT {
            return Err(format!(
                "第 {page} 页可见区域不一致（{label}）：候选 PDF {:.2} pt，MinerU 原件 {:.2} pt。页面尺寸、裁切框或原点不同。",
                cand_box[i], orig_box[i]
            ));
        }
    }

    if !cand.user_unit.is_finite() || !orig.user_unit.is_finite() || (cand.user_unit - orig.user_unit).abs() > 1e-6 {
        return Err(format!("第 {page} 页 UserUnit 不一致，未写入。"));
    }

    let cand_text = normalize_anchor(&cand.text_anchor);
    let orig_text = normalize_anchor(&orig.text_anchor);
    if cand_text != orig_text {
        return Err(format!(
            "第 {page} 页文本锚点不一致：候选 PDF 为“{cand_text}”，MinerU 原件为“{orig_text}”。候选 PDF 可能不是这篇论文的同一版本。"
        ));
    }
    Ok(())
}

/// Compares one page box that the frontend read from the file structure. Both
/// sides must be present; a missing box is an unproven geometry, not a match.
fn compare_independent_box(
    page: usize,
    name: &str,
    cand: Option<[f64; 4]>,
    orig: Option<[f64; 4]>,
) -> Result<(), String> {
    let (Some(cand), Some(orig)) = (cand, orig) else {
        return Err(format!("第 {page} 页无法独立证明 {name}，未写入。"));
    };
    let cand_box = normalize_box(page, "候选 PDF", &cand)?;
    let orig_box = normalize_box(page, "MinerU 原件", &orig)?;
    let labels = ["左边界", "下边界", "右边界", "上边界"];
    for (i, label) in labels.iter().enumerate() {
        if (cand_box[i] - orig_box[i]).abs() > GEOMETRY_TOLERANCE_PT {
            return Err(format!(
                "第 {page} 页 {name} 不一致（{label}）：候选 PDF {:.2} pt，MinerU 原件 {:.2} pt。",
                cand_box[i], orig_box[i]
            ));
        }
    }
    Ok(())
}

/// Maps a rotation to 0, 90, 180, or 270. Other values are rejected because the
/// page's displayed orientation cannot be compared reliably.
fn normalize_rotate(rotate: i64) -> Option<i64> {
    let value = rotate.rem_euclid(360);
    matches!(value, 0 | 90 | 180 | 270).then_some(value)
}

/// Orders the corners so `[x0, y0, x1, y1]` has `x0 <= x1` and `y0 <= y1`.
/// Rejects non-finite or empty boxes.
fn normalize_box(page: usize, side: &str, raw: &[f64; 4]) -> Result<[f64; 4], String> {
    if raw.iter().any(|value| !value.is_finite()) {
        return Err(format!("第 {page} 页{side}的可见区域包含无效数值。"));
    }
    let x0 = raw[0].min(raw[2]);
    let x1 = raw[0].max(raw[2]);
    let y0 = raw[1].min(raw[3]);
    let y1 = raw[1].max(raw[3]);
    if x1 - x0 <= 0.0 || y1 - y0 <= 0.0 {
        return Err(format!("第 {page} 页{side}的可见区域为空。"));
    }
    Ok([x0, y0, x1, y1])
}

/// Collapses whitespace so differences in spacing between two extractions do not
/// count as text changes. The frontend already applied Unicode normalization.
fn normalize_anchor(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(TEXT_ANCHOR_MAX_CHARS)
        .collect()
}

type FileWriter<'a> = &'a dyn Fn(&Path, &[u8]) -> Result<(), WorkspaceError>;

impl Workspace {
    /// Replaces `paper.pdf` for an entry that already has one.
    ///
    /// `expected_content_hash` is the BLAKE3 hash the caller last saw. A different
    /// current hash means the reading PDF changed, and nothing is written.
    pub fn replace_reading_pdf(
        &self,
        entry_id: &EntryId,
        file_name: &str,
        candidate_pdf: &[u8],
        expected_content_hash: &str,
        verifier: &dyn ReadingPdfVerifier,
    ) -> Result<EntryMeta, WorkspaceError> {
        self.replace_reading_pdf_with_writer(
            entry_id,
            file_name,
            candidate_pdf,
            expected_content_hash,
            verifier,
            &|path: &Path, bytes: &[u8]| atomic_write(path, bytes),
        )
    }

    pub(crate) fn replace_reading_pdf_with_writer(
        &self,
        entry_id: &EntryId,
        file_name: &str,
        candidate_pdf: &[u8],
        expected_content_hash: &str,
        verifier: &dyn ReadingPdfVerifier,
        write_file: FileWriter<'_>,
    ) -> Result<EntryMeta, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let mut entry = self.read_entry(entry_id)?;
        let current = entry
            .pdf
            .clone()
            .ok_or_else(|| WorkspaceError::PdfMissing(entry_id.to_string()))?;
        if current.content_hash != expected_content_hash {
            return Err(WorkspaceError::ReadingPdfChanged(entry_id.to_string()));
        }
        validate_pdf_bytes(candidate_pdf)?;
        let origin_pdf = self.mineru_origin_pdf_bytes(entry_id)?;
        verifier
            .verify(candidate_pdf, &origin_pdf)
            .map_err(WorkspaceError::ReadingPdfVerification)?;

        let new_hash = blake3::hash(candidate_pdf).to_hex().to_string();
        let pdf_path = self.layout().entry_pdf_file(entry_id);
        let meta_path = self.layout().entry_meta_file(entry_id);
        let state_path = self.layout().entry_reading_state_file(entry_id);

        let original_pdf = fs::read(&pdf_path)?;
        let original_meta = fs::read(&meta_path)?;
        let original_state = if state_path.exists() {
            Some(fs::read(&state_path)?)
        } else {
            None
        };

        // Reading progress is keyed by document hash. Carry it over to the new
        // hash so visited pages survive; the page structure was verified above.
        let state_update = match &original_state {
            Some(bytes) => {
                let mut state: ReadingState = serde_json::from_slice(bytes)?;
                if state.document_hash.as_deref() == Some(current.content_hash.as_str()) {
                    state.document_hash = Some(new_hash.clone());
                    Some(serde_json::to_vec_pretty(&state)?)
                } else {
                    None
                }
            }
            None => None,
        };

        entry.pdf = Some(PdfAsset {
            file_name: file_name.to_string(),
            content_hash: new_hash,
            imported_at: Utc::now(),
            parse: current.parse,
        });
        entry.updated_at = Utc::now();
        let meta_bytes = serde_json::to_vec_pretty(&entry)?;

        let mut steps: Vec<(PathBuf, Vec<u8>, Vec<u8>)> = vec![
            (pdf_path, candidate_pdf.to_vec(), original_pdf),
            (meta_path, meta_bytes, original_meta),
        ];
        if let (Some(bytes), Some(original)) = (state_update, original_state) {
            steps.push((state_path, bytes, original));
        }

        let mut written: Vec<(PathBuf, Vec<u8>)> = Vec::new();
        for (path, new_bytes, original_bytes) in steps {
            if let Err(error) = write_file(&path, &new_bytes) {
                return Err(rollback(written, error, write_file));
            }
            written.push((path, original_bytes));
        }
        Ok(entry)
    }

    /// Reads the MinerU origin PDF that the entry's parse output carries.
    pub fn mineru_origin_pdf_bytes(&self, entry_id: &EntryId) -> Result<Vec<u8>, WorkspaceError> {
        let path = self
            .layout()
            .entry_mineru_output_dir(entry_id)
            .join("paper_origin.pdf");
        if path.is_file() {
            return Ok(fs::read(path)?);
        }
        // Beta also accepts a single PDF without the conventional origin suffix.
        // Resolve it from the saved archive, never from the mutable reading PDF.
        let archive_path = self.layout().entry_mineru_output_zip(entry_id);
        if !archive_path.is_file() {
            return Err(WorkspaceError::ReadingPdfVerification(
                "条目缺少 MinerU 原件与结果包，无法与候选 PDF 对照".to_string(),
            ));
        }
        const MAX_PDF_BYTES: u64 = 512 * 1024 * 1024;
        let file = fs::File::open(archive_path)?;
        if file.metadata()?.len() > 1024 * 1024 * 1024 {
            return Err(WorkspaceError::ReadingPdfVerification("MinerU 结果包过大".into()));
        }
        let mut archive = zip::ZipArchive::new(file)?;
        if archive.len() > 10_000 {
            return Err(WorkspaceError::ReadingPdfVerification("MinerU 结果包文件过多".into()));
        }
        let mut preferred = Vec::new();
        let mut fallback = Vec::new();
        for index in 0..archive.len() {
            let entry = archive.by_index(index)?;
            let name = entry.name().to_ascii_lowercase();
            if entry.is_dir() || name.ends_with("_layout.pdf") || name.ends_with("_span.pdf") {
                continue;
            }
            if name.ends_with("_origin.pdf") {
                preferred.push(index);
            } else if name.ends_with(".pdf") {
                fallback.push(index);
            }
        }
        let candidates = if preferred.is_empty() { fallback } else { preferred };
        if candidates.len() != 1 {
            return Err(WorkspaceError::ReadingPdfVerification(
                "MinerU 结果包缺少唯一原始 PDF，无法与候选 PDF 对照".into(),
            ));
        }
        let mut entry = archive.by_index(candidates[0])?;
        if entry.size() > MAX_PDF_BYTES {
            return Err(WorkspaceError::ReadingPdfVerification("MinerU 原始 PDF 过大".into()));
        }
        let mut bytes = Vec::new();
        entry.by_ref().take(MAX_PDF_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_PDF_BYTES {
            return Err(WorkspaceError::ReadingPdfVerification("MinerU 原始 PDF 过大".into()));
        }
        validate_pdf_bytes(&bytes)?;
        Ok(bytes)
    }
}

/// Restores already-written files in reverse order. The original write error is
/// returned unless a restore also fails, in which case the restore error is
/// reported because the entry may now be inconsistent.
fn rollback(
    written: Vec<(PathBuf, Vec<u8>)>,
    error: WorkspaceError,
    write_file: FileWriter<'_>,
) -> WorkspaceError {
    let mut failures: BTreeMap<String, String> = BTreeMap::new();
    for (path, original) in written.into_iter().rev() {
        if let Err(restore_error) = write_file(&path, &original) {
            failures.insert(path.display().to_string(), restore_error.to_string());
        }
    }
    if failures.is_empty() {
        error
    } else {
        WorkspaceError::ReadingPdfRollbackFailed(format!("{failures:?}"))
    }
}
