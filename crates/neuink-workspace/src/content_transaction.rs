//! Recoverable content publication. Callers hold the workspace metadata lock.
//! File publication and the bound workspace's outbox share one recovery record.
use crate::{atomic_write, atomic_write_json, tag_reading::validate_id, Workspace, WorkspaceError};
use neuink_domain::{EntryId, NoteId};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs, io::ErrorKind, path::PathBuf};

const JOURNAL: &str = "content-operation.journal.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) enum ContentTarget {
    IdeationState,
    SentenceTranslations { entry_id: EntryId },
    ParagraphTranslations { entry_id: EntryId },
    EntryMeta { entry_id: EntryId },
    NoteBody { entry_id: EntryId, note_id: NoteId },
    NoteLinks { entry_id: EntryId, note_id: NoteId },
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct ContentChange {
    target: ContentTarget,
    before_hash: Option<String>,
    after: Vec<u8>,
}

#[derive(Debug, Deserialize, Serialize)]
struct Transaction {
    version: u16,
    changes: Vec<ContentChange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sync_binding: Option<crate::sync_journal::WorkspaceSyncBinding>,
    #[serde(default)]
    sync_sequence: u64,
}

/// Map a durable save event to logical entities without exposing local paths or bytes.
pub(crate) fn sync_entity_keys(
    raw: &serde_json::Value,
) -> Result<BTreeSet<String>, WorkspaceError> {
    let transaction: Transaction = serde_json::from_value(raw.clone())?;
    if transaction.version != 1 || transaction.changes.is_empty() {
        return Err(failure("本地保存记录格式不兼容，未确认同步交接"));
    }
    let mut keys = BTreeSet::new();
    for change in transaction.changes {
        match change.target {
            ContentTarget::IdeationState => {
                keys.insert("board:ideation".into());
            }
            ContentTarget::ParagraphTranslations { entry_id } => {
                validate_id(entry_id.as_str())?;
                keys.insert(format!("paragraph-translation:{entry_id}"));
            }
            ContentTarget::SentenceTranslations { entry_id } => {
                validate_id(entry_id.as_str())?;
                keys.insert(format!("sentence-translation:{entry_id}"));
            }
            ContentTarget::EntryMeta { entry_id } => {
                validate_id(entry_id.as_str())?;
                keys.insert(format!("entry:{entry_id}"));
            }
            ContentTarget::NoteBody { entry_id, note_id }
            | ContentTarget::NoteLinks { entry_id, note_id } => {
                validate_id(entry_id.as_str())?;
                validate_id(note_id.as_str())?;
                keys.insert(format!("entry:{entry_id}"));
                keys.insert(format!("note:{note_id}"));
            }
        }
    }
    Ok(keys)
}

struct PendingWrite {
    path: PathBuf,
    content: Vec<u8>,
    before_hash: Option<String>,
}

fn failure(message: &str) -> WorkspaceError {
    WorkspaceError::ContentTransaction(message.into())
}
fn bytes(path: &std::path::Path) -> Result<Option<Vec<u8>>, WorkspaceError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}
fn hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

impl Workspace {
    pub(crate) fn content_change(
        &self,
        target: ContentTarget,
        after: Vec<u8>,
    ) -> Result<ContentChange, WorkspaceError> {
        let path = self.content_target_path(&target)?;
        Ok(ContentChange {
            target,
            before_hash: bytes(&path)?.as_deref().map(hash),
            after,
        })
    }

    pub(crate) fn commit_content_transaction(
        &self,
        changes: Vec<ContentChange>,
    ) -> Result<(), WorkspaceError> {
        let path = self.layout().root().join(JOURNAL);
        self.validate_note_workspace_path(&path)?;
        if path.exists() {
            return Err(failure("尚有内容保存待恢复，请重新打开资料库"));
        }
        let sync_binding = self.sync_binding()?;
        let transaction = Transaction {
            version: 1,
            changes,
            sync_sequence: if sync_binding.is_some() {
                self.next_content_sync_sequence()?
            } else {
                0
            },
            sync_binding,
        };
        self.preflight_content_transaction(&transaction)?;
        // Record intent before any content file is published. Never discard this
        // record on an I/O failure: the next open resumes the same transaction.
        atomic_write_json(&path, &transaction)?;
        self.recover_content_transaction()
    }

    pub(crate) fn recover_content_transaction(&self) -> Result<(), WorkspaceError> {
        let journal = self.layout().root().join(JOURNAL);
        self.validate_note_workspace_path(&journal)?;
        let Some(raw) = bytes(&journal)? else {
            return Ok(());
        };
        let transaction: Transaction = serde_json::from_slice(&raw)?;
        let pending = self.preflight_content_transaction(&transaction)?;
        for change in &transaction.changes {
            if let ContentTarget::NoteBody { entry_id, note_id } = &change.target {
                self.prepare_content_note_assets(entry_id, note_id, &change.after)?;
            }
        }
        for PendingWrite {
            path,
            content,
            before_hash,
        } in pending
        {
            // Check once more just before replacing: an external editor may have
            // changed a later file while an earlier file was being published.
            self.validate_note_workspace_path(&path)?;
            let current = bytes(&path)?.as_deref().map(hash);
            if current == Some(hash(&content)) {
                continue;
            }
            if current != before_hash {
                return Err(failure("内容恢复遇到外部修改，已保留当前文件和恢复记录"));
            }
            atomic_write(path, &content)?;
        }
        if let Some(binding) = &transaction.sync_binding {
            self.publish_content_sync_event(binding, &raw)?;
        }
        fs::remove_file(journal)?;
        Ok(())
    }

    fn preflight_content_transaction(
        &self,
        transaction: &Transaction,
    ) -> Result<Vec<PendingWrite>, WorkspaceError> {
        if transaction.version != 1 || transaction.changes.is_empty() {
            return Err(failure("内容恢复记录不兼容，已保留原始文件"));
        }
        if let Some(binding) = &transaction.sync_binding {
            if self.sync_binding()?.as_ref() != Some(binding) || transaction.sync_sequence == 0 {
                return Err(failure("内容恢复记录的同步绑定已改变，未修改当前资料"));
            }
        }
        let mut targets = BTreeSet::new();
        let mut pending = Vec::new();
        for change in &transaction.changes {
            if matches!(change.target, ContentTarget::NoteBody { .. })
                && std::str::from_utf8(&change.after).is_err()
            {
                return Err(failure("内容恢复记录包含无效笔记正文"));
            }
            let path = self.content_target_path(&change.target)?;
            if !targets.insert(path.clone()) {
                return Err(failure("内容恢复记录包含重复目标"));
            }
            let current = bytes(&path)?.as_deref().map(hash);
            if current == Some(hash(&change.after)) {
                continue;
            }
            if current != change.before_hash {
                return Err(failure("内容恢复遇到外部修改，已保留当前文件和恢复记录"));
            }
            pending.push(PendingWrite {
                path,
                content: change.after.clone(),
                before_hash: change.before_hash.clone(),
            });
        }
        Ok(pending)
    }

    fn content_target_path(&self, target: &ContentTarget) -> Result<PathBuf, WorkspaceError> {
        let path = match target {
            ContentTarget::ParagraphTranslations { entry_id } => {
                validate_id(entry_id.as_str())?;
                self.layout()
                    .entry_dir(entry_id)
                    .join("paper.paragraph-translations.json")
            }
            ContentTarget::SentenceTranslations { entry_id } => {
                validate_id(entry_id.as_str())?;
                self.layout()
                    .entry_dir(entry_id)
                    .join("paper.sentence-translations.json")
            }
            ContentTarget::IdeationState => {
                self.layout().root().join("ideation").join("state.json")
            }
            ContentTarget::EntryMeta { entry_id } => {
                validate_id(entry_id.as_str())?;
                self.layout().entry_meta_file(entry_id)
            }
            ContentTarget::NoteBody { entry_id, note_id } => {
                validate_id(entry_id.as_str())?;
                validate_id(note_id.as_str())?;
                self.layout().entry_note_file(entry_id, note_id)
            }
            ContentTarget::NoteLinks { entry_id, note_id } => {
                validate_id(entry_id.as_str())?;
                validate_id(note_id.as_str())?;
                self.layout().entry_note_links_file(entry_id, note_id)
            }
        };
        self.validate_note_workspace_path(&path)?;
        Ok(path)
    }
}

#[cfg(test)]
#[path = "content_transaction_tests.rs"]
mod tests;
