//! Backfill tests: an existing library can gain visual assets from the MinerU ZIP it
//! already stores, without re-importing the paper.

use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use neuink_domain::EntryId;
use neuink_workspace::Workspace;
use zip::{write::SimpleFileOptions, ZipWriter};

use crate::commands::entry::{backfill_entry_assets, BackfillEntryAssetsRequest};

fn temp_root(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::temp_dir().join(format!("neuink_backfill_{tag}_{nanos}"))
}

/// A MinerU client ZIP shape: a content list plus one image under `images/`.
fn mineru_zip(images: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .start_file("paper_content_list.json", SimpleFileOptions::default())
        .expect("start json");
    writer
        .write_all(br#"[{"type":"text","text":"An abstract"}]"#)
        .expect("write json");
    for (name, bytes) in images {
        writer
            .start_file(*name, SimpleFileOptions::default())
            .expect("start image");
        writer.write_all(bytes).expect("write image");
    }
    writer.finish().expect("finish zip").into_inner()
}

#[test]
fn backfill_imports_assets_from_the_stored_zip_and_reuses_them_on_a_second_run() {
    let root = temp_root("reuse");
    let workspace = Workspace::create(&root).expect("create workspace");
    let entry = workspace.create_entry("Paper").expect("create entry");
    let zip = mineru_zip(&[
        ("images/figure-1.jpg", b"figure-one"),
        ("images/figure-2.jpg", b"figure-two"),
    ]);
    // The stored ZIP is what an import from an older version left behind.
    workspace
        .write_mineru_output_zip(&entry.id, &zip)
        .expect("store zip");
    assert!(workspace.entry_assets(&entry.id).expect("list").is_empty());

    let first = backfill_entry_assets(BackfillEntryAssetsRequest {
        root: root.clone(),
        entry_ids: Vec::new(),
    })
    .expect("backfill");
    assert_eq!(first.entries_considered, 1);
    assert_eq!(first.entries_with_zip, 1);
    assert_eq!(first.entries_imported, 1);
    assert_eq!(first.entries_reused, 0);
    assert_eq!(first.assets_imported, 2);
    assert!(first.failures.is_empty());
    assert_eq!(
        workspace
            .entry_asset_bytes(&entry.id, "images/figure-1.jpg")
            .expect("read asset"),
        b"figure-one"
    );

    let second = backfill_entry_assets(BackfillEntryAssetsRequest {
        root: root.clone(),
        entry_ids: vec![entry.id.clone()],
    })
    .expect("backfill again");
    assert_eq!(second.entries_imported, 0);
    assert_eq!(second.entries_reused, 1);
    assert_eq!(second.assets_imported, 2);

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn an_entry_without_a_stored_zip_is_skipped_not_failed() {
    let root = temp_root("nozip");
    let workspace = Workspace::create(&root).expect("create workspace");
    let entry = workspace.create_entry("No parse").expect("create entry");

    let response = backfill_entry_assets(BackfillEntryAssetsRequest {
        root: root.clone(),
        entry_ids: vec![entry.id.clone()],
    })
    .expect("backfill");
    assert_eq!(response.entries_considered, 1);
    assert_eq!(response.entries_with_zip, 0);
    assert_eq!(response.entries_imported, 0);
    assert!(response.failures.is_empty());

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn a_rejected_archive_is_reported_with_a_fixed_code() {
    let root = temp_root("reject");
    let workspace = Workspace::create(&root).expect("create workspace");
    let entry = workspace.create_entry("Escape").expect("create entry");
    let zip = mineru_zip(&[("images/../../escape.jpg", b"nope")]);
    workspace
        .write_mineru_output_zip(&entry.id, &zip)
        .expect("store zip");

    let response = backfill_entry_assets(BackfillEntryAssetsRequest {
        root: root.clone(),
        entry_ids: Vec::new(),
    })
    .expect("backfill");
    assert_eq!(response.entries_imported, 0);
    assert_eq!(response.failures.len(), 1);
    assert_eq!(response.failures[0].code, "asset_path_traversal");
    // The failing entry id is data, never a filesystem path.
    assert_eq!(response.failures[0].entry_id, entry.id.to_string());
    assert!(!workspace.layout().entry_assets_dir(&entry.id).exists());

    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn an_unknown_entry_id_selects_nothing_rather_than_widening_the_set() {
    let root = temp_root("unknown");
    let workspace = Workspace::create(&root).expect("create workspace");
    let entry = workspace.create_entry("Paper").expect("create entry");
    workspace
        .write_mineru_output_zip(&entry.id, &mineru_zip(&[("images/a.jpg", b"a")]))
        .expect("store zip");

    let response = backfill_entry_assets(BackfillEntryAssetsRequest {
        root: root.clone(),
        entry_ids: vec![EntryId::from_string("does-not-exist")],
    })
    .expect("backfill");
    assert_eq!(response.entries_considered, 0);
    assert_eq!(response.entries_with_zip, 0);
    assert!(workspace.entry_assets(&entry.id).expect("list").is_empty());

    std::fs::remove_dir_all(&root).ok();
}
