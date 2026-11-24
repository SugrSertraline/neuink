//! End-to-end chain test against a running visual service.
//!
//! Gated on `NEUINK_VISUAL_SERVICE_URL`: without a service the test returns immediately,
//! so CI stays hermetic. With a service (the repository ships `--stub` mode for this) it
//! exercises the real path: import assets, encode pages and crops, write the snapshot,
//! reopen it read-only, and rank for a question.
//!
//! ```powershell
//! python apps/desktop/scripts/qwen-visual-service/service.py --stub --port 8765
//! $env:NEUINK_VISUAL_SERVICE_URL = 'http://127.0.0.1:8765'
//! cargo test -p neuink-ipc --lib commands::search::visual_service_tests -- --nocapture
//! ```

use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use neuink_domain::{SegmentType, SourceSegment};
use neuink_search::{VisualRecall, VisualSourceKind};
use neuink_workspace::Workspace;
use zip::{write::SimpleFileOptions, ZipWriter};

use crate::commands::search::visual::{prepare_visual_index, visual_channel};
use crate::commands::search::PrepareVisualSearchIndexRequest;

fn temp_root(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::temp_dir().join(format!("neuink_visual_service_{tag}_{nanos}"))
}

fn mineru_zip() -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .start_file("paper_content_list.json", SimpleFileOptions::default())
        .expect("json entry");
    writer
        .write_all(br#"[{"type":"text","text":"An abstract"}]"#)
        .expect("json bytes");
    for (name, bytes) in [
        ("images/fig1.jpg", b"figure-one".as_slice()),
        ("images/table1.jpg", b"table-one".as_slice()),
    ] {
        writer
            .start_file(name, SimpleFileOptions::default())
            .expect("image entry");
        writer.write_all(bytes).expect("image bytes");
    }
    writer.finish().expect("finish zip").into_inner()
}

#[test]
fn pages_regions_and_assets_are_encoded_then_ranked_from_one_snapshot() {
    let Ok(endpoint) = std::env::var("NEUINK_VISUAL_SERVICE_URL") else {
        // No service: the product path is covered by the unit tests, and this chain test
        // would only measure the environment.
        return;
    };

    let root = temp_root("chain");
    let workspace = Workspace::create(&root).expect("create workspace");
    let entry = workspace.create_entry("Chain").expect("create entry");

    // A parsed entry with a native PDF and two pages.
    let pdf_path = root.join("origin.pdf");
    std::fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").expect("write pdf");
    workspace
        .import_pdf(&entry.id, &pdf_path)
        .expect("import pdf");
    // Parse state follows the domain's transition table; the visual channel only accepts
    // a successfully parsed entry.
    for status in [
        neuink_domain::PdfParseStatus::Queued,
        neuink_domain::PdfParseStatus::Uploading,
        neuink_domain::PdfParseStatus::Uploaded,
        neuink_domain::PdfParseStatus::Parsing,
        neuink_domain::PdfParseStatus::Succeeded,
    ] {
        workspace
            .set_pdf_parse_state(&entry.id, status, None)
            .expect("advance parse state");
    }
    workspace
        .write_segments(
            &entry.id,
            &[
                SourceSegment::new(SegmentType::Figure, 0, None, "page zero".to_string())
                    .with_asset_path(Some("images/fig1.jpg".to_string())),
                SourceSegment::new(SegmentType::Table, 1, None, "page one".to_string())
                    .with_asset_path(Some("images/table1.jpg".to_string())),
            ],
        )
        .expect("segments");

    // MinerU assets: the figure/table channel of the same snapshot. The bytes are read
    // straight from the stored ZIP, so nothing has to be copied out first.
    let zip = mineru_zip();
    workspace
        .write_mineru_output_zip(&entry.id, &zip)
        .expect("store zip");
    let collected = workspace
        .collect_entry_visual_assets(None)
        .expect("collect assets");
    assert_eq!(collected.len(), 2);

    let settings = neuink_config::VisualEmbeddingSettings {
        provider: neuink_config::VisualEmbeddingProviderKind::QwenLocal,
        endpoint: Some(endpoint.clone()),
        timeout_ms: 30_000,
        ..Default::default()
    };
    let provider = crate::commands::search::visual::provider_for(&settings);
    assert!(
        provider.status().available,
        "service must be reachable: {:?}",
        provider.status().message
    );

    let response = prepare_visual_index(
        provider.clone(),
        PrepareVisualSearchIndexRequest { root: root.clone() },
    )
    .expect("prepare visual index");
    // Both chart pages already have MinerU crops, so the PDF pages are not rendered again.
    assert_eq!(response.asset_count, 2);
    assert_eq!(response.document_count, 2);
    assert!(response.dimensions.unwrap_or_default() > 0);

    let mut channel = visual_channel(&root, provider);
    assert!(channel.status().is_ready(), "snapshot must reopen");
    let scores = channel
        .recall(
            "which value does the chart report?",
            &[entry.id.to_string()],
            20,
        )
        .expect("visual recall");
    assert_eq!(scores.len(), 2);
    assert!(scores.iter().all(|score| score.region.is_none()));
    assert!(scores
        .iter()
        .any(|score| score.parent_id.starts_with("asset:")));

    let parents = neuink_search::aggregate_parents(&scores);
    assert_eq!(parents.len(), 2);

    std::fs::remove_dir_all(&root).ok();
    let _ = VisualSourceKind::Page;
}
