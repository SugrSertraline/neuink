use std::path::PathBuf;

use neuink_domain::{
    Annotation, DomainError, EntryId, EntryReadingState, NeuinkDocument, ReadingStateUpdate,
    SegmentBlockNote, SegmentUid, SourceSegment,
};
use serde::Deserialize;
use tauri::ipc::Response;

#[derive(Debug, Deserialize)]
pub struct ReadPdfReaderRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
}

#[derive(Debug, Deserialize)]
pub struct ReadPdfBytesRequest {
    pub pdf_path: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct UpsertSegmentNoteRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub segment_uid: SegmentUid,
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct DeleteSegmentNoteRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub segment_uid: SegmentUid,
}

#[derive(Debug, Deserialize)]
pub struct SetSegmentNoteBookmarkRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub segment_uid: SegmentUid,
    pub bookmarked: bool,
}

#[tauri::command]
pub fn set_segment_note_bookmark(
    request: SetSegmentNoteBookmarkRequest,
) -> Result<Vec<SegmentBlockNote>, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .set_segment_note_bookmark(&request.entry_id, request.segment_uid, request.bookmarked)
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
pub struct ListReadingStatesRequest {
    pub root: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct UpdateReadingStateRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    #[serde(flatten)]
    pub update: ReadingStateUpdate,
}

#[derive(Debug, serde::Serialize)]
pub struct PdfReaderResponse {
    pub pdf_path: PathBuf,
    pub segments: Vec<SourceSegment>,
    pub segment_notes: Vec<SegmentBlockNote>,
    pub annotations: Vec<Annotation>,
}

#[derive(Debug, serde::Serialize)]
pub struct SegmentNoteCommandError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<usize>,
    pub retryable: bool,
}

impl SegmentNoteCommandError {
    fn from_workspace_error(error: neuink_workspace::WorkspaceError) -> Self {
        match error {
            neuink_workspace::WorkspaceError::Domain(DomainError::SegmentNoteTooLong {
                actual,
                max,
            }) => Self {
                code: "segment_note_too_long".to_string(),
                message: format!("segment note is too long: actual={actual}, max={max}"),
                actual: Some(actual),
                max: Some(max),
                retryable: false,
            },
            error => Self {
                code: "segment_note_save_failed".to_string(),
                message: error.to_string(),
                actual: None,
                max: None,
                retryable: false,
            },
        }
    }
}

#[tauri::command]
pub fn read_pdf_reader(request: ReadPdfReaderRequest) -> Result<PdfReaderResponse, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    let entry = workspace
        .read_entry(&request.entry_id)
        .map_err(|error| error.to_string())?;
    // Parsed-only imports are readable in Reflow even without an original PDF.
    let pdf_path = workspace.layout().entry_pdf_file(&request.entry_id);
    if entry.pdf.is_none()
        && !pdf_path.is_file()
        && !workspace
            .layout()
            .entry_segments_file(&request.entry_id)
            .is_file()
    {
        return Err("该条目没有可读的 PDF 或解析内容".to_string());
    }

    let mut document = NeuinkDocument::new(
        workspace
            .read_segments(&request.entry_id)
            .map_err(|error| error.to_string())?,
    );
    if let Some(middle) = workspace
        .read_mineru_middle_json(&request.entry_id)
        .map_err(|error| error.to_string())?
    {
        neuink_parser::enrich_document_with_middle(&mut document, &middle);
    }

    Ok(PdfReaderResponse {
        pdf_path,
        segments: document.segments,
        segment_notes: workspace
            .read_segment_notes(&request.entry_id)
            .map_err(|error| error.to_string())?,
        annotations: workspace
            .read_annotations(&request.entry_id)
            .map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
pub fn list_reading_states(
    request: ListReadingStatesRequest,
) -> Result<Vec<EntryReadingState>, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .list_reading_states()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_reading_state(request: ReadPdfReaderRequest) -> Result<EntryReadingState, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .read_reading_state(&request.entry_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_reading_state(
    request: UpdateReadingStateRequest,
) -> Result<EntryReadingState, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .update_reading_state(&request.entry_id, request.update)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn read_pdf_bytes(request: ReadPdfBytesRequest) -> Result<Response, String> {
    tokio::fs::read(&request.pdf_path)
        .await
        .map(Response::new)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_pdf_file(request: ReadPdfBytesRequest) -> Result<(), String> {
    validate_pdf_path(&request.pdf_path)?;
    super::entry::open_path_with_system(&request.pdf_path)
}

#[tauri::command]
pub fn reveal_pdf_file(request: ReadPdfBytesRequest) -> Result<(), String> {
    validate_pdf_path(&request.pdf_path)?;
    super::entry::reveal_path_in_file_manager(&request.pdf_path)
}

fn validate_pdf_path(path: &std::path::Path) -> Result<(), String> {
    let is_pdf = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err("selected path is not a PDF file".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn upsert_segment_note(
    request: UpsertSegmentNoteRequest,
) -> Result<Vec<SegmentBlockNote>, SegmentNoteCommandError> {
    let workspace = neuink_workspace::Workspace::open(request.root)
        .map_err(SegmentNoteCommandError::from_workspace_error)?;
    workspace
        .upsert_segment_note(&request.entry_id, request.segment_uid, request.text)
        .map_err(SegmentNoteCommandError::from_workspace_error)
}

#[tauri::command]
pub fn delete_segment_note(
    request: DeleteSegmentNoteRequest,
) -> Result<Vec<SegmentBlockNote>, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .delete_segment_note(&request.entry_id, request.segment_uid)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use neuink_domain::PdfParseStatus;
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn serializes_segment_note_limit_errors_with_machine_readable_fields() {
        let error = SegmentNoteCommandError::from_workspace_error(
            neuink_workspace::WorkspaceError::Domain(DomainError::SegmentNoteTooLong {
                actual: 501,
                max: 500,
            }),
        );

        assert_eq!(
            serde_json::to_value(error).unwrap(),
            json!({
                "code": "segment_note_too_long",
                "message": "segment note is too long: actual=501, max=500",
                "actual": 501,
                "max": 500,
                "retryable": false
            })
        );
    }

    #[test]
    fn validates_pdf_paths_case_insensitively() {
        assert!(validate_pdf_path(std::path::Path::new("paper.PDF")).is_ok());
        assert!(validate_pdf_path(std::path::Path::new("paper.txt")).is_err());
    }

    #[test]
    fn reads_parsed_only_content_without_pdf_metadata_or_file() {
        let root = test_workspace_root();
        let workspace = neuink_workspace::Workspace::create(&root).unwrap();
        let entry = workspace.create_entry("Parsed-only import").unwrap();
        assert!(entry.pdf.is_none());
        workspace
            .write_segments(
                &entry.id,
                &[SourceSegment::new(
                    neuink_domain::SegmentType::Paragraph,
                    0,
                    None,
                    "Parsed content".into(),
                )],
            )
            .unwrap();
        let response = read_pdf_reader(ReadPdfReaderRequest {
            root: root.clone(),
            entry_id: entry.id,
        })
        .unwrap();
        assert!(!response.pdf_path.exists());
        assert_eq!(response.segments.len(), 1);
        assert_eq!(response.segments[0].text, "Parsed content");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_the_original_pdf_while_parsing_is_queued_or_failed() {
        let root = test_workspace_root();
        let source_pdf = root.with_extension("source.pdf");
        fs::write(&source_pdf, b"%PDF-1.4\n% offline reader fixture").expect("write source PDF");
        let workspace = neuink_workspace::Workspace::create(&root).expect("create workspace");
        let entry = workspace
            .create_entry("Offline paper")
            .expect("create entry");
        workspace
            .import_pdf(&entry.id, &source_pdf)
            .expect("import PDF");

        workspace
            .set_pdf_parse_state(&entry.id, PdfParseStatus::Queued, None)
            .expect("queue parsing");
        assert_original_pdf_is_readable(&root, &entry.id);

        workspace
            .set_pdf_parse_state(&entry.id, PdfParseStatus::Uploading, None)
            .expect("start uploading");
        workspace
            .set_pdf_parse_state(
                &entry.id,
                PdfParseStatus::Failed,
                Some("parser unavailable".to_string()),
            )
            .expect("fail parsing");
        assert_original_pdf_is_readable(&root, &entry.id);

        fs::remove_dir_all(&root).expect("remove test workspace");
        fs::remove_file(&source_pdf).expect("remove source PDF");
    }

    fn assert_original_pdf_is_readable(root: &std::path::Path, entry_id: &EntryId) {
        let response = read_pdf_reader(ReadPdfReaderRequest {
            root: root.to_path_buf(),
            entry_id: entry_id.clone(),
        })
        .expect("read original PDF while parser is unavailable");

        assert!(response.pdf_path.is_file());
        assert!(response.segments.is_empty());
    }

    fn test_workspace_root() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "neuink-ipc-pdf-reader-{}-{unique}",
            std::process::id()
        ))
    }
}
