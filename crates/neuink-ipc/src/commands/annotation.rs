use std::path::PathBuf;

use neuink_domain::{
    Annotation, AnnotationId, AnnotationImportance, AnnotationTextSelection, EntryId, SegmentUid,
};
use neuink_workspace::AnnotationIndexRecord;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateAnnotationRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub segment_uid: SegmentUid,
    pub kind: String,
    pub content: String,
    pub importance: AnnotationImportance,
    #[serde(default)]
    pub text_selection: Option<AnnotationTextSelection>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAnnotationRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub annotation_id: AnnotationId,
    pub kind: String,
    pub content: String,
    pub importance: AnnotationImportance,
}

#[derive(Debug, Deserialize)]
pub struct DeleteAnnotationRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub annotation_id: AnnotationId,
}

#[derive(Debug, Deserialize)]
pub struct ListAnnotationsRequest {
    pub root: PathBuf,
}

#[tauri::command]
pub fn list_annotations(
    request: ListAnnotationsRequest,
) -> Result<Vec<AnnotationIndexRecord>, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .list_annotations()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_annotation(request: CreateAnnotationRequest) -> Result<Vec<Annotation>, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .create_annotation_with_text_selection(
            &request.entry_id,
            request.segment_uid,
            request.kind,
            request.content,
            request.importance,
            request.text_selection,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_annotation(request: UpdateAnnotationRequest) -> Result<Vec<Annotation>, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .update_annotation(
            &request.entry_id,
            &request.annotation_id,
            request.kind,
            request.content,
            request.importance,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_annotation(request: DeleteAnnotationRequest) -> Result<Vec<Annotation>, String> {
    let workspace =
        neuink_workspace::Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .delete_annotation(&request.entry_id, &request.annotation_id)
        .map_err(|error| error.to_string())
}
