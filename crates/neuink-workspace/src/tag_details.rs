use crate::{tag_transaction::TagTransactionTarget, Workspace, WorkspaceError};
use chrono::Utc;
use neuink_domain::{EntryId, EntryMeta, TagId, TagMeta};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ApplyEntryTagPathsResponse {
    pub entry: EntryMeta,
    pub tags: Vec<TagMeta>,
}

impl Workspace {
    /// Merge suggested paths with the latest saved membership, without replacing other entry metadata.
    pub fn apply_entry_tag_paths(
        &self,
        entry_id: &EntryId,
        paths: Vec<String>,
    ) -> Result<ApplyEntryTagPathsResponse, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let mut file = self.read_workspace_file()?;
        let mut entry = self.read_entry(entry_id)?;
        let original_tag_count = file.tags.len();
        let original_membership = entry.tags.clone();

        for path in paths {
            let mut parent_id: Option<TagId> = None;
            for segment in path
                .split('/')
                .map(str::trim)
                .filter(|segment| !segment.is_empty())
            {
                if let Some(existing) = file.tags.iter().find(|tag| {
                    tag.parent_id == parent_id && tag.name.eq_ignore_ascii_case(segment)
                }) {
                    parent_id = Some(existing.id.clone());
                } else {
                    let tag = TagMeta::new(segment, parent_id)?;
                    parent_id = Some(tag.id.clone());
                    file.tags.push(tag);
                }
            }
            if let Some(tag_id) = parent_id {
                if !entry.tags.contains(&tag_id) {
                    entry.tags.push(tag_id);
                }
            }
        }

        let catalog_changed = file.tags.len() != original_tag_count;
        let entry_changed = entry.tags != original_membership;
        if entry_changed {
            entry.updated_at = Utc::now();
            entry.validate()?;
        }
        if catalog_changed || entry_changed {
            let mut changes = Vec::new();
            if catalog_changed {
                changes.push(self.tag_file_change(TagTransactionTarget::Workspace, &file)?);
            }
            if entry_changed {
                changes.push(self.tag_file_change(
                    TagTransactionTarget::Entry {
                        entry_id: entry_id.clone(),
                        trashed: false,
                    },
                    &entry,
                )?);
            }
            self.commit_tag_transaction(changes)?;
        }
        Ok(ApplyEntryTagPathsResponse {
            entry,
            tags: file.tags,
        })
    }

    /// Compare the edited field only: an unrelated rename must not overwrite a description.
    pub fn update_tag_description(
        &self,
        tag_id: &TagId,
        description: String,
        expected_description: &str,
    ) -> Result<TagMeta, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        crate::tag_reading::validate_id(tag_id.as_str())?;
        if description.len() > 64 * 1024 {
            return Err(WorkspaceError::TagReading("标签描述不能超过 64 KB".into()));
        }
        let mut file = self.read_workspace_file()?;
        let tag = file
            .tags
            .iter_mut()
            .find(|tag| &tag.id == tag_id)
            .ok_or_else(|| WorkspaceError::TagMissing(tag_id.to_string()))?;
        if tag.description != expected_description {
            return Err(WorkspaceError::TagReading(
                "标签描述已在其他位置修改，请保留草稿并重新加载".into(),
            ));
        }
        tag.description = description;
        tag.updated_at = chrono::Utc::now();
        let saved = tag.clone();
        self.write_workspace_file(&file)?;
        Ok(saved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggestions_merge_with_current_tags_and_preserve_entry_metadata() {
        let root = std::env::temp_dir().join(format!("neuink_tag_merge_{}", EntryId::new()));
        let workspace = Workspace::create(&root).unwrap();
        let entry = workspace.create_entry("Original title").unwrap();
        let first = workspace
            .apply_entry_tag_paths(
                &entry.id,
                vec!["a".into(), "b".into(), "c".into(), "d".into()],
            )
            .unwrap();
        let original_ids = first.entry.tags.clone();

        // Simulate a detail-page edit after the reader loaded its old snapshot.
        let latest = workspace
            .update_entry_meta(
                &entry.id,
                "Edited title",
                Default::default(),
                original_ids.clone(),
            )
            .unwrap();
        let saved = workspace
            .apply_entry_tag_paths(
                &entry.id,
                vec!["c".into(), "d".into(), "e".into(), "E".into()],
            )
            .unwrap();
        assert_eq!(saved.entry.title, latest.title);
        assert_eq!(&saved.entry.tags[..4], &original_ids);
        assert_eq!(saved.entry.tags.len(), 5);
        assert_eq!(saved.tags.len(), 5);
        assert_eq!(
            workspace.read_entry(&entry.id).unwrap().tags,
            saved.entry.tags
        );

        let unchanged = workspace
            .apply_entry_tag_paths(&entry.id, vec!["a".into(), "b".into(), "c".into()])
            .unwrap();
        assert_eq!(unchanged.entry.tags, saved.entry.tags);
        assert_eq!(unchanged.entry.updated_at, saved.entry.updated_at);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn suggestions_reuse_existing_hierarchical_tags() {
        let root = std::env::temp_dir().join(format!("neuink_tag_merge_{}", EntryId::new()));
        let workspace = Workspace::create(&root).unwrap();
        let entry = workspace.create_entry("Paper").unwrap();
        let parent = workspace.create_tag("Research", None).unwrap();
        let child = workspace.create_tag("Traffic", Some(parent.id)).unwrap();
        let saved = workspace
            .apply_entry_tag_paths(
                &entry.id,
                vec!["research/traffic".into(), "Research/Forecast".into()],
            )
            .unwrap();
        assert_eq!(saved.entry.tags[0], child.id);
        assert_eq!(saved.tags.len(), 3);
        assert_eq!(saved.entry.tags.len(), 2);
        std::fs::remove_dir_all(root).unwrap();
    }
}
