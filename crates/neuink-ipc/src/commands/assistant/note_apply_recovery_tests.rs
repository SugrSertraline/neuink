use super::{
    note_apply::{recover_journal, ApplyNoteProposalResponse},
    note_apply_store::{write_json, ApplyJournal, ApplyReceipt},
};
use neuink_domain::{EntryId, NoteId, SegmentUid};
use neuink_workspace::Workspace;
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

struct Fixture {
    root: PathBuf,
    ws: Workspace,
    entry: EntryId,
    note: NoteId,
}
impl Fixture {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "neuink_recovery_{}_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let ws = Workspace::create(&root).unwrap();
        let entry = ws.create_entry("Paper").unwrap().id;
        let note = NoteId::new();
        ws.create_note_with_id(&entry, note.clone(), "Note")
            .unwrap();
        ws.update_note(&entry, &note, "Manual title", "new manual text")
            .unwrap();
        Self {
            root,
            ws,
            entry,
            note,
        }
    }
    fn paths(&self) -> (PathBuf, PathBuf) {
        (
            self.root.join("journal.json"),
            self.root.join("receipt.json"),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn uncertain_update_and_create_never_restore_or_delete_newer_manual_edits() {
    let f = Fixture::new();
    let (journal, receipt) = f.paths();
    let before = f.ws.read_note(&f.entry, &f.note).unwrap();
    for pending in [
        ApplyJournal::MarkdownUpdate {
            entry_id: f.entry.to_string(),
            note_id: f.note.to_string(),
            title: "Old".into(),
            markdown: "old".into(),
            links: vec![],
        },
        ApplyJournal::MarkdownCreate {
            entry_id: f.entry.to_string(),
            created_note_id: Some(f.note.to_string()),
        },
        ApplyJournal::MarkdownCreate {
            entry_id: f.entry.to_string(),
            created_note_id: None,
        },
    ] {
        write_json(&journal, &pending).unwrap();
        for _ in 0..2 {
            assert!(recover_journal(&journal, &receipt)
                .unwrap_err()
                .contains("未回滚或删除"));
            assert!(journal.exists());
            assert!(!receipt.exists());
            assert_eq!(
                f.ws.read_note(&f.entry, &f.note).unwrap().revision,
                before.revision
            );
            assert_eq!(f.ws.read_entry(&f.entry).unwrap().contents.len(), 1);
        }
    }
}

#[test]
fn uncertain_segment_update_never_overwrites_manual_text() {
    let f = Fixture::new();
    let segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        0,
        None,
        "Source".into(),
    );
    let uid: SegmentUid = segment.uid.clone();
    f.ws.write_segments(&f.entry, &[segment]).unwrap();
    f.ws.upsert_segment_note(&f.entry, uid.clone(), "manual text".into())
        .unwrap();
    let (journal, receipt) = f.paths();
    write_json(
        &journal,
        &ApplyJournal::SegmentUpdate {
            entry_id: f.entry.to_string(),
            segment_uid: uid.to_string(),
            text: "old".into(),
        },
    )
    .unwrap();
    assert!(recover_journal(&journal, &receipt).is_err());
    assert_eq!(
        f.ws.read_segment_notes(&f.entry).unwrap()[0].text,
        "manual text"
    );
}

#[test]
fn completed_write_recovers_receipt_even_after_later_manual_edits() {
    let f = Fixture::new();
    let (journal, receipt) = f.paths();
    let before = f.ws.read_note(&f.entry, &f.note).unwrap().revision;
    write_json(
        &journal,
        &ApplyJournal::Completed {
            receipt: ApplyReceipt {
                action: "append".into(),
                content_hash: "previous committed hash".into(),
                entry_id: f.entry.to_string(),
                note_id: Some(f.note.to_string()),
                proposal_id: "p".into(),
                segment_uid: None,
                task_id: "t".into(),
            },
        },
    )
    .unwrap();
    // An unavailable receipt destination must not erase the only completed checkpoint.
    fs::create_dir(&receipt).unwrap();
    assert!(recover_journal(&journal, &receipt).is_err());
    assert!(journal.exists());
    fs::remove_dir(&receipt).unwrap();
    assert!(matches!(
        recover_journal(&journal, &receipt).unwrap(),
        ApplyNoteProposalResponse::Applied { .. }
    ));
    assert!(!journal.exists());
    assert!(receipt.is_file());
    assert_eq!(f.ws.read_note(&f.entry, &f.note).unwrap().revision, before);
}
