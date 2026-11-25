use super::entry::{
    note_asset_extension, note_asset_extension_from_mime, open_path_with_system,
    reveal_path_in_file_manager,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use neuink_domain::{daily::DailyState, EntryId, SegmentUid};
use neuink_workspace::{note::NoteDocument, Workspace};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

#[derive(Deserialize)]
pub struct DailyRequest {
    pub root: PathBuf,
    pub action: DailyAction,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DailyAction {
    Read,
    Save {
        expected_revision: String,
        state: DailyState,
    },
    ReadNote {
        date: String,
    },
    SaveNote {
        date: String,
        document: NoteDocument,
    },
    BuildSourceLink {
        date: String,
        source_entry_id: EntryId,
        segment_uid: SegmentUid,
    },
    ImportAsset {
        date: String,
        source_path: PathBuf,
    },
    SaveAsset {
        date: String,
        mime_type: String,
        data_base64: String,
    },
    NoteFile {
        date: String,
        reveal: bool,
    },
}
#[tauri::command]
pub async fn daily_workspace(request: DailyRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || execute(request))
        .await
        .map_err(|e| e.to_string())?
}
fn serialize<T: serde::Serialize>(
    result: Result<T, neuink_workspace::WorkspaceError>,
) -> Result<Value, String> {
    serde_json::to_value(result.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn execute(request: DailyRequest) -> Result<Value, String> {
    let workspace = Workspace::open_existing(request.root).map_err(|e| e.to_string())?;
    match request.action {
        DailyAction::Read => serialize(workspace.read_daily_state()),
        DailyAction::Save {
            expected_revision,
            state,
        } => serialize(workspace.save_daily_state(&expected_revision, state)),
        DailyAction::ReadNote { date } => serialize(workspace.read_daily_note(&date)),
        DailyAction::SaveNote { date, document } => {
            serialize(workspace.save_daily_note(&date, document))
        }
        DailyAction::BuildSourceLink {
            date,
            source_entry_id,
            segment_uid,
        } => {
            serialize(workspace.build_daily_note_source_link(&date, &source_entry_id, segment_uid))
        }
        DailyAction::ImportAsset { date, source_path } => {
            let ext = note_asset_extension(&source_path)?;
            if fs::metadata(&source_path).map_err(|e| e.to_string())?.len() > 20 * 1024 * 1024 {
                return Err("图片超过 20 MB".into());
            }
            asset(
                &workspace,
                &date,
                &ext,
                &fs::read(source_path).map_err(|e| e.to_string())?,
            )
        }
        DailyAction::SaveAsset {
            date,
            mime_type,
            data_base64,
        } => {
            if data_base64.len() > 28 * 1024 * 1024 {
                return Err("图片超过 20 MB".into());
            }
            let ext = note_asset_extension_from_mime(&mime_type)?;
            asset(
                &workspace,
                &date,
                &ext,
                &STANDARD.decode(data_base64).map_err(|_| "图片内容无效")?,
            )
        }
        DailyAction::NoteFile { date, reveal } => {
            workspace
                .read_daily_note(&date)
                .map_err(|e| e.to_string())?;
            let path = workspace
                .daily_note_file(&date)
                .map_err(|e| e.to_string())?;
            if !path.exists() {
                return Err("请先保存每日记录".into());
            }
            if reveal {
                reveal_path_in_file_manager(&path)?;
            } else {
                open_path_with_system(&path)?;
            }
            Ok(Value::Null)
        }
    }
}
fn asset(workspace: &Workspace, date: &str, ext: &str, bytes: &[u8]) -> Result<Value, String> {
    let (markdown_path, path) = workspace
        .write_daily_note_asset(date, ext, bytes)
        .map_err(|e| e.to_string())?;
    Ok(json!({ "markdown_path": markdown_path, "file_path": path.to_string_lossy() }))
}
