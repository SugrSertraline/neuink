use std::path::PathBuf;

use neuink_domain::{
    Annotation, EntryId, NeuinkDocument, SegmentBlockNote, SegmentUid, SourceSegment,
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

#[derive(Debug, serde::Serialize)]
pub struct PdfReaderResponse {
    pub pdf_path: PathBuf,
    pub segments: Vec<SourceSegment>,
    pub segment_notes: Vec<SegmentBlockNote>,
    pub annotations: Vec<Annotation>,
}

#[tauri::command]
pub fn read_pdf_reader(request: ReadPdfReaderRequest) -> Result<PdfReaderResponse, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    let entry = workspace
        .read_entry(&request.entry_id)
        .map_err(|error| error.to_string())?;
    if entry.pdf.is_none() {
        return Err("selected entry has no PDF".to_string());
    }

    let pdf_path = workspace
        .entry_pdf_path(&request.entry_id)
        .map_err(|error| error.to_string())?;

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
pub async fn read_pdf_bytes(request: ReadPdfBytesRequest) -> Result<Response, String> {
    tokio::fs::read(&request.pdf_path)
        .await
        .map(Response::new)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn upsert_segment_note(
    request: UpsertSegmentNoteRequest,
) -> Result<Vec<SegmentBlockNote>, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .upsert_segment_note(&request.entry_id, request.segment_uid, request.text)
        .map_err(|error| error.to_string())
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
