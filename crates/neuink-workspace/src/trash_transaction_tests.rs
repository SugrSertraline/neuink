use super::*;
use crate::trash::StoredTrashPayload;
use neuink_domain::ContentItem;
fn fixture() -> (
    tempfile::TempDir,
    Workspace,
    neuink_domain::EntryMeta,
    neuink_domain::NoteId,
    Journal,
) {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let entry = workspace.create_entry("Recovery").unwrap();
    let mut entry = workspace.create_note(&entry.id, "Note").unwrap();
    let ContentItem::Note { note_id, .. } = entry.contents[0].clone();
    workspace
        .update_note(&entry.id, &note_id, "Note", "Saved before delete")
        .unwrap();
    entry = workspace.read_entry(&entry.id).unwrap();
    let records = vec![StoredTrashRecord {
        trash_id: format!("markdown_note:{note_id}"),
        deleted_at: chrono::Utc::now(),
        payload: StoredTrashPayload::MarkdownNote {
            note_id: note_id.clone(),
            title: "Note".into(),
            original_index: 0,
        },
    }];
    let event = ChildEvent {
        version: 1,
        sequence: 1,
        event_id: EntryId::new().to_string(),
        entry_id: entry.id.clone(),
        entity_id: format!("note:{note_id}"),
        restored: false,
        binding: None,
        documents: vec![],
        issue: None,
    };
    let mut deleted = entry.clone();
    deleted.contents.clear();
    let writes = [
        (
            workspace.layout().entry_trash_index_file(&entry.id),
            records_bytes(&records).unwrap(),
        ),
        (
            workspace.layout().entry_meta_file(&entry.id),
            serde_json::to_vec_pretty(&deleted).unwrap(),
        ),
    ]
    .into_iter()
    .map(|(path, after)| Write {
        path: workspace.child_relative(&path).unwrap(),
        before: current(&path).unwrap(),
        after,
    })
    .collect();
    let source = workspace.layout().entry_note_file(&entry.id, &note_id);
    let target = workspace
        .layout()
        .entry_trash_notes_dir(&entry.id)
        .join(format!("{note_id}.md"));
    let moves = vec![Move {
        source: workspace.child_relative(&source).unwrap(),
        target: workspace.child_relative(&target).unwrap(),
        files: inventory(&source).unwrap(),
    }];
    (
        dir,
        workspace,
        entry,
        note_id,
        Journal {
            event,
            writes,
            moves,
        },
    )
}
#[test]
fn reopens_after_each_move_and_file_boundary_without_losing_note() {
    for boundary in 0usize..4 {
        let (dir, workspace, entry, note_id, journal) = fixture();
        atomic_write_json(dir.path().join(JOURNAL), &journal).unwrap();
        if boundary >= 1 {
            let movement = &journal.moves[0];
            let target = workspace.child_path(&movement.target).unwrap();
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::rename(workspace.child_path(&movement.source).unwrap(), target).unwrap();
        }
        for write in journal.writes.iter().take(boundary.saturating_sub(1)) {
            crate::atomic_write(workspace.child_path(&write.path).unwrap(), &write.after).unwrap();
        }
        let workspace = Workspace::open_existing(dir.path()).unwrap();
        assert!(workspace.read_entry(&entry.id).unwrap().contents.is_empty());
        assert_eq!(
            workspace.list_entry_trash_items(&entry.id).unwrap().len(),
            1
        );
        assert!(!dir.path().join(JOURNAL).exists());
        workspace
            .restore_trash_item(&entry.id, &format!("markdown_note:{note_id}"))
            .unwrap();
        assert_eq!(
            workspace.read_note(&entry.id, &note_id).unwrap().markdown,
            "Saved before delete"
        );
    }
}
#[test]
fn external_edit_or_existing_destination_preserves_both_and_the_journal() {
    for conflict_in_destination in [false, true] {
        let (dir, workspace, entry, note_id, journal) = fixture();
        atomic_write_json(dir.path().join(JOURNAL), &journal).unwrap();
        if conflict_in_destination {
            let target = workspace.child_path(&journal.moves[0].target).unwrap();
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(target, b"Existing different note").unwrap();
        } else {
            fs::write(
                workspace.layout().entry_note_file(&entry.id, &note_id),
                b"External new edit",
            )
            .unwrap();
        }
        assert!(Workspace::open_existing(dir.path()).is_err());
        assert!(workspace
            .layout()
            .entry_note_file(&entry.id, &note_id)
            .exists());
        assert!(dir.path().join(JOURNAL).exists());
        assert_eq!(workspace.read_entry(&entry.id).unwrap().contents.len(), 1);
    }
}
#[test]
fn bound_child_deletion_retains_last_saved_snapshot_and_explicit_restore_event() {
    let (dir, workspace, entry, note_id, _) = fixture();
    let binding = WorkspaceSyncBinding {
        server_id: "1".repeat(64),
        account_id: "2".repeat(64),
        library_id: "3".repeat(64),
        epoch: "4".repeat(64),
    };
    workspace.bind_sync(&binding).unwrap();
    workspace.delete_note(&entry.id, &note_id).unwrap();
    let path = fs::read_dir(dir.path().join("sync-child-lifecycle"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let event: ChildEvent = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert!(!event.restored);
    assert!(event.issue.is_none());
    assert_eq!(event.documents.len(), 2);
    let resource = event
        .documents
        .iter()
        .find(|d| d.entity_id == event.entity_id)
        .unwrap()
        .resources
        .iter()
        .find(|r| r.name == "note.json")
        .unwrap();
    let body: serde_json::Value =
        serde_json::from_slice(&workspace.read_sync_resource(&binding, resource).unwrap()).unwrap();
    assert_eq!(body["markdown"], "Saved before delete");
    workspace
        .restore_trash_item(&entry.id, &format!("markdown_note:{note_id}"))
        .unwrap();
    assert_eq!(
        fs::read_dir(dir.path().join("sync-child-lifecycle"))
            .unwrap()
            .count(),
        2
    );
}

#[test]
fn incoming_restore_preserves_externally_edited_trash() {
    let (_dir, workspace, entry, note_id, _) = fixture();
    let binding = WorkspaceSyncBinding {
        server_id: "1".repeat(64),
        account_id: "2".repeat(64),
        library_id: "3".repeat(64),
        epoch: "4".repeat(64),
    };
    workspace.bind_sync(&binding).unwrap();
    workspace.delete_note(&entry.id, &note_id).unwrap();
    let restored = std::collections::BTreeSet::from([format!("note:{note_id}")]);
    assert!(workspace
        .sync_child_trash_files(&entry.id, &[], &restored)
        .is_ok());
    let archived = workspace
        .layout()
        .entry_trash_notes_dir(&entry.id)
        .join(format!("{note_id}.md"));
    fs::write(&archived, "External recovered thoughts").unwrap();
    assert!(workspace
        .sync_child_trash_files(&entry.id, &[], &restored)
        .is_err());
    assert_eq!(
        fs::read_to_string(&archived).unwrap(),
        "External recovered thoughts"
    );
    assert_eq!(
        workspace.list_entry_trash_items(&entry.id).unwrap().len(),
        1
    );
}
