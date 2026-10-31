use neuink_workspace::{
    ideation::{IdeationDraft, IdeationState},
    Workspace,
};
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Deserialize)]
pub struct IdeationRequest {
    root: PathBuf,
    action: IdeationAction,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IdeationAction {
    Read,
    ListDrafts,
    ReadDraft {
        entry_id: String,
    },
    SaveDraft {
        expected_revision: String,
        draft: IdeationDraft,
    },
    Save {
        expected_revision: String,
        state: IdeationState,
    },
}

#[tauri::command]
pub async fn ideation_workspace(request: IdeationRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = Workspace::open_existing(request.root).map_err(|e| e.to_string())?;
        let output = match request.action {
            IdeationAction::Read => {
                serde_json::to_value(workspace.read_ideation().map_err(|e| e.to_string())?)
            }
            IdeationAction::ListDrafts => serde_json::to_value(
                workspace
                    .list_ideation_drafts()
                    .map_err(|e| e.to_string())?,
            ),
            IdeationAction::ReadDraft { entry_id } => serde_json::to_value(
                workspace
                    .read_ideation_draft(&entry_id)
                    .map_err(|e| e.to_string())?,
            ),
            IdeationAction::SaveDraft {
                expected_revision,
                draft,
            } => serde_json::to_value(
                workspace
                    .save_ideation_draft(&expected_revision, draft)
                    .map_err(|e| e.to_string())?,
            ),
            IdeationAction::Save {
                expected_revision,
                state,
            } => serde_json::to_value(
                workspace
                    .save_ideation(&expected_revision, state)
                    .map_err(|e| e.to_string())?,
            ),
        };
        output.map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
