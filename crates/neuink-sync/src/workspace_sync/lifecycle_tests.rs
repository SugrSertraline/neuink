use super::test_support::{binding, exchange, replica};
use super::*;
use neuink_domain::ContentItem;

#[tokio::test]
async fn ideation_with_trashed_source_syncs_without_restoring_or_deleting_cards() {
    let a_dir = tempfile::tempdir().unwrap();
    let b_dir = tempfile::tempdir().unwrap();
    let a = Workspace::create(a_dir.path()).unwrap();
    let b = Workspace::create(b_dir.path()).unwrap();
    let entry = a.create_entry("Source").unwrap();
    let mut snapshot = a.read_ideation().unwrap();
    snapshot.state.cards.push(serde_json::from_value(serde_json::json!({
        "id":"retained", "entry_id":entry.id.as_str(), "title":"Idea", "body":"Saved evidence", "kind":"method"
    })).unwrap());
    a.save_ideation(&snapshot.revision, snapshot.state).unwrap();
    a.delete_entry(&entry.id).unwrap();
    let binding = binding();
    a.bind_sync(&binding).unwrap(); b.bind_sync(&binding).unwrap();
    let mut ra = replica(&a, &binding); let mut rb = replica(&b, &binding);
    let mut revision = 0;
    let observation = observe(&a, &mut ra, &binding, true).unwrap();
    assert!(observation.ready.contains("board:ideation"), "{:?}", observation.failures);
    exchange(&mut ra, &mut rb, &mut revision);
    let client = SyncClient::new("http://127.0.0.1:1").unwrap();
    let mut result = WorkspaceSyncResult::default();
    inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut result).await.unwrap();
    assert!(result.failures.is_empty(), "{:?}", result.failures);
    assert_eq!(b.read_ideation().unwrap().state.cards[0].entry_id, entry.id.as_str());
    assert_eq!(b.read_ideation().unwrap().state.cards[0].body, "Saved evidence");
    assert!(a.read_entry(&entry.id).is_err());
    assert!(b.read_entry(&entry.id).is_err());
    let restored = a.restore_entry(&entry.id).unwrap();
    assert_eq!(restored.id, entry.id);
    let observation = observe(&a, &mut ra, &binding, true).unwrap();
    assert!(observation.ready.contains("board:ideation"));
    assert_eq!(a.read_ideation().unwrap().state.cards.len(), 1);
    exchange(&mut ra, &mut rb, &mut revision);
    let mut restored_result = WorkspaceSyncResult::default();
    inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut restored_result).await.unwrap();
    assert!(restored_result.failures.is_empty(), "{:?}", restored_result.failures);
    assert!(b.read_entry(&entry.id).is_ok());
    a.delete_entry(&entry.id).unwrap();
    for _ in 0..4 {
        let observation = observe(&a, &mut ra, &binding, true).unwrap();
        assert!(observation.ready.contains("board:ideation"), "{:?}", observation.failures);
        exchange(&mut ra, &mut rb, &mut revision);
        let mut deleted_result = WorkspaceSyncResult::default();
        inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut deleted_result).await.unwrap();
        assert!(deleted_result.failures.is_empty(), "{:?}", deleted_result.failures);
    }
    assert!(b.read_entry(&entry.id).is_err());
    assert_eq!(b.read_ideation().unwrap().state.cards[0].body, "Saved evidence");
}

#[tokio::test]
async fn two_workspaces_delete_restore_and_child_edit_conflict_keep_real_note_files() {
    let a_dir = tempfile::tempdir().unwrap();
    let b_dir = tempfile::tempdir().unwrap();
    let a = Workspace::create(a_dir.path()).unwrap();
    let b = Workspace::create(b_dir.path()).unwrap();
    let binding = binding();
    a.bind_sync(&binding).unwrap();
    b.bind_sync(&binding).unwrap();
    let entry = a.create_entry("Roundtrip").unwrap();
    let entry = a.create_note(&entry.id, "Evidence").unwrap();
    let ContentItem::Note { note_id, .. } = &entry.contents[0];
    a.update_note(&entry.id, note_id, "Evidence", "Last saved text")
        .unwrap();
    let bundle =
        neuink_workspace::sync_export::export_entry(a_dir.path(), entry.id.as_str()).unwrap();
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
    assert!(result.failures.is_empty(), "{:?}", result.failures);
    assert_eq!(
        b.read_note(&entry.id, note_id).unwrap().markdown,
        "Last saved text"
    );
    a.delete_entry(&entry.id).unwrap();
    observe(&a, &mut ra, &binding, true).unwrap();
    for _ in 0..2 {
        exchange(&mut ra, &mut rb, &mut revision);
        observe(&a, &mut ra, &binding, true).unwrap();
    }
    exchange(&mut ra, &mut rb, &mut revision);
    let mut result = WorkspaceSyncResult::default();
    inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut result)
        .await
        .unwrap();
    assert!(result.failures.is_empty(), "{:?}", result.failures);
    assert!(b.list_entries().unwrap().is_empty());
    assert_eq!(b.list_trashed_entries().unwrap().len(), 1);
    assert!(
        b.pending_entry_lifecycle_events().unwrap().is_empty(),
        "remote deletion must not echo as a new local intent"
    );
    observe(&a, &mut ra, &binding, true).unwrap();
    a.restore_entry(&entry.id).unwrap();
    observe(&a, &mut ra, &binding, true).unwrap();
    exchange(&mut ra, &mut rb, &mut revision);
    let mut result = WorkspaceSyncResult::default();
    inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut result)
        .await
        .unwrap();
    assert!(result.failures.is_empty(), "{:?}", result.failures);
    assert_eq!(
        b.read_note(&entry.id, note_id).unwrap().markdown,
        "Last saved text"
    );
    assert!(b.list_trashed_entries().unwrap().is_empty());
    // A fresh local child edit on B must prevent A's whole-entry deletion.
    b.update_note(&entry.id, note_id, "Evidence", "B's newer edit")
        .unwrap();
    observe(&b, &mut rb, &binding, true).unwrap();
    a.delete_entry(&entry.id).unwrap();
    observe(&a, &mut ra, &binding, true).unwrap();
    for _ in 0..2 {
        exchange(&mut ra, &mut rb, &mut revision);
        observe(&a, &mut ra, &binding, true).unwrap();
    }
    exchange(&mut ra, &mut rb, &mut revision);
    let mut result = WorkspaceSyncResult::default();
    inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut result)
        .await
        .unwrap();
    assert!(!rb.conflicts().unwrap().is_empty());
    assert_eq!(
        b.read_note(&entry.id, note_id).unwrap().markdown,
        "B's newer edit"
    );
    assert!(b.list_trashed_entries().unwrap().is_empty());
}

#[tokio::test]
async fn individual_notes_delete_as_a_group_and_restore_without_duplicate_trash_records() {
    let da = tempfile::tempdir().unwrap();
    let db = tempfile::tempdir().unwrap();
    let a = Workspace::create(da.path()).unwrap();
    let b = Workspace::create(db.path()).unwrap();
    let binding = binding();
    a.bind_sync(&binding).unwrap();
    b.bind_sync(&binding).unwrap();
    let entry = a.create_entry("Child roundtrip").unwrap();
    let entry = a.create_note(&entry.id, "One").unwrap();
    let entry = a.create_note(&entry.id, "Two").unwrap();
    let ContentItem::Note { note_id: first, .. } = &entry.contents[0];
    let ContentItem::Note {
        note_id: second, ..
    } = &entry.contents[1];
    a.update_note(&entry.id, first, "One", "Initial").unwrap();
    let bundle = neuink_workspace::sync_export::export_entry(da.path(), entry.id.as_str()).unwrap();
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
    assert!(result.failures.is_empty(), "{:?}", result.failures);
    a.update_note(&entry.id, first, "One", "Final offline edit")
        .unwrap();
    a.delete_note(&entry.id, first).unwrap();
    a.delete_note(&entry.id, second).unwrap();
    for _ in 0..3 {
        let scan = observe(&a, &mut ra, &binding, true).unwrap();
        assert!(scan.failures.is_empty(), "{:?}", scan.failures);
        exchange(&mut ra, &mut rb, &mut revision);
    }
    let mut result = WorkspaceSyncResult::default();
    inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut result)
        .await
        .unwrap();
    assert!(result.failures.is_empty(), "{:?}", result.failures);
    assert!(b.read_entry(&entry.id).unwrap().contents.is_empty());
    assert_eq!(b.list_entry_trash_items(&entry.id).unwrap().len(), 2);
    a.restore_trash_item(&entry.id, &format!("markdown_note:{first}"))
        .unwrap();
    let bundle = neuink_workspace::sync_export::export_entry(da.path(), entry.id.as_str()).unwrap();
    b.stage_sync_bundle(&binding, &bundle).unwrap();
    observe(&a, &mut ra, &binding, true).unwrap();
    exchange(&mut ra, &mut rb, &mut revision);
    let mut result = WorkspaceSyncResult::default();
    inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut result)
        .await
        .unwrap();
    assert!(result.failures.is_empty(), "{:?}", result.failures);
    assert_eq!(
        b.read_note(&entry.id, first).unwrap().markdown,
        "Final offline edit"
    );
    assert_eq!(b.list_entry_trash_items(&entry.id).unwrap().len(), 1);
    // A restored note can be deleted again; retained old archive bytes never
    // cause an overwrite or a false same-name conflict.
    b.delete_note(&entry.id, first).unwrap();
    b.restore_trash_item(&entry.id, &format!("markdown_note:{first}"))
        .unwrap();
    assert_eq!(
        b.read_note(&entry.id, first).unwrap().markdown,
        "Final offline edit"
    );
}

#[tokio::test]
async fn offline_child_then_parent_deletion_converges_without_recreating_child() {
    let da = tempfile::tempdir().unwrap();
    let db = tempfile::tempdir().unwrap();
    let a = Workspace::create(da.path()).unwrap();
    let b = Workspace::create(db.path()).unwrap();
    let binding = binding();
    a.bind_sync(&binding).unwrap();
    b.bind_sync(&binding).unwrap();
    let entry = a.create_entry("Nested deletion").unwrap();
    let entry = a.create_note(&entry.id, "Child").unwrap();
    let ContentItem::Note { note_id, .. } = &entry.contents[0];
    let bundle = neuink_workspace::sync_export::export_entry(da.path(), entry.id.as_str()).unwrap();
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
    assert!(result.failures.is_empty(), "{:?}", result.failures);
    a.delete_note(&entry.id, note_id).unwrap();
    a.delete_entry(&entry.id).unwrap();
    for _ in 0..8 {
        let scan = observe(&a, &mut ra, &binding, true).unwrap();
        assert!(scan.failures.is_empty(), "{:?}", scan.failures);
        exchange(&mut ra, &mut rb, &mut revision);
    }
    let mut result = WorkspaceSyncResult::default();
    inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut result)
        .await
        .unwrap();
    assert!(result.failures.is_empty(), "{:?}", result.failures);
    assert!(b.list_entries().unwrap().is_empty());
    assert_eq!(b.list_trashed_entries().unwrap().len(), 1);
    assert!(a.pending_child_lifecycle_events().unwrap().is_empty());
    assert!(a.pending_entry_lifecycle_events().unwrap().is_empty());
    a.restore_entry(&entry.id).unwrap();
    observe(&a, &mut ra, &binding, true).unwrap();
    exchange(&mut ra, &mut rb, &mut revision);
    let mut result = WorkspaceSyncResult::default();
    inbound::apply(&b, &client, &binding, "unused", &mut rb, &mut result)
        .await
        .unwrap();
    assert!(result.failures.is_empty(), "{:?}", result.failures);
    assert!(b.read_entry(&entry.id).unwrap().contents.is_empty());
}
