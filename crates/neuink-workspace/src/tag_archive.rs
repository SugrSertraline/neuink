use chrono::{DateTime, Utc};
use neuink_domain::{EntryId, EntryMeta, TagId, TagMeta};
use serde::{Deserialize, Serialize};
use std::fs;

use crate::{
    tag_reading::validate_id, tag_transaction::TagTransactionTarget,
    workspace::collect_descendant_tag_ids, Workspace, WorkspaceError,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ArchivedEntryTags {
    entry_id: EntryId,
    before: Vec<TagId>,
    after: Vec<TagId>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TagArchive {
    pub archive_id: TagId,
    pub root_tag: TagMeta,
    pub tags: Vec<TagMeta>,
    pub deleted_at: DateTime<Utc>,
    pub(crate) entries: Vec<ArchivedEntryTags>,
}

impl Workspace {
    pub fn list_tag_archives(&self) -> Result<Vec<TagArchive>, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        self.recover_tag_archive_purges()?;
        Ok(self.read_workspace_file()?.tag_archives)
    }

    pub fn purge_tag_archive(&self, archive_id: &TagId) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        validate_id(archive_id.as_str())?;
        self.recover_tag_archive_purges()?;
        let mut file = self.read_workspace_file()?;
        let archive = file
            .tag_archives
            .iter()
            .find(|item| item.archive_id == *archive_id)
            .cloned()
            .ok_or_else(|| WorkspaceError::TrashItemMissing(archive_id.to_string()))?;
        let reading_root = self.layout().root().join("tag-reading");
        let staged = reading_root.join(format!(".purging-{}", archive_id.as_str()));
        self.validate_note_workspace_path(&staged)?;
        fs::create_dir_all(&staged)?;
        let result = (|| {
            for tag in &archive.tags {
                let source = reading_root.join(tag.id.as_str());
                if source.exists() {
                    self.validate_note_workspace_path(&source)?;
                    fs::rename(source, staged.join(tag.id.as_str()))?;
                }
            }
            file.tag_archives
                .retain(|item| item.archive_id != *archive_id);
            self.write_workspace_file(&file)
        })();
        if let Err(error) = result {
            if let Err(recovery_error) = self.recover_tag_archive_purge_dir(&staged, true) {
                return Err(WorkspaceError::TagReading(format!(
                    "标签彻底删除失败：{error}；暂存资料尚未完全恢复，已保留，请解决恢复错误后重试：{recovery_error}"
                )));
            }
            return Err(error);
        }
        fs::remove_dir_all(staged)?;
        Ok(())
    }

    fn recover_tag_archive_purges(&self) -> Result<(), WorkspaceError> {
        let reading_root = self.layout().root().join("tag-reading");
        if !reading_root.exists() {
            return Ok(());
        }
        let file = self.read_workspace_file()?;
        for item in fs::read_dir(&reading_root)? {
            let path = item?.path();
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let Some(id) = name.strip_prefix(".purging-") else {
                continue;
            };
            validate_id(id)?;
            self.validate_note_workspace_path(&path)?;
            let archive_exists = file
                .tag_archives
                .iter()
                .any(|archive| archive.archive_id.as_str() == id);
            // Older versions could restore metadata before recovering these files.
            // An active tag still owns its staged data even without an archive.
            let active_tag_exists = file
                .tags
                .iter()
                .any(|tag| path.join(tag.id.as_str()).exists());
            self.recover_tag_archive_purge_dir(&path, archive_exists || active_tag_exists)?;
        }
        Ok(())
    }

    fn recover_tag_archive_purge_dir(
        &self,
        staged: &std::path::Path,
        restore: bool,
    ) -> Result<(), WorkspaceError> {
        if !staged.exists() {
            return Ok(());
        }
        if restore {
            let reading_root = staged
                .parent()
                .ok_or_else(|| WorkspaceError::TagReading("标签暂存路径无效".into()))?;
            for item in fs::read_dir(staged)? {
                let source = item?.path();
                let id = source
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or_else(|| WorkspaceError::TagReading("标签暂存项目无效".into()))?;
                validate_id(id)?;
                let target = reading_root.join(id);
                if target.exists() {
                    return Err(WorkspaceError::TagReading(
                        "标签阅读资料恢复位置已存在".into(),
                    ));
                }
                fs::rename(source, target)?;
            }
        }
        fs::remove_dir_all(staged)?;
        Ok(())
    }

    pub fn delete_tag(&self, tag_id: &TagId) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        validate_id(tag_id.as_str())?;
        let mut file = self.read_workspace_file()?;
        let root_tag = file
            .tags
            .iter()
            .find(|tag| tag.id == *tag_id)
            .cloned()
            .ok_or_else(|| WorkspaceError::TagMissing(tag_id.to_string()))?;
        let deleted = collect_descendant_tag_ids(&file.tags, tag_id);
        let mut archive = TagArchive {
            archive_id: TagId::new(),
            root_tag,
            deleted_at: Utc::now(),
            tags: file
                .tags
                .iter()
                .filter(|tag| deleted.contains(&tag.id))
                .cloned()
                .collect(),
            entries: Vec::new(),
        };
        let mut changes = Vec::new();
        for (mut entry, trashed) in self.entries_including_trash()? {
            let before = entry.tags.clone();
            entry.tags.retain(|id| !deleted.contains(id));
            if before == entry.tags {
                continue;
            }
            archive.entries.push(ArchivedEntryTags {
                entry_id: entry.id.clone(),
                before,
                after: entry.tags.clone(),
            });
            entry.updated_at = Utc::now();
            changes.push(self.tag_file_change(
                TagTransactionTarget::Entry {
                    entry_id: entry.id.clone(),
                    trashed,
                },
                &entry,
            )?);
        }
        file.tags.retain(|tag| !deleted.contains(&tag.id));
        file.tag_archives.push(archive);
        // The durable journal contains the archive before any membership is removed.
        // Reading files stay at stable TagId paths, inaccessible until their tags are restored.
        changes.push(self.tag_file_change(TagTransactionTarget::Workspace, &file)?);
        self.commit_tag_transaction(changes)
    }

    pub fn restore_tag_archive(&self, archive_id: &TagId) -> Result<usize, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        // Keep the archive as recovery evidence until every staged file is back.
        // A failed/partial recovery must not turn the next cleanup into a purge.
        self.recover_tag_archive_purges()?;
        let mut file = self.read_workspace_file()?;
        let archive = file
            .tag_archives
            .iter()
            .find(|item| item.archive_id == *archive_id)
            .cloned()
            .ok_or_else(|| WorkspaceError::TrashItemMissing(archive_id.to_string()))?;
        for tag in &archive.tags {
            if file.tags.iter().any(|existing| {
                existing.id == tag.id
                    || (existing.parent_id == tag.parent_id
                        && existing.name.eq_ignore_ascii_case(&tag.name))
            }) {
                return Err(WorkspaceError::TagReading(
                    "恢复位置已有同名标签，请先重命名现有标签；未合并或覆盖".into(),
                ));
            }
            if tag.parent_id.as_ref().is_some_and(|id| {
                !file
                    .tags
                    .iter()
                    .chain(archive.tags.iter())
                    .any(|parent| parent.id == *id)
            }) {
                return Err(WorkspaceError::TagReading(
                    "请先恢复父标签，再恢复此标签".into(),
                ));
            }
        }
        let mut entries = self.entries_including_trash()?;
        let mut changes = Vec::new();
        let mut missing = 0;
        for snapshot in archive.entries {
            let Some((entry, trashed)) = entries
                .iter_mut()
                .find(|(entry, _)| entry.id == snapshot.entry_id)
            else {
                missing += 1;
                continue;
            };
            if entry.tags != snapshot.after {
                return Err(WorkspaceError::TagReading(format!(
                    "条目“{}”的标签已改变，请核对后再恢复；未覆盖当前标签",
                    entry.title
                )));
            }
            entry.tags = snapshot.before;
            entry.updated_at = Utc::now();
            changes.push(self.tag_file_change(
                TagTransactionTarget::Entry {
                    entry_id: entry.id.clone(),
                    trashed: *trashed,
                },
                entry,
            )?);
        }
        file.tags.extend(archive.tags);
        file.tag_archives
            .retain(|item| item.archive_id != *archive_id);
        changes.push(self.tag_file_change(TagTransactionTarget::Workspace, &file)?);
        self.commit_tag_transaction(changes)?;
        Ok(missing)
    }

    fn entries_including_trash(&self) -> Result<Vec<(EntryMeta, bool)>, WorkspaceError> {
        Ok(self
            .list_entries()?
            .into_iter()
            .map(|entry| (entry, false))
            .chain(
                self.list_trashed_entries()?
                    .into_iter()
                    .map(|entry| (entry, true)),
            )
            .collect())
    }
}

#[cfg(test)]
#[path = "tag_archive_tests.rs"]
mod tests;
