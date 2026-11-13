use super::test_support::{binding, exchange, replica};
use super::*;
use neuink_domain::ContentItem;
#[tokio::test]
async fn deletion_group_choice_keeps_parent_and_note_consistent() {
    for keep_local in [false, true] {
        let da = tempfile::tempdir().unwrap();
        let db = tempfile::tempdir().unwrap();
        let a = Workspace::create(da.path()).unwrap();
        let b = Workspace::create(db.path()).unwrap();
        let binding = binding();
        a.bind_sync(&binding).unwrap();
        b.bind_sync(&binding).unwrap();
        let entry = a.create_entry("Group choice").unwrap();
        let entry = a.create_note(&entry.id, "Child").unwrap();
        let ContentItem::Note { note_id, .. } = &entry.contents[0];
        let bundle =
            neuink_workspace::sync_export::export_entry(da.path(), entry.id.as_str()).unwrap();
        b.stage_sync_bundle(&binding, &bundle).unwrap();
        let mut ra = replica(&a, &binding);
        let mut rb = replica(&b, &binding);
        let mut revision = 0;
        let client = SyncClient::new("http://127.0.0.1:1").unwrap();
        observe(&a, &mut ra, &binding, true).unwrap();
        exchange(&mut ra, &mut rb, &mut revision);
        let mut result = WorkspaceSyncResult::default();
        inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut result)
            .await
            .unwrap();
        b.update_note(&entry.id, note_id, "Child", "B saved edit")
            .unwrap();
        observe(&b, &mut rb, &binding, true).unwrap();
        a.delete_entry(&entry.id).unwrap();
        for _ in 0..3 {
            observe(&a, &mut ra, &binding, true).unwrap();
            exchange(&mut ra, &mut rb, &mut revision);
        }
        let id = format!("note:{note_id}");
        let group = conflicts::group::inspect(&b, &binding, &id).unwrap();
        assert!(group.remote_deleted);
        assert_eq!(group.members.len(), 2);
        conflicts::group::resolve(&b, &binding, &id, &group.token, keep_local).unwrap();
        assert!(rb.conflicts().unwrap().is_empty());
        if keep_local {
            let pending = rb.pending().unwrap();
            assert_eq!(pending.len(), 2);
            assert!(pending
                .iter()
                .all(|o| matches!(o.mutation, Mutation::Restore { .. })));
            assert_eq!(
                b.read_note(&entry.id, note_id).unwrap().markdown,
                "B saved edit"
            );
        } else {
            let mut result = WorkspaceSyncResult::default();
            inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut result)
                .await
                .unwrap();
            assert!(result.failures.is_empty(), "{:?}", result.failures);
            assert!(b.list_entries().unwrap().is_empty());
            assert_eq!(b.list_trashed_entries().unwrap().len(), 1);
        }
    }
}

#[tokio::test]
async fn local_deletion_group_can_keep_deletion_or_restore_remote_edit() {
    for keep_local in [false, true] {
        let da = tempfile::tempdir().unwrap();
        let db = tempfile::tempdir().unwrap();
        let a = Workspace::create(da.path()).unwrap();
        let b = Workspace::create(db.path()).unwrap();
        let binding = binding();
        a.bind_sync(&binding).unwrap();
        b.bind_sync(&binding).unwrap();
        let entry = a.create_entry("Local deletion").unwrap();
        let entry = a.create_note(&entry.id, "Child").unwrap();
        let ContentItem::Note { note_id, .. } = &entry.contents[0];
        let bundle =
            neuink_workspace::sync_export::export_entry(da.path(), entry.id.as_str()).unwrap();
        b.stage_sync_bundle(&binding, &bundle).unwrap();
        let mut ra = replica(&a, &binding);
        let mut rb = replica(&b, &binding);
        let mut revision = 0;
        let client = SyncClient::new("http://127.0.0.1:1").unwrap();
        observe(&a, &mut ra, &binding, true).unwrap();
        exchange(&mut ra, &mut rb, &mut revision);
        let mut result = WorkspaceSyncResult::default();
        inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut result)
            .await
            .unwrap();
        b.delete_entry(&entry.id).unwrap();
        observe(&b, &mut rb, &binding, true).unwrap();
        a.update_note(&entry.id, note_id, "Child", "Remote saved edit")
            .unwrap();
        observe(&a, &mut ra, &binding, true).unwrap();
        exchange(&mut ra, &mut rb, &mut revision);
        let bundle =
            neuink_workspace::sync_export::export_entry(da.path(), entry.id.as_str()).unwrap();
        b.stage_sync_bundle(&binding, &bundle).unwrap();
        let id = format!("note:{note_id}");
        let group = conflicts::group::inspect(&b, &binding, &id).unwrap();
        assert!(group.local_deleted);
        assert!(conflicts::group::resolve(&b, &binding, &id, "stale", keep_local).is_err());
        assert!(!rb.conflicts().unwrap().is_empty());
        conflicts::group::resolve(&b, &binding, &id, &group.token, keep_local).unwrap();
        assert!(rb.conflicts().unwrap().is_empty());
        let scan = observe(&b, &mut rb, &binding, true).unwrap();
        assert!(scan.failures.is_empty(), "{:?}", scan.failures);
        if keep_local {
            let pending = rb.pending().unwrap();
            assert_eq!(pending.len(), 2);
            assert!(pending
                .iter()
                .all(|o| matches!(o.mutation, Mutation::Delete)));
            assert!(b.list_entries().unwrap().is_empty());
        } else {
            let mut result = WorkspaceSyncResult::default();
            inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut result)
                .await
                .unwrap();
            assert!(result.failures.is_empty(), "{:?}", result.failures);
            assert_eq!(
                b.read_note(&entry.id, note_id).unwrap().markdown,
                "Remote saved edit"
            );
            assert!(rb.pending().unwrap().is_empty());
        }
        assert!(b.pending_entry_lifecycle_events().unwrap().is_empty());
    }
}
