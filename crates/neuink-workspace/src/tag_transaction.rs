use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};

use neuink_domain::EntryId;
use serde::{Deserialize, Serialize};

use crate::{atomic_write, atomic_write_json, tag_reading::validate_id, Workspace, WorkspaceError};

static METADATA_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) enum TagTransactionTarget {
    Workspace,
    Entry { entry_id: EntryId, trashed: bool },
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct TagFileChange {
    target: TagTransactionTarget,
    before_hash: String,
    after: Vec<u8>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TagTransaction {
    version: u16,
    changes: Vec<TagFileChange>,
}

impl Workspace {
    /// Serialize metadata changes in this desktop process, including transaction recovery.
    pub(crate) fn begin_tag_safe_mutation(
        &self,
    ) -> Result<MutexGuard<'static, ()>, WorkspaceError> {
        let guard = METADATA_LOCK
            .lock()
            .map_err(|_| WorkspaceError::TagReading("资料库写入锁不可用，请重启后重试".into()))?;
        self.recover_tag_transaction()?;
        Ok(guard)
    }

    pub(crate) fn tag_file_change<T: Serialize>(
        &self,
        target: TagTransactionTarget,
        after: &T,
    ) -> Result<TagFileChange, WorkspaceError> {
        let before_hash = hash(&fs::read(self.tag_target_path(&target)?)?);
        Ok(TagFileChange {
            target,
            before_hash,
            after: serde_json::to_vec_pretty(after)?,
        })
    }

    pub(crate) fn commit_tag_transaction(
        &self,
        changes: Vec<TagFileChange>,
    ) -> Result<(), WorkspaceError> {
        let path = self.layout().root().join("tag-operation.journal.json");
        if path.exists() {
            return Err(WorkspaceError::TagReading(
                "尚有标签操作待恢复，请重新打开资料库".into(),
            ));
        }
        atomic_write_json(
            path,
            &TagTransaction {
                version: 1,
                changes,
            },
        )?;
        self.recover_tag_transaction()
    }

    fn recover_tag_transaction(&self) -> Result<(), WorkspaceError> {
        let path = self.layout().root().join("tag-operation.journal.json");
        if path.exists()
            && !path
                .canonicalize()?
                .starts_with(self.layout().root().canonicalize()?)
        {
            return Err(WorkspaceError::TagReading(
                "标签恢复记录超出资料库范围".into(),
            ));
        }
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        let transaction: TagTransaction = serde_json::from_slice(&bytes)?;
        if transaction.version != 1 {
            return Err(WorkspaceError::TagReading(
                "标签恢复记录版本不兼容；已保留原始文件".into(),
            ));
        }
        // Preflight every target before writing anything. Never overwrite an external edit.
        let mut pending = Vec::new();
        for change in transaction.changes {
            let target = self.tag_target_path(&change.target)?;
            let current_hash = hash(&fs::read(&target)?);
            if current_hash == hash(&change.after) {
                continue;
            }
            if current_hash != change.before_hash {
                return Err(WorkspaceError::TagReading(
                    "标签操作恢复遇到文件冲突；已保留恢复记录，请先处理冲突，未覆盖当前内容".into(),
                ));
            }
            pending.push((target, change.after));
        }
        for (target, bytes) in pending {
            atomic_write(target, &bytes)?;
        }
        fs::remove_file(path)?;
        Ok(())
    }

    fn tag_target_path(&self, target: &TagTransactionTarget) -> Result<PathBuf, WorkspaceError> {
        let path = match target {
            TagTransactionTarget::Workspace => self.layout().workspace_file(),
            TagTransactionTarget::Entry { entry_id, trashed } => {
                validate_id(entry_id.as_str())?;
                if *trashed {
                    self.layout()
                        .trashed_entry_dir(entry_id)
                        .join("entry.meta.json")
                } else {
                    self.layout().entry_meta_file(entry_id)
                }
            }
        };
        if !path
            .canonicalize()?
            .starts_with(self.layout().root().canonicalize()?)
        {
            return Err(WorkspaceError::TagReading(
                "标签操作目标超出资料库范围".into(),
            ));
        }
        Ok(path)
    }
}

fn hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_journal_access_does_not_remove_tags_or_membership() {
        let root = std::env::temp_dir().join(format!("neuink_tag_journal_{}", EntryId::new()));
        let ws = Workspace::create(&root).unwrap();
        let tag = ws.create_tag("keep", None).unwrap();
        let entry = ws
            .create_entry_with_meta("keep", Default::default(), vec![tag.id.clone()])
            .unwrap();
        fs::create_dir(root.join("tag-operation.journal.json")).unwrap();
        assert!(ws.delete_tag(&tag.id).is_err());
        assert_eq!(ws.list_tags().unwrap(), vec![tag.clone()]);
        assert_eq!(ws.read_entry(&entry.id).unwrap().tags, vec![tag.id]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_is_idempotent_and_rejects_external_edits() {
        let root = std::env::temp_dir().join(format!("neuink_tag_journal_{}", EntryId::new()));
        let ws = Workspace::create(&root).unwrap();
        let entry = ws.create_entry("original").unwrap();
        let mut after = entry.clone();
        after.title = "updated".into();
        let change = ws
            .tag_file_change(
                TagTransactionTarget::Entry {
                    entry_id: entry.id.clone(),
                    trashed: false,
                },
                &after,
            )
            .unwrap();
        let journal = root.join("tag-operation.journal.json");
        atomic_write_json(
            &journal,
            &TagTransaction {
                version: 1,
                changes: vec![change],
            },
        )
        .unwrap();
        atomic_write_json(ws.layout().entry_meta_file(&entry.id), &after).unwrap();
        Workspace::open_existing(&root).unwrap();
        assert!(!journal.exists());
        let change = ws
            .tag_file_change(
                TagTransactionTarget::Entry {
                    entry_id: entry.id.clone(),
                    trashed: false,
                },
                &entry,
            )
            .unwrap();
        atomic_write_json(
            &journal,
            &TagTransaction {
                version: 1,
                changes: vec![change],
            },
        )
        .unwrap();
        after.title = "external".into();
        atomic_write_json(ws.layout().entry_meta_file(&entry.id), &after).unwrap();
        assert!(Workspace::open_existing(&root).is_err());
        assert_eq!(ws.read_entry(&entry.id).unwrap().title, "external");
        assert!(journal.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
