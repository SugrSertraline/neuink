use super::*;
use neuink_domain::{ContentItem, EntryMeta};

fn binding() -> crate::sync_journal::WorkspaceSyncBinding {
    crate::sync_journal::WorkspaceSyncBinding {
        server_id: "a".repeat(64),
        account_id: "b".repeat(64),
        library_id: "c".repeat(64),
        epoch: "d".repeat(64),
    }
}

#[test]
fn bound_note_updates_publish_ordered_events_and_reject_wrong_account_ack() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    ws.bind_sync(&binding()).unwrap();
    let entry = ws.create_entry("paper").unwrap();
    let note = NoteId::new();
    ws.create_note_with_id(&entry.id, note.clone(), "original")
        .unwrap();
    let old = ws.read_note(&entry.id, &note).unwrap();
    ws.update_note_document_if_revision(
        &entry.id,
        &note,
        "changed",
        "new body",
        &[],
        Some(&old.revision),
    )
    .unwrap();
    let events = ws.pending_content_events().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!((events[0].sequence, events[1].sequence), (1, 2));
    assert_eq!(
        events[1].transaction["changes"].as_array().unwrap().len(),
        3
    );
    assert_eq!(ws.read_note(&entry.id, &note).unwrap().markdown, "new body");
    let mut other = binding();
    other.account_id = "e".repeat(64);
    assert!(ws
        .acknowledge_content_event(&other, &events[0].event_id)
        .is_err());
    assert!(ws.bind_sync(&other).is_err());
    ws.acknowledge_content_event(&binding(), &events[0].event_id)
        .unwrap();
    ws.acknowledge_content_event(&binding(), &events[0].event_id)
        .unwrap();
    assert_eq!(ws.pending_content_events().unwrap().len(), 1);
    assert!(ws
        .update_note_if_revision(&entry.id, &note, "stale", "lost", Some(&old.revision))
        .is_err());
    assert_eq!(ws.pending_content_events().unwrap().len(), 1);
}

#[test]
fn recovery_after_file_publication_recreates_missing_outbox_only_once() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    ws.bind_sync(&binding()).unwrap();
    let (entry, note, mut transaction) = prepared(&ws);
    transaction.sync_binding = Some(binding());
    transaction.sync_sequence = 1;
    atomic_write_json(dir.path().join(JOURNAL), &transaction).unwrap();
    for change in &transaction.changes {
        atomic_write(
            ws.content_target_path(&change.target).unwrap(),
            &change.after,
        )
        .unwrap();
    }
    // Simulate a crash after all content files but before publication of the outbox.
    let reopened = Workspace::open_existing(dir.path()).unwrap();
    let event = reopened.pending_content_events().unwrap().remove(0);
    assert_eq!(
        reopened.read_note(&entry.id, &note).unwrap().title,
        "Saved note"
    );
    // Also cover crash after the outbox is written but before the journal is removed.
    atomic_write_json(dir.path().join(JOURNAL), &transaction).unwrap();
    let reopened = Workspace::open_existing(dir.path()).unwrap();
    assert_eq!(
        reopened.pending_content_events().unwrap()[0].event_id,
        event.event_id
    );
    assert_eq!(reopened.pending_content_events().unwrap().len(), 1);
}

#[test]
fn unbound_workspace_has_no_upload_intent_and_tampered_event_is_retained() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    let entry = ws.create_entry("paper").unwrap();
    ws.create_note(&entry.id, "local only").unwrap();
    assert!(ws.pending_content_events().unwrap().is_empty());
    ws.bind_sync(&binding()).unwrap();
    ws.create_note(&entry.id, "bound").unwrap();
    let mut event = ws.pending_content_events().unwrap().remove(0);
    event.transaction["changes"][0]["after"] = serde_json::json!([0]);
    let path = dir
        .path()
        .join("sync-outbox")
        .join(format!("{}.json", event.event_id));
    atomic_write_json(&path, &event).unwrap();
    assert!(ws.pending_content_events().is_err());
    assert!(path.exists());
}

#[test]
fn failed_outbox_write_keeps_recovery_intent_and_full_note_is_recovered() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    let entry = ws.create_entry("paper").unwrap();
    let note = NoteId::new();
    ws.create_note_with_id(&entry.id, note.clone(), "original")
        .unwrap();
    let previous = ws.read_note(&entry.id, &note).unwrap();
    ws.bind_sync(&binding()).unwrap();
    fs::write(dir.path().join("sync-outbox"), b"blocked directory").unwrap();
    assert!(ws
        .update_note_document_if_revision(
            &entry.id,
            &note,
            "new title",
            "new body",
            &[],
            Some(&previous.revision)
        )
        .is_err());
    assert!(dir.path().join(JOURNAL).exists());
    assert!(Workspace::open_existing(dir.path()).is_err());
    fs::remove_file(dir.path().join("sync-outbox")).unwrap();
    let recovered = Workspace::open_existing(dir.path()).unwrap();
    let document = recovered.read_note(&entry.id, &note).unwrap();
    assert_eq!(document.title, "new title");
    assert_eq!(document.markdown, "new body");
    assert!(document.links.is_empty());
    assert_eq!(recovered.pending_content_events().unwrap().len(), 1);
    assert!(!dir.path().join(JOURNAL).exists());
}

fn prepared(ws: &Workspace) -> (EntryMeta, NoteId, Transaction) {
    let mut entry = ws.create_entry("Paper").unwrap();
    let note = NoteId::new();
    let body = ws
        .content_change(
            ContentTarget::NoteBody {
                entry_id: entry.id.clone(),
                note_id: note.clone(),
            },
            b"# Saved note\n".to_vec(),
        )
        .unwrap();
    entry.contents.push(ContentItem::Note {
        note_id: note.clone(),
        title: "Saved note".into(),
    });
    let metadata = ws
        .content_change(
            ContentTarget::EntryMeta {
                entry_id: entry.id.clone(),
            },
            serde_json::to_vec_pretty(&entry).unwrap(),
        )
        .unwrap();
    (
        entry,
        note,
        Transaction {
            version: 1,
            changes: vec![body, metadata],
            sync_binding: None,
            sync_sequence: 0,
        },
    )
}

#[test]
fn reopening_completes_creation_after_body_only_was_written() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    let (entry, note, transaction) = prepared(&ws);
    atomic_write_json(dir.path().join(JOURNAL), &transaction).unwrap();
    let body = ws.layout().entry_note_file(&entry.id, &note);
    atomic_write(&body, &transaction.changes[0].after).unwrap();
    drop(ws);
    let ws = Workspace::open_existing(dir.path()).unwrap();
    assert_eq!(ws.read_entry(&entry.id).unwrap().contents, entry.contents);
    assert_eq!(
        ws.read_note(&entry.id, &note).unwrap().markdown,
        "# Saved note\n"
    );
    assert!(!dir.path().join(JOURNAL).exists());
    drop(ws);
    assert_eq!(
        Workspace::open_existing(dir.path())
            .unwrap()
            .read_entry(&entry.id)
            .unwrap()
            .contents
            .len(),
        1
    );
}

#[test]
fn external_edit_is_preserved_and_no_other_target_is_written() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    let (entry, note, transaction) = prepared(&ws);
    atomic_write_json(dir.path().join(JOURNAL), &transaction).unwrap();
    let mut external = ws.read_entry(&entry.id).unwrap();
    external.title = "External update".into();
    atomic_write_json(ws.layout().entry_meta_file(&entry.id), &external).unwrap();
    assert!(Workspace::open_existing(dir.path()).is_err());
    assert!(!ws.layout().entry_note_file(&entry.id, &note).exists());
    assert_eq!(ws.read_entry(&entry.id).unwrap().title, "External update");
    assert!(dir.path().join(JOURNAL).is_file());
}

#[test]
fn recovery_after_all_files_written_only_finishes_journal() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    let (entry, _, transaction) = prepared(&ws);
    atomic_write_json(dir.path().join(JOURNAL), &transaction).unwrap();
    for change in &transaction.changes {
        atomic_write(
            ws.content_target_path(&change.target).unwrap(),
            &change.after,
        )
        .unwrap();
    }
    let before = fs::read(ws.layout().entry_meta_file(&entry.id)).unwrap();
    ws.recover_content_transaction().unwrap();
    assert_eq!(
        before,
        fs::read(ws.layout().entry_meta_file(&entry.id)).unwrap()
    );
    assert!(!dir.path().join(JOURNAL).exists());
}

#[test]
fn rejects_path_traversal_and_duplicate_targets_before_publication() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    assert!(ws
        .content_change(
            ContentTarget::EntryMeta {
                entry_id: EntryId::from_string("../escape")
            },
            vec![]
        )
        .is_err());
    let (entry, note, mut transaction) = prepared(&ws);
    let duplicate = ws
        .content_change(
            ContentTarget::EntryMeta {
                entry_id: entry.id.clone(),
            },
            vec![],
        )
        .unwrap();
    transaction.changes.push(duplicate);
    assert!(ws.commit_content_transaction(transaction.changes).is_err());
    assert!(!ws.layout().entry_note_file(&entry.id, &note).exists());
    assert!(!dir.path().join(JOURNAL).exists());
}

#[test]
fn normal_creation_publishes_both_files_without_leftover_journal() {
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    let entry = ws.create_entry("Paper").unwrap();
    let note = NoteId::new();
    let saved = ws
        .create_note_with_id(&entry.id, note.clone(), "New note")
        .unwrap();
    assert_eq!(saved.contents.len(), 1);
    assert_eq!(ws.read_note(&entry.id, &note).unwrap().title, "New note");
    assert!(!dir.path().join(JOURNAL).exists());
}

#[test]
fn ideation_recovery_replays_save_and_sync_event_once() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    workspace.bind_sync(&binding()).unwrap();
    let state = workspace.read_ideation().unwrap().state;
    let change = workspace
        .content_change(
            ContentTarget::IdeationState,
            serde_json::to_vec(&state).unwrap(),
        )
        .unwrap();
    let transaction = Transaction {
        version: 1,
        changes: vec![change],
        sync_binding: Some(binding()),
        sync_sequence: 1,
    };
    atomic_write_json(dir.path().join(JOURNAL), &transaction).unwrap();
    // Simulate interruption after the content file was published but before outbox publication.
    atomic_write(
        workspace
            .content_target_path(&ContentTarget::IdeationState)
            .unwrap(),
        &transaction.changes[0].after,
    )
    .unwrap();
    let reopened = Workspace::open_existing(dir.path()).unwrap();
    assert_ne!(reopened.read_ideation().unwrap().revision, "missing");
    let events = reopened.pending_content_events().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].affected_entities().unwrap(),
        BTreeSet::from(["board:ideation".into()])
    );
    reopened.recover_content_transaction().unwrap();
    assert_eq!(reopened.pending_content_events().unwrap().len(), 1);
}
