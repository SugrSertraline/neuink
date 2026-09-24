use chrono::{DateTime, Utc};
use neuink_domain::{EntryId, EntryMeta, TagId};

use crate::{atomic_write_json, tag_transaction::TagTransactionTarget, Workspace, WorkspaceError};

impl Workspace {
    pub fn apply_entry_meta_patch(
        &self,
        entry_id: &EntryId,
        base_updated_at: DateTime<Utc>,
        title: String,
        description: String,
    ) -> Result<EntryMeta, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let mut entry = self.read_entry(entry_id)?;
        if entry.updated_at != base_updated_at {
            return Err(WorkspaceError::EntryRevisionConflict(entry_id.to_string()));
        }

        let description = description.trim();
        if description.is_empty() {
            entry.fields.remove("description");
        } else {
            entry
                .fields
                .insert("description".to_string(), description.to_string());
        }
        entry.title = title.trim().to_string();
        entry.updated_at = Utc::now();
        entry.validate()?;
        atomic_write_json(self.layout().entry_meta_file(entry_id), &entry)?;
        Ok(entry)
    }

    /// Change only membership under the metadata lock, using the existing multi-file journal.
    pub fn apply_entry_tag_membership(
        &self,
        entry_ids: &[EntryId],
        tag_id: &TagId,
        attach: bool,
    ) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        if !self.list_tags()?.iter().any(|tag| tag.id == *tag_id) {
            return Err(WorkspaceError::TagReading(
                "目标标签已不存在，未修改条目".into(),
            ));
        }
        let mut changes = Vec::new();
        let unique: std::collections::BTreeSet<_> = entry_ids.iter().collect();
        for entry_id in unique {
            let mut entry = self.read_entry(entry_id)?;
            if entry.tags.contains(tag_id) == attach {
                continue;
            }
            if attach {
                entry.tags.push(tag_id.clone());
            } else {
                entry.tags.retain(|id| id != tag_id);
            }
            entry.updated_at = Utc::now();
            entry.validate()?;
            changes.push(self.tag_file_change(
                TagTransactionTarget::Entry {
                    entry_id: entry.id.clone(),
                    trashed: false,
                },
                &entry,
            )?);
        }
        if changes.is_empty() {
            return Ok(());
        }
        self.commit_tag_transaction(changes)
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    #[test]
    fn applies_metadata_patch_and_preserves_other_fields() {
        let root = test_root("apply");
        let workspace = Workspace::create(&root).unwrap();
        let mut entry = workspace.create_entry("old.pdf").unwrap();
        entry.fields.insert("author".to_string(), "Ada".to_string());
        entry = workspace
            .update_entry_meta(&entry.id, &entry.title, entry.fields, entry.tags)
            .unwrap();

        let updated = workspace
            .apply_entry_meta_patch(
                &entry.id,
                entry.updated_at,
                "New title".to_string(),
                "New description".to_string(),
            )
            .unwrap();

        assert_eq!(updated.title, "New title");
        assert_eq!(
            updated.fields.get("description").unwrap(),
            "New description"
        );
        assert_eq!(updated.fields.get("author").unwrap(), "Ada");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_a_stale_metadata_proposal() {
        let root = test_root("conflict");
        let workspace = Workspace::create(&root).unwrap();
        let entry = workspace.create_entry("Old").unwrap();
        workspace
            .update_entry_meta(&entry.id, "Changed", entry.fields, entry.tags)
            .unwrap();

        let result = workspace.apply_entry_meta_patch(
            &entry.id,
            entry.updated_at,
            "Proposal".to_string(),
            String::new(),
        );

        assert!(matches!(
            result,
            Err(WorkspaceError::EntryRevisionConflict(_))
        ));
        fs::remove_dir_all(root).unwrap();
    }

    fn test_root(name: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("neuink_entry_meta_{name}_{suffix}"))
    }

    #[test]
    fn tag_membership_preserves_current_metadata_and_preflights_all_targets() {
        let root = test_root("membership");
        let workspace = Workspace::create(&root).expect("workspace");
        let entry = workspace.create_entry("Before").expect("entry");
        let tag = workspace.create_tag("Reviewed", None).expect("tag");
        let mut fields = entry.fields.clone();
        fields.insert("author".into(), "Ada".into());
        workspace
            .update_entry_meta(&entry.id, "Edited by user", fields.clone(), vec![])
            .expect("edit");
        assert!(workspace
            .apply_entry_tag_membership(
                &[entry.id.clone(), EntryId::from_string("missing")],
                &tag.id,
                true
            )
            .is_err());
        assert!(workspace
            .read_entry(&entry.id)
            .expect("entry")
            .tags
            .is_empty());
        workspace
            .apply_entry_tag_membership(&[entry.id.clone(), entry.id.clone()], &tag.id, true)
            .expect("attach");
        let after = workspace.read_entry(&entry.id).expect("entry");
        assert_eq!(after.title, "Edited by user");
        assert_eq!(after.fields, fields);
        assert_eq!(after.tags, vec![tag.id.clone()]);
        workspace
            .apply_entry_tag_membership(&[entry.id.clone()], &tag.id, false)
            .expect("detach");
        assert!(workspace
            .read_entry(&entry.id)
            .expect("entry")
            .tags
            .is_empty());
        fs::remove_dir_all(root).expect("cleanup");
    }
}
