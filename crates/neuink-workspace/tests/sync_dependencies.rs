use neuink_workspace::{
    sync_apply::SyncDocumentChange, sync_export::export_tags, sync_journal::WorkspaceSyncBinding,
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
fn nested_tags_keep_their_ids_and_local_unrelated_tags_and_reject_stale_overwrites() {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    let a = Workspace::create(left.path()).unwrap();
    let b = Workspace::create(right.path()).unwrap();
    b.bind_sync(&binding()).unwrap();
    let parent = a.create_tag("Research", None).unwrap();
    let child = a.create_tag("Methods", Some(parent.id.clone())).unwrap();
    let local = b.create_tag("Local only", None).unwrap();
    let docs = export_tags(left.path()).unwrap();
    let changes = docs
        .iter()
        .map(|d| SyncDocumentChange {
            expected: None,
            target: d.clone(),
        })
        .collect::<Vec<_>>();
    b.apply_sync_tags(&binding(), &changes).unwrap();
    assert!(b.list_tags().unwrap().contains(&child));
    assert!(b.list_tags().unwrap().contains(&parent));
    assert!(b.list_tags().unwrap().contains(&local));
    b.apply_sync_tags(&binding(), &changes).unwrap();
    assert_eq!(b.list_tags().unwrap().len(), 3);
    a.rename_tag(&child.id, "Remote methods").unwrap();
    b.rename_tag(&child.id, "My methods").unwrap();
    let changed = export_tags(left.path())
        .unwrap()
        .into_iter()
        .find(|d| d.entity_id == format!("tag:{}", child.id))
        .unwrap();
    let expected = docs.into_iter().find(|d| d.entity_id == changed.entity_id);
    assert!(b
        .apply_sync_tags(
            &binding(),
            &[SyncDocumentChange {
                expected,
                target: changed
            }]
        )
        .is_err());
    assert_eq!(
        b.list_tags()
            .unwrap()
            .into_iter()
            .find(|t| t.id == child.id)
            .unwrap()
            .name,
        "My methods"
    );
}

#[test]
fn mutually_referencing_papers_and_nested_tags_rebuild_together() {
    use neuink_domain::{ContentItem, PdfParseStatus, SegmentType, SourceSegment};
    use neuink_workspace::sync_export::export_entry;
    use std::collections::BTreeMap;
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    let a = Workspace::create(left.path()).unwrap();
    let b = Workspace::create(right.path()).unwrap();
    b.bind_sync(&binding()).unwrap();
    let tag = a.create_tag("Graph learning", None).unwrap();
    let mut entries = Vec::new();
    for title in ["First paper", "Second paper"] {
        let entry = a.create_entry(title).unwrap();
        a.import_pdf_bytes(
            &entry.id,
            "paper.pdf",
            format!("%PDF-1.4\n%{title}\n%%EOF").as_bytes(),
        )
        .unwrap();
        let segment = SourceSegment::new(
            SegmentType::Paragraph,
            0,
            Some([1., 2., 3., 4.]),
            title.into(),
        );
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
        let entry = a.create_note(&entry.id, "Related method").unwrap();
        let ContentItem::Note { note_id, .. } = &entry.contents[0];
        a.update_entry_meta(&entry.id, title, entry.fields.clone(), vec![tag.id.clone()])
            .unwrap();
        entries.push((entry.id.clone(), note_id.clone(), segment.uid));
    }
    for index in 0..2 {
        let (entry, note, _) = &entries[index];
        let (source, _, uid) = &entries[1 - index];
        let link = a
            .create_note_source_link(entry, note, source, uid.clone())
            .unwrap();
        a.update_note(
            entry,
            note,
            "Related method",
            format!("Compare both methods [^{}]", link.anchor_id),
        )
        .unwrap();
        assert_eq!(
            a.read_note(entry, note).unwrap().links[0].sources[0].entry_id,
            *source
        );
    }
    let tags = export_tags(left.path()).unwrap();
    b.apply_sync_tags(
        &binding(),
        &tags
            .into_iter()
            .map(|d| SyncDocumentChange {
                expected: None,
                target: d,
            })
            .collect::<Vec<_>>(),
    )
    .unwrap();
    let mut updates: BTreeMap<String, Vec<SyncDocumentChange>> = BTreeMap::new();
    for (id, _, _) in &entries {
        let bundle = export_entry(left.path(), id.as_str()).unwrap();
        b.stage_sync_bundle(&binding(), &bundle).unwrap();
        updates.insert(
            id.to_string(),
            bundle
                .manifest()
                .documents
                .iter()
                .map(|d| SyncDocumentChange {
                    expected: None,
                    target: d.clone(),
                })
                .collect(),
        );
    }
    let first_only = BTreeMap::from([(
        entries[0].0.to_string(),
        updates[&entries[0].0.to_string()].clone(),
    )]);
    assert!(b.apply_sync_entries(&binding(), &first_only).is_err());
    assert!(
        b.list_entries().unwrap().is_empty(),
        "missing dependencies must not publish a partial paper"
    );
    b.apply_sync_entries(&binding(), &updates).unwrap();
    for (entry, note, _) in &entries {
        assert_eq!(
            b.read_note(entry, note).unwrap().links,
            a.read_note(entry, note).unwrap().links
        );
        assert_eq!(b.read_entry(entry).unwrap().tags, vec![tag.id.clone()]);
        assert_eq!(
            b.read_segments(entry).unwrap(),
            a.read_segments(entry).unwrap()
        );
    }
    b.apply_sync_entries(&binding(), &updates).unwrap();
    assert_eq!(b.list_entries().unwrap().len(), 2);
}

#[test]
fn a_remote_tag_cycle_is_rejected_before_any_local_tag_changes() {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    let a = Workspace::create(left.path()).unwrap();
    let b = Workspace::create(right.path()).unwrap();
    b.bind_sync(&binding()).unwrap();
    let first = a.create_tag("First", None).unwrap();
    let second = a.create_tag("Second", Some(first.id.clone())).unwrap();
    let mut docs = export_tags(left.path()).unwrap();
    let parent = docs
        .iter_mut()
        .find(|d| d.entity_id == format!("tag:{}", first.id))
        .unwrap();
    parent.payload["tag"]["parent_id"] = serde_json::json!(second.id);
    parent.references = vec![format!("tag:{}", second.id)];
    let changes = docs
        .into_iter()
        .map(|target| SyncDocumentChange {
            expected: None,
            target,
        })
        .collect::<Vec<_>>();
    assert!(b.apply_sync_tags(&binding(), &changes).is_err());
    assert!(b.list_tags().unwrap().is_empty());
}
