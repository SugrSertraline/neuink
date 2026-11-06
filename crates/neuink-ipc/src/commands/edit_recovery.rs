use std::{collections::BTreeMap, path::PathBuf};
use neuink_workspace::{Workspace, edit_recovery::{EditRecoveryDraft, EditRecoveryList}};
use serde::Deserialize;
mod vault;

#[derive(Deserialize)]
pub struct RecoveryRequest { root: PathBuf, action: RecoveryAction }
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum RecoveryAction { List, Write { draft: EditRecoveryDraft, #[serde(default)] secrets: BTreeMap<String, String> }, Remove { key: String } }
#[derive(Deserialize)]
pub struct SecretsRequest { root: PathBuf, key: String, expected_ref: String }

#[tauri::command]
pub async fn edit_recovery(request: RecoveryRequest) -> Result<EditRecoveryList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = Workspace::open_existing(request.root).map_err(|e| e.to_string())?;
        match request.action {
            RecoveryAction::List => workspace.read_edit_recovery().map_err(|e| e.to_string()),
            RecoveryAction::Write { draft, secrets } => vault::write(&workspace, draft, secrets, &vault::SystemVault).map(|_| EditRecoveryList::default()),
            RecoveryAction::Remove { key } => vault::remove(&workspace, &key, &vault::SystemVault).map(|_| EditRecoveryList::default()),
        }
    }).await.map_err(|_| "本地恢复任务未完成".to_string())?
}

/// Secrets are loaded only after an explicit restore, never by the recovery list/preview.
#[tauri::command]
pub async fn edit_recovery_secrets(request: SecretsRequest) -> Result<BTreeMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = Workspace::open_existing(request.root).map_err(|e| e.to_string())?;
        vault::read(&workspace, &request.key, Some(&request.expected_ref), &vault::SystemVault)
    }).await.map_err(|_| "安全恢复任务未完成".to_string())?
}
