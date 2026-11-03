use std::{collections::BTreeMap, path::PathBuf};

use neuink_domain::EntryId;
use neuink_workspace::{
    folding::{FoldRecord, FoldTranslation},
    Workspace,
};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct FoldReadRequest {
    root: PathBuf,
    entry_id: EntryId,
}

#[derive(Deserialize)]
pub struct FoldUpsertRequest {
    root: PathBuf,
    entry_id: EntryId,
    records: Vec<FoldRecord>,
}

#[derive(Deserialize)]
pub struct FoldTranslationRequest {
    root: PathBuf,
    entry_id: EntryId,
    segment_uid: String,
    level: String,
    translation: FoldTranslation,
}

#[tauri::command]
pub fn read_entry_folds(request: FoldReadRequest) -> Result<BTreeMap<String, FoldRecord>, String> {
    let workspace = Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .read_entry_folds(&request.entry_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn upsert_entry_folds(request: FoldUpsertRequest) -> Result<(), String> {
    let workspace = Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .upsert_entry_folds(&request.entry_id, request.records)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_fold_translation(request: FoldTranslationRequest) -> Result<(), String> {
    let workspace = Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .save_fold_translation(
            &request.entry_id,
            &request.segment_uid,
            &request.level,
            request.translation,
        )
        .map_err(|error| error.to_string())
}
