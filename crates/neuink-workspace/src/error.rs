use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("{0}")]
    LocalCopy(String),
    #[error("外部来源条目只能隐藏或恢复。请到 Zotero 或 MinerU 来源端删除原论文。")]
    SourceManagedEntry,
    #[error("只有带有 Zotero 或 MinerU 来源记录的条目支持隐藏。")]
    SourceVisibilityUnavailable,
    #[error("{0}")]
    Zotero(String),
    #[error("{0}")]
    Daily(String),
    #[error("invalid reading session: {0}")]
    InvalidReadingSession(String),
    #[error("{0}")]
    Onboarding(String),
    #[error("{0}")]
    PdfQueue(String),
    #[error("{0}")]
    PdfText(String),
    #[error("{0}")]
    ParagraphTranslation(String),
    #[error("{0}")]
    TagReading(String),
    #[error(transparent)]
    Domain(#[from] neuink_domain::DomainError),
    #[error("entry already exists: {0}")]
    EntryAlreadyExists(String),
    #[error("entry does not exist: {0}")]
    EntryMissing(String),
    #[error("entry changed after the proposal was created: {0}")]
    EntryRevisionConflict(String),
    #[error("note already exists: {0}")]
    NoteAlreadyExists(String),
    #[error("note does not exist: {0}")]
    NoteMissing(String),
    #[error("note changed after it was opened: {0}")]
    NoteRevisionConflict(String),
    #[error("segment note changed after the proposal was created")]
    SegmentNoteConflict(String),
    #[error("invalid note document: {0}")]
    InvalidNoteDocument(String),
    #[error("tag already exists under the same parent: {0}")]
    TagAlreadyExists(String),
    #[error("tag does not exist: {0}")]
    TagMissing(String),
    #[error("segment does not exist: {0}")]
    SegmentMissing(String),
    #[error("annotation does not exist: {0}")]
    AnnotationMissing(String),
    #[error("trash item does not exist: {0}")]
    TrashItemMissing(String),
    #[error("trash item cannot be restored because its destination already exists: {0}")]
    TrashRestoreConflict(String),
    #[error("invalid tag parent: {0}")]
    InvalidTagParent(String),
    #[error("entry already has a PDF: {0}")]
    PdfAlreadyExists(String),
    #[error("相同内容的 PDF 已在本地：{0}")]
    PdfContentDuplicate(String),
    #[error("entry has no PDF: {0}")]
    PdfMissing(String),
    #[error("invalid PDF display name: {0}")]
    InvalidPdfDisplayName(String),
    #[error("reading PDF changed since it was loaded; reload the entry before replacing it: {0}")]
    ReadingPdfChanged(String),
    #[error("file is not a PDF: {0}")]
    ReadingPdfInvalid(String),
    #[error("reading PDF was not replaced because verification failed: {0}")]
    ReadingPdfVerification(String),
    #[error("reading PDF replacement failed and restoring the previous files also failed: {0}")]
    ReadingPdfRollbackFailed(String),
    #[error("entry PDF is not parsed: {0}")]
    PdfNotParsed(String),
    #[error("invalid PDF parse transition: {0}")]
    InvalidPdfParseTransition(String),
    #[error("workspace path does not exist: {0}")]
    WorkspaceMissing(PathBuf),
    #[error("workspace marker is missing: {0}")]
    WorkspaceMarkerMissing(PathBuf),
    #[error("workspace path is not a directory: {0}")]
    WorkspaceNotDirectory(PathBuf),
    #[error("unsupported workspace schema version {0}")]
    WorkspaceSchemaUnsupported(u16),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
}
