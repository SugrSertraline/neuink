use super::*;
use neuink_domain::{SegmentType, SourceSegment};

fn fixture() -> (tempfile::TempDir, Workspace, EntryId) {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path().join("library")).unwrap();
    let entry = workspace.create_entry("Source paper").unwrap();
    let pdf = dir.path().join("paper.pdf");
    fs::write(&pdf, b"%PDF-1.7\nindependent copy fixture").unwrap();
    workspace.import_pdf(&entry.id, pdf).unwrap();
    workspace
        .record_mineru_source(&entry.id, "source-item".into(), "hash".into())
        .unwrap();
    (dir, workspace, entry.id)
}

#[test]
fn copies_saved_content_and_remaps_owned_notes_links_assets_without_source_binding_or_reading_history(
) {
    let (_dir, workspace, source) = fixture();
    workspace
        .apply_entry_tag_paths(&source, vec!["My labels/To read".into()])
        .unwrap();
    let note = NoteId::new();
    workspace
        .create_note_with_id(&source, note.clone(), "My edits")
        .unwrap();
    let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "Evidence".into());
    workspace
        .write_segments(&source, &[segment.clone()])
        .unwrap();
    let link = workspace
        .build_note_source_link(&source, &note, &source, segment.uid)
        .unwrap();
    let assets = workspace.layout().entry_note_assets_dir(&source, &note);
    fs::create_dir_all(&assets).unwrap();
    fs::write(assets.join("image.png"), b"image-bytes").unwrap();
    let markdown = format!(
        "Local edits [^{}]\n\n![image](notes/{}.assets/image.png)",
        link.anchor_id, note
    );
    workspace
        .update_note_document_if_revision(
            &source,
            &note,
            "My edits",
            &markdown,
            &[link.clone()],
            None,
        )
        .unwrap();
    fs::write(
        workspace.layout().entry_reading_state_file(&source),
        b"original-reading-history",
    )
    .unwrap();
    fs::create_dir_all(
        workspace
            .layout()
            .entry_mineru_output_dir(&source)
            .join("images"),
    )
    .unwrap();
    fs::write(
        workspace
            .layout()
            .entry_mineru_output_dir(&source)
            .join("images/figure.png"),
        b"parser-image",
    )
    .unwrap();
    let result = workspace.copy_source_to_local(&source, false).unwrap();
    assert!(result.created);
    assert_ne!(source, result.entry_id);
    let copy = workspace.read_entry(&result.entry_id).unwrap();
    assert_eq!(copy.tags, workspace.read_entry(&source).unwrap().tags);
    assert_eq!(
        workspace.read_segments(&copy.id).unwrap(),
        workspace.read_segments(&source).unwrap()
    );
    let ContentItem::Note {
        note_id: copied_note,
        ..
    } = &copy.contents[0];
    assert_ne!(copied_note, &note);
    let document = workspace.read_note(&copy.id, copied_note).unwrap();
    assert!(document.markdown.contains("Local edits"));
    assert!(!document.markdown.contains(note.as_str()));
    assert_eq!(document.links.len(), 1);
    assert_ne!(document.links[0].link_id, link.link_id);
    assert_eq!(document.links[0].sources[0].entry_id, copy.id);
    assert_eq!(
        fs::read(
            workspace
                .layout()
                .entry_note_assets_dir(&copy.id, copied_note)
                .join("image.png")
        )
        .unwrap(),
        b"image-bytes"
    );
    assert_eq!(
        fs::read(workspace.layout().entry_pdf_file(&copy.id)).unwrap(),
        fs::read(workspace.layout().entry_pdf_file(&source)).unwrap()
    );
    assert_eq!(
        fs::read(
            workspace
                .layout()
                .entry_mineru_output_dir(&copy.id)
                .join("images/figure.png")
        )
        .unwrap(),
        b"parser-image"
    );
    assert!(!workspace
        .layout()
        .entry_reading_state_file(&copy.id)
        .exists());
    let catalog = workspace.entry_source_kinds().unwrap();
    assert!(catalog[copy.id.as_str()].kinds.is_empty());
    assert_eq!(
        catalog[source.as_str()].local_copy_ids,
        [copy.id.to_string()]
    );
    assert_eq!(
        catalog[copy.id.as_str()]
            .copied_from
            .as_ref()
            .unwrap()
            .source_entry_id,
        source
    );
    assert!(workspace.zotero_sources(&copy.id).unwrap().is_empty());
    workspace
        .update_note(&copy.id, copied_note, "Changed locally", "Independent")
        .unwrap();
    assert!(workspace
        .read_note(&source, &note)
        .unwrap()
        .markdown
        .contains("Local edits"));
    workspace.delete_entry(&copy.id).unwrap();
    assert!(workspace.read_entry(&source).is_ok());
}

#[test]
fn zotero_metadata_and_notes_copy_without_pdf_or_writeback_binding_and_survive_source_changes() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path().join("library")).unwrap();
    let source = workspace
        .create_entry("Metadata-only Zotero paper")
        .unwrap();
    let original_note = NoteId::new();
    workspace
        .create_note_with_id(&source.id, original_note.clone(), "Source note")
        .unwrap();
    workspace
        .update_note(
            &source.id,
            &original_note,
            "Source note",
            "Saved local edits",
        )
        .unwrap();
    atomic_write_json(workspace.layout().entry_dir(&source.id).join("zotero-source.json"), &serde_json::json!([{
        "source_id": "zotero-library", "item_id": "1:ABC12345", "attachment_key": null,
        "collections": ["Research / Topic"], "tags": ["Source label"], "note_ids": { "1:NOTE1234": original_note }
    }])).unwrap();
    let result = workspace.copy_source_to_local(&source.id, false).unwrap();
    let copied = workspace.read_entry(&result.entry_id).unwrap();
    assert!(copied.pdf.is_none());
    let ContentItem::Note { note_id, .. } = &copied.contents[0];
    assert_ne!(note_id, &original_note);
    assert_eq!(
        workspace.read_note(&copied.id, note_id).unwrap().markdown,
        "Saved local edits"
    );
    assert!(workspace.zotero_sources(&copied.id).unwrap().is_empty());
    let catalog = workspace.entry_source_kinds().unwrap();
    assert_eq!(
        catalog[source.id.as_str()].local_copy_ids,
        [copied.id.to_string()]
    );
    assert!(catalog[copied.id.as_str()].zotero_note_ids.is_empty());
    assert_eq!(
        catalog[copied.id.as_str()]
            .copied_from
            .as_ref()
            .unwrap()
            .source_kinds,
        ["zotero"]
    );
    workspace
        .update_note(
            &source.id,
            &original_note,
            "Source changed",
            "New source content",
        )
        .unwrap();
    assert_eq!(
        workspace.read_note(&copied.id, note_id).unwrap().markdown,
        "Saved local edits"
    );
    workspace.delete_entry(&copied.id).unwrap();
    let replacement = workspace.copy_source_to_local(&source.id, false).unwrap();
    assert!(replacement.created);
    assert_ne!(replacement.entry_id, copied.id);
    assert_eq!(
        workspace
            .read_note(&source.id, &original_note)
            .unwrap()
            .markdown,
        "New source content"
    );
}

#[test]
fn repeated_import_opens_existing_copy_and_explicit_force_creates_another() {
    let (_dir, workspace, source) = fixture();
    let first = workspace.copy_source_to_local(&source, false).unwrap();
    let repeated = workspace.copy_source_to_local(&source, false).unwrap();
    assert_eq!(first.entry_id, repeated.entry_id);
    assert!(!repeated.created);
    let next = workspace.copy_source_to_local(&source, true).unwrap();
    assert_ne!(first.entry_id, next.entry_id);
    assert_eq!(workspace.list_entries().unwrap().len(), 3);
    workspace.set_source_entry_hidden(&source, true).unwrap();
    let catalog = workspace.entry_source_kinds().unwrap();
    assert!(catalog[source.as_str()].hidden);
    assert!(!catalog[first.entry_id.as_str()].hidden);
}

#[test]
fn missing_notes_invalid_pdf_or_in_progress_parse_never_publish_partial_copies() {
    let (_dir, workspace, source) = fixture();
    let note = NoteId::new();
    workspace
        .create_note_with_id(&source, note.clone(), "Missing")
        .unwrap();
    fs::remove_file(workspace.layout().entry_note_file(&source, &note)).unwrap();
    assert!(workspace.copy_source_to_local(&source, false).is_err());
    assert_eq!(workspace.list_entries().unwrap().len(), 1);
    let mut entry = workspace.read_entry(&source).unwrap();
    entry.contents.clear();
    entry.pdf.as_mut().unwrap().parse.status = PdfParseStatus::Parsing;
    atomic_write_json(workspace.layout().entry_meta_file(&source), &entry).unwrap();
    assert!(workspace.copy_source_to_local(&source, false).is_err());
    entry.pdf.as_mut().unwrap().parse.status = PdfParseStatus::NotStarted;
    atomic_write_json(workspace.layout().entry_meta_file(&source), &entry).unwrap();
    fs::write(workspace.layout().entry_pdf_file(&source), b"changed-pdf").unwrap();
    assert!(workspace.copy_source_to_local(&source, false).is_err());
    assert_eq!(workspace.list_entries().unwrap().len(), 1);
}
