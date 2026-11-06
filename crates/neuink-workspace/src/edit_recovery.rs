//! Recovery snapshots are separate from canonical notes and are never applied on disk.
use std::{fs, path::PathBuf};
use serde::{Deserialize, Serialize};
use crate::{atomic_write_json, Workspace, WorkspaceError};

const MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DraftKind { Note, SegmentNote, Annotation, Settings, Entry, CreateEntry, TagDescription, Todo, TagReading, DailyState }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditRecoveryDraft {
    pub key: String,
    pub kind: DraftKind,
    pub label: String,
    pub owner_id: String,
    pub target_id: String,
    pub scope_key: String,
    pub updated_at: String,
    pub payload: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_ref: Option<String>,
}

#[derive(Default, Serialize)]
pub struct EditRecoveryList {
    pub drafts: Vec<EditRecoveryDraft>,
    pub unreadable: usize,
}

impl Workspace {
    fn edit_recovery_dir(&self) -> Result<PathBuf, WorkspaceError> {
        // Do not put user-authored recovery data in the disposable cache directory.
        let path = self.layout().root().join(".neuink-recovery");
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if meta.file_type().is_symlink() || !meta.is_dir() {
                return Err(invalid("恢复目录不可用"));
            }
        }
        Ok(path)
    }

    pub fn read_edit_recovery(&self) -> Result<EditRecoveryList, WorkspaceError> {
        let path = self.edit_recovery_dir()?;
        if !path.exists() { return Ok(EditRecoveryList::default()); }
        let mut result = EditRecoveryList::default();
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            if entry.path().extension().and_then(|s| s.to_str()) != Some("json") { continue; }
            let read = || -> Result<EditRecoveryDraft, WorkspaceError> {
                let meta = fs::symlink_metadata(entry.path())?;
                if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_BYTES as u64 {
                    return Err(invalid("恢复记录不可读"));
                }
                let draft: EditRecoveryDraft = serde_json::from_slice(&fs::read(entry.path())?)?;
                validate(&draft)?;
                if entry.file_name().to_string_lossy() != filename(&draft.key) { return Err(invalid("恢复记录标识不匹配")); }
                Ok(draft)
            };
            match read() { Ok(draft) => result.drafts.push(draft), Err(_) => result.unreadable += 1 }
        }
        result.drafts.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(result)
    }

    pub fn write_edit_recovery(&self, draft: &EditRecoveryDraft) -> Result<(), WorkspaceError> {
        validate(draft)?;
        if serde_json::to_vec_pretty(draft)?.len() > MAX_BYTES { return Err(invalid("恢复草稿超过 8 MB，请先另存为文件")); }
        atomic_write_json(self.edit_recovery_dir()?.join(filename(&draft.key)), draft)
    }

    pub fn remove_edit_recovery(&self, key: &str) -> Result<(), WorkspaceError> {
        match fs::remove_file(self.edit_recovery_dir()?.join(filename(key))) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

fn filename(key: &str) -> String { format!("{}.json", blake3::hash(key.as_bytes())) }
fn invalid(message: &str) -> WorkspaceError { WorkspaceError::InvalidNoteDocument(message.into()) }
fn validate(draft: &EditRecoveryDraft) -> Result<(), WorkspaceError> {
    if draft.key.is_empty() || draft.key.len() > 4096 || draft.label.len() > 4096 ||
        draft.owner_id.len() > 4096 || draft.target_id.len() > 4096 || draft.scope_key.len() > 4096 ||
        chrono::DateTime::parse_from_rfc3339(&draft.updated_at).is_err() || !draft.payload.is_object() {
        return Err(invalid("恢复记录格式无效"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_is_atomic_isolated_and_survives_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let mut draft = EditRecoveryDraft { key: "../../note".into(), kind: DraftKind::Note,
            label: "笔记".into(), owner_id: "entry".into(), target_id: "note".into(), scope_key: "note:entry:note".into(),
            updated_at: "2026-11-04T12:00:00Z".into(), payload: serde_json::json!({"markdown": "未保存"}), secret_ref: None };
        workspace.write_edit_recovery(&draft).unwrap();
        draft.payload = serde_json::json!({"markdown": "后续修改"});
        workspace.write_edit_recovery(&draft).unwrap();
        let reopened = Workspace::open_existing(dir.path()).unwrap();
        let list = reopened.read_edit_recovery().unwrap();
        assert_eq!(list.drafts.len(), 1);
        assert_eq!(list.drafts[0].payload, draft.payload);
        assert!(!dir.path().join("note").exists());
        fs::write(dir.path().join(".neuink-recovery/broken.json"), "broken").unwrap();
        let list = reopened.read_edit_recovery().unwrap();
        assert_eq!(list.drafts.len(), 1);
        assert_eq!(list.unreadable, 1);
        reopened.remove_edit_recovery(&draft.key).unwrap();
        reopened.remove_edit_recovery(&draft.key).unwrap();
        assert!(reopened.read_edit_recovery().unwrap().drafts.is_empty());
    }
}
