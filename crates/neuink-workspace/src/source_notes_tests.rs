use super::*;
use neuink_zotero::{Library, ZoteroNote};

fn fixture() -> (tempfile::TempDir, Workspace, Library, EntryId) {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path().join("library")).unwrap();
    let paper = Paper {
        id: "1:PAPER001".into(),
        key: "PAPER001".into(),
        library_id: 1,
        library_name: "Library".into(),
        title: "Source paper".into(),
        authors: "".into(),
        year: "".into(),
        fields: Default::default(),
        tags: vec![],
        collection_ids: vec![],
        attachments: vec![],
        notes: vec![ZoteroNote {
            key: "NOTE0001".into(),
            html: "<p>Original source note</p>".into(),
        }],
    };
    let library = Library {
        source_id: "source".into(),
        data_directory: dir.path().into(),
        papers: vec![paper],
        collections: vec![],
    };
    let local = workspace.create_entry("My independent paper").unwrap();
    (dir, workspace, library, local.id)
}
fn selection(candidate: &SourceNoteCandidate) -> SourceNoteSelection {
    SourceNoteSelection {
        key: candidate.key.clone(),
        content_hash: candidate.content_hash.clone(),
    }
}

#[test]
fn catalog_keeps_a_source_row_for_an_existing_pdf_and_explicit_copies_remain_independent() {
    let (dir, ws, mut library, local) = fixture();
    let pdf = dir.path().join("source.pdf");
    fs::write(&pdf, b"%PDF-1.7\nsame PDF bytes").unwrap();
    ws.import_pdf(&local, &pdf).unwrap();
    let metadata = fs::metadata(&pdf).unwrap();
    library.papers[0]
        .attachments
        .push(neuink_zotero::Attachment {
            key: "ATTACH01".into(),
            file_name: "Renamed source.pdf".into(),
            available: true,
            reason: None,
            path: Some(pdf.clone()),
            file_size: metadata.len(),
            modified: metadata.modified().ok(),
        });
    let indexed = ws
        .index_zotero_paper(&library, &library.papers[0], Some("ATTACH01"))
        .unwrap();
    assert!(!indexed.has_pdf);
    assert_ne!(indexed.entry_id, local);
    assert!(!ws.layout().entry_pdf_file(&indexed.entry_id).exists());
    assert_eq!(
        ws.entry_source_kinds().unwrap()[indexed.entry_id.as_str()].local_copy_ids,
        [local.to_string()]
    );
    let result = ws.copy_source_to_local(&indexed.entry_id, false).unwrap();
    assert!(!result.created);
    assert_eq!(result.entry_id, local);
    let result = ws
        .import_current_zotero_copy(&indexed.entry_id, &library, &library.papers[0], false)
        .unwrap();
    assert!(!result.created);
    assert_eq!(result.entry_id, local);
    let forced = ws
        .import_current_zotero_copy(&indexed.entry_id, &library, &library.papers[0], true)
        .unwrap();
    assert!(forced.created);
    assert_ne!(forced.entry_id, local);
    assert_eq!(
        fs::read(ws.layout().entry_pdf_file(&forced.entry_id)).unwrap(),
        fs::read(&pdf).unwrap()
    );
    assert!(ws.zotero_sources(&forced.entry_id).unwrap().is_empty());
    assert_eq!(
        ws.local_copy_origin(&forced.entry_id, false)
            .unwrap()
            .unwrap()
            .source_entry_id,
        indexed.entry_id
    );
    // A later source replacement never changes either independent local copy.
    fs::write(&pdf, b"%PDF-1.7\nnew source version").unwrap();
    let metadata = fs::metadata(&pdf).unwrap();
    library.papers[0].attachments[0].file_size = metadata.len();
    library.papers[0].attachments[0].modified = metadata.modified().ok();
    assert!(
        !ws.import_current_zotero_copy(&indexed.entry_id, &library, &library.papers[0], false)
            .unwrap()
            .created
    );
    let new_copy = ws
        .import_current_zotero_copy(&indexed.entry_id, &library, &library.papers[0], true)
        .unwrap();
    assert_eq!(
        fs::read(ws.layout().entry_pdf_file(&new_copy.entry_id)).unwrap(),
        fs::read(&pdf).unwrap()
    );
    assert_ne!(
        fs::read(ws.layout().entry_pdf_file(&local)).unwrap(),
        fs::read(&pdf).unwrap()
    );
    assert_ne!(
        fs::read(ws.layout().entry_pdf_file(&forced.entry_id)).unwrap(),
        fs::read(&pdf).unwrap()
    );
}

#[test]
fn imports_idempotent_snapshots_and_appends_new_versions_without_overwriting_local_edits() {
    let (_dir, ws, mut library, local) = fixture();
    let before = ws.read_entry(&local).unwrap();
    let candidates = ws
        .source_note_candidates("source", &library.papers[0], &local)
        .unwrap();
    assert!(!candidates[0].imported);
    let selected = [selection(&candidates[0])];
    assert_eq!(
        ws.import_source_notes("source", &library.papers[0], &local, &selected)
            .unwrap()
            .imported,
        1
    );
    let entry = ws.read_entry(&local).unwrap();
    let ContentItem::Note { note_id, .. } = &entry.contents[0];
    ws.update_note(&local, note_id, "My title", "My local edits")
        .unwrap();
    let repeated = ws
        .import_source_notes("source", &library.papers[0], &local, &selected)
        .unwrap();
    assert_eq!((repeated.imported, repeated.skipped), (0, 1));
    assert_eq!(
        ws.read_note(&local, note_id).unwrap().markdown,
        "My local edits"
    );
    library.papers[0].notes[0].html = "<p>New source version</p>".into();
    let candidates = ws
        .source_note_candidates("source", &library.papers[0], &local)
        .unwrap();
    assert!(!candidates[0].imported);
    assert_eq!(
        ws.import_source_notes(
            "source",
            &library.papers[0],
            &local,
            &[selection(&candidates[0])]
        )
        .unwrap()
        .imported,
        1
    );
    let after = ws.read_entry(&local).unwrap();
    assert_eq!(after.contents.len(), 2);
    assert_eq!(after.title, before.title);
    assert_eq!(
        ws.read_note(&local, note_id).unwrap().markdown,
        "My local edits"
    );
    assert!(ws.zotero_sources(&local).unwrap().is_empty());
    assert!(ws.entry_source_kinds().unwrap()[local.as_str()]
        .kinds
        .is_empty());
    let records = ws.imported_source_notes(&local).unwrap();
    assert_eq!(records.len(), 2);
    assert_eq!(records[1].original_html, "<p>New source version</p>");
}

#[test]
fn stale_previews_are_rejected_and_initial_independent_copies_already_record_their_notes() {
    let (_dir, ws, mut library, local) = fixture();
    let candidates = ws
        .source_note_candidates("source", &library.papers[0], &local)
        .unwrap();
    library.papers[0].notes[0].html = "<p>Changed before confirm</p>".into();
    assert!(ws
        .import_source_notes(
            "source",
            &library.papers[0],
            &local,
            &[selection(&candidates[0])]
        )
        .is_err());
    assert!(ws.read_entry(&local).unwrap().contents.is_empty());
    let source = ws
        .import_zotero_paper(&library, &library.papers[0], None)
        .unwrap()
        .entry_id;
    assert!(ws
        .import_source_notes("source", &library.papers[0], &source, &[])
        .is_err());
    let copy = ws.copy_source_to_local(&source, false).unwrap().entry_id;
    let candidates = ws
        .source_note_candidates("source", &library.papers[0], &copy)
        .unwrap();
    assert!(candidates[0].imported);
}

#[test]
fn reopening_finishes_an_interrupted_import_without_duplicate_notes_and_preserves_external_conflicts(
) {
    for conflict in [false, true] {
        let (_dir, ws, _library, local) = fixture();
        let before = ws.read_entry(&local).unwrap();
        let mut after = before.clone();
        let note = NoteId::new();
        after.contents.push(ContentItem::Note {
            note_id: note.clone(),
            title: "Recovered note".into(),
        });
        let journal = NoteImportJournal {
            version: 1,
            entry_id: local.clone(),
            before_meta: hash(&fs::read(ws.layout().entry_meta_file(&local)).unwrap()),
            before_records: None,
            after_meta: after,
            after_records: vec![],
            notes: vec![PendingNote {
                id: note.clone(),
                document: "---\nkind: note\n---\n\nRecovered".into(),
            }],
        };
        atomic_write_json(ws.layout().root().join(JOURNAL), &journal).unwrap();
        // Simulate a crash after writing one note, before updating the metadata.
        atomic_write(
            ws.layout().entry_note_file(&local, &note),
            journal.notes[0].document.as_bytes(),
        )
        .unwrap();
        if conflict {
            let mut external = before;
            external.title = "External change".into();
            atomic_write_json(ws.layout().entry_meta_file(&local), &external).unwrap();
            assert!(Workspace::open_existing(ws.layout().root()).is_err());
            assert_eq!(ws.read_entry(&local).unwrap().title, "External change");
            assert!(ws.layout().root().join(JOURNAL).exists());
        } else {
            let reopened = Workspace::open_existing(ws.layout().root()).unwrap();
            assert_eq!(reopened.read_entry(&local).unwrap().contents.len(), 1);
            assert!(!ws.layout().root().join(JOURNAL).exists());
            assert_eq!(
                Workspace::open_existing(ws.layout().root())
                    .unwrap()
                    .read_entry(&local)
                    .unwrap()
                    .contents
                    .len(),
                1
            );
        }
    }
}
