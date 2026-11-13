use neuink_domain::ContentItem;
use neuink_workspace::{
    sync_apply::SyncDocumentChange, sync_export::export_entry, sync_journal::WorkspaceSyncBinding,
    Workspace,
};

fn binding() -> WorkspaceSyncBinding {
    WorkspaceSyncBinding {
        server_id: "1".repeat(64),
        account_id: "2".repeat(64),
        library_id: "3".repeat(64),
        epoch: "4".repeat(64),
    }
}

#[test]
fn a_new_workspace_can_read_the_same_note_after_verified_download() {
    let a_dir = tempfile::tempdir().unwrap();
    let b_dir = tempfile::tempdir().unwrap();
    let a = Workspace::create(a_dir.path()).unwrap();
    let b = Workspace::create(b_dir.path()).unwrap();
    b.bind_sync(&binding()).unwrap();
    let entry = a.create_entry("Paper").unwrap();
    let entry = a.create_note(&entry.id, "Evidence").unwrap();
    let ContentItem::Note { note_id, .. } = &entry.contents[0];
    a.update_note(&entry.id, note_id, "Evidence", "A persisted note")
        .unwrap();
    let bundle = export_entry(a_dir.path(), entry.id.as_str()).unwrap();
    b.stage_sync_bundle(&binding(), &bundle).unwrap();
    let changes: Vec<_> = bundle
        .manifest()
        .documents
        .iter()
        .map(|target| SyncDocumentChange {
            expected: None,
            target: target.clone(),
        })
        .collect();
    b.apply_sync_entry(&binding(), entry.id.as_str(), &changes)
        .unwrap();
    assert_eq!(
        b.read_note(&entry.id, note_id).unwrap().markdown,
        "A persisted note"
    );
    assert_eq!(b.read_entry(&entry.id).unwrap().contents, entry.contents);
    // Replaying the same remote operation is safe even after the local write succeeded.
    b.apply_sync_entry(&binding(), entry.id.as_str(), &changes)
        .unwrap();
    assert_eq!(b.list_entries().unwrap().len(), 1);
}

#[test]
fn downloaded_paper_keeps_pdf_images_source_links_and_annotation_coordinates() {
    use neuink_domain::{AnnotationImportance, PdfParseStatus, SegmentType, SourceSegment};
    let a_dir = tempfile::tempdir().unwrap();
    let b_dir = tempfile::tempdir().unwrap();
    let a = Workspace::create(a_dir.path()).unwrap();
    let b = Workspace::create(b_dir.path()).unwrap();
    b.bind_sync(&binding()).unwrap();
    let entry = a.create_entry("Paper with evidence").unwrap();
    let pdf = b"%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\n%%EOF";
    a.import_pdf_bytes(&entry.id, "evidence.pdf", pdf).unwrap();
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(3, 2)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let image_dir = a.layout().entry_mineru_output_dir(&entry.id).join("images");
    std::fs::create_dir_all(&image_dir).unwrap();
    std::fs::write(image_dir.join("figure.png"), png.get_ref()).unwrap();
    let segment = SourceSegment::new(
        SegmentType::Figure,
        2,
        Some([10., 20., 100., 80.]),
        "A figure".into(),
    )
    .with_asset_path(Some("images/figure.png".into()));
    a.write_segments(&entry.id, &[segment.clone()]).unwrap();
    for status in [
        PdfParseStatus::Queued,
        PdfParseStatus::Uploading,
        PdfParseStatus::Uploaded,
        PdfParseStatus::Parsing,
        PdfParseStatus::Succeeded,
    ] {
        a.set_pdf_parse_state(&entry.id, status, None).unwrap();
    }
    let annotations = a
        .create_annotation(
            &entry.id,
            segment.uid.clone(),
            "comment".into(),
            "Useful evidence".into(),
            AnnotationImportance::Important,
        )
        .unwrap();
    let entry = a.create_note(&entry.id, "My evidence").unwrap();
    let ContentItem::Note { note_id, .. } = &entry.contents[0];
    let link = a
        .create_note_source_link(&entry.id, note_id, &entry.id, segment.uid.clone())
        .unwrap();
    a.update_note(
        &entry.id,
        note_id,
        "My evidence",
        format!("Observation [^{}]", link.anchor_id),
    )
    .unwrap();
    let bundle = export_entry(a_dir.path(), entry.id.as_str()).unwrap();
    b.stage_sync_bundle(&binding(), &bundle).unwrap();
    let changes = bundle
        .manifest()
        .documents
        .iter()
        .map(|target| SyncDocumentChange {
            expected: None,
            target: target.clone(),
        })
        .collect::<Vec<_>>();
    b.apply_sync_entry(&binding(), entry.id.as_str(), &changes)
        .unwrap();
    assert_eq!(
        std::fs::read(b.entry_pdf_path(&entry.id).unwrap()).unwrap(),
        pdf
    );
    assert_eq!(b.read_segments(&entry.id).unwrap(), vec![segment]);
    assert_eq!(b.read_annotations(&entry.id).unwrap(), annotations);
    assert_eq!(b.read_note(&entry.id, note_id).unwrap().links[0], link);
    assert_eq!(
        std::fs::read(
            b.layout()
                .entry_mineru_output_dir(&entry.id)
                .join("images/figure.png")
        )
        .unwrap(),
        *png.get_ref()
    );
}

#[test]
fn a_local_edit_after_download_is_not_replaced_by_an_old_projection() {
    let a_dir = tempfile::tempdir().unwrap();
    let b_dir = tempfile::tempdir().unwrap();
    let a = Workspace::create(a_dir.path()).unwrap();
    let b = Workspace::create(b_dir.path()).unwrap();
    b.bind_sync(&binding()).unwrap();
    let entry = a.create_entry("Versions").unwrap();
    let entry = a.create_note(&entry.id, "Note").unwrap();
    let ContentItem::Note { note_id, .. } = &entry.contents[0];
    a.update_note(&entry.id, note_id, "Note", "Base").unwrap();
    let base = export_entry(a_dir.path(), entry.id.as_str()).unwrap();
    b.stage_sync_bundle(&binding(), &base).unwrap();
    b.apply_sync_entry(
        &binding(),
        entry.id.as_str(),
        &base
            .manifest()
            .documents
            .iter()
            .map(|d| SyncDocumentChange {
                expected: None,
                target: d.clone(),
            })
            .collect::<Vec<_>>(),
    )
    .unwrap();
    a.update_note(&entry.id, note_id, "Note", "Remote edit")
        .unwrap();
    let remote = export_entry(a_dir.path(), entry.id.as_str()).unwrap();
    b.stage_sync_bundle(&binding(), &remote).unwrap();
    b.update_note(&entry.id, note_id, "Note", "Local edit during download")
        .unwrap();
    let changes = remote
        .manifest()
        .documents
        .iter()
        .map(|d| SyncDocumentChange {
            expected: base
                .manifest()
                .documents
                .iter()
                .find(|old| old.entity_id == d.entity_id)
                .cloned(),
            target: d.clone(),
        })
        .collect::<Vec<_>>();
    assert!(b
        .apply_sync_entry(&binding(), entry.id.as_str(), &changes)
        .unwrap_err()
        .contains("本地内容已改变"));
    assert_eq!(
        b.read_note(&entry.id, note_id).unwrap().markdown,
        "Local edit during download"
    );
}

#[test]
fn corrupt_download_and_wrong_account_cannot_publish_an_entry() {
    let a_dir = tempfile::tempdir().unwrap();
    let b_dir = tempfile::tempdir().unwrap();
    let a = Workspace::create(a_dir.path()).unwrap();
    let b = Workspace::create(b_dir.path()).unwrap();
    b.bind_sync(&binding()).unwrap();
    let entry = a.create_entry("Protected").unwrap();
    let entry = a.create_note(&entry.id, "Note").unwrap();
    let bundle = export_entry(a_dir.path(), entry.id.as_str()).unwrap();
    b.stage_sync_bundle(&binding(), &bundle).unwrap();
    let resource = bundle
        .manifest()
        .documents
        .iter()
        .flat_map(|d| &d.resources)
        .find(|r| r.name == "note.json")
        .unwrap();
    let blob = b.sync_blob_path(&binding(), &resource.hash).unwrap();
    std::fs::write(&blob, vec![b'x'; resource.size as usize]).unwrap();
    let changes = bundle
        .manifest()
        .documents
        .iter()
        .map(|d| SyncDocumentChange {
            expected: None,
            target: d.clone(),
        })
        .collect::<Vec<_>>();
    assert!(b
        .apply_sync_entry(&binding(), entry.id.as_str(), &changes)
        .is_err());
    assert!(b.list_entries().unwrap().is_empty());
    let download = b.prepare_sync_download(&binding(), resource).unwrap();
    assert!(!download.exists());
    b.stage_sync_bundle(&binding(), &bundle).unwrap();
    let mut other = binding();
    other.account_id = "5".repeat(64);
    assert!(b
        .apply_sync_entry(&other, entry.id.as_str(), &changes)
        .is_err());
    b.apply_sync_entry(&binding(), entry.id.as_str(), &changes)
        .unwrap();
    assert_eq!(b.list_entries().unwrap().len(), 1);
}

#[test]
fn a_download_cannot_implicitly_restore_an_entry_from_the_recycle_bin() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    workspace.bind_sync(&binding()).unwrap();
    let entry = workspace.create_entry("Explicit restore only").unwrap();
    let bundle = export_entry(dir.path(), entry.id.as_str()).unwrap();
    workspace.stage_sync_bundle(&binding(), &bundle).unwrap();
    let changes = bundle
        .manifest()
        .documents
        .iter()
        .map(|target| SyncDocumentChange {
            expected: None,
            target: target.clone(),
        })
        .collect::<Vec<_>>();
    workspace.delete_entry(&entry.id).unwrap();
    assert!(workspace
        .apply_sync_entry(&binding(), entry.id.as_str(), &changes)
        .is_err());
    assert!(workspace.list_entries().unwrap().is_empty());
    assert!(workspace.layout().trashed_entry_dir(&entry.id).exists());
    workspace.restore_entry(&entry.id).unwrap();
    workspace
        .apply_sync_entry(&binding(), entry.id.as_str(), &changes)
        .unwrap();
}

#[test]
fn reopening_replays_a_partly_published_download_without_replacing_newer_edits() {
    use serde_json::json;
    for externally_edited in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        workspace.bind_sync(&binding()).unwrap();
        let entry = workspace.create_entry("Original paper").unwrap();
        let entry = workspace.create_note(&entry.id, "Note").unwrap();
        let ContentItem::Note { note_id, .. } = &entry.contents[0];
        let before_events = workspace.pending_content_events().unwrap().len();
        let note_path = workspace.layout().entry_note_file(&entry.id, note_id);
        let meta_path = workspace.layout().entry_meta_file(&entry.id);
        let mut metadata = entry.clone();
        metadata.title = "Recovered paper".into();
        let targets = [
            (
                format!("entries/{}/notes/{}.md", entry.id, note_id),
                b"Recovered body".to_vec(),
            ),
            (
                format!("entries/{}/entry.meta.json", entry.id),
                serde_json::to_vec(&metadata).unwrap(),
            ),
        ];
        let mut changes = Vec::new();
        for (relative, after) in &targets {
            let before = blake3::hash(&std::fs::read(dir.path().join(relative)).unwrap())
                .to_hex()
                .to_string();
            let hash = blake3::hash(after).to_hex().to_string();
            std::fs::write(workspace.sync_blob_path(&binding(), &hash).unwrap(), after).unwrap();
            changes
                .push(json!({"relative":relative,"before":before,"hash":hash,"size":after.len()}));
        }
        std::fs::write(
            dir.path().join("sync-apply.journal.json"),
            serde_json::to_vec(&json!({"version":1,"binding":binding(),"changes":changes}))
                .unwrap(),
        )
        .unwrap();
        // Simulated crash after the first file was fsynced, before catalog publication.
        std::fs::write(&note_path, &targets[0].1).unwrap();
        if externally_edited {
            let mut local = entry.clone();
            local.title = "External edit".into();
            std::fs::write(&meta_path, serde_json::to_vec(&local).unwrap()).unwrap();
            assert!(Workspace::open_existing(dir.path()).is_err());
            assert_eq!(
                workspace.read_entry(&entry.id).unwrap().title,
                "External edit"
            );
        } else {
            let reopened = Workspace::open_existing(dir.path()).unwrap();
            assert_eq!(
                reopened.read_entry(&entry.id).unwrap().title,
                "Recovered paper"
            );
            assert_eq!(
                reopened.read_note(&entry.id, note_id).unwrap().markdown,
                "Recovered body"
            );
            assert_eq!(
                reopened.pending_content_events().unwrap().len(),
                before_events
            );
        }
    }
}

#[test]
fn independent_sentence_translations_roundtrip_and_keep_concurrent_edits() {
    use neuink_domain::{SegmentType, SourceSegment};
    use neuink_workspace::sentence_translation::SavedSentenceTranslation;
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    let a = Workspace::create(left.path()).unwrap();
    let b = Workspace::create(right.path()).unwrap();
    a.bind_sync(&binding()).unwrap();
    b.bind_sync(&binding()).unwrap();
    let entry = a.create_entry("Sentence translation").unwrap();
    let segment = SourceSegment::new(
        SegmentType::Paragraph,
        0,
        None,
        "前缀。 First. Second.".into(),
    );
    a.write_segments(&entry.id, &[segment.clone()]).unwrap();
    let mut record = SavedSentenceTranslation {
        segment_uid: segment.uid.to_string(),
        paragraph_source: segment.text.clone(),
        source: "First.".into(),
        source_start: "前缀。 ".len(),
        translation: "人工修订后的第一句。".into(),
    };
    a.save_sentence_translation(&entry.id, record.clone(), None)
        .unwrap();
    use neuink_workspace::paragraph_translation::{
        ParagraphRequestStatus, ParagraphTranslation, ParagraphView, SentenceTranslation,
        TranslationPart,
    };
    a.update_paragraph_translation(&entry.id, &segment.uid, |_| {
        Ok(ParagraphTranslation {
            segment_uid: segment.uid.clone(),
            source_text: segment.text.clone(),
            source_hash: "saved-source-hash".into(),
            job_id: "local-task-id".into(),
            model: "local-model-label".into(),
            view: ParagraphView::Sentences,
            paragraph: TranslationPart {
                status: ParagraphRequestStatus::Failed,
                value: Some("原有整段结果".into()),
                error: Some("private service diagnostic".into()),
                timing: None,
            },
            sentences: TranslationPart {
                status: ParagraphRequestStatus::Succeeded,
                value: Some(vec![SentenceTranslation {
                    id: 1,
                    source: "First.".into(),
                    translation: "历史逐句结果".into(),
                }]),
                error: None,
                timing: None,
            },
        })
    })
    .unwrap();

    let bundle = export_entry(left.path(), entry.id.as_str()).unwrap();
    let previous = bundle
        .manifest()
        .documents
        .iter()
        .find(|document| document.entity_id.starts_with("sentence-translation:"))
        .unwrap()
        .clone();
    b.stage_sync_bundle(&binding(), &bundle).unwrap();
    let changes = bundle
        .manifest()
        .documents
        .iter()
        .map(|target| SyncDocumentChange {
            expected: None,
            target: target.clone(),
        })
        .collect::<Vec<_>>();
    b.apply_sync_entry(&binding(), entry.id.as_str(), &changes)
        .unwrap();
    assert_eq!(
        b.read_sentence_translations(&entry.id).unwrap(),
        a.read_sentence_translations(&entry.id).unwrap()
    );
    let legacy = b
        .read_paragraph_translations(&entry.id)
        .unwrap()
        .remove(segment.uid.as_str())
        .unwrap();
    assert_eq!(legacy.paragraph.value.as_deref(), Some("原有整段结果"));
    assert_eq!(
        legacy.sentences.value.unwrap()[0].translation,
        "历史逐句结果"
    );
    assert!(legacy.job_id.is_empty());
    assert!(legacy.paragraph.error.is_none());
    assert_eq!(legacy.paragraph.status, ParagraphRequestStatus::Succeeded);

    let original = record.translation.clone();
    record.translation = "另一设备的修订。".into();
    b.save_sentence_translation(&entry.id, record.clone(), Some(original.clone()))
        .unwrap();
    let local = b.read_sentence_translations(&entry.id).unwrap();
    record.translation = "第一台设备的新修订。".into();
    a.save_sentence_translation(&entry.id, record, Some(original))
        .unwrap();
    let changed = export_entry(left.path(), entry.id.as_str()).unwrap();
    b.stage_sync_bundle(&binding(), &changed).unwrap();
    let target = changed
        .manifest()
        .documents
        .iter()
        .find(|d| d.entity_id == previous.entity_id)
        .unwrap()
        .clone();
    assert!(b
        .apply_sync_entry(
            &binding(),
            entry.id.as_str(),
            &[SyncDocumentChange {
                expected: Some(previous),
                target,
            }]
        )
        .is_err());
    assert_eq!(b.read_sentence_translations(&entry.id).unwrap(), local);
    assert!(a.pending_content_events().unwrap().iter().any(|event| event
        .affected_entities()
        .unwrap()
        .contains(&format!("sentence-translation:{}", entry.id))));
}
