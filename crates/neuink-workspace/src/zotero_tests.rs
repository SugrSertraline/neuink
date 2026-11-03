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
fn imports_complete_entry_and_repeated_import_preserves_user_edits() {
    let (_dir, ws, library) = fixture();
    let first = ws
        .import_zotero_paper(&library, &library.papers[0], Some("PDF00001"))
        .unwrap();
    assert_eq!(first.status, "imported");
    let entry = ws.read_entry(&first.entry_id).unwrap();
    assert_eq!(entry.pdf.as_ref().unwrap().file_name, "论文.pdf");
    assert_eq!(entry.fields["doi"], "10.1/test");
    assert_eq!(ws.list_tags().unwrap()[0].name, "literal/slash");
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
fn identical_existing_pdf_is_reused_and_source_is_remembered() {
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
    assert_eq!(imported.status, "skipped");
    assert_eq!(ws.list_entries().unwrap().len(), 1);
    assert!(ws
        .zotero_matches("source")
        .unwrap()
        .contains_key("1:TEST0001"));
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
