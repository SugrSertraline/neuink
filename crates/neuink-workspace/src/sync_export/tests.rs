use super::*;
use neuink_domain::{EntryId, LinkOwner, SegmentType, SourceLink, SourceSegment};
use std::fs;
#[path = "fixtures.rs"]
mod fixtures;
use fixtures::{content, write, Fixture};

#[test]
fn exports_real_workspace_shapes_with_stable_ids_and_atomic_note_content() {
    let fixture = Fixture::new();
    let bundle = fixture.export();
    assert_eq!(bundle.manifest.documents.len(), 4);
    let note = bundle
        .manifest
        .documents
        .iter()
        .find(|d| d.kind == ObjectKind::Note)
        .unwrap();
    let value = content(&bundle, note, "note.json");
    assert_eq!(value["note_id"], fixture.note_id.to_string());
    assert!(value["markdown"].as_str().unwrap().starts_with("My note"));
    assert_eq!(
        value["links"][0]["link_id"],
        fixture.link.link_id.to_string()
    );
    assert_eq!(
        value["links"][0]["sources"][0]["segment_uid"],
        fixture.segment.uid.to_string()
    );
    let snapshot = bundle
        .manifest
        .documents
        .iter()
        .find(|d| d.kind == ObjectKind::ParseSnapshot)
        .unwrap();
    let segments = content(&bundle, snapshot, "segments.json");
    assert_eq!(
        segments["segments"][0]["uid"],
        fixture.segment.uid.to_string()
    );
    assert_eq!(segments["segments"][0]["bbox"], json!([1., 2., 30., 40.]));
    let annotation = bundle
        .manifest
        .documents
        .iter()
        .find(|d| d.kind == ObjectKind::Annotation)
        .unwrap();
    assert_eq!(
        annotation.payload["annotation"]["annotation_id"],
        fixture.annotation.annotation_id.to_string()
    );
    assert!(bundle.manifest.unique_attachment_bytes < bundle.manifest.attachment_bytes);
    assert_eq!(
        serde_json::to_value(&bundle.manifest).unwrap(),
        serde_json::to_value(&fixture.export().manifest).unwrap()
    );
}

#[test]
fn serialization_excludes_host_paths_tasks_settings_and_raw_provider_metadata() {
    let fixture = Fixture::new();
    let bundle = fixture.export();
    let mut wire = serde_json::to_string(&bundle.manifest).unwrap();
    for document in &bundle.manifest.documents {
        for resource in &document.resources {
            wire.push_str(&String::from_utf8_lossy(
                &bundle.attachment_bytes(&resource.hash).unwrap(),
            ));
        }
    }
    for secret in [
        "D:\\private",
        "private log",
        "secret task",
        "parser.invalid",
        "private_key",
        "never upload",
        "chat history",
        fixture.dir.path().to_str().unwrap(),
    ] {
        assert!(!wire.contains(secret), "leaked {secret}");
    }
    assert!(fixture.path("mineru-output/full.zip").is_file());
    let entry = bundle
        .manifest
        .documents
        .iter()
        .find(|d| d.kind == ObjectKind::Entry)
        .unwrap();
    assert_eq!(
        entry.payload["entry"]["pdf"]["parse"]["status"],
        "succeeded"
    );
}

#[test]
fn resources_rebuild_snapshot_and_note_without_original_zip_or_generated_ids() {
    let fixture = Fixture::new();
    let bundle = fixture.export();
    let receiver = tempfile::tempdir().unwrap();
    for document in &bundle.manifest.documents {
        for resource in &document.resources {
            let bytes = bundle.attachment_bytes(&resource.hash).unwrap();
            assert_eq!(blake3::hash(&bytes).to_hex().as_str(), resource.hash);
            if resource.name.starts_with("entries/") {
                write(receiver.path(), &resource.name, bytes);
            }
        }
        if document.kind == ObjectKind::ParseSnapshot {
            let snapshot = content(&bundle, document, "segments.json");
            let restored: Vec<SourceSegment> =
                serde_json::from_value(snapshot["segments"].clone()).unwrap();
            assert_eq!(restored[0].uid, fixture.segment.uid);
            assert!(receiver
                .path()
                .join(format!(
                    "entries/{}/mineru-output/{}",
                    fixture.entry.id,
                    restored[0].asset_path.as_ref().unwrap()
                ))
                .is_file());
        }
        if document.kind == ObjectKind::Note {
            let restored = content(&bundle, document, "note.json");
            let links: Vec<SourceLink> = serde_json::from_value(restored["links"].clone()).unwrap();
            assert_eq!(links, vec![fixture.link.clone()]);
        }
    }
}

#[test]
fn missing_image_or_pdf_blocks_export_and_keeps_recovery_package() {
    for path in ["mineru-output/images/result.png", "paper.pdf"] {
        let fixture = Fixture::new();
        fs::remove_file(fixture.path(path)).unwrap();
        assert!(export_entry(fixture.dir.path(), fixture.entry.id.as_str()).is_err());
        assert!(fixture.path("mineru-output/full.zip").is_file());
    }
}

#[test]
fn refuses_corrupt_snapshot_duplicate_ids_and_misowned_links() {
    let mut fixture = Fixture::new();
    fs::write(fixture.path("paper.segments.json"), b"{}").unwrap();
    assert!(export_entry(fixture.dir.path(), fixture.entry.id.as_str()).is_err());
    fs::write(
        fixture.path("paper.segments.json"),
        serde_json::to_vec(&vec![fixture.segment.clone(), fixture.segment.clone()]).unwrap(),
    )
    .unwrap();
    assert!(export_entry(fixture.dir.path(), fixture.entry.id.as_str()).is_err());
    fixture.link.owner = LinkOwner::Note {
        entry_id: EntryId::new(),
        note_id: fixture.note_id.clone(),
    };
    fixture.save();
    assert!(export_entry(fixture.dir.path(), fixture.entry.id.as_str()).is_err());
}

#[test]
fn revalidation_detects_changed_or_new_files_including_missing_sidecar() {
    let fixture = Fixture::new();
    let bundle = fixture.export();
    fs::write(fixture.path("paper.pdf"), b"changed").unwrap();
    assert!(bundle.verify_unchanged().is_err());
    let pdf = bundle
        .manifest
        .documents
        .iter()
        .flat_map(|d| &d.resources)
        .find(|r| r.name == "paper.pdf")
        .unwrap();
    assert!(bundle.attachment_bytes(&pdf.hash).is_err());
    fixture.save();
    fs::remove_file(fixture.path(&format!("notes/{}.links.json", fixture.note_id))).unwrap();
    let without_links = fixture.export();
    fs::write(
        fixture.path(&format!("notes/{}.links.json", fixture.note_id)),
        b"[]",
    )
    .unwrap();
    assert!(without_links.verify_unchanged().is_err());
}

#[test]
fn pending_transaction_blocks_export_without_running_recovery() {
    let fixture = Fixture::new();
    write(
        fixture.dir.path(),
        "content-operation.journal.json",
        b"pending",
    );
    assert!(export_entry(fixture.dir.path(), fixture.entry.id.as_str()).is_err());
    assert_eq!(
        fs::read(fixture.dir.path().join("content-operation.journal.json")).unwrap(),
        b"pending"
    );
}

#[test]
fn rejects_absolute_and_parent_traversal_in_assets_and_entity_ids() {
    let mut fixture = Fixture::new();
    for path in [
        "../private.png",
        "D:/private.png",
        "file:///private.png",
        "a/CON.png",
        "images/a?.png",
    ] {
        fixture.segment.asset_path = Some(path.into());
        fixture.save();
        assert!(
            export_entry(fixture.dir.path(), fixture.entry.id.as_str()).is_err(),
            "{path}"
        );
    }
    assert!(export_entry(fixture.dir.path(), "../private").is_err());
}

#[test]
fn cross_entry_sources_remain_explicit_and_missing_external_images_are_reported() {
    let mut fixture = Fixture::new();
    let other = EntryId::new();
    fixture.link.sources[0].entry_id = other.clone();
    fixture.link.sources[0].snapshot_asset_path = None;
    fixture.save();
    let bundle = fixture.export();
    let note = bundle
        .manifest
        .documents
        .iter()
        .find(|d| d.kind == ObjectKind::Note)
        .unwrap();
    assert!(note.references.contains(&entity("entry", other.as_str())));
    assert!(bundle
        .manifest
        .required_entities
        .contains(&entity("entry", other.as_str())));
    let path = fixture.path(&format!("notes/{}.md", fixture.note_id));
    fs::write(path, "![external](https://example.invalid/figure.png)").unwrap();
    assert!(fixture
        .export()
        .manifest
        .notices
        .iter()
        .any(|n| n.code == "external_image"));
}

#[test]
fn discovers_html_and_reference_style_note_images_without_uploading_unreferenced_files() {
    let fixture = Fixture::new();
    fs::write(fixture.path(&format!("notes/{}.md", fixture.note_id)), format!("![figure][img]\n\n[img]: ./{0}.assets/figure.png\n\n<img src=\"./{0}.assets/figure.png\">", fixture.note_id)).unwrap();
    write(
        fixture.dir.path(),
        &format!(
            "entries/{}/notes/{}.assets/unused.png",
            fixture.entry.id, fixture.note_id
        ),
        b"unused",
    );
    let bundle = fixture.export();
    let note = bundle
        .manifest
        .documents
        .iter()
        .find(|d| d.kind == ObjectKind::Note)
        .unwrap();
    assert_eq!(
        note.resources
            .iter()
            .filter(|r| r.name.contains(".assets/"))
            .count(),
        1
    );
    assert!(!serde_json::to_string(&bundle.manifest)
        .unwrap()
        .contains("unused.png"));
}

#[test]
fn list_item_coordinates_and_reader_metadata_survive_without_provider_configuration() {
    let mut fixture = Fixture::new();
    fixture.segment.segment_type = SegmentType::List;
    fixture
        .segment
        .mineru_metadata
        .insert("level".into(), "1".into());
    fixture.segment.mineru_metadata.insert(
        "list_item_regions".into(),
        json!([
            {"text":"first", "bbox":[1,2,20,10], "page_idx":2, "provider_token":"do not export"},
            {"text":"second", "bbox":[1,12,20,20]}
        ])
        .to_string(),
    );
    fixture.save();
    let original = neuink_domain::list_item_segments(&fixture.segment);
    let bundle = fixture.export();
    let snapshot = bundle
        .manifest
        .documents
        .iter()
        .find(|d| d.kind == ObjectKind::ParseSnapshot)
        .unwrap();
    let value = content(&bundle, snapshot, "segments.json");
    let restored: Vec<SourceSegment> = serde_json::from_value(value["segments"].clone()).unwrap();
    assert_eq!(restored[0].mineru_metadata["level"], "1");
    assert!(!serde_json::to_string(&value)
        .unwrap()
        .contains("provider_token"));
    for (before, after) in original
        .iter()
        .zip(neuink_domain::list_item_segments(&restored[0]))
    {
        assert_eq!(
            (
                before.uid.clone(),
                before.bbox,
                before.page_idx,
                before.text.clone()
            ),
            (after.uid, after.bbox, after.page_idx, after.text)
        );
    }
}

#[test]
fn bounded_attachment_reads_support_resume_and_refuse_invalid_ranges() {
    let fixture = Fixture::new();
    let bundle = fixture.export();
    for resource in bundle.manifest.documents.iter().flat_map(|d| &d.resources) {
        let bytes = bundle.attachment_bytes(&resource.hash).unwrap();
        let mut restored = Vec::new();
        while restored.len() < bytes.len() {
            restored.extend(
                bundle
                    .attachment_chunk(&resource.hash, restored.len() as u64, 17)
                    .unwrap(),
            );
        }
        assert_eq!(restored, bytes);
        assert!(bundle
            .attachment_chunk(&resource.hash, resource.size, 17)
            .unwrap()
            .is_empty());
        assert!(bundle
            .attachment_chunk(&resource.hash, resource.size + 1, 17)
            .is_err());
        assert!(bundle.attachment_chunk(&resource.hash, 0, 0).is_err());
        assert!(bundle
            .attachment_chunk(&resource.hash, 0, 4 * 1024 * 1024 + 1)
            .is_err());
    }
}

#[test]
fn rejects_html_host_links_and_disguised_configuration_resources() {
    let mut fixture = Fixture::new();
    fs::write(
        fixture.path(&format!("notes/{}.md", fixture.note_id)),
        "<a href=\"file:///D:/secret.txt\">local file</a>",
    )
    .unwrap();
    assert!(export_entry(fixture.dir.path(), fixture.entry.id.as_str()).is_err());
    fixture.segment.asset_path = Some("settings.json".into());
    fixture.save();
    fs::write(fixture.path("mineru-output/settings.json"), b"private key").unwrap();
    assert!(export_entry(fixture.dir.path(), fixture.entry.id.as_str()).is_err());
}

#[test]
fn preview_reports_one_failed_entry_without_losing_valid_entry_results() {
    let fixture = Fixture::new();
    write(
        fixture.dir.path(),
        "entries/damaged/entry.meta.json",
        b"corrupt",
    );
    let report = crate::sync_inventory::preview(fixture.dir.path()).unwrap();
    assert_eq!(report.entries.len(), 2);
    assert_eq!(report.validated_entities, 4);
    assert_eq!(
        report.entries.iter().filter(|e| e.issue.is_some()).count(),
        1
    );
    assert_eq!(
        report.validated_attachment_bytes,
        fixture.export().manifest.unique_attachment_bytes
    );
    assert!(report.files.iter().any(|f| f.path.ends_with("full.zip")));
}

#[test]
fn recovers_legacy_directory_image_reference_without_rewriting_original() {
    let mut fixture = Fixture::new();
    fixture.segment.asset_path = Some("images/".into());
    fixture.segment.text = "images/".into();
    fixture.save();
    let original = fs::read(fixture.path("paper.segments.json")).unwrap();
    write(fixture.dir.path(), &format!("entries/{}/mineru-output/paper_middle.json", fixture.entry.id),
        serde_json::to_vec(&json!({"pdf_info":[{"page_idx":2,"page_size":[1000,1000],"preproc_blocks":[{"type":"image","bbox":[1,2,30,40],"blocks":[{"image_path":"result.png"}]}]}]})).unwrap());
    let bundle = fixture.export();
    let snapshot = bundle
        .manifest
        .documents
        .iter()
        .find(|d| d.kind == ObjectKind::ParseSnapshot)
        .unwrap();
    let value = content(&bundle, snapshot, "segments.json");
    assert_eq!(value["segments"][0]["asset_path"], "images/result.png");
    assert_eq!(value["segments"][0]["uid"], fixture.segment.uid.to_string());
    assert!(snapshot
        .resources
        .iter()
        .any(|r| r.name.ends_with("/images/result.png")));
    assert!(bundle
        .manifest
        .notices
        .iter()
        .any(|n| n.code == "recovered_image_reference"));
    assert_eq!(
        fs::read(fixture.path("paper.segments.json")).unwrap(),
        original
    );
    fs::remove_file(fixture.path("mineru-output/images/result.png")).unwrap();
    assert!(export_entry(fixture.dir.path(), fixture.entry.id.as_str()).is_err());
}
