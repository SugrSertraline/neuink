use std::{collections::BTreeMap, path::PathBuf};
use neuink_domain::EntryId;
use neuink_workspace::{Workspace, sentence_translation::SavedSentenceTranslation};
use serde::Deserialize;
#[derive(Deserialize)]
pub struct Request { root: PathBuf, entry_id: EntryId, record: Option<SavedSentenceTranslation>, expected: Option<String> }
#[tauri::command]
pub fn sentence_translation(request: Request) -> Result<BTreeMap<String, SavedSentenceTranslation>, String> {
    let workspace = Workspace::open(request.root).map_err(|e| e.to_string())?;
    if let Some(record) = request.record {
        workspace.save_sentence_translation(&request.entry_id, record, request.expected).map_err(|e| e.to_string())?;
    }
    workspace.read_sentence_translations(&request.entry_id).map_err(|e| e.to_string())
}
