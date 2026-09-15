use super::entry::{
    note_asset_extension, note_asset_extension_from_mime, open_path_with_system,
    reveal_path_in_file_manager,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use neuink_domain::{EntryId, NoteId, SegmentUid, TagId};
use neuink_workspace::{
    export::reading::{self, ReadingExportFormat, ReadingExportRequest, ReadingExportSelection},
    note::NoteDocument,
    Workspace,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

#[derive(Debug, Deserialize)]
pub struct TagNoteRequest {
    pub root: PathBuf,
    pub tag_id: TagId,
    pub action: TagNoteAction,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TagNoteAction {
    List,
    Create {
        title: String,
    },
    Read {
        note_id: NoteId,
    },
    Save {
        document: NoteDocument,
    },
    SetDeleted {
        note_id: NoteId,
        deleted: bool,
        expected_revision: String,
    },
    BuildSourceLink {
        note_id: NoteId,
        source_entry_id: EntryId,
        segment_uid: SegmentUid,
    },
    ImportAsset {
        note_id: NoteId,
        source_path: PathBuf,
    },
    SaveAsset {
        note_id: NoteId,
        mime_type: String,
        data_base64: String,
    },
    File {
        note_id: NoteId,
        reveal: bool,
    },
    InspectExport {
        note_id: Option<String>,
    },
    Export {
        selected: Vec<ReadingExportSelection>,
        format: ReadingExportFormat,
        target_path: PathBuf,
        allow_incomplete: bool,
    },
}

#[tauri::command]
pub async fn tag_note(request: TagNoteRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || execute(request))
        .await
        .map_err(|e| e.to_string())?
}

fn execute(request: TagNoteRequest) -> Result<Value, String> {
    let workspace = Workspace::open_existing(request.root).map_err(|e| e.to_string())?;
    let tag = &request.tag_id;
    match request.action {
        TagNoteAction::List => serialize(workspace.list_tag_notes(tag)),
        TagNoteAction::Create { title } => serialize(workspace.create_tag_note(tag, title)),
        TagNoteAction::Read { note_id } => serialize(workspace.read_tag_note(tag, &note_id)),
        TagNoteAction::Save { document } => {
            serialize(workspace.update_tag_note(tag, &document.note_id.clone(), document))
        }
        TagNoteAction::SetDeleted {
            note_id,
            deleted,
            expected_revision,
        } => serialize(workspace.set_tag_note_deleted(tag, &note_id, deleted, &expected_revision)),
        TagNoteAction::BuildSourceLink {
            note_id,
            source_entry_id,
            segment_uid,
        } => serialize(workspace.build_tag_note_source_link(
            tag,
            &note_id,
            &source_entry_id,
            segment_uid,
        )),
        TagNoteAction::ImportAsset {
            note_id,
            source_path,
        } => {
            let extension = note_asset_extension(&source_path)?;
            if fs::metadata(&source_path).map_err(|e| e.to_string())?.len() > 20 * 1024 * 1024 {
                return Err("图片超过 20 MB".into());
            }
            let bytes = fs::read(source_path).map_err(|e| e.to_string())?;
            save_asset(&workspace, tag, &note_id, &extension, &bytes)
        }
        TagNoteAction::SaveAsset {
            note_id,
            mime_type,
            data_base64,
        } => {
            if data_base64.len() > 28 * 1024 * 1024 {
                return Err("图片超过 20 MB".into());
            }
            let extension = note_asset_extension_from_mime(&mime_type)?;
            let bytes = STANDARD.decode(data_base64).map_err(|_| "图片内容无效")?;
            save_asset(&workspace, tag, &note_id, &extension, &bytes)
        }
        TagNoteAction::File { note_id, reveal } => {
            workspace
                .read_tag_note(tag, &note_id)
                .map_err(|e| e.to_string())?;
            let path = workspace
                .tag_note_file(tag, &note_id)
                .map_err(|e| e.to_string())?;
            if reveal {
                reveal_path_in_file_manager(&path)?;
            } else {
                open_path_with_system(&path)?;
            }
            Ok(Value::Null)
        }
        TagNoteAction::InspectExport { note_id } => serde_json::to_value(
            reading::inspect_tag_notes(&workspace, tag, note_id.as_deref())?,
        )
        .map_err(|e| e.to_string()),
        TagNoteAction::Export {
            selected,
            format,
            target_path,
            allow_incomplete,
        } => {
            reading::export_tag_notes(
                &workspace,
                tag,
                ReadingExportRequest {
                    selected: &selected,
                    format,
                    target: &target_path,
                    allow_incomplete,
                },
            )?;
            Ok(Value::Null)
        }
    }
}

fn serialize<T: serde::Serialize>(
    result: Result<T, neuink_workspace::WorkspaceError>,
) -> Result<Value, String> {
    serde_json::to_value(result.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn save_asset(
    workspace: &Workspace,
    tag: &TagId,
    note: &NoteId,
    extension: &str,
    bytes: &[u8],
) -> Result<Value, String> {
    let (markdown_path, path) = workspace
        .write_tag_note_asset(tag, note, extension, bytes)
        .map_err(|e| e.to_string())?;
    Ok(json!({"markdown_path": markdown_path, "file_path": path.to_string_lossy()}))
}
