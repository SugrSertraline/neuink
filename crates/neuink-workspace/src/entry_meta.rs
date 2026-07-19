use chrono::{DateTime, Utc};
use neuink_domain::{EntryId, EntryMeta};

use crate::{Workspace, WorkspaceError};

impl Workspace {
    pub fn apply_entry_meta_patch(
        &self,
        entry_id: &EntryId,
        base_updated_at: DateTime<Utc>,
        title: String,
        description: String,
    ) -> Result<EntryMeta, WorkspaceError> {
        let entry = self.read_entry(entry_id)?;
        if entry.updated_at != base_updated_at {
            return Err(WorkspaceError::EntryRevisionConflict(entry_id.to_string()));
        }

        let mut fields = entry.fields;
        let description = description.trim();
        if description.is_empty() {
            fields.remove("description");
        } else {
            fields.insert("description".to_string(), description.to_string());
        }

        self.update_entry_meta(entry_id, title.trim(), fields, entry.tags)
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
}
