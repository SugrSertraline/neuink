use neuink_domain::{SegmentType, SourceSegment};
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
fn downloaded_snapshot_contains_the_images_the_reader_actually_displays() {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    let a = Workspace::create(left.path()).unwrap();
    let b = Workspace::create(right.path()).unwrap();
    b.bind_sync(&binding()).unwrap();
    let entry = a.create_entry("Enriched paper").unwrap();
    let segment = SourceSegment::new(
        SegmentType::Figure,
        2,
        Some([10., 20., 300., 400.]),
        "Figure caption".into(),
    );
    a.write_segments(&entry.id, &[segment.clone()]).unwrap();
    let output = a.layout().entry_mineru_output_dir(&entry.id);
    std::fs::create_dir_all(output.join("images")).unwrap();
    std::fs::write(output.join("images/figure.png"), b"unchanged image bytes").unwrap();
    let original = br#"[{"type":"image","page_idx":2,"bbox":[10,20,300,400],"img_path":"images/figure.png","image_caption":["Figure caption"],"api_key":"must-stay-local"}]"#;
    std::fs::write(output.join("paper_content_list.json"), original).unwrap();
    a.upsert_segment_note(&entry.id, segment.uid.clone(), "My interpretation".into())
        .unwrap();
    a.set_segment_note_bookmark(&entry.id, segment.uid.clone(), true)
        .unwrap();
    let expected = a.read_segments(&entry.id).unwrap();
    assert_eq!(expected[0].asset_path.as_deref(), Some("images/figure.png"));
    let bundle = export_entry(left.path(), entry.id.as_str()).unwrap();
    let repeated = export_entry(left.path(), entry.id.as_str()).unwrap();
    assert_eq!(
        bundle.manifest().documents,
        repeated.manifest().documents,
        "unchanged reading content has stable IDs and hashes"
    );
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
    assert_eq!(b.read_segments(&entry.id).unwrap(), expected);
    assert_eq!(
        b.read_segment_notes(&entry.id).unwrap(),
        a.read_segment_notes(&entry.id).unwrap()
    );
    assert_eq!(b.read_segments(&entry.id).unwrap()[0].uid, segment.uid);
    assert_eq!(
        std::fs::read(
            b.layout()
                .entry_mineru_output_dir(&entry.id)
                .join("images/figure.png")
        )
        .unwrap(),
        b"unchanged image bytes"
    );
    assert!(!b
        .layout()
        .entry_mineru_output_dir(&entry.id)
        .join("paper_content_list.json")
        .exists());
    assert_eq!(
        std::fs::read(output.join("paper_content_list.json")).unwrap(),
        original
    );
    std::fs::write(output.join("paper_content_list_v2.json"), b"[]").unwrap();
    assert!(
        bundle.verify_unchanged().is_err(),
        "a new supplementary file invalidates the frozen snapshot"
    );
}

#[test]
fn middle_derived_caption_coordinates_survive_and_stale_local_raw_data_is_not_reapplied() {
    use neuink_domain::NeuinkDocument;
    use serde_json::json;
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    let a = Workspace::create(left.path()).unwrap();
    let b = Workspace::create(right.path()).unwrap();
    b.bind_sync(&binding()).unwrap();
    let entry = a.create_entry("Caption geometry").unwrap();
    let caption = SourceSegment::new(SegmentType::Paragraph, 0, None, "Figure 1: Evidence".into())
        .with_mineru_metadata(Some("image".into()), None, Some("caption".into()));
    a.write_segments(&entry.id, &[caption.clone()]).unwrap();
    let output = a.layout().entry_mineru_output_dir(&entry.id);
    std::fs::create_dir_all(&output).unwrap();
    let middle = json!({"pdf_info":[{"page_idx":0,"page_size":[1000,1000],"para_blocks":[{"bbox":[10,20,100,30],"type":"image_caption","lines":[{"spans":[{"content":"Figure 1: Evidence","type":"text"}]}]}]}]});
    std::fs::write(
        output.join("paper_middle.json"),
        serde_json::to_vec(&middle).unwrap(),
    )
    .unwrap();
    let mut expected = NeuinkDocument::new(a.read_segments(&entry.id).unwrap());
    neuink_parser::enrich_document_with_middle(&mut expected, &middle);
    assert_eq!(expected.segments[0].bbox, Some([10., 20., 100., 30.]));
    let bundle = export_entry(left.path(), entry.id.as_str()).unwrap();
    let repeated = export_entry(left.path(), entry.id.as_str()).unwrap();
    assert_eq!(
        bundle.manifest().documents,
        repeated.manifest().documents,
        "unchanged reading content has stable IDs and hashes"
    );
    b.stage_sync_bundle(&binding(), &bundle).unwrap();
    let target = b.layout().entry_mineru_output_dir(&entry.id);
    std::fs::create_dir_all(&target).unwrap();
    std::fs::write(target.join("paper_middle.json"), b"{\"pdf_info\":[]}").unwrap();
    let changes = bundle
        .manifest()
        .documents
        .iter()
        .map(|d| SyncDocumentChange {
            expected: None,
            target: d.clone(),
        })
        .collect::<Vec<_>>();
    b.apply_sync_entry(&binding(), entry.id.as_str(), &changes)
        .unwrap();
    assert_eq!(b.read_segments(&entry.id).unwrap(), expected.segments);
    assert!(b.read_mineru_middle_json(&entry.id).unwrap().is_none());
    b.write_segments(&entry.id, &[caption]).unwrap();
    assert!(
        b.read_mineru_middle_json(&entry.id).unwrap().is_some(),
        "new local parsing invalidates the normalized marker"
    );
}

#[test]
fn reading_detail_and_its_translation_roundtrip_without_generation() {
    use neuink_workspace::folding::{FoldRecord, FoldTranslation};
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    let a = Workspace::create(left.path()).unwrap();
    let b = Workspace::create(right.path()).unwrap();
    b.bind_sync(&binding()).unwrap();
    let entry = a.create_entry("Fold results").unwrap();
    let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "First. Second.".into());
    a.write_segments(&entry.id, &[segment.clone()]).unwrap();
    a.upsert_entry_folds(
        &entry.id,
        vec![FoldRecord {
            segment_uid: segment.uid.to_string(),
            source: segment.text.clone(),
            evidence: vec![0],
            brief: vec!["First.".into()],
            key: "First. Reason.".into(),
            takeaway: "First.".into(),
            topic: "First".into(),
            model: "test".into(),
            generated_at: "2026-01-01".into(),
            translations: Default::default(),
        }],
    )
    .unwrap();
    a.save_fold_translation(
        &entry.id,
        segment.uid.as_str(),
        "takeaway",
        FoldTranslation {
            source_text: "First.".into(),
            translated_text: "第一。".into(),
            model: "test".into(),
            generated_at: "2026-01-01".into(),
        },
    )
    .unwrap();
    let bundle = export_entry(left.path(), entry.id.as_str()).unwrap();
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
        b.read_entry_folds(&entry.id).unwrap(),
        a.read_entry_folds(&entry.id).unwrap()
    );
    b.apply_sync_entry(&binding(), entry.id.as_str(), &changes)
        .unwrap();
    assert_eq!(b.read_entry_folds(&entry.id).unwrap().len(), 1);
}

#[test]
fn saved_translation_downloads_without_running_tasks_or_error_details() {
    use serde_json::json;
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    let a = Workspace::create(left.path()).unwrap();
    let b = Workspace::create(right.path()).unwrap();
    b.bind_sync(&binding()).unwrap();
    let entry = a.create_entry("Translated paper").unwrap();
    let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "Evidence".into());
    a.write_segments(&entry.id, &[segment.clone()]).unwrap();
    let now = "2026-11-09T00:00:00Z";
    let translation:neuink_workspace::EntryTranslation=serde_json::from_value(json!({"schema_version":1,"entry_id":entry.id,"source_language":"en","target_language":"zh","status":"running","progress":{"total":1,"translated":0,"skipped":0,"failed":1},"paper_context":null,"model":"configured-model","error":"private runtime error","created_at":now,"updated_at":now,"task":{"job_id":"private-job","profile_id":"private-profile","force":false,"source_hashes":{},"remaining_segment_uids":[],"created_at":now},"segments":[{"segment_uid":segment.uid,"page_idx":0,"segment_type":"paragraph","source_hash":"content-hash","source_text":"Evidence","translated_text":"证据","status":"translated","error":"private error","updated_at":now}]})).unwrap();
    a.write_entry_translation(&entry.id, &translation).unwrap();
    let bundle = export_entry(left.path(), entry.id.as_str()).unwrap();
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
    let saved = b.read_entry_translation(&entry.id).unwrap().unwrap();
    assert!(saved.task.is_none());
    assert!(saved.error.is_none());
    assert!(saved.segments[0].error.is_none());
    assert_eq!(saved.segments[0].translated_text.as_deref(), Some("证据"));
    assert_eq!(saved.progress.translated, 1);
    assert!(a
        .read_entry_translation(&entry.id)
        .unwrap()
        .unwrap()
        .task
        .is_some());
}
