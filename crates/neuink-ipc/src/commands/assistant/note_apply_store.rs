use std::{
    fs,
    path::{Path, PathBuf},
};

use neuink_domain::SourceLink;
use neuink_workspace::{atomic_write_json, WorkspaceLayout};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VerifiedNoteProposal {
    pub action: String,
    pub base_content_hash: Option<String>,
    pub before_markdown: Option<String>,
    pub entry_id: String,
    pub id: String,
    pub idempotency_key: String,
    pub markdown: String,
    pub note_id: Option<String>,
    #[serde(default)]
    pub patch_operations: Vec<MarkdownPatchOperation>,
    pub proposal_digest: String,
    pub segment_uid: Option<String>,
    #[serde(default)]
    pub sources: Vec<ProposalSource>,
    #[serde(default = "default_target_kind")]
    pub target_kind: String,
    pub task_id: String,
    pub title: String,
    pub verified_at: String,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub(super) enum MarkdownPatchOperation {
    #[serde(rename = "replace_exact")]
    ReplaceExact { new_text: String, old_text: String },
    #[serde(rename = "insert_after")]
    InsertAfter { anchor_text: String, text: String },
    #[serde(rename = "insert_before")]
    InsertBefore { anchor_text: String, text: String },
    #[serde(rename = "append")]
    Append { text: String },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProposalSource {
    pub entry_id: String,
    pub entry_title: String,
    pub marker: Option<String>,
    pub page_idx: u32,
    pub quote: String,
    pub segment_uid: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReceipt {
    pub action: String,
    pub content_hash: String,
    pub entry_id: String,
    pub note_id: Option<String>,
    pub proposal_id: String,
    pub segment_uid: Option<String>,
    pub task_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(super) enum ApplyJournal {
    MarkdownCreate {
        created_note_id: Option<String>,
        entry_id: String,
    },
    MarkdownUpdate {
        entry_id: String,
        links: Vec<SourceLink>,
        markdown: String,
        note_id: String,
        title: String,
    },
    SegmentUpdate {
        entry_id: String,
        segment_uid: String,
        text: String,
    },
}

pub(super) fn load_verified_proposal(
    root: &Path,
    task_id: &str,
    proposal_id: &str,
) -> Result<VerifiedNoteProposal, String> {
    let layout = WorkspaceLayout::new(root.to_path_buf());
    for path in json_files(&layout.conversations_dir())? {
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        let Some(messages) = value.get("messages").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for part in messages.iter().flat_map(message_parts) {
            if part.get("type").and_then(serde_json::Value::as_str) != Some("note-proposal") {
                continue;
            }
            let Some(proposal) = part.get("proposal") else {
                continue;
            };
            if proposal.get("id").and_then(serde_json::Value::as_str) != Some(proposal_id)
                || proposal.get("taskId").and_then(serde_json::Value::as_str) != Some(task_id)
            {
                continue;
            }
            return serde_json::from_value(proposal.clone()).map_err(|error| error.to_string());
        }
    }
    Err(format!("verified proposal not found: {proposal_id}"))
}

pub(super) fn receipt_path(root: &Path, idempotency_key: &str) -> PathBuf {
    runtime_dir(root, "apply-receipts").join(format!(
        "{}.json",
        blake3::hash(idempotency_key.as_bytes()).to_hex()
    ))
}

pub(super) fn journal_path(root: &Path, idempotency_key: &str) -> PathBuf {
    runtime_dir(root, "apply-journal").join(format!(
        "{}.json",
        blake3::hash(idempotency_key.as_bytes()).to_hex()
    ))
}

pub(super) fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

pub(super) fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    atomic_write_json(path, value).map_err(|error| error.to_string())
}

fn message_parts(message: &serde_json::Value) -> impl Iterator<Item = &serde_json::Value> {
    message
        .get("parts")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
}

fn json_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().and_then(|value| value.to_str()) == Some("json")
            && path.file_name().and_then(|value| value.to_str()) != Some("index.json")
        {
            paths.push(path);
        }
    }
    Ok(paths)
}

fn runtime_dir(root: &Path, child: &str) -> PathBuf {
    root.join("agent-runtime").join(child)
}

fn default_target_kind() -> String {
    "markdown_note".to_string()
}
