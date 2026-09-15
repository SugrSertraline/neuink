use std::path::PathBuf;
use neuink_domain::SegmentRef;
use neuink_workspace::{note_catalog::NoteCatalog, source_availability::SourceAvailability, Workspace};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct CatalogRequest { pub root: PathBuf }

#[tauri::command]
pub async fn read_note_catalog(request: CatalogRequest) -> Result<NoteCatalog, String> {
    tauri::async_runtime::spawn_blocking(move || Workspace::open_existing(request.root)
        .and_then(|workspace| workspace.read_note_catalog()).map_err(|error| error.to_string()))
        .await.map_err(|error| error.to_string())?
}

#[derive(Deserialize)]
pub struct InspectSourcesRequest { pub root: PathBuf, pub sources: Vec<SegmentRef> }

#[tauri::command]
pub async fn inspect_note_sources(request: InspectSourcesRequest) -> Result<Vec<SourceAvailability>, String> {
    tauri::async_runtime::spawn_blocking(move || Workspace::open_existing(request.root)
        .map(|workspace| workspace.inspect_sources(&request.sources)).map_err(|error| error.to_string()))
        .await.map_err(|error| error.to_string())?
}
