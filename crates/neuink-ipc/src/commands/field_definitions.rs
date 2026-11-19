use std::path::PathBuf;
use neuink_workspace::{field_definitions::FieldDefinition, Workspace};
use serde::Deserialize;
use tauri::{AppHandle, Runtime};

#[derive(Deserialize)]
pub struct FieldDefinitionsRequest {
    root: PathBuf,
    #[serde(flatten)]
    action: Action,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Action {
    Read,
    Save { expected: Vec<FieldDefinition>, definitions: Vec<FieldDefinition>, #[serde(default)] rename: Option<(String, String)> },
}

#[tauri::command]
pub async fn field_definitions<R: Runtime>(app: AppHandle<R>, request: FieldDefinitionsRequest) -> Result<Vec<FieldDefinition>, String> {
    let current = super::workspace::current_workspace_root(&app)?.canonicalize().map_err(|_| "无法定位当前资料库")?;
    let requested = request.root.canonicalize().map_err(|_| "无法定位资料库")?;
    if current != requested { return Err("请先切换到对应资料库".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = Workspace::open_existing(requested).map_err(|e| e.to_string())?;
        match request.action {
            Action::Read => workspace.read_field_definitions(),
            Action::Save { expected, definitions, rename } => workspace.save_field_definitions_with_rename(&expected, definitions, rename),
        }.map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
