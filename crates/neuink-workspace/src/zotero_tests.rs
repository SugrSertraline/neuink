use super::*;
use neuink_zotero::Attachment;

fn fixture() -> (tempfile::TempDir, Workspace, Library) {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path().join("workspace")).unwrap();
    let source = dir.path().join("source.pdf");
    fs::write(&source, b"%PDF-1.7\nZotero import test").unwrap();
    let metadata = fs::metadata(&source).unwrap();
    let paper = Paper {
        id: "1:TEST0001".into(),
        key: "TEST0001".into(),
        library_id: 1,
        library_name: "我的文库".into(),
        title: "Imported title".into(),
        authors: "Ada".into(),
        year: "2024".into(),
        fields: [("doi".into(), "10.1/test".into())].into(),
        tags: vec!["literal/slash".into()],
        collection_ids: vec![],
        attachments: vec![Attachment {
            key: "PDF00001".into(),
            file_name: "论文.pdf".into(),
            available: true,
            reason: None,
            path: Some(source),
            file_size: metadata.len(),
            modified: metadata.modified().ok(),
        }],
        notes: vec![],
    };
    let library = Library {
        source_id: "source".into(),
        data_directory: dir.path().into(),
        collections: vec![],
        papers: vec![paper],
    };
    (dir, workspace, library)
}

#[test]
fn hidden_papers_are_scoped_to_source_and_reversible() {
    let (_dir, ws, _library) = fixture();
    ws.set_zotero_paper_hidden("source", "1:TEST0001", true).unwrap();
    ws.set_zotero_paper_hidden("source", "1:TEST0001", true).unwrap();
    let reopened = Workspace::open_existing(ws.layout().root()).unwrap();
    assert_eq!(reopened.hidden_zotero_papers("source").unwrap(), ["1:TEST0001"]);
    assert!(ws.hidden_zotero_papers("other").unwrap().is_empty());
    ws.set_zotero_paper_hidden("source", "1:TEST0001", false).unwrap();
    assert!(ws.hidden_zotero_papers("source").unwrap().is_empty());
}

#[test]
fn imports_child_notes_as_editable_copies_and_keeps_original_html() {
    let (_dir, ws, mut library) = fixture();
    library.papers[0].notes.push(neuink_zotero::ZoteroNote {
        key: "NOTE0001".into(), html: "<p>Important &amp; useful</p>".into(),
    });
    let result = ws.import_zotero_paper(&library, &library.papers[0], None).unwrap();
    let entry = ws.read_entry(&result.entry_id).unwrap();
    let note_id = entry.contents.iter().map(|content| match content {
        neuink_domain::ContentItem::Note { note_id, .. } => note_id.clone(),
    }).next().unwrap();
    assert!(ws.read_note(&entry.id, &note_id).unwrap().markdown.contains("Important & useful"));
    let raw = fs::read_to_string(ws.layout().entry_dir(&entry.id).join("zotero-notes.json")).unwrap();
    assert!(raw.contains("&amp;"));
    let backup = ws.backup_zotero_note_original(&entry.id, &note_id, "server-1", 5, "<p>Before write</p>").unwrap();
    assert!(backup.starts_with(ws.layout().entry_dir(&entry.id)));
    assert_eq!(fs::read_to_string(backup).unwrap(), "<p>Before write</p>");
}

#[test]
fn local_note_edits_survive_reopen_without_becoming_source_updates() {
    let (_dir, ws, mut library) = fixture();
    library.papers[0].notes.push(neuink_zotero::ZoteroNote { key: "NOTE0001".into(), html: "<p>Original</p>".into() });
    let result = ws.import_zotero_paper(&library, &library.papers[0], None).unwrap();
    let note = ws.zotero_sources(&result.entry_id).unwrap()[0].note_ids["NOTE0001"].clone();
    assert!(!ws.zotero_note_status(&result.entry_id, &note).unwrap().unwrap().local_modified);
    ws.update_note(&result.entry_id, &note, "My local title", "Original plus my edits").unwrap();
    let reopened = Workspace::open_existing(ws.layout().root()).unwrap();
    assert!(reopened.zotero_note_status(&result.entry_id, &note).unwrap().unwrap().local_modified);
    assert_eq!(reopened.zotero_note_status(&result.entry_id, &note).unwrap().unwrap().source_html.as_deref(), Some("<p>Original</p>"));
    assert!(reopened.zotero_changed_papers(&library).unwrap().is_empty());
    fs::remove_file(ws.layout().entry_dir(&result.entry_id).join("zotero-note-sync.json")).unwrap();
    assert!(reopened.zotero_note_status(&result.entry_id, &note).unwrap().unwrap().local_modified);
    assert_eq!(reopened.zotero_note_status(&result.entry_id, &note).unwrap().unwrap().source_html.as_deref(), Some("<p>Original</p>"));
    library.papers[0].notes[0].html = "<p>Changed in Zotero</p>".into();
    assert_eq!(reopened.zotero_changed_papers(&library).unwrap(), ["1:TEST0001"]);
    assert_eq!(reopened.read_note(&result.entry_id, &note).unwrap().markdown, "Original plus my edits");
}

#[test]
fn confirmed_note_write_is_known_but_later_zotero_changes_are_reported() {
    let (_dir, ws, mut library) = fixture();
    library.papers[0].notes.push(neuink_zotero::ZoteroNote { key: "NOTE0001".into(), html: "<p>Original</p>".into() });
    let result = ws.import_zotero_paper(&library, &library.papers[0], None).unwrap();
    let note = ws.zotero_sources(&result.entry_id).unwrap()[0].note_ids["NOTE0001"].clone();
    ws.update_note(&result.entry_id, &note, "My note", "Edited").unwrap();
    let original_fingerprint = ws.zotero_paper_fingerprints(&library).unwrap();
    ws.record_zotero_note_write(&result.entry_id, &note, "<p>Edited</p>").unwrap();
    library.papers[0].notes[0].html = "<p>Edited</p>".into();
    let reopened = Workspace::open_existing(ws.layout().root()).unwrap();
    assert!(!reopened.zotero_note_status(&result.entry_id, &note).unwrap().unwrap().local_modified);
    assert_eq!(reopened.zotero_note_status(&result.entry_id, &note).unwrap().unwrap().source_html.as_deref(), Some("<p>Edited</p>"));
    assert!(reopened.zotero_changed_papers(&library).unwrap().is_empty());
    assert_eq!(reopened.zotero_paper_fingerprints(&library).unwrap(), original_fingerprint);
    library.papers[0].notes[0].html = "<p>Edited again in Zotero</p>".into();
    assert_eq!(reopened.zotero_changed_papers(&library).unwrap(), ["1:TEST0001"]);
}

#[test]
fn reports_source_changes_without_overwriting_local_entry() {
    let (_dir, ws, mut library) = fixture();
    let result = ws.import_zotero_paper(&library, &library.papers[0], None).unwrap();
    assert!(ws.zotero_changed_papers(&library).unwrap().is_empty());
    library.papers[0].title = "Revised at source".into();
    assert_eq!(ws.zotero_changed_papers(&library).unwrap(), ["1:TEST0001"]);
    assert_eq!(ws.read_entry(&result.entry_id).unwrap().title, "Imported title");
}

#[test]
fn source_organization_refresh_is_read_only_and_persists_without_touching_local_tags() {
    let (_dir, ws, mut library) = fixture();
    let result = ws.import_zotero_paper(&library, &library.papers[0], None).unwrap();
    ws.apply_entry_tag_paths(&result.entry_id, vec!["我的分类/待精读".into()]).unwrap();
    let local_before = ws.read_entry(&result.entry_id).unwrap();
    let baseline = ws.zotero_sources(&result.entry_id).unwrap()[0].source_fingerprint.clone();
    library.collections.push(neuink_zotero::Collection { id: "collection-1".into(), name: "来源分类".into(), path: "研究 / 来源分类".into(), parent_id: None });
    library.papers[0].collection_ids.push("collection-1".into());
    library.papers[0].tags = vec!["我的分类/待精读".into(), "来源新标签".into()];
    assert!(ws.refresh_zotero_organization(&library).unwrap());
    assert!(!ws.refresh_zotero_organization(&library).unwrap());
    let reopened = Workspace::open_existing(ws.layout().root()).unwrap();
    let info = reopened.entry_source_kinds().unwrap().remove(result.entry_id.as_str()).unwrap();
    assert_eq!(info.zotero_organization[0].tags, library.papers[0].tags);
    assert_eq!(info.zotero_organization[0].collections, ["研究 / 来源分类"]);
    assert_eq!(reopened.read_entry(&result.entry_id).unwrap().tags, local_before.tags);
    assert_eq!(reopened.zotero_sources(&result.entry_id).unwrap()[0].source_fingerprint, baseline);
    assert_eq!(ws.list_tags().unwrap().len(), 2);
}

#[test]
fn legacy_source_records_gain_read_only_tags_on_scan_without_removing_old_local_tags() {
    let (_dir, ws, library) = fixture();
    let result = ws.import_zotero_paper(&library, &library.papers[0], None).unwrap();
    ws.apply_entry_tag_paths(&result.entry_id, vec!["旧本地标签".into()]).unwrap();
    let path = ws.layout().entry_dir(&result.entry_id).join(SOURCE_FILE);
    let mut legacy: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    legacy[0].as_object_mut().unwrap().remove("tags");
    fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    assert!(ws.refresh_zotero_organization(&library).unwrap());
    assert_eq!(ws.zotero_sources(&result.entry_id).unwrap()[0].tags, ["literal/slash"]);
    assert_eq!(ws.read_entry(&result.entry_id).unwrap().tags.len(), 1);
}

#[test]
fn hides_imported_zotero_entry_without_deleting_local_copy() {
    let (_dir, ws, library) = fixture();
    let result = ws.import_zotero_paper(&library, &library.papers[0], None).unwrap();
    ws.set_imported_zotero_entry_hidden(&result.entry_id, true).unwrap();
    let sources = ws.entry_source_kinds().unwrap();
    assert!(sources[result.entry_id.as_str()].zotero_hidden);
    assert!(ws.read_entry(&result.entry_id).is_ok());
    ws.set_imported_zotero_entry_hidden(&result.entry_id, false).unwrap();
    assert!(!ws.entry_source_kinds().unwrap()[result.entry_id.as_str()].zotero_hidden);
}

#[test]
fn imports_complete_entry_and_repeated_import_preserves_user_edits() {
    let (_dir, ws, library) = fixture();
    let first = ws
        .import_zotero_paper(&library, &library.papers[0], Some("PDF00001"))
        .unwrap();
    assert_eq!(first.status, "imported");
    let entry = ws.read_entry(&first.entry_id).unwrap();
    assert_eq!(entry.pdf.as_ref().unwrap().file_name, "论文.pdf");
    assert_eq!(entry.fields["doi"], "10.1/test");
    assert!(ws.list_tags().unwrap().is_empty());
    assert!(entry.tags.is_empty());
    assert_eq!(ws.zotero_sources(&entry.id).unwrap()[0].tags, ["literal/slash"]);
    ws.update_entry_meta(&entry.id, "My edited title", entry.fields, entry.tags)
        .unwrap();
    let second = ws
        .import_zotero_paper(&library, &library.papers[0], Some("PDF00001"))
        .unwrap();
    assert_eq!(second.status, "skipped");
    assert_eq!(second.title, "My edited title");
    assert_eq!(ws.list_entries().unwrap().len(), 1);
    assert_eq!(
        ws.zotero_matches("source").unwrap()["1:TEST0001"],
        first.entry_id
    );
}

#[test]
fn identical_existing_pdf_requires_confirmation_before_new_entry() {
    let (_dir, ws, library) = fixture();
    let entry = ws.create_entry("Existing paper").unwrap();
    ws.import_pdf(
        &entry.id,
        library.papers[0].attachments[0].path.clone().unwrap(),
    )
    .unwrap();
    let imported = ws
        .import_zotero_paper(&library, &library.papers[0], Some("PDF00001"))
        .unwrap();
    assert_eq!(imported.entry_id, entry.id);
    assert_eq!(imported.status, "duplicate");
    assert!(imported.duplicate.is_some());
    assert_eq!(ws.list_entries().unwrap().len(), 1);
    assert!(!ws
        .zotero_matches("source")
        .unwrap()
        .contains_key("1:TEST0001"));
    let hash = imported.duplicate.unwrap().content_hash;
    let added = ws.import_zotero_paper_with_confirmation(&library, &library.papers[0], Some("PDF00001"), Some(&hash)).unwrap();
    assert_eq!(added.status, "imported");
    assert_ne!(added.entry_id, entry.id);
    assert_eq!(ws.list_entries().unwrap().len(), 2);
}

#[test]
fn pdf_in_trash_is_reported_instead_of_imported_again() {
    let (_dir, ws, library) = fixture();
    let entry = ws.create_entry("Trashed paper").unwrap();
    ws.import_pdf(&entry.id, library.papers[0].attachments[0].path.clone().unwrap()).unwrap();
    ws.delete_entry(&entry.id).unwrap();
    let duplicate = ws.import_zotero_paper(&library, &library.papers[0], Some("PDF00001")).unwrap();
    assert_eq!(duplicate.status, "duplicate");
    assert!(duplicate.duplicate.unwrap().in_trash);
    assert!(ws.list_entries().unwrap().is_empty());
}

#[test]
fn changed_missing_or_invalid_pdf_does_not_publish_partial_entries() {
    let (_dir, ws, mut library) = fixture();
    let source = library.papers[0].attachments[0].path.clone().unwrap();
    fs::write(&source, b"changed").unwrap();
    assert!(ws
        .import_zotero_paper(&library, &library.papers[0], Some("PDF00001"))
        .is_err());
    let metadata = fs::metadata(&source).unwrap();
    library.papers[0].attachments[0].file_size = metadata.len();
    library.papers[0].attachments[0].modified = metadata.modified().ok();
    assert!(ws
        .import_zotero_paper(&library, &library.papers[0], Some("PDF00001"))
        .is_err());
    fs::remove_file(source).unwrap();
    assert!(ws
        .import_zotero_paper(&library, &library.papers[0], Some("PDF00001"))
        .is_err());
    assert!(ws.list_entries().unwrap().is_empty());
    assert!(ws.list_tags().unwrap().is_empty());
}

#[test]
fn metadata_only_import_is_explicit_and_does_not_start_parsing() {
    let (_dir, ws, library) = fixture();
    let imported = ws
        .import_zotero_paper(&library, &library.papers[0], None)
        .unwrap();
    assert!(!imported.has_pdf);
    assert!(ws.read_entry(&imported.entry_id).unwrap().pdf.is_none());
}

#[test]
#[ignore = "Requires NEUINK_ZOTERO_TEST_DIR; reads a real source but writes only a temporary workspace"]
fn live_local_zotero_import_isolated() {
    let directory = std::env::var_os("NEUINK_ZOTERO_TEST_DIR").expect("set NEUINK_ZOTERO_TEST_DIR");
    let library = neuink_zotero::read_library(&neuink_zotero::SourceSettings {
        data_directory: Some(directory.into()),
        linked_attachment_directory: None,
    })
    .unwrap();
    let paper = library
        .papers
        .iter()
        .find(|p| p.attachments.iter().any(|a| a.available))
        .expect("a local PDF");
    let attachment = paper.attachments.iter().find(|a| a.available).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let ws = Workspace::create(dir.path()).unwrap();
    let imported = ws
        .import_zotero_paper(&library, paper, Some(&attachment.key))
        .unwrap();
    assert_eq!(imported.status, "imported");
    let entry = ws.read_entry(&imported.entry_id).unwrap();
    assert_eq!(entry.title, paper.title);
    assert_eq!(
        fs::read(ws.entry_pdf_path(&entry.id).unwrap()).unwrap(),
        fs::read(attachment.path.as_ref().unwrap()).unwrap()
    );
    assert_eq!(
        ws.import_zotero_paper(&library, paper, Some(&attachment.key))
            .unwrap()
            .status,
        "skipped"
    );
    println!("Real local PDF, metadata, tags and repeated import verified in temporary workspace");
}
