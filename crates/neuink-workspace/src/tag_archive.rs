use chrono::{DateTime, Utc};
use neuink_domain::{EntryId, EntryMeta, TagId, TagMeta};
use serde::{Deserialize, Serialize};

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
        Ok(self.read_workspace_file()?.tag_archives)
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
