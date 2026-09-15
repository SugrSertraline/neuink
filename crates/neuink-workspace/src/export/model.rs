use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PaperExportKind {
    Source,
    Translation,
    Bilingual,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PaperExportFormat {
    Docx,
    Txt,
    MarkdownZip,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagramExportMode {
    #[default]
    Original,
    Rendered,
    Mermaid,
    OriginalWithSource,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportImageWidth {
    Compact,
    #[default]
    Standard,
    Full,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct PaperExportOptions {
    pub diagrams: DiagramExportMode,
    pub image_width: ExportImageWidth,
    pub include_source_refs: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct ExportDiagram {
    pub id: String,
    pub segment_uid: String,
    pub page: u32,
    pub code: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RenderedExportDiagram {
    pub id: String,
    pub png_base64: String,
}

pub struct PaperExportRequest<'a> {
    pub kind: PaperExportKind,
    pub format: PaperExportFormat,
    pub target: &'a std::path::Path,
    pub expected_fingerprint: &'a str,
    pub allow_draft: bool,
    pub options: &'a PaperExportOptions,
    pub rendered_diagrams: &'a [RenderedExportDiagram],
}

impl PaperExportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Docx => "docx",
            Self::Txt => "txt",
            Self::MarkdownZip => "zip",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ExportIssue {
    pub segment_uid: String,
    pub page: u32,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct PaperExportInspection {
    pub fingerprint: String,
    pub total: usize,
    pub translated: usize,
    pub preserved: usize,
    pub missing: usize,
    pub stale: usize,
    pub unverified_images: usize,
    pub missing_assets: usize,
    /// Missing translations, stale translations, or unavailable assets require explicit consent.
    /// Unverified image text remains informational and does not force a draft.
    pub requires_draft: bool,
    pub issues: Vec<ExportIssue>,
    pub diagrams: Vec<ExportDiagram>,
}

#[derive(Debug, Serialize)]
pub struct PaperExportPreview {
    pub fingerprint: String,
    pub segment_uid: String,
    pub page: u32,
    pub markdown: String,
    pub assets: std::collections::BTreeMap<String, String>,
    pub diagrams: Vec<ExportDiagram>,
}

pub struct PaperExportPreviewRequest<'a> {
    pub kind: PaperExportKind,
    pub options: &'a PaperExportOptions,
    pub expected_fingerprint: &'a str,
    pub segment_uid: &'a str,
}

impl PaperExportInspection {
    pub(super) fn new(total: usize) -> Self {
        Self {
            fingerprint: String::new(),
            total,
            translated: 0,
            preserved: 0,
            missing: 0,
            stale: 0,
            unverified_images: 0,
            missing_assets: 0,
            requires_draft: false,
            issues: Vec::new(),
            diagrams: Vec::new(),
        }
    }
}

pub(super) struct ExportAsset {
    pub name: String,
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub(super) struct PreparedExport {
    pub title: String,
    pub markdown: String,
    pub assets: std::collections::BTreeMap<String, ExportAsset>,
    pub report: PaperExportInspection,
    pub options: PaperExportOptions,
    pub diagram_sources: std::collections::BTreeMap<String, String>,
    pub issue_content: std::collections::BTreeMap<String, String>,
}

pub const COVERAGE_NOTICE: &str = "本文件按当前解析结果逐项导出，未对原 PDF 逐页核验；处理完全部解析片段不代表原 PDF 没有识别遗漏。图片内文字未做 OCR 翻译核验；公式保留源表示，不承诺可编辑 Word 公式。";
