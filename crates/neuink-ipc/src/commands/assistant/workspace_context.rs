use super::{
    clamp_context_budget, read_entry_assistant_context_from_workspace,
    read_segment_content_from_workspace, trim_to_char_budget, EntryAssistantSource,
};
use neuink_domain::{ContentItem, EntryId, NoteId, SegmentUid};
use neuink_workspace::{Workspace, WorkspaceLayout};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, time::UNIX_EPOCH};

#[derive(Clone, Debug, Deserialize)]
pub struct AssistantActiveNoteRef {
    pub entry_id: EntryId,
    pub note_id: NoteId,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AssistantPinnedSegmentRef {
    pub entry_id: EntryId,
    pub segment_uid: SegmentUid,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AssistantContextSnapshotRequest {
    pub root: PathBuf,
    #[serde(default)]
    pub metadata_only: bool,
    pub active_entry_id: Option<EntryId>,
    pub active_note: Option<AssistantActiveNoteRef>,
    #[serde(default)]
    pub pinned_segments: Vec<AssistantPinnedSegmentRef>,
    #[serde(default)]
    pub document_char_budget: Option<usize>,
    #[serde(default)]
    pub note_char_budget: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AssistantEntrySnapshot {
    pub revision: Option<String>,
    pub entry_id: EntryId,
    pub entry_title: String,
    pub has_pdf: bool,
    pub parse_status: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AssistantNoteSnapshot {
    pub revision: Option<String>,
    pub body_loaded: bool,
    pub entry_id: EntryId,
    pub entry_title: String,
    pub note_id: NoteId,
    pub note_title: String,
    pub markdown: String,
    pub markdown_char_count: usize,
    pub source_link_count: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AssistantDocumentSnapshot {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub markdown: String,
    pub markdown_char_count: usize,
    pub sources: Vec<EntryAssistantSource>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AssistantPinnedSegmentSnapshot {
    pub entry_id: EntryId,
    pub entry_title: String,
    pub segment_uid: SegmentUid,
    pub page_idx: u32,
    pub text: String,
    pub text_char_count: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AssistantContextSnapshotResponse {
    pub metadata_only: bool,
    pub active_entry: Option<AssistantEntrySnapshot>,
    pub active_note: Option<AssistantNoteSnapshot>,
    pub document: Option<AssistantDocumentSnapshot>,
    pub pinned_segments: Vec<AssistantPinnedSegmentSnapshot>,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn get_assistant_context_snapshot(
    request: AssistantContextSnapshotRequest,
) -> Result<AssistantContextSnapshotResponse, String> {
    let workspace = Workspace::open(&request.root).map_err(|error| error.to_string())?;
    if request.metadata_only {
        return Ok(metadata_snapshot(&workspace, &request));
    }
    let mut warnings = Vec::new();
    let document_budget = clamp_context_budget(request.document_char_budget, 240_000);
    let note_budget = clamp_context_budget(request.note_char_budget, 64_000);

    let active_entry = request.active_entry_id.as_ref().and_then(|entry_id| {
        match workspace.read_entry(entry_id) {
            Ok(entry) => Some(AssistantEntrySnapshot {
                revision: Some(entry.updated_at.to_rfc3339()),
                entry_id: entry.id,
                entry_title: entry.title,
                has_pdf: entry.pdf.is_some(),
                parse_status: entry
                    .pdf
                    .as_ref()
                    .map(|pdf| format!("{:?}", pdf.parse.status)),
            }),
            Err(error) => {
                warnings.push(format!("active entry unavailable: {error}"));
                None
            }
        }
    });

    let active_note = request.active_note.as_ref().and_then(|note_ref| {
        let entry = match workspace.read_entry(&note_ref.entry_id) {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(format!("active note entry unavailable: {error}"));
                return None;
            }
        };
        let note = match workspace.read_note(&note_ref.entry_id, &note_ref.note_id) {
            Ok(note) => note,
            Err(error) => {
                warnings.push(format!("active note unavailable: {error}"));
                return None;
            }
        };
        let source_link_count = note.links.len();
        let (markdown, markdown_char_count, truncated) =
            trim_to_char_budget(note.markdown, note_budget);
        Some(AssistantNoteSnapshot {
            revision: note_revision(&request.root, &note_ref.entry_id, &note_ref.note_id),
            body_loaded: true,
            entry_id: note_ref.entry_id.clone(),
            entry_title: entry.title,
            note_id: note.note_id,
            note_title: note.title,
            markdown,
            markdown_char_count,
            source_link_count,
            truncated,
        })
    });

    let document = request.active_entry_id.as_ref().and_then(|entry_id| {
        match read_entry_assistant_context_from_workspace(&workspace, entry_id.clone()) {
            Ok(context) => {
                if context.has_pdf && context.parsed_segment_count == 0 {
                    warnings.push("PDF 尚未完整解析；可使用 read_entry_assistant_context、read_pdf_pages 或 search_pdf_text 读取文字层，扫描页需 OCR。".to_string());
                }
                if context.markdown.trim().is_empty() {
                    return None;
                }
                let (markdown, markdown_char_count, truncated) =
                    trim_to_char_budget(context.markdown, document_budget);
                Some(AssistantDocumentSnapshot {
                    entry_id: context.entry_id,
                    entry_title: context.entry_title,
                    markdown,
                    markdown_char_count,
                    sources: context.sources,
                    truncated,
                })
            }
            Err(error) => {
                warnings.push(format!("entry document context unavailable: {error}"));
                None
            }
        }
    });

    let mut pinned_segments = Vec::new();
    for pinned in request.pinned_segments {
        match read_segment_content_from_workspace(&workspace, pinned.entry_id, pinned.segment_uid) {
            Ok(segment) => {
                let (text, text_char_count, truncated) = trim_to_char_budget(segment.text, 8_000);
                pinned_segments.push(AssistantPinnedSegmentSnapshot {
                    entry_id: segment.entry_id,
                    entry_title: segment.entry_title,
                    segment_uid: segment.segment_uid,
                    page_idx: segment.page_idx,
                    text,
                    text_char_count,
                    truncated,
                });
            }
            Err(error) => warnings.push(format!("pinned segment unavailable: {error}")),
        }
    }

    Ok(AssistantContextSnapshotResponse {
        metadata_only: false,
        active_entry,
        active_note,
        document,
        pinned_segments,
        warnings,
    })
}

fn file_revision(path: &std::path::Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    Some(format!("{}-{modified}", meta.len()))
}

// These revisions detect context changes only. Writes still validate freshly read content hashes.
fn note_revision(root: &std::path::Path, entry_id: &EntryId, note_id: &NoteId) -> Option<String> {
    let layout = WorkspaceLayout::new(root);
    Some(format!(
        "{}:{}",
        file_revision(&layout.entry_note_file(entry_id, note_id))?,
        file_revision(&layout.entry_note_links_file(entry_id, note_id)).unwrap_or_default()
    ))
}

fn metadata_snapshot(
    workspace: &Workspace,
    request: &AssistantContextSnapshotRequest,
) -> AssistantContextSnapshotResponse {
    let layout = WorkspaceLayout::new(&request.root);
    let mut warnings = Vec::new();
    let active_entry =
        request
            .active_entry_id
            .as_ref()
            .and_then(|id| match workspace.read_entry(id) {
                Ok(entry) => Some(AssistantEntrySnapshot {
                    revision: Some(format!(
                        "{}:{}:{}",
                        entry.updated_at.to_rfc3339(),
                        file_revision(&layout.entry_segments_file(id)).unwrap_or_default(),
                        file_revision(&layout.entry_pdf_file(id)).unwrap_or_default()
                    )),
                    entry_id: entry.id,
                    entry_title: entry.title,
                    has_pdf: entry.pdf.is_some(),
                    parse_status: entry
                        .pdf
                        .as_ref()
                        .map(|pdf| format!("{:?}", pdf.parse.status)),
                }),
                Err(_) => {
                    warnings.push("Selected Entry metadata is unavailable.".to_string());
                    None
                }
            });
    let active_note = request.active_note.as_ref().and_then(|target| {
        let entry = workspace.read_entry(&target.entry_id).ok()?;
        let title = entry.contents.iter().find_map(|content| match content {
            ContentItem::Note { note_id, title } if *note_id == target.note_id => {
                Some(title.clone())
            }
            _ => None,
        })?;
        let revision = note_revision(&request.root, &target.entry_id, &target.note_id)?;
        Some(AssistantNoteSnapshot {
            revision: Some(revision),
            body_loaded: false,
            entry_id: target.entry_id.clone(),
            entry_title: entry.title,
            note_id: target.note_id.clone(),
            note_title: title,
            markdown: String::new(),
            markdown_char_count: 0,
            source_link_count: 0,
            truncated: true,
        })
    });
    if request.active_note.is_some() && active_note.is_none() {
        warnings.push("Selected note metadata is unavailable.".to_string());
    }
    AssistantContextSnapshotResponse {
        metadata_only: true,
        active_entry,
        active_note,
        document: None,
        pinned_segments: Vec::new(),
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_initialization_does_not_parse_document_or_note_bodies() {
        let dir = tempfile::tempdir().expect("temporary workspace");
        let workspace = Workspace::create(dir.path()).expect("workspace");
        let entry = workspace.create_entry("Paper").expect("entry");
        let note_id = NoteId::new();
        workspace
            .create_note_with_id(&entry.id, note_id.clone(), "Selected note")
            .expect("note");
        let layout = WorkspaceLayout::new(dir.path());
        fs::write(
            layout.entry_segments_file(&entry.id),
            b"invalid segment JSON",
        )
        .expect("segments");
        fs::write(layout.entry_note_file(&entry.id, &note_id), [0xff, 0xfe])
            .expect("unreadable body");
        let request = AssistantContextSnapshotRequest {
            root: dir.path().to_path_buf(),
            metadata_only: true,
            active_entry_id: Some(entry.id.clone()),
            active_note: Some(AssistantActiveNoteRef {
                entry_id: entry.id.clone(),
                note_id: note_id.clone(),
            }),
            pinned_segments: Vec::new(),
            document_char_budget: None,
            note_char_budget: None,
        };
        let first = get_assistant_context_snapshot(request.clone()).expect("metadata snapshot");
        assert_eq!(
            first
                .active_entry
                .as_ref()
                .map(|entry| entry.entry_title.as_str()),
            Some("Paper")
        );
        let note = first.active_note.expect("note metadata");
        assert_eq!(note.note_title, "Selected note");
        assert!(!note.body_loaded);
        assert!(note.markdown.is_empty());
        assert!(first.document.is_none());
        assert!(first.warnings.is_empty());
        fs::write(
            layout.entry_note_file(&entry.id, &note_id),
            [0xff, 0xfe, 0xfd],
        )
        .expect("changed body");
        let changed = get_assistant_context_snapshot(request).expect("changed metadata");
        assert_ne!(
            note.revision,
            changed.active_note.expect("note metadata").revision
        );
    }
}
