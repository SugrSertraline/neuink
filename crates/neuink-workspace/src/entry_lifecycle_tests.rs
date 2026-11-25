use super::*;

fn binding() -> WorkspaceSyncBinding {
    WorkspaceSyncBinding {
        server_id: "1".repeat(64),
        account_id: "2".repeat(64),
        library_id: "3".repeat(64),
        epoch: "4".repeat(64),
    }
}
fn intent(entry_id: EntryId, action: EntryLifecycleAction) -> EntryLifecycleEvent {
    EntryLifecycleEvent {
        version: 1,
        sequence: 1,
        remote: false,
        event_id: EntryId::new().to_string(),
        entry_id,
        action,
        occurred_at: chrono::Utc::now(),
        binding: None,
        documents: Vec::new(),
        snapshot_issue: None,
    }
}

#[test]
fn explicit_delete_freezes_last_saved_note_and_restore_keeps_both_intents() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    workspace.bind_sync(&binding()).unwrap();
    let entry = workspace.create_entry("Offline edit").unwrap();
    let entry = workspace.create_note(&entry.id, "Note").unwrap();
    let neuink_domain::ContentItem::Note { note_id, .. } = &entry.contents[0];
    workspace
        .update_note(&entry.id, note_id, "Note", "Latest offline text")
        .unwrap();
    workspace.delete_entry(&entry.id).unwrap();
    let events = workspace.pending_entry_lifecycle_events().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].action, EntryLifecycleAction::Delete);
    assert!(events[0].snapshot_issue.is_none());
    let note = events[0]
        .documents
        .iter()
        .find(|d| d.kind == neuink_sync_protocol::ObjectKind::Note)
        .unwrap();
    let resource = note
        .resources
        .iter()
        .find(|r| r.name == "note.json")
        .unwrap();
    let bytes = workspace.read_sync_resource(&binding(), resource).unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["markdown"],
        "Latest offline text"
    );
    let reopened = Workspace::open_existing(dir.path()).unwrap();
    reopened.restore_entry(&entry.id).unwrap();
    assert_eq!(reopened.pending_entry_lifecycle_events().unwrap().len(), 2);
    assert!(reopened.layout().entry_dir(&entry.id).exists());
    assert!(!reopened
        .layout()
        .entry_dir(&entry.id)
        .join(".trashed.json")
        .exists());
}

#[test]
fn recovers_both_sides_of_directory_move_and_restore_marker_cleanup() {
    for moved in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let entry = workspace.create_entry("Recovery").unwrap();
        atomic_write_json(
            dir.path().join(JOURNAL),
            &intent(entry.id.clone(), EntryLifecycleAction::Delete),
        )
        .unwrap();
        if moved {
            fs::create_dir_all(workspace.layout().trashed_entries_dir()).unwrap();
            fs::rename(
                workspace.layout().entry_dir(&entry.id),
                workspace.layout().trashed_entry_dir(&entry.id),
            )
            .unwrap();
        }
        let workspace = Workspace::open_existing(dir.path()).unwrap();
        assert!(workspace.layout().trashed_entry_dir(&entry.id).exists());
        assert!(!dir.path().join(JOURNAL).exists());
        atomic_write_json(
            dir.path().join(JOURNAL),
            &intent(entry.id.clone(), EntryLifecycleAction::Restore),
        )
        .unwrap();
        fs::rename(
            workspace.layout().trashed_entry_dir(&entry.id),
            workspace.layout().entry_dir(&entry.id),
        )
        .unwrap();
        Workspace::open_existing(dir.path()).unwrap();
        assert!(!workspace
            .layout()
            .entry_dir(&entry.id)
            .join(".trashed.json")
            .exists());
    }
}

#[test]
fn never_interprets_missing_or_conflicting_directories_as_success() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let entry = workspace.create_entry("Keep both").unwrap();
    let trash = workspace.layout().trashed_entry_dir(&entry.id);
    fs::create_dir_all(&trash).unwrap();
    atomic_write_json(
        dir.path().join(JOURNAL),
        &intent(entry.id.clone(), EntryLifecycleAction::Delete),
    )
    .unwrap();
    assert!(Workspace::open_existing(dir.path()).is_err());
    assert!(workspace.layout().entry_dir(&entry.id).exists());
    assert!(trash.exists());
    assert!(dir.path().join(JOURNAL).exists());
    let other = tempfile::tempdir().unwrap();
    let other_workspace = Workspace::create(other.path()).unwrap();
    atomic_write_json(
        other.path().join(JOURNAL),
        &intent(EntryId::new(), EntryLifecycleAction::Delete),
    )
    .unwrap();
    assert!(other_workspace.recover_entry_lifecycle().is_err());
    assert!(other_workspace
        .pending_entry_lifecycle_events()
        .unwrap()
        .is_empty());
}

#[test]
fn invalid_export_does_not_prevent_local_delete_but_records_sync_block() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    workspace.bind_sync(&binding()).unwrap();
    let entry = workspace.create_entry("Invalid parser cache").unwrap();
    fs::write(
        workspace
            .layout()
            .entry_dir(&entry.id)
            .join("paper.segments.json"),
        b"invalid",
    )
    .unwrap();
    workspace.delete_entry(&entry.id).unwrap();
    assert!(workspace.layout().trashed_entry_dir(&entry.id).exists());
    assert!(workspace.pending_entry_lifecycle_events().unwrap()[0]
        .snapshot_issue
        .is_some());
}
