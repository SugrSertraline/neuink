use std::{
    fs,
    sync::{Arc, Barrier},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::json;

use super::{Workspace, WorkspaceError};

#[test]
fn creates_and_lists_entries() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();

    workspace.create_entry("A paper").unwrap();

    let entries = workspace.list_entries().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].title, "A paper");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn updates_entry_meta() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let mut fields = std::collections::BTreeMap::new();
    fields.insert("author".to_string(), "Ada".to_string());

    let updated = workspace
        .update_entry_meta(&entry.id, "Updated paper", fields, Vec::new())
        .unwrap();

    assert_eq!(updated.title, "Updated paper");
    assert_eq!(updated.fields.get("author").unwrap(), "Ada");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn deletes_entry() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();

    workspace.delete_entry(&entry.id).unwrap();

    assert!(workspace.list_entries().unwrap().is_empty());
    assert_eq!(workspace.list_trashed_entries().unwrap().len(), 1);
    assert!(workspace.layout.trashed_entry_dir(&entry.id).exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn restores_and_purges_trashed_entry() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();

    workspace.delete_entry(&entry.id).unwrap();
    let restored = workspace.restore_entry(&entry.id).unwrap();

    assert_eq!(restored.title, "A paper");
    assert_eq!(workspace.list_entries().unwrap().len(), 1);
    assert!(workspace.list_trashed_entries().unwrap().is_empty());

    workspace.delete_entry(&entry.id).unwrap();
    workspace.purge_entry(&entry.id).unwrap();

    assert!(workspace.list_entries().unwrap().is_empty());
    assert!(workspace.list_trashed_entries().unwrap().is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn imports_pdf_once() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();

    let updated = workspace.import_pdf(&entry.id, &source_pdf).unwrap();

    assert!(updated.pdf.is_some());
    assert!(workspace.layout.entry_pdf_file(&entry.id).exists());
    assert!(workspace.import_pdf(&entry.id, &source_pdf).is_err());
    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn renames_pdf_display_name_without_moving_the_pdf_or_parse_state() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let imported = workspace.import_pdf(&entry.id, &source_pdf).unwrap();

    let renamed = workspace
        .rename_pdf_display_name(&entry.id, "renamed-paper.pdf")
        .unwrap();

    let renamed_pdf = renamed.pdf.as_ref().unwrap();
    let imported_pdf = imported.pdf.as_ref().unwrap();
    assert_eq!(renamed_pdf.file_name, "renamed-paper.pdf");
    assert_eq!(renamed_pdf.content_hash, imported_pdf.content_hash);
    assert_eq!(renamed_pdf.parse, imported_pdf.parse);
    assert!(workspace.layout.entry_pdf_file(&entry.id).exists());
    assert_eq!(
        fs::read(workspace.layout.entry_pdf_file(&entry.id)).unwrap(),
        b"%PDF-1.7"
    );

    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn creates_note_and_updates_entry_contents() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();

    let updated = workspace.create_note(&entry.id, "Reading note").unwrap();

    assert_eq!(updated.contents.len(), 1);
    let neuink_domain::ContentItem::Note { note_id, title } = &updated.contents[0];
    assert_eq!(title, "Reading note");
    assert!(workspace
        .layout
        .entry_note_file(&entry.id, note_id)
        .exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn updates_note_title_and_markdown() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let updated = workspace.create_note(&entry.id, "Reading note").unwrap();
    let neuink_domain::ContentItem::Note { note_id, .. } = &updated.contents[0];

    let note = workspace
        .update_note(&entry.id, note_id, "Renamed note", "## Claim\n\nText")
        .unwrap();

    assert_eq!(note.title, "Renamed note");
    assert!(note.markdown.contains("## Claim"));
    assert_eq!(note.revision.len(), 64);
    let entry = workspace.read_entry(&entry.id).unwrap();
    let neuink_domain::ContentItem::Note { title, .. } = &entry.contents[0];
    assert_eq!(title, "Renamed note");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_stale_note_revision_without_overwriting_newer_content() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let updated = workspace.create_note(&entry.id, "Reading note").unwrap();
    let neuink_domain::ContentItem::Note { note_id, .. } = &updated.contents[0];
    let opened = workspace.read_note(&entry.id, note_id).unwrap();

    let newer = workspace
        .update_note_if_revision(
            &entry.id,
            note_id,
            "Newer title",
            "newer content",
            Some(&opened.revision),
        )
        .unwrap();
    assert_ne!(newer.revision, opened.revision);

    let error = workspace
        .update_note_if_revision(
            &entry.id,
            note_id,
            "Stale title",
            "stale content",
            Some(&opened.revision),
        )
        .unwrap_err();
    assert!(matches!(error, WorkspaceError::NoteRevisionConflict(_)));

    let persisted = workspace.read_note(&entry.id, note_id).unwrap();
    assert_eq!(persisted.title, "Newer title");
    assert_eq!(persisted.markdown, "newer content");
    assert_eq!(persisted.revision, newer.revision);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn aggregate_note_save_tracks_and_prunes_referenced_source_links() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let updated = workspace.create_note(&entry.id, "Reading note").unwrap();
    let neuink_domain::ContentItem::Note { note_id, .. } = &updated.contents[0];
    let opened = workspace.read_note(&entry.id, note_id).unwrap();
    let link = neuink_domain::SourceLink::note(
        entry.id.clone(),
        note_id.clone(),
        "sl-test".to_string(),
        neuink_domain::SegmentRef {
            entry_id: entry.id.clone(),
            segment_uid: neuink_domain::SegmentUid::from_string("segment-test"),
            page: 1,
            bbox: None,
            segment_type: None,
            snapshot_text: "Source text".to_string(),
            snapshot_asset_path: None,
            quote_hash: "hash".to_string(),
        },
        "p.1".to_string(),
    );

    let linked = workspace
        .update_note_document_if_revision(
            &entry.id,
            note_id,
            "Reading note",
            "Claim [^sl-test]",
            std::slice::from_ref(&link),
            Some(&opened.revision),
        )
        .unwrap();
    assert_eq!(linked.links.len(), 1);

    let mut externally_changed_link = link.clone();
    externally_changed_link.display_text = "changed externally".to_string();
    workspace
        .replace_note_source_links(
            &entry.id,
            note_id,
            std::slice::from_ref(&externally_changed_link),
        )
        .unwrap();
    let externally_changed = workspace.read_note(&entry.id, note_id).unwrap();
    assert_ne!(externally_changed.revision, linked.revision);

    let error = workspace
        .update_note_document_if_revision(
            &entry.id,
            note_id,
            "Reading note",
            "Stale edit [^sl-test]",
            std::slice::from_ref(&link),
            Some(&linked.revision),
        )
        .unwrap_err();
    assert!(matches!(error, WorkspaceError::NoteRevisionConflict(_)));

    let pruned = workspace
        .update_note_document_if_revision(
            &entry.id,
            note_id,
            "Reading note",
            "Claim without a source marker",
            std::slice::from_ref(&externally_changed_link),
            Some(&externally_changed.revision),
        )
        .unwrap();
    assert!(pruned.links.is_empty());
    let persisted_links: Vec<neuink_domain::SourceLink> = serde_json::from_slice(
        &fs::read(workspace.layout.entry_note_links_file(&entry.id, note_id)).unwrap(),
    )
    .unwrap();
    assert!(persisted_links.is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quarantines_stale_unreferenced_note_assets_and_restores_references() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let updated = workspace.create_note(&entry.id, "Reading note").unwrap();
    let neuink_domain::ContentItem::Note { note_id, .. } = &updated.contents[0];
    let asset_dir = workspace.layout.entry_note_assets_dir(&entry.id, note_id);
    let file_name = "figure-0123456789ab.png";
    let active_path = asset_dir.join(file_name);
    fs::create_dir_all(&asset_dir).unwrap();
    fs::write(&active_path, b"image bytes").unwrap();

    let opened = workspace.read_note(&entry.id, note_id).unwrap();
    workspace
        .update_note_if_revision(
            &entry.id,
            note_id,
            "Reading note",
            "No image yet",
            Some(&opened.revision),
        )
        .unwrap();
    let manifest_path = asset_dir.join(".orphaned-assets.json");
    assert!(active_path.exists());
    assert!(manifest_path.exists());

    fs::write(
        &manifest_path,
        serde_json::to_vec(&json!({
            "unreferenced_since": { (file_name): 0 }
        }))
        .unwrap(),
    )
    .unwrap();
    let before_quarantine = workspace.read_note(&entry.id, note_id).unwrap();
    workspace
        .update_note_if_revision(
            &entry.id,
            note_id,
            "Reading note",
            "Still no image",
            Some(&before_quarantine.revision),
        )
        .unwrap();
    let quarantined_path = asset_dir.join(".orphaned").join(file_name);
    assert!(!active_path.exists());
    assert!(quarantined_path.exists());

    let before_restore = workspace.read_note(&entry.id, note_id).unwrap();
    let markdown = format!(
        r#"<img src="./{}.assets/{}" alt="figure" />"#,
        note_id.as_str(),
        file_name
    );
    workspace
        .update_note_if_revision(
            &entry.id,
            note_id,
            "Reading note",
            markdown,
            Some(&before_restore.revision),
        )
        .unwrap();
    assert!(active_path.exists());
    assert!(!quarantined_path.exists());
    assert!(!manifest_path.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn serializes_concurrent_note_updates_with_the_same_revision() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let updated = workspace.create_note(&entry.id, "Reading note").unwrap();
    let neuink_domain::ContentItem::Note { note_id, .. } = &updated.contents[0];
    let opened = workspace.read_note(&entry.id, note_id).unwrap();
    let barrier = Arc::new(Barrier::new(3));

    let handles = ["first", "second"].map(|markdown| {
        let workspace = workspace.clone();
        let entry_id = entry.id.clone();
        let note_id = note_id.clone();
        let revision = opened.revision.clone();
        let barrier = barrier.clone();
        std::thread::spawn(move || {
            barrier.wait();
            workspace.update_note_if_revision(
                &entry_id,
                &note_id,
                "Reading note",
                markdown,
                Some(&revision),
            )
        })
    });
    barrier.wait();

    let results = handles.map(|handle| handle.join().unwrap());
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(WorkspaceError::NoteRevisionConflict(_))))
            .count(),
        1
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn creates_note_source_link_sidecar() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let updated = workspace.create_note(&entry.id, "Reading note").unwrap();
    let neuink_domain::ContentItem::Note { note_id, .. } = &updated.contents[0];
    workspace.import_pdf(&entry.id, &source_pdf).unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Queued, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Uploading, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Uploaded, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Parsing, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Succeeded, None)
        .unwrap();
    let segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        0,
        Some([0.0, 0.0, 100.0, 100.0]),
        "Grounded claim".to_string(),
    );
    let segment_uid = segment.uid.clone();
    workspace.write_segments(&entry.id, &[segment]).unwrap();

    let links_path = workspace.layout.entry_note_links_file(&entry.id, note_id);
    let prepared = workspace
        .build_note_source_link(&entry.id, note_id, &entry.id, segment_uid.clone())
        .unwrap();
    assert_eq!(prepared.sources.len(), 1);
    assert!(!links_path.exists());

    let link = workspace
        .create_note_source_link(&entry.id, note_id, &entry.id, segment_uid)
        .unwrap();

    assert_eq!(link.sources.len(), 1);
    assert!(links_path.exists());
    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn requeue_failed_pdf_parse_clears_previous_task_metadata() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    workspace.import_pdf(&entry.id, &source_pdf).unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Queued, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Uploading, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Uploaded, None)
        .unwrap();
    workspace
        .set_pdf_parse_state_with_task(
            &entry.id,
            neuink_domain::PdfParseStatus::Parsing,
            Some("parsing: old task".to_string()),
            Some("old-task".to_string()),
            Some("https://parser.example".to_string()),
        )
        .unwrap();
    workspace
        .set_pdf_parse_state_with_task(
            &entry.id,
            neuink_domain::PdfParseStatus::Failed,
            Some("failed".to_string()),
            None,
            None,
        )
        .unwrap();

    let requeued = workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Queued, None)
        .unwrap();
    let parse = requeued.pdf.unwrap().parse;

    assert_eq!(parse.status, neuink_domain::PdfParseStatus::Queued);
    assert!(parse.task_id.is_none());
    assert!(parse.endpoint.is_none());
    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn trashes_and_restores_note_with_sidecar() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let updated = workspace.create_note(&entry.id, "Reading note").unwrap();
    let neuink_domain::ContentItem::Note { note_id, .. } = &updated.contents[0];
    workspace.import_pdf(&entry.id, &source_pdf).unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Queued, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Uploading, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Uploaded, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Parsing, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Succeeded, None)
        .unwrap();
    let segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        0,
        Some([0.0, 0.0, 100.0, 100.0]),
        "Grounded claim".to_string(),
    );
    let segment_uid = segment.uid.clone();
    workspace.write_segments(&entry.id, &[segment]).unwrap();
    workspace
        .create_note_source_link(&entry.id, note_id, &entry.id, segment_uid)
        .unwrap();

    let note_path = workspace.layout.entry_note_file(&entry.id, note_id);
    let links_path = workspace.layout.entry_note_links_file(&entry.id, note_id);
    let deleted = workspace.delete_note(&entry.id, note_id).unwrap();

    assert!(deleted.contents.is_empty());
    assert!(!note_path.exists());
    assert!(!links_path.exists());
    let trash = workspace.list_entry_trash_items(&entry.id).unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].kind, crate::TrashItemKind::MarkdownNote);

    workspace
        .restore_trash_item(&entry.id, &trash[0].trash_id)
        .unwrap();

    assert!(workspace.read_note(&entry.id, note_id).is_ok());
    assert!(note_path.exists());
    assert!(links_path.exists());
    assert!(workspace
        .list_entry_trash_items(&entry.id)
        .unwrap()
        .is_empty());
    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn global_trash_lists_child_content_inside_trashed_entries() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = create_parsed_entry_with_segment(&workspace, &source_pdf);
    let segment_uid = workspace.read_segments(&entry.id).unwrap()[0].uid.clone();
    workspace.create_note(&entry.id, "Reading note").unwrap();
    workspace
        .upsert_segment_note(
            &entry.id,
            segment_uid.clone(),
            "Segment thought".to_string(),
        )
        .unwrap();
    workspace
        .create_annotation(
            &entry.id,
            segment_uid,
            "highlight".to_string(),
            "Key sentence".to_string(),
            neuink_domain::AnnotationImportance::Important,
        )
        .unwrap();

    workspace.delete_entry(&entry.id).unwrap();
    let trash = workspace.list_trash_items().unwrap();

    assert!(trash
        .iter()
        .any(|item| item.kind == crate::TrashItemKind::Entry));
    assert!(trash
        .iter()
        .any(|item| item.kind == crate::TrashItemKind::MarkdownNote));
    assert!(trash
        .iter()
        .any(|item| item.kind == crate::TrashItemKind::SegmentNote));
    assert!(trash
        .iter()
        .any(|item| item.kind == crate::TrashItemKind::Highlight));
    assert!(trash
        .iter()
        .filter(|item| item.kind != crate::TrashItemKind::Entry)
        .all(|item| item.parent_entry_trashed));

    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn restores_segment_notes_and_annotations_from_entry_trash() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = create_parsed_entry_with_segment(&workspace, &source_pdf);
    let segment_uid = workspace.read_segments(&entry.id).unwrap()[0].uid.clone();
    workspace
        .upsert_segment_note(
            &entry.id,
            segment_uid.clone(),
            "Segment thought".to_string(),
        )
        .unwrap();
    let annotations = workspace
        .create_annotation(
            &entry.id,
            segment_uid.clone(),
            "question".to_string(),
            "Why?".to_string(),
            neuink_domain::AnnotationImportance::Normal,
        )
        .unwrap();

    workspace
        .delete_segment_note(&entry.id, segment_uid)
        .unwrap();
    workspace
        .delete_annotation(&entry.id, &annotations[0].annotation_id)
        .unwrap();
    let trash = workspace.list_entry_trash_items(&entry.id).unwrap();
    assert_eq!(trash.len(), 2);

    for item in trash {
        workspace
            .restore_trash_item(&entry.id, &item.trash_id)
            .unwrap();
    }

    assert_eq!(workspace.read_segment_notes(&entry.id).unwrap().len(), 1);
    assert_eq!(workspace.read_annotations(&entry.id).unwrap().len(), 1);
    assert!(workspace
        .list_entry_trash_items(&entry.id)
        .unwrap()
        .is_empty());

    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn creates_and_assigns_tags() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let parent = workspace.create_tag("Vision", None).unwrap();
    let child = workspace
        .create_tag("Detection", Some(parent.id.clone()))
        .unwrap();
    let entry = workspace
        .create_entry_with_meta(
            "A paper",
            std::collections::BTreeMap::new(),
            vec![child.id.clone()],
        )
        .unwrap();

    assert_eq!(workspace.list_tags().unwrap().len(), 2);
    assert_eq!(entry.tags, vec![child.id]);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn deleting_tag_removes_descendants_from_entries() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let parent = workspace.create_tag("Vision", None).unwrap();
    let child = workspace
        .create_tag("Detection", Some(parent.id.clone()))
        .unwrap();
    let entry = workspace
        .create_entry_with_meta(
            "A paper",
            std::collections::BTreeMap::new(),
            vec![child.id.clone()],
        )
        .unwrap();

    workspace.delete_tag(&parent.id).unwrap();

    assert!(workspace.list_tags().unwrap().is_empty());
    assert!(workspace.read_entry(&entry.id).unwrap().tags.is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn writes_and_reads_segments() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let segments = vec![neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        0,
        Some([0.0, 0.0, 100.0, 100.0]),
        "Hello".to_string(),
    )];

    workspace.write_segments(&entry.id, &segments).unwrap();

    assert_eq!(workspace.read_segments(&entry.id).unwrap().len(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn creates_updates_and_deletes_annotations() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = create_parsed_entry_with_segment(&workspace, &source_pdf);
    let segment_uid = workspace.read_segments(&entry.id).unwrap()[0].uid.clone();

    let created = workspace
        .create_annotation(
            &entry.id,
            segment_uid.clone(),
            "question".to_string(),
            "What supports this claim?".to_string(),
            neuink_domain::AnnotationImportance::Important,
        )
        .unwrap();
    assert_eq!(created.len(), 1);
    assert_eq!(
        created[0]
            .segment_snapshot
            .as_ref()
            .map(|snapshot| snapshot.text.as_str()),
        Some("Grounded claim")
    );
    let annotation_id = created[0].annotation_id.clone();

    let updated = workspace
        .update_annotation(
            &entry.id,
            &annotation_id,
            "insight".to_string(),
            "This is the key takeaway.".to_string(),
            neuink_domain::AnnotationImportance::Core,
        )
        .unwrap();
    assert_eq!(updated[0].kind, "insight");
    assert_eq!(
        updated[0].importance,
        neuink_domain::AnnotationImportance::Core
    );

    let remaining = workspace
        .delete_annotation(&entry.id, &annotation_id)
        .unwrap();
    assert!(remaining.is_empty());

    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn persists_pdf_text_selection_across_workspace_reopen_and_annotation_edit() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = create_parsed_entry_with_segment(&workspace, &source_pdf);
    let segment_uid = workspace.read_segments(&entry.id).unwrap()[0].uid.clone();
    let selection = neuink_domain::AnnotationTextSelection {
        color: "blue".to_string(),
        page_idx: 0,
        rects: vec![[120.0, 220.0, 640.0, 270.0]],
        text: "Grounded claim".to_string(),
    };

    let created = workspace
        .create_annotation_with_text_selection(
            &entry.id,
            segment_uid,
            "highlight".to_string(),
            "Initial note".to_string(),
            neuink_domain::AnnotationImportance::Important,
            Some(selection.clone()),
        )
        .unwrap();
    let annotation_id = created[0].annotation_id.clone();
    drop(workspace);

    let reopened = Workspace::open(&root).unwrap();
    let persisted = reopened.read_annotations(&entry.id).unwrap();
    assert_eq!(persisted[0].text_selection.as_ref(), Some(&selection));

    let updated = reopened
        .update_annotation(
            &entry.id,
            &annotation_id,
            "highlight".to_string(),
            "Edited note".to_string(),
            neuink_domain::AnnotationImportance::Core,
        )
        .unwrap();
    assert_eq!(updated[0].text_selection.as_ref(), Some(&selection));

    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn persists_page_anchored_annotation_before_and_after_parse_failure() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("Unparsed paper").unwrap();
    workspace.import_pdf(&entry.id, &source_pdf).unwrap();
    let selection = neuink_domain::AnnotationTextSelection {
        color: "green".to_string(),
        page_idx: 3,
        rects: vec![[120.0, 220.0, 640.0, 270.0]],
        text: "Available before parsing".to_string(),
    };
    let segment_uid = neuink_domain::pdf_page_annotation_segment_uid(selection.page_idx);

    let created = workspace
        .create_annotation_with_text_selection(
            &entry.id,
            segment_uid.clone(),
            "highlight".to_string(),
            "Saved against the PDF page".to_string(),
            neuink_domain::AnnotationImportance::Important,
            Some(selection.clone()),
        )
        .unwrap();
    let annotation_id = created[0].annotation_id.clone();
    assert_eq!(
        created[0].anchor_kind,
        neuink_domain::AnnotationAnchorKind::PdfPage
    );
    assert_eq!(created[0].segment_uid, segment_uid);

    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Queued, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Uploading, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(
            &entry.id,
            neuink_domain::PdfParseStatus::Failed,
            Some("parser unavailable".to_string()),
        )
        .unwrap();

    let updated = workspace
        .update_annotation(
            &entry.id,
            &annotation_id,
            "highlight".to_string(),
            "Still editable".to_string(),
            neuink_domain::AnnotationImportance::Core,
        )
        .unwrap();
    assert_eq!(updated[0].content, "Still editable");
    assert_eq!(updated[0].text_selection.as_ref(), Some(&selection));

    let records = workspace.list_annotations().unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0].segment_status,
        crate::AnnotationSegmentStatus::PageAnchored
    );
    assert_eq!(
        records[0].segment.as_ref().map(|segment| segment.page_idx),
        Some(3)
    );

    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn lists_annotations_for_parsed_entries() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = create_parsed_entry_with_segment(&workspace, &source_pdf);
    let segment_uid = workspace.read_segments(&entry.id).unwrap()[0].uid.clone();

    workspace
        .create_annotation(
            &entry.id,
            segment_uid,
            "summary".to_string(),
            "Short recap".to_string(),
            neuink_domain::AnnotationImportance::Normal,
        )
        .unwrap();

    let records = workspace.list_annotations().unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].entry_id, entry.id);
    assert_eq!(records[0].annotation.kind, "summary");
    assert_eq!(
        records[0].segment.as_ref().map(|segment| segment.page_idx),
        Some(0)
    );
    assert_eq!(
        records[0].segment_status,
        crate::AnnotationSegmentStatus::Current
    );

    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn list_annotations_preserves_orphaned_snapshot_context() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = create_parsed_entry_with_segment(&workspace, &source_pdf);
    let segment_uid = workspace.read_segments(&entry.id).unwrap()[0].uid.clone();

    workspace
        .create_annotation(
            &entry.id,
            segment_uid,
            "summary".to_string(),
            "Short recap".to_string(),
            neuink_domain::AnnotationImportance::Normal,
        )
        .unwrap();
    workspace.write_segments(&entry.id, &[]).unwrap();

    let records = workspace.list_annotations().unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0].segment_status,
        crate::AnnotationSegmentStatus::Orphaned
    );
    assert_eq!(
        records[0]
            .segment
            .as_ref()
            .map(|segment| segment.text.as_str()),
        Some("Grounded claim")
    );

    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn annotation_requires_succeeded_pdf() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        0,
        Some([0.0, 0.0, 100.0, 100.0]),
        "Hello".to_string(),
    );
    let segment_uid = segment.uid.clone();
    workspace.write_segments(&entry.id, &[segment]).unwrap();

    let error = workspace
        .create_annotation(
            &entry.id,
            segment_uid,
            "question".to_string(),
            "Needs parse".to_string(),
            neuink_domain::AnnotationImportance::Normal,
        )
        .unwrap_err();

    assert!(matches!(error, crate::WorkspaceError::PdfNotParsed(_)));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn read_segments_enriches_asset_paths_from_mineru_content_list() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Figure,
        2,
        Some([10.0, 20.0, 300.0, 400.0]),
        "Figure caption".to_string(),
    );
    workspace.write_segments(&entry.id, &[segment]).unwrap();

    let mineru_output_dir = workspace.layout.entry_mineru_output_dir(&entry.id);
    fs::create_dir_all(&mineru_output_dir).unwrap();
    fs::write(
        mineru_output_dir.join("paper_content_list.json"),
        r#"[{
            "type": "image",
            "page_idx": 2,
            "bbox": [10, 20, 300, 400],
            "img_path": "images/figure.jpg",
            "image_caption": ["Figure caption"]
        }]"#,
    )
    .unwrap();

    let segments = workspace.read_segments(&entry.id).unwrap();

    assert_eq!(segments[0].asset_path.as_deref(), Some("images/figure.jpg"));
    assert!(segments[0].text.contains("Figure caption"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn write_mineru_output_response_saves_images_locally() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();

    workspace
        .write_mineru_output_response(
            &entry.id,
            &json!({
                "content_list": [{
                    "type": "image",
                    "page_idx": 0,
                    "bbox": [0, 0, 100, 100],
                    "img_path": "images/sample.jpg"
                }],
                "images": {
                    "sample.jpg": "data:image/jpeg;base64,SGVsbG8="
                }
            }),
        )
        .unwrap();

    assert!(workspace
        .layout
        .entry_mineru_output_dir(&entry.id)
        .join("task-result.json")
        .exists());
    assert_eq!(
        fs::read(
            workspace
                .layout
                .entry_mineru_output_dir(&entry.id)
                .join("images")
                .join("sample.jpg")
        )
        .unwrap(),
        b"Hello"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn creates_note_source_link_from_continuation_group_id() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let updated = workspace.create_note(&entry.id, "Reading note").unwrap();
    let neuink_domain::ContentItem::Note { note_id, .. } = &updated.contents[0];
    workspace.import_pdf(&entry.id, &source_pdf).unwrap();
    for status in [
        neuink_domain::PdfParseStatus::Queued,
        neuink_domain::PdfParseStatus::Uploading,
        neuink_domain::PdfParseStatus::Uploaded,
        neuink_domain::PdfParseStatus::Parsing,
        neuink_domain::PdfParseStatus::Succeeded,
    ] {
        workspace
            .set_pdf_parse_state(&entry.id, status, None)
            .unwrap();
    }
    let segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        0,
        None,
        "Grouped claim".to_string(),
    )
    .with_relation_groups(Some("v2-continuation-0".to_string()), None);
    let actual_uid = segment.uid.clone();
    workspace.write_segments(&entry.id, &[segment]).unwrap();

    let link = workspace
        .create_note_source_link(
            &entry.id,
            note_id,
            &entry.id,
            neuink_domain::SegmentUid::from_string("v2-continuation-0"),
        )
        .unwrap();

    assert_eq!(link.sources[0].segment_uid, actual_uid);
    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn stores_real_segment_uid_for_group_targeted_segment_note() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        0,
        None,
        "Grouped note target".to_string(),
    )
    .with_relation_groups(Some("v2-continuation-note".to_string()), None);
    let actual_uid = segment.uid.clone();
    workspace.write_segments(&entry.id, &[segment]).unwrap();

    let notes = workspace
        .upsert_segment_note(
            &entry.id,
            neuink_domain::SegmentUid::from_string("v2-continuation-note"),
            "Note".to_string(),
        )
        .unwrap();

    assert_eq!(notes[0].segment_uid, actual_uid);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_segment_note_over_limit_before_writing() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        0,
        None,
        "Segment".to_string(),
    );
    let segment_uid = segment.uid.clone();
    workspace.write_segments(&entry.id, &[segment]).unwrap();
    workspace
        .upsert_segment_note(&entry.id, segment_uid.clone(), "valid".to_string())
        .unwrap();

    let max = neuink_domain::segment_note::MAX_SEGMENT_NOTE_CHARACTERS;
    let error = workspace
        .upsert_segment_note(&entry.id, segment_uid, "x".repeat(max + 1))
        .expect_err("over-limit segment note should fail");

    assert!(matches!(
        error,
        crate::WorkspaceError::Domain(neuink_domain::DomainError::SegmentNoteTooLong {
            actual,
            max: actual_max
        }) if actual == max + 1 && actual_max == max
    ));
    assert_eq!(
        workspace.read_segment_notes(&entry.id).unwrap()[0].text,
        "valid"
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn write_mineru_output_response_preserves_embedded_artifacts() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();

    workspace
        .write_mineru_output_response(
            &entry.id,
            &json!({
                "files": {
                    "nested/paper_middle.json": {"pdf_info": [{"page_idx": 0}]},
                    "nested/notes.txt": "complete parser output"
                }
            }),
        )
        .unwrap();

    let output_dir = workspace.layout.entry_mineru_output_dir(&entry.id);
    assert_eq!(
        fs::read_to_string(output_dir.join("nested/notes.txt")).unwrap(),
        "complete parser output"
    );
    assert!(output_dir.join("paper_middle.json").exists());
    assert_eq!(
        workspace
            .read_mineru_middle_json(&entry.id)
            .unwrap()
            .unwrap()["pdf_info"][0]["page_idx"],
        0
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn search_records_include_notes_but_only_succeeded_segments() {
    let root = std::env::temp_dir().join(format!("neuink_workspace_{}", unique_suffix()));
    let source_pdf = root.with_extension("pdf");
    fs::write(&source_pdf, b"%PDF-1.7").unwrap();
    let workspace = Workspace::create(&root).unwrap();
    let parsed = workspace.create_entry("Parsed paper").unwrap();
    let pending = workspace.create_entry("Pending paper").unwrap();
    let parsed_note = workspace
        .create_note(&parsed.id, "Searchable note")
        .unwrap();
    let neuink_domain::ContentItem::Note { note_id, .. } = &parsed_note.contents[0];
    workspace
        .update_note(&parsed.id, note_id, "Searchable note", "note body token")
        .unwrap();

    workspace.import_pdf(&parsed.id, &source_pdf).unwrap();
    workspace
        .set_pdf_parse_state(&parsed.id, neuink_domain::PdfParseStatus::Queued, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&parsed.id, neuink_domain::PdfParseStatus::Uploading, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&parsed.id, neuink_domain::PdfParseStatus::Uploaded, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&parsed.id, neuink_domain::PdfParseStatus::Parsing, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&parsed.id, neuink_domain::PdfParseStatus::Succeeded, None)
        .unwrap();
    workspace.import_pdf(&pending.id, &source_pdf).unwrap();

    let parsed_segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        0,
        Some([0.0, 0.0, 100.0, 100.0]),
        "parsed segment token".to_string(),
    );
    let parsed_segment_uid = parsed_segment.uid.clone();
    workspace
        .write_segments(&parsed.id, &[parsed_segment])
        .unwrap();
    workspace
        .create_annotation(
            &parsed.id,
            parsed_segment_uid.clone(),
            "insight".to_string(),
            "annotation insight token".to_string(),
            neuink_domain::AnnotationImportance::Core,
        )
        .unwrap();
    workspace
        .upsert_segment_note(
            &parsed.id,
            parsed_segment_uid,
            "<p>segment note token &amp; detail</p>".to_string(),
        )
        .unwrap();
    workspace
        .write_segments(
            &pending.id,
            &[neuink_domain::SourceSegment::new(
                neuink_domain::SegmentType::Paragraph,
                0,
                Some([0.0, 0.0, 100.0, 100.0]),
                "pending segment token".to_string(),
            )],
        )
        .unwrap();

    let records = workspace
        .collect_search_records(crate::WorkspaceSearchOptions::default())
        .unwrap();

    assert!(records
        .iter()
        .any(|record| record.text.contains("note body token")));
    assert!(records
        .iter()
        .any(|record| record.text.contains("segment note token & detail")));
    assert!(records.iter().any(|record| {
        record.kind == crate::WorkspaceSearchRecordKind::Annotation
            && record.text.contains("annotation insight token")
    }));
    assert!(records
        .iter()
        .any(|record| record.text.contains("parsed segment token")));
    assert!(!records
        .iter()
        .any(|record| record.text.contains("pending segment token")));

    fs::remove_file(source_pdf).unwrap();
    fs::remove_dir_all(root).unwrap();
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

fn create_parsed_entry_with_segment(
    workspace: &Workspace,
    source_pdf: &std::path::Path,
) -> neuink_domain::EntryMeta {
    let entry = workspace.create_entry("Parsed paper").unwrap();
    workspace.import_pdf(&entry.id, source_pdf).unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Queued, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Uploading, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Uploaded, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Parsing, None)
        .unwrap();
    workspace
        .set_pdf_parse_state(&entry.id, neuink_domain::PdfParseStatus::Succeeded, None)
        .unwrap();
    workspace
        .write_segments(
            &entry.id,
            &[neuink_domain::SourceSegment::new(
                neuink_domain::SegmentType::Paragraph,
                0,
                Some([0.0, 0.0, 100.0, 100.0]),
                "Grounded claim".to_string(),
            )],
        )
        .unwrap();
    entry
}

#[test]
fn segment_note_bookmark_survives_reopen_text_changes_and_trash() {
    let root = std::env::temp_dir().join(format!("neuink_bookmark_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("Bookmark paper").unwrap();
    let segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        2,
        None,
        "Source".into(),
    )
    .with_relation_groups(Some("logical-bookmark".into()), None);
    let uid = segment.uid.clone();
    workspace.write_segments(&entry.id, &[segment]).unwrap();
    let notes = workspace
        .set_segment_note_bookmark(
            &entry.id,
            neuink_domain::SegmentUid::from_string("logical-bookmark"),
            true,
        )
        .unwrap();
    assert_eq!(notes.len(), 1);
    assert!(notes[0].bookmarked);
    assert!(notes[0].text.is_empty());
    assert_eq!(notes[0].segment_uid, uid);
    workspace
        .upsert_segment_note(&entry.id, uid.clone(), "Keep this text".into())
        .unwrap();
    let notes = workspace
        .set_segment_note_bookmark(&entry.id, uid.clone(), false)
        .unwrap();
    assert_eq!(notes[0].text, "Keep this text");
    workspace
        .set_segment_note_bookmark(&entry.id, uid.clone(), true)
        .unwrap();
    workspace
        .upsert_segment_note(&entry.id, uid.clone(), String::new())
        .unwrap();
    let reopened = Workspace::open(&root).unwrap();
    assert!(reopened.read_segment_notes(&entry.id).unwrap()[0].bookmarked);
    reopened.delete_segment_note(&entry.id, uid).unwrap();
    assert!(reopened.read_segment_notes(&entry.id).unwrap().is_empty());
    let trash = reopened.list_trash_items().unwrap();
    reopened
        .restore_trash_item(&entry.id, &trash[0].trash_id)
        .unwrap();
    assert!(reopened.read_segment_notes(&entry.id).unwrap()[0].bookmarked);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_segment_note_and_missing_bookmark_source_are_handled() {
    let note: neuink_domain::SegmentBlockNote = serde_json::from_value(json!({
        "segment_uid": "legacy", "text": "old note", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"
    })).unwrap();
    assert!(!note.bookmarked);
    let root = std::env::temp_dir().join(format!("neuink_bookmark_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("Paper").unwrap();
    let segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        0,
        None,
        "Source".into(),
    );
    let uid = segment.uid.clone();
    workspace.write_segments(&entry.id, &[segment]).unwrap();
    workspace
        .set_segment_note_bookmark(&entry.id, uid.clone(), true)
        .unwrap();
    workspace.write_segments(&entry.id, &[]).unwrap();
    assert!(
        !workspace
            .set_segment_note_bookmark(&entry.id, uid.clone(), false)
            .unwrap()[0]
            .bookmarked
    );
    assert!(workspace
        .set_segment_note_bookmark(&entry.id, uid, true)
        .is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn segment_note_body_and_bookmark_writes_do_not_overwrite_each_other() {
    let root = std::env::temp_dir().join(format!("neuink_bookmark_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let second = Workspace::open(&root).unwrap();
    let entry = workspace.create_entry("Concurrent note").unwrap();
    let segment = neuink_domain::SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        0,
        None,
        "Source".into(),
    );
    let uid = segment.uid.clone();
    workspace.write_segments(&entry.id, &[segment]).unwrap();
    let barrier = std::sync::Barrier::new(2);
    std::thread::scope(|scope| {
        scope.spawn(|| {
            barrier.wait();
            workspace
                .upsert_segment_note(&entry.id, uid.clone(), "Keep the edited body".into())
                .unwrap();
        });
        scope.spawn(|| {
            barrier.wait();
            second
                .set_segment_note_bookmark(&entry.id, uid.clone(), true)
                .unwrap();
        });
    });
    let notes = workspace.read_segment_notes(&entry.id).unwrap();
    assert_eq!(notes.len(), 1);
    assert!(notes[0].bookmarked);
    assert_eq!(notes[0].text, "Keep the edited body");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn segment_note_compare_and_write_is_atomic_and_preserves_bookmarks() {
    let root = std::env::temp_dir().join(format!("neuink_segment_cas_{}", unique_suffix()));
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("Concurrent note").unwrap();
    let segment = neuink_domain::SourceSegment::new(neuink_domain::SegmentType::Paragraph, 0, None, "Source".into());
    let uid = segment.uid.clone();
    workspace.write_segments(&entry.id, &[segment]).unwrap();
    workspace.set_segment_note_bookmark(&entry.id, uid.clone(), true).unwrap();
    let barrier = Barrier::new(2);
    let results = std::thread::scope(|scope| {
        let handles: Vec<_> = ["AI", "manual"].into_iter().map(|text| {
            let (root, id, uid, barrier) = (&root, &entry.id, &uid, &barrier);
            scope.spawn(move || {
                let writer = Workspace::open(root).unwrap();
                barrier.wait();
                writer.upsert_segment_note_if_text(id, uid.clone(), text.into(), Some(""))
            })
        }).collect();
        handles.into_iter().map(|handle| handle.join().unwrap()).collect::<Vec<_>>()
    });
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(results.iter().filter(|r| matches!(r, Err(WorkspaceError::SegmentNoteConflict(_)))).count(), 1);
    let notes = workspace.read_segment_notes(&entry.id).unwrap();
    assert!(notes[0].bookmarked);
    workspace.upsert_segment_note(&entry.id, uid.clone(), "new manual edit".into()).unwrap();
    assert!(matches!(workspace.upsert_segment_note_if_text(&entry.id, uid, "stale AI".into(), Some(&notes[0].text)), Err(WorkspaceError::SegmentNoteConflict(_))));
    assert_eq!(workspace.read_segment_notes(&entry.id).unwrap()[0].text, "new manual edit");
    fs::remove_dir_all(root).unwrap();
}
