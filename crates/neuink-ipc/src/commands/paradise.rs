use neuink_workspace::{paradise::ParadiseSave, Workspace};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct ReadRequest {
    root: String,
}
#[derive(Deserialize)]
pub struct SaveRequest {
    root: String,
    expected_revision: u64,
    world: serde_json::Value,
}

#[tauri::command]
pub fn read_paradise(request: ReadRequest) -> Result<Option<ParadiseSave>, String> {
    Workspace::open(request.root)
        .and_then(|w| w.read_paradise())
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn save_paradise(request: SaveRequest) -> Result<ParadiseSave, String> {
    Workspace::open(request.root)
        .and_then(|w| w.save_paradise(request.expected_revision, request.world))
        .map_err(|e| e.to_string())
}
