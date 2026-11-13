use neuink_domain::{AnnotationImportance, PdfParseStatus, SegmentType, SourceSegment};
use neuink_sync_protocol::ObjectKind;
use neuink_workspace::{
    sync_apply::SyncDocumentChange, sync_export::export_entry, sync_journal::WorkspaceSyncBinding,
    Workspace,
};
use std::collections::BTreeMap;

#[test]
fn child_collection_deletion_replays_and_restores_last_and_remaining_members() {
    for count in [1, 2] {
        let da = tempfile::tempdir().unwrap();
        let db = tempfile::tempdir().unwrap();
        let a = Workspace::create(da.path()).unwrap();
        let b = Workspace::create(db.path()).unwrap();
        let binding = WorkspaceSyncBinding {
            server_id: "1".repeat(64),
            account_id: "2".repeat(64),
            library_id: "3".repeat(64),
            epoch: "4".repeat(64),
        };
        b.bind_sync(&binding).unwrap();
        let entry = a.create_entry("Collection deletion").unwrap();
        a.import_pdf_bytes(
            &entry.id,
            "paper.pdf",
            b"%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\n%%EOF",
        )
        .unwrap();
        let segments = (0..count)
            .map(|i| SourceSegment::new(SegmentType::Paragraph, i, None, format!("Paragraph {i}")))
            .collect::<Vec<_>>();
        a.write_segments(&entry.id, &segments).unwrap();
        for status in [
            PdfParseStatus::Queued,
            PdfParseStatus::Uploading,
            PdfParseStatus::Uploaded,
            PdfParseStatus::Parsing,
            PdfParseStatus::Succeeded,
        ] {
            a.set_pdf_parse_state(&entry.id, status, None).unwrap();
        }
        for segment in &segments {
            a.create_annotation(
                &entry.id,
                segment.uid.clone(),
                "comment".into(),
                "Saved annotation".into(),
                AnnotationImportance::Normal,
            )
            .unwrap();
            a.upsert_segment_note(&entry.id, segment.uid.clone(), "Saved thought".into())
                .unwrap();
        }
        let bundle = export_entry(da.path(), entry.id.as_str()).unwrap();
        b.stage_sync_bundle(&binding, &bundle).unwrap();
        let changes = bundle
            .manifest()
            .documents
            .iter()
            .map(|target| SyncDocumentChange {
                expected: None,
                target: target.clone(),
            })
            .collect::<Vec<_>>();
        b.apply_sync_entry(&binding, entry.id.as_str(), &changes)
            .unwrap();
        let deleted = bundle
            .manifest()
            .documents
            .iter()
            .filter(|d| {
                matches!(d.kind, ObjectKind::Annotation | ObjectKind::SegmentNote)
                    && d.payload[if d.kind == ObjectKind::Annotation {
                        "annotation"
                    } else {
                        "note"
                    }]["segment_uid"]
                        == serde_json::to_value(&segments[0].uid).unwrap()
            })
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(deleted.len(), 2);
        let deletions = BTreeMap::from([(entry.id.to_string(), deleted.clone())]);
        for _ in 0..2 {
            b.apply_sync_entries_with_deletions(&binding, &BTreeMap::new(), &deletions)
                .unwrap();
        }
        assert_eq!(
            b.read_annotations(&entry.id).unwrap().len(),
            count as usize - 1
        );
        assert_eq!(
            b.read_segment_notes(&entry.id).unwrap().len(),
            count as usize - 1
        );
        assert_eq!(b.list_entry_trash_items(&entry.id).unwrap().len(), 2);
        let restores = deleted
            .into_iter()
            .map(|target| SyncDocumentChange {
                expected: None,
                target,
            })
            .collect::<Vec<_>>();
        b.apply_sync_entry(&binding, entry.id.as_str(), &restores)
            .unwrap();
        assert_eq!(b.read_annotations(&entry.id).unwrap().len(), count as usize);
        assert_eq!(
            b.read_segment_notes(&entry.id).unwrap().len(),
            count as usize
        );
        assert!(b.list_entry_trash_items(&entry.id).unwrap().is_empty());
    }
}
