//! Explicit entry deletion/restoration with a recoverable directory move.
//! Missing files alone never manufacture a deletion intent.
use crate::{atomic_write_json, sync_journal::WorkspaceSyncBinding, Workspace, WorkspaceError};
use neuink_domain::EntryId;
use neuink_sync_protocol::document::EntityDocument;
use serde::{Deserialize, Serialize};
use std::{fs, io::ErrorKind, path::PathBuf};

const JOURNAL: &str = "entry-lifecycle.journal.json";
const EVENTS: &str = "sync-lifecycle";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EntryLifecycleAction {
    Delete,
    Restore,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EntryLifecycleEvent {
    pub version: u16,
    pub sequence: u64,
    pub remote: bool,
    pub event_id: String,
    pub entry_id: EntryId,
    pub action: EntryLifecycleAction,
    pub occurred_at: chrono::DateTime<chrono::Utc>,
    pub binding: Option<WorkspaceSyncBinding>,
    /// Frozen final saved contents, including edits made offline before deletion.
    pub documents: Vec<EntityDocument>,
    pub snapshot_issue: Option<String>,
}

fn failure(message: &str) -> WorkspaceError {
    WorkspaceError::ContentTransaction(message.into())
}

impl Workspace {
    fn lifecycle_path(&self, relative: &str) -> Result<PathBuf, WorkspaceError> {
        let root = self.layout().root().canonicalize()?;
        Ok(crate::sync_export::files::safe_path(&root, relative)?)
    }

    fn check_lifecycle_path(&self, path: &std::path::Path) -> Result<(), WorkspaceError> {
        let root = self.layout().root().canonicalize()?;
        let relative = path
            .strip_prefix(&root)
            .map_err(|_| failure("删除恢复路径越界"))?
            .to_string_lossy()
            .replace('\\', "/");
        crate::sync_export::files::safe_path(&root, &relative)?;
        Ok(())
    }

    /// Caller owns the metadata lock. Publishing the intent precedes any move.
    pub(crate) fn move_entry_with_intent(
        &self,
        entry_id: &EntryId,
        action: EntryLifecycleAction,
    ) -> Result<(), WorkspaceError> {
        self.move_entry_with_origin(entry_id, action, false, Vec::new())
    }

    pub(crate) fn move_entry_with_origin(
        &self,
        entry_id: &EntryId,
        action: EntryLifecycleAction,
        remote: bool,
        documents: Vec<EntityDocument>,
    ) -> Result<(), WorkspaceError> {
        crate::tag_reading::validate_id(entry_id.as_str())?;
        let binding = self.sync_binding()?;
        let sequence_path = self.lifecycle_path("lifecycle-sequence.json")?;
        let previous: u64 = match fs::read(&sequence_path) {
            Ok(raw) => serde_json::from_slice(&raw)?,
            Err(e) if e.kind() == ErrorKind::NotFound => 0,
            Err(e) => return Err(e.into()),
        };
        let sequence = previous
            .checked_add(1)
            .ok_or_else(|| failure("删除恢复序号已耗尽"))?;
        atomic_write_json(sequence_path, &sequence)?;
        let mut event = EntryLifecycleEvent {
            version: 1,
            sequence,
            remote,
            event_id: EntryId::new().to_string(),
            entry_id: entry_id.clone(),
            action,
            occurred_at: chrono::Utc::now(),
            binding,
            documents,
            snapshot_issue: None,
        };
        if event.action == EntryLifecycleAction::Delete && !remote {
            if let Some(binding) = &event.binding {
                match crate::sync_export::export_entry_locked(
                    self.layout().root(),
                    entry_id.as_str(),
                ) {
                    Ok(bundle) => match self.stage_sync_bundle_locked(binding, &bundle) {
                        Ok(()) => event.documents = bundle.manifest().documents.clone(),
                        Err(_) => {
                            event.snapshot_issue = Some(
                                "删除前内容暂存失败；资料仍保留在回收站，云端删除等待处理".into(),
                            )
                        }
                    },
                    Err(_) => {
                        event.snapshot_issue = Some(
                            "删除前内容未通过同步完整性检查；资料仍保留在回收站，云端删除等待处理"
                                .into(),
                        )
                    }
                }
            }
        }
        let journal = self.lifecycle_path(JOURNAL)?;
        if journal.exists() {
            return Err(failure("仍有删除或恢复操作待完成"));
        }
        atomic_write_json(journal, &event)?;
        self.recover_entry_lifecycle()
    }

    pub(crate) fn recover_entry_lifecycle(&self) -> Result<(), WorkspaceError> {
        let journal = self.lifecycle_path(JOURNAL)?;
        let raw = match fs::read(&journal) {
            Ok(raw) => raw,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.into()),
        };
        let event: EntryLifecycleEvent = serde_json::from_slice(&raw)?;
        self.validate_lifecycle_event(&event)?;
        let active = self.lifecycle_path(&format!("entries/{}", event.entry_id))?;
        let trash = self.lifecycle_path(&format!("trash/entries/{}", event.entry_id))?;
        let (source, target) = if event.action == EntryLifecycleAction::Delete {
            (&active, &trash)
        } else {
            (&trash, &active)
        };
        if source.exists() && target.exists() {
            return Err(failure(
                "删除恢复遇到同标识目录冲突，已保留双方目录和操作记录",
            ));
        }
        if !source.exists() && !target.exists() {
            return Err(failure("删除恢复的资料目录缺失，未将缺失当作删除成功"));
        }
        let existing = if source.exists() { source } else { target };
        let meta = existing.join("entry.meta.json");
        self.check_lifecycle_path(&meta)?;
        let entry: neuink_domain::EntryMeta = serde_json::from_slice(&fs::read(meta)?)?;
        if entry.id != event.entry_id {
            return Err(failure("删除恢复的目录与条目标识不一致"));
        }
        if event.action == EntryLifecycleAction::Delete
            && crate::entry_sources::is_source_managed_dir(existing)?
        {
            return Err(WorkspaceError::SourceManagedEntry);
        }
        if source.exists() {
            if event.action == EntryLifecycleAction::Delete {
                let marker = source.join(".trashed.json");
                self.check_lifecycle_path(&marker)?;
                atomic_write_json(marker, &serde_json::json!({"deleted_at":event.occurred_at}))?;
            }
            fs::create_dir_all(target.parent().ok_or_else(|| failure("回收站位置无效"))?)?;
            fs::rename(source, target)?;
        }
        if event.action == EntryLifecycleAction::Delete {
            let marker = target.join(".trashed.json");
            self.check_lifecycle_path(&marker)?;
            atomic_write_json(marker, &serde_json::json!({"deleted_at":event.occurred_at}))?;
        }
        if event.action == EntryLifecycleAction::Restore {
            let marker = target.join(".trashed.json");
            self.check_lifecycle_path(&marker)?;
            match fs::remove_file(marker) {
                Ok(()) => {}
                Err(e) if e.kind() == ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        if event.action == EntryLifecycleAction::Delete && !event.documents.is_empty() {
            let receipt = target.join(".sync-deleted.json");
            self.check_lifecycle_path(&receipt)?;
            atomic_write_json(receipt, &event)?;
        }
        if event.binding.is_some() && !event.remote {
            atomic_write_json(
                self.lifecycle_path(&format!("{EVENTS}/{}.json", event.event_id))?,
                &event,
            )?;
        }
        fs::remove_file(journal)?;
        Ok(())
    }

    fn validate_lifecycle_event(&self, event: &EntryLifecycleEvent) -> Result<(), WorkspaceError> {
        crate::tag_reading::validate_id(event.entry_id.as_str())?;
        crate::tag_reading::validate_id(&event.event_id)?;
        if event.version != 1 || event.sequence == 0 || event.binding != self.sync_binding()? {
            return Err(failure("删除恢复记录的版本或绑定已改变"));
        }
        for doc in &event.documents {
            doc.validate().map_err(failure)?;
            if doc.payload["entry_id"].as_str() != Some(event.entry_id.as_str())
                && doc.entity_id != format!("entry:{}", event.entry_id)
            {
                return Err(failure("删除快照包含其他条目的内容"));
            }
        }
        Ok(())
    }

    pub fn acknowledge_entry_lifecycle_event(
        &self,
        binding: &WorkspaceSyncBinding,
        event_id: &str,
    ) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        crate::tag_reading::validate_id(event_id)?;
        if self.sync_binding()?.as_ref() != Some(binding) {
            return Err(failure("删除恢复事件绑定不一致"));
        }
        let path = self.lifecycle_path(&format!("{EVENTS}/{event_id}.json"))?;
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn pending_entry_lifecycle_events(
        &self,
    ) -> Result<Vec<EntryLifecycleEvent>, WorkspaceError> {
        let directory = self.lifecycle_path(EVENTS)?;
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut events = Vec::new();
        for item in fs::read_dir(directory)? {
            let item = item?;
            if item.path().extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let path =
                self.lifecycle_path(&format!("{EVENTS}/{}", item.file_name().to_string_lossy()))?;
            let event: EntryLifecycleEvent = serde_json::from_slice(&fs::read(path)?)?;
            self.validate_lifecycle_event(&event)?;
            if item.file_name().to_string_lossy() != format!("{}.json", event.event_id) {
                return Err(failure("删除恢复事件文件标识不一致"));
            }
            events.push(event);
        }
        events.sort_by_key(|event| event.sequence);
        Ok(events)
    }
}

#[cfg(test)]
#[path = "entry_lifecycle_tests.rs"]
mod tests;
