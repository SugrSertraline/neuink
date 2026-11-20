use super::*;
#[path = "fixtures.rs"]
mod fixtures;
use fixtures::Fixture;
use std::fs;

fn incremental(fixture: &Fixture) -> ExportBundle {
    export_entry_incremental(fixture.dir.path(), fixture.entry.id.as_str()).unwrap()
}

fn binding() -> crate::sync_journal::WorkspaceSyncBinding {
    crate::sync_journal::WorkspaceSyncBinding {
        server_id: "1".repeat(64),
        account_id: "2".repeat(64),
        library_id: "3".repeat(64),
        epoch: "4".repeat(64),
    }
}

#[test]
fn unchanged_pdf_and_immutable_snapshot_are_not_read_when_staging_note() {
    let fixture = Fixture::new();
    let workspace = crate::Workspace::create(fixture.dir.path()).unwrap();
    let binding = binding();
    workspace.bind_sync(&binding).unwrap();
    let initial = incremental(&fixture);
    workspace.stage_sync_bundle(&binding, &initial).unwrap();
    let pdf = initial
        .manifest
        .documents
        .iter()
        .find(|d| d.kind == ObjectKind::Entry)
        .unwrap()
        .resources[0]
        .clone();
    files::take_read_counts();
    let note = workspace
        .read_note(&fixture.entry.id, &fixture.note_id)
        .unwrap();
    workspace
        .update_note_if_revision(
            &fixture.entry.id,
            &fixture.note_id,
            "Updated note",
            format!("{}\nAnother observation.", note.markdown),
            Some(&note.revision),
        )
        .unwrap();
    let changed = incremental(&fixture);
    let ids: BTreeSet<_> = changed
        .manifest
        .documents
        .iter()
        .filter(|document| {
            initial
                .manifest
                .documents
                .iter()
                .find(|old| old.entity_id == document.entity_id)
                != Some(*document)
        })
        .map(|document| document.entity_id.clone())
        .collect();
    assert!(ids.contains(&format!("entry:{}", fixture.entry.id)));
    assert!(ids.contains(&format!("note:{}", fixture.note_id)));
    let confirmed_resources = initial
        .manifest
        .documents
        .iter()
        .flat_map(|d| &d.resources)
        .map(|r| (r.hash.clone(), r.size))
        .collect();
    workspace
        .stage_sync_bundle_entities_with_confirmed(&binding, &changed, &ids, &confirmed_resources)
        .unwrap();
    changed.verify_unchanged().unwrap();
    let counts = files::take_read_counts();
    assert_eq!(counts.get("paper.pdf").copied().unwrap_or_default(), 0);
    assert_eq!(
        counts.get(&pdf.hash).copied().unwrap_or_default(),
        0,
        "the unrelated immutable PDF snapshot must not be rehashed"
    );
    let document = changed
        .manifest
        .documents
        .iter()
        .find(|d| d.kind == ObjectKind::Note)
        .unwrap();
    let resource = document
        .resources
        .iter()
        .find(|r| r.name == "note.json")
        .unwrap();
    let bytes = workspace.read_sync_resource(&binding, resource).unwrap();
    let saved: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(saved, fixtures::content(&changed, document, "note.json"));
    assert!(saved["markdown"]
        .as_str()
        .unwrap()
        .contains("Another observation"));
}

#[test]
fn unconfirmed_blob_is_strongly_checked_even_with_a_warm_hint() {
    let fixture = Fixture::new();
    let workspace = crate::Workspace::create(fixture.dir.path()).unwrap();
    let binding = binding();
    workspace.bind_sync(&binding).unwrap();
    let bundle = incremental(&fixture);
    workspace.stage_sync_bundle(&binding, &bundle).unwrap();
    let pdf = &bundle
        .manifest
        .documents
        .iter()
        .find(|d| d.kind == ObjectKind::Entry)
        .unwrap()
        .resources[0];
    let path = workspace.sync_blob_path(&binding, &pdf.hash).unwrap();
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    let mut corrupt = fs::read(&path).unwrap();
    corrupt[7] = b'9';
    fs::write(&path, corrupt).unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    files::take_read_counts();
    workspace
        .stage_sync_bundle_entities(
            &binding,
            &bundle,
            &BTreeSet::from([format!("entry:{}", fixture.entry.id)]),
        )
        .unwrap();
    assert!(
        files::take_read_counts()
            .get(&pdf.hash)
            .copied()
            .unwrap_or_default()
            > 0
    );
    assert_eq!(
        fs::read(path).unwrap(),
        fs::read(fixture.path("paper.pdf")).unwrap()
    );
}

#[test]
fn invalidation_and_broken_cache_rehash_without_changing_user_content() {
    let fixture = Fixture::new();
    let initial = incremental(&fixture);
    files::take_pdf_read_bytes();
    incremental(&fixture);
    assert_eq!(files::take_pdf_read_bytes(), 0);
    invalidate_incremental_cache(fixture.dir.path()).unwrap();
    incremental(&fixture);
    assert!(files::take_pdf_read_bytes() > 0);
    let records = fixture.dir.path().join(".neuink-sync/fingerprints");
    for item in fs::read_dir(&records).unwrap() {
        fs::write(item.unwrap().path(), b"broken cache").unwrap();
    }
    let recovered = incremental(&fixture);
    assert!(files::take_pdf_read_bytes() > 0);
    assert_eq!(
        serde_json::to_value(initial.manifest()).unwrap(),
        serde_json::to_value(recovered.manifest()).unwrap()
    );
    for item in fs::read_dir(&records).unwrap() {
        fs::remove_file(item.unwrap().path()).unwrap();
    }
    incremental(&fixture);
    assert!(files::take_pdf_read_bytes() > 0);
}

#[test]
fn ordinary_resource_change_or_missing_file_is_not_hidden_by_cache() {
    let fixture = Fixture::new();
    incremental(&fixture);
    let path = fixture.path("paper.pdf");
    let mut bytes = fs::read(&path).unwrap();
    bytes.extend_from_slice(b"\nAdditional PDF data\n");
    fs::write(&path, &bytes).unwrap();
    let changed = incremental(&fixture);
    let pdf = &changed
        .manifest
        .documents
        .iter()
        .find(|d| d.kind == ObjectKind::Entry)
        .unwrap()
        .resources[0];
    assert_eq!(pdf.hash, blake3::hash(&bytes).to_hex().to_string());
    assert_eq!(pdf.size, bytes.len() as u64);
    fs::remove_file(&path).unwrap();
    assert!(export_entry_incremental(fixture.dir.path(), fixture.entry.id.as_str()).is_err());
}

#[test]
fn cache_is_scoped_to_binding_and_rechecks_on_session_or_audit_expiry() {
    let fixture = Fixture::new();
    incremental(&fixture);
    files::take_pdf_read_bytes();
    fs::write(
        fixture.dir.path().join("sync-binding.json"),
        serde_json::to_vec(&binding()).unwrap(),
    )
    .unwrap();
    incremental(&fixture);
    assert!(files::take_pdf_read_bytes() > 0);
    for field in ["session", "verified_at"] {
        for item in fs::read_dir(fixture.dir.path().join(".neuink-sync/fingerprints")).unwrap() {
            let path = item.unwrap().path();
            let value = if field == "session" {
                json!("previous process")
            } else {
                json!(0)
            };
            fingerprints::rewrite_record_field(&path, field, value);
        }
        incremental(&fixture);
        assert!(files::take_pdf_read_bytes() > 0);
    }
}

#[test]
fn per_file_invalidation_detects_replacement_preserving_size_and_mtime() {
    let fixture = Fixture::new();
    let initial = incremental(&fixture);
    let path = fixture.path("paper.pdf");
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    let mut bytes = fs::read(&path).unwrap();
    bytes[7] = b'7';
    fs::write(&path, &bytes).unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    invalidate_incremental_paths(
        fixture.dir.path(),
        &[format!("entries/{}/paper.pdf", fixture.entry.id)],
    )
    .unwrap();
    let changed = incremental(&fixture);
    let pdf_hash = |bundle: &ExportBundle| {
        bundle
            .manifest
            .documents
            .iter()
            .find(|d| d.kind == ObjectKind::Entry)
            .unwrap()
            .resources[0]
            .hash
            .clone()
    };
    assert_ne!(pdf_hash(&initial), pdf_hash(&changed));
    assert_eq!(
        pdf_hash(&changed),
        blake3::hash(&bytes).to_hex().to_string()
    );
    // Explicit/overwrite verification keeps its strong default even without a watcher event.
    let strong = fixture.export();
    bytes[7] = b'8';
    fs::write(&path, bytes).unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert!(strong.verify_unchanged().is_err());
}

#[test]
fn new_snapshot_is_verified_even_if_resource_hint_is_stale() {
    let fixture = Fixture::new();
    let workspace = crate::Workspace::create(fixture.dir.path()).unwrap();
    let binding = binding();
    workspace.bind_sync(&binding).unwrap();
    let bundle = incremental(&fixture);
    let path = fixture.path("paper.pdf");
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    let mut bytes = fs::read(&path).unwrap();
    bytes[7] = b'9';
    fs::write(&path, bytes).unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert!(workspace
        .stage_sync_bundle_entities(
            &binding,
            &bundle,
            &BTreeSet::from([format!("entry:{}", fixture.entry.id)])
        )
        .is_err());
}
