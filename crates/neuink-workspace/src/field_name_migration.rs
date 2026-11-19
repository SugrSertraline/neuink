use crate::{tag_transaction::TagTransactionTarget, Workspace, WorkspaceError};

impl Workspace {
    /// Migrate once per workspace, using the existing crash-recoverable metadata journal.
    pub(crate) fn migrate_imported_field_names(&self) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let marker = self.layout().root().join("field-name-migration-v1.json");
        if marker.exists() { return Ok(()); }
        let mut changes = Vec::new();
        for (trashed, entries) in [(false, self.list_entries()?), (true, self.list_trashed_entries()?)] {
            for mut entry in entries {
                if neuink_domain::entry_fields::normalize_entry_fields(&mut entry.fields) {
                    entry.updated_at = chrono::Utc::now();
                    changes.push(self.tag_file_change(TagTransactionTarget::Entry { entry_id: entry.id.clone(), trashed }, &entry)?);
                }
            }
        }
        if !changes.is_empty() { self.commit_tag_transaction(changes)?; }
        crate::atomic_write_json(marker, &serde_json::json!({"version": 1}))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_handles_normal_and_trashed_entries_and_preserves_conflicts() {
        let temp = tempfile::tempdir().unwrap();
        let ws = Workspace::create(temp.path()).unwrap();
        let a = ws.create_entry("A").unwrap();
        let b = ws.create_entry("B").unwrap();
        let mut fields = std::collections::BTreeMap::new();
        fields.insert("year".into(), "2024".into()); fields.insert("doi".into(), "10.1/old".into()); fields.insert("DOI".into(), "10.1/new".into());
        ws.update_entry_meta(&a.id, "A", fields.clone(), vec![]).unwrap();
        ws.update_entry_meta(&b.id, "B", fields, vec![]).unwrap(); ws.delete_entry(&b.id).unwrap();
        let reopened = Workspace::open_existing(temp.path()).unwrap();
        for entry in reopened.list_entries().unwrap().into_iter().chain(reopened.list_trashed_entries().unwrap()) {
            assert_eq!(entry.fields["发表年份"], "2024"); assert!(!entry.fields.contains_key("year"));
            assert_eq!(entry.fields["doi"], "10.1/old"); assert_eq!(entry.fields["DOI"], "10.1/new");
        }
        assert!(reopened.layout().root().join("field-name-migration-v1.json").exists());
    }
}
