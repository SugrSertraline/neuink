use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Barrier},
    time::{SystemTime, UNIX_EPOCH},
};

use neuink_domain::{EntryId, ReadingMode, ReadingSession, ReadingStateUpdate, SegmentType, SourceSegment};

use crate::{
    reading_pdf::{GeometryProof, PdfDocumentSummary, PdfPairSummary, ReadingPdfVerifier},
    Workspace, WorkspaceError,
};

/// Human-made PDFs and the PDF.js summaries that `readingPdfVerification.test.ts` pins.
fn fixture_bytes(name: &str) -> &'static [u8] {
    match name {
        "origin" => include_bytes!("../tests/fixtures/reading_pdf/origin.pdf"),
        "resaved" => include_bytes!("../tests/fixtures/reading_pdf/resaved.pdf"),
        "page_count" => include_bytes!("../tests/fixtures/reading_pdf/page_count.pdf"),
        "rotate" => include_bytes!("../tests/fixtures/reading_pdf/rotate.pdf"),
        "media_box" => include_bytes!("../tests/fixtures/reading_pdf/media_box.pdf"),
        "crop_box" => include_bytes!("../tests/fixtures/reading_pdf/crop_box.pdf"),
        "text" => include_bytes!("../tests/fixtures/reading_pdf/text.pdf"),
        other => panic!("unknown fixture {other}"),
    }
}

fn golden(name: &str) -> PdfDocumentSummary {
    let all: std::collections::BTreeMap<String, PdfDocumentSummary> = serde_json::from_str(
        include_str!("../tests/fixtures/reading_pdf/summaries.json"),
    )
    .unwrap();
    all[name].clone()
}

/// Pairs the named candidate fixture's summary with the origin fixture's summary.
fn pair(candidate: &str) -> PdfPairSummary {
    PdfPairSummary {
        candidate: golden(candidate),
        origin: golden("origin"),
    }
}

const ORIGINAL: &[u8] = b"%PDF-1.7 original";
const REPLACEMENT: &[u8] = b"%PDF-1.7 replacement with a different hash";
const ORIGIN: &[u8] = b"%PDF-1.7 mineru origin";

struct Accept;
impl ReadingPdfVerifier for Accept {
    fn verify(&self, _: &[u8], _: &[u8]) -> Result<(), String> {
        Ok(())
    }
}

struct Reject;
impl ReadingPdfVerifier for Reject {
    fn verify(&self, _: &[u8], _: &[u8]) -> Result<(), String> {
        Err("page count mismatch: candidate 22, origin 21".into())
    }
}

fn temp_root(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("neuink_reading_pdf_{tag}_{nanos}"))
}

/// Builds an entry with an imported PDF, a MinerU origin copy, segments, and reading progress.
fn fixture(tag: &str) -> (PathBuf, Workspace, EntryId, String) {
    let root = temp_root(tag);
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let source = root.with_extension("pdf");
    fs::write(&source, ORIGINAL).unwrap();
    let imported = workspace.import_pdf(&entry.id, &source).unwrap();
    fs::remove_file(source).unwrap();
    let origin_dir = workspace.layout().entry_mineru_output_dir(&entry.id);
    fs::create_dir_all(&origin_dir).unwrap();
    fs::write(origin_dir.join("paper_origin.pdf"), ORIGIN).unwrap();
    let segment = SourceSegment::new(
        SegmentType::Paragraph,
        0,
        Some([10., 10., 500., 100.]),
        "An abstract".into(),
    );
    workspace.write_segments(&entry.id, &[segment]).unwrap();
    workspace
        .update_reading_state(
            &entry.id,
            ReadingStateUpdate {
                mode: ReadingMode::Pdf,
                current_page_idx: Some(1),
                page_count: 3,
                visited_pages: vec![0, 1],
                active_ms_delta: 0,
                session_start: false,
                reading_session: None,
                local_date: None,
            },
        )
        .unwrap();
    let hash = imported.pdf.unwrap().content_hash;
    (root, workspace, entry.id, hash)
}

/// Returns every file under `root` keyed by its relative path.
fn snapshot(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn walk(base: &Path, dir: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for item in fs::read_dir(dir).unwrap() {
            let path = item.unwrap().path();
            if path.is_dir() {
                walk(base, &path, out);
            } else {
                out.insert(
                    path.strip_prefix(base).unwrap().to_path_buf(),
                    fs::read(&path).unwrap(),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

#[test]
fn stale_hash_is_rejected_without_writing() {
    let (root, workspace, id, _hash) = fixture("stale");
    let before = snapshot(&root);

    let error = workspace
        .replace_reading_pdf(&id, "new.pdf", REPLACEMENT, "not-the-current-hash", &Accept)
        .unwrap_err();

    assert!(matches!(error, WorkspaceError::ReadingPdfChanged(_)));
    assert_eq!(snapshot(&root), before);
    fs::remove_dir_all(root).unwrap();
}

/// Entry whose MinerU origin copy is the real `origin.pdf` fixture, so verification
/// runs against real PDF bytes.
fn real_fixture(tag: &str) -> (PathBuf, Workspace, EntryId, String) {
    let root = temp_root(tag);
    let workspace = Workspace::create(&root).unwrap();
    let entry = workspace.create_entry("A paper").unwrap();
    let source = root.with_extension("pdf");
    fs::write(&source, fixture_bytes("origin")).unwrap();
    let imported = workspace.import_pdf(&entry.id, &source).unwrap();
    fs::remove_file(source).unwrap();
    let origin_dir = workspace.layout().entry_mineru_output_dir(&entry.id);
    fs::create_dir_all(&origin_dir).unwrap();
    fs::write(origin_dir.join("paper_origin.pdf"), fixture_bytes("origin")).unwrap();
    let hash = imported.pdf.unwrap().content_hash;
    (root, workspace, entry.id, hash)
}

#[test]
fn real_summary_accepts_resaved_pdf_with_same_pages_and_text() {
    let (root, workspace, id, hash) = real_fixture("real_accept");

    let updated = workspace
        .replace_reading_pdf(
            &id,
            "resaved.pdf",
            fixture_bytes("resaved"),
            &hash,
            &pair("resaved"),
        )
        .unwrap();

    assert_eq!(
        updated.pdf.unwrap().content_hash,
        blake3::hash(fixture_bytes("resaved")).to_hex().to_string()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn real_summary_rejects_each_mismatch_without_writing() {
    let cases = [
        ("page_count", "页数不一致"),
        ("rotate", "旋转角度不一致"),
        ("crop_box", "CropBox 不一致"),
        ("media_box", "MediaBox 不一致"),
        ("text", "文本锚点不一致"),
    ];
    for (name, expected) in cases {
        let (root, workspace, id, hash) = real_fixture(name);
        let before = snapshot(&root);

        let error = workspace
            .replace_reading_pdf(&id, "new.pdf", fixture_bytes(name), &hash, &pair(name))
            .unwrap_err();

        let WorkspaceError::ReadingPdfVerification(reason) = &error else {
            panic!("{name}: expected verification error, got {error}");
        };
        assert!(reason.contains(expected), "{name}: {reason}");
        assert_eq!(snapshot(&root), before, "{name} wrote files");
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn toctou_bytes_differing_from_summary_are_rejected_without_writing() {
    // The summary describes `resaved`, but the bytes passed in are `text`.
    let (root, workspace, id, hash) = real_fixture("toctou_candidate");
    let before = snapshot(&root);

    let error = workspace
        .replace_reading_pdf(&id, "new.pdf", fixture_bytes("text"), &hash, &pair("resaved"))
        .unwrap_err();

    let WorkspaceError::ReadingPdfVerification(reason) = &error else {
        panic!("expected verification error, got {error}");
    };
    assert!(reason.contains("校验摘要不一致"), "{reason}");
    assert_eq!(snapshot(&root), before);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn origin_bytes_changed_after_summary_are_rejected_without_writing() {
    let (root, workspace, id, hash) = real_fixture("toctou_origin");
    let origin_path = workspace
        .layout()
        .entry_mineru_output_dir(&id)
        .join("paper_origin.pdf");
    // A trailing byte keeps the PDF readable but changes its SHA-256.
    let mut tampered = fixture_bytes("origin").to_vec();
    tampered.push(b'\n');
    fs::write(&origin_path, &tampered).unwrap();
    let before = snapshot(&root);

    let error = workspace
        .replace_reading_pdf(&id, "resaved.pdf", fixture_bytes("resaved"), &hash, &pair("resaved"))
        .unwrap_err();

    assert!(error.to_string().contains("MinerU 原件"), "{error}");
    assert_eq!(snapshot(&root), before);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn text_free_pair_is_rejected_without_writing() {
    // Both files have no text layer on any page, so matching anchors prove nothing.
    let (root, workspace, id, hash) = real_fixture("text_free_pair");
    let mut pair = pair("resaved");
    for doc in [&mut pair.candidate, &mut pair.origin] {
        for page in &mut doc.pages {
            page.text_anchor.clear();
        }
    }
    let before = snapshot(&root);

    let error = workspace
        .replace_reading_pdf(&id, "new.pdf", fixture_bytes("resaved"), &hash, &pair)
        .unwrap_err();

    let WorkspaceError::ReadingPdfVerification(reason) = &error else {
        panic!("expected verification error, got {error}");
    };
    assert!(reason.contains("无文本层"), "{reason}");
    assert_eq!(snapshot(&root), before);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn single_empty_anchor_page_does_not_fail_the_pair() {
    let mut pair = pair("resaved");
    pair.candidate.pages[0].text_anchor.clear();
    pair.origin.pages[0].text_anchor.clear();

    assert!(pair
        .verify(fixture_bytes("resaved"), fixture_bytes("origin"))
        .is_ok());
}

#[test]
fn summary_verifier_is_checked_against_bytes_directly() {
    let pair = pair("origin");
    assert!(pair
        .verify(fixture_bytes("origin"), fixture_bytes("origin"))
        .is_ok());
    assert!(pair
        .verify(fixture_bytes("resaved"), fixture_bytes("origin"))
        .is_err());
}

#[test]
fn verifier_mismatch_is_rejected_without_writing() {
    let (root, workspace, id, hash) = fixture("mismatch");
    let before = snapshot(&root);

    assert!(workspace
        .replace_reading_pdf(&id, "new.pdf", REPLACEMENT, &hash, &Reject)
        .is_err());

    assert_eq!(snapshot(&root), before);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn non_pdf_bytes_are_rejected_without_writing() {
    let (root, workspace, id, hash) = fixture("non_pdf");
    let before = snapshot(&root);

    let error = workspace
        .replace_reading_pdf(&id, "new.pdf", b"PK\x03\x04 zip", &hash, &Accept)
        .unwrap_err();

    assert!(matches!(error, WorkspaceError::ReadingPdfInvalid(_)));
    assert_eq!(snapshot(&root), before);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn stored_archive_origin_fallback_handles_beta_names_and_excludes_debug_pdfs() {
    for name in ["nested/PAPER_ORIGIN.PDF", "nested/paper.pdf"] {
        let (root, workspace, id, _) = fixture("origin_fallback");
        fs::remove_file(workspace.layout().entry_mineru_output_dir(&id).join("paper_origin.pdf")).unwrap();
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for path in [name, "paper_layout.pdf", "paper_span.pdf"] {
            zip.start_file(path, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(ORIGIN).unwrap();
        }
        fs::write(workspace.layout().entry_mineru_output_zip(&id), zip.finish().unwrap().into_inner()).unwrap();
        assert_eq!(workspace.mineru_origin_pdf_bytes(&id).unwrap(), ORIGIN);
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn stored_archive_origin_fallback_rejects_ambiguity_but_canonical_still_wins() {
    for names in [["one.pdf", "two.pdf"], ["one_origin.pdf", "two_ORIGIN.PDF"]] {
        let (root, workspace, id, _) = fixture("origin_ambiguous");
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for name in names {
            zip.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(ORIGIN).unwrap();
        }
        fs::write(workspace.layout().entry_mineru_output_zip(&id), zip.finish().unwrap().into_inner()).unwrap();
        assert_eq!(workspace.mineru_origin_pdf_bytes(&id).unwrap(), ORIGIN);
        fs::remove_file(workspace.layout().entry_mineru_output_dir(&id).join("paper_origin.pdf")).unwrap();
        assert!(matches!(workspace.mineru_origin_pdf_bytes(&id), Err(WorkspaceError::ReadingPdfVerification(_))));
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn replacement_changes_only_pdf_meta_and_reading_hash() {
    let (root, workspace, id, hash) = fixture("replace");
    let started_at = chrono::DateTime::parse_from_rfc3339("2026-11-04T10:00:00Z").unwrap().with_timezone(&chrono::Utc);
    workspace.update_reading_state(&id, ReadingStateUpdate {
        mode: ReadingMode::Pdf,
        current_page_idx: Some(1),
        page_count: 3,
        visited_pages: vec![0, 1],
        reading_session: Some(ReadingSession {
            id: "replacement-test-session".into(), local_date: "2026-11-04".into(),
            started_at, ended_at: started_at + chrono::Duration::seconds(30), active_ms: 20_000,
        }),
        ..Default::default()
    }).unwrap();
    let mut expected_state = workspace.read_reading_state(&id).unwrap().state;
    let before = snapshot(&root);
    let parse_before = workspace.read_entry(&id).unwrap().pdf.unwrap().parse;

    let updated = workspace
        .replace_reading_pdf(&id, "new.pdf", REPLACEMENT, &hash, &Accept)
        .unwrap();

    let new_hash = blake3::hash(REPLACEMENT).to_hex().to_string();
    let pdf = updated.pdf.as_ref().unwrap();
    assert_eq!(pdf.content_hash, new_hash);
    assert_eq!(pdf.file_name, "new.pdf");
    assert_eq!(pdf.parse, parse_before);

    let after = snapshot(&root);
    let mut changed: Vec<String> = before
        .keys()
        .filter(|path| before[*path] != after[*path])
        .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    changed.sort();
    assert_eq!(
        changed,
        vec![
            "entry.meta.json".to_string(),
            "paper.pdf".to_string(),
            "paper.reading.json".to_string(),
        ]
    );
    assert_eq!(
        fs::read(workspace.layout().entry_pdf_file(&id)).unwrap(),
        REPLACEMENT
    );

    let state = workspace.read_reading_state(&id).unwrap().state;
    expected_state.document_hash = Some(new_hash.clone());
    assert_eq!(state, expected_state, "all populated session checkpoints and statistics survive");
    assert_eq!(state.document_hash.as_deref(), Some(new_hash.as_str()));
    assert_eq!(state.visited_pages, vec![0, 1]);
    assert_eq!(state.current_page_idx, Some(1));
    assert_eq!(state.page_count, 3);
    assert_eq!(workspace.read_segments(&id).unwrap().len(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_meta_write_restores_pdf_and_reading_state() {
    let (root, workspace, id, hash) = fixture("rollback");
    let before = snapshot(&root);
    let meta_path = workspace.layout().entry_meta_file(&id);
    let failing = |path: &Path, bytes: &[u8]| {
        if path == meta_path {
            return Err(WorkspaceError::Io(std::io::Error::other(
                "injected meta failure",
            )));
        }
        crate::atomic_write(path, bytes)
    };

    let error = workspace
        .replace_reading_pdf_with_writer(&id, "new.pdf", REPLACEMENT, &hash, &Accept, &failing)
        .unwrap_err();

    assert!(error.to_string().contains("injected meta failure"));
    assert_eq!(snapshot(&root), before);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_replacements_with_same_hash_commit_only_one() {
    let (root, _workspace, id, hash) = fixture("concurrent");
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = [REPLACEMENT, b"%PDF-1.7 second candidate"]
        .into_iter()
        .map(|bytes| {
            let root = root.clone();
            let id = id.clone();
            let hash = hash.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                let workspace = Workspace::open(&root).unwrap();
                barrier.wait();
                workspace.replace_reading_pdf(&id, "new.pdf", bytes, &hash, &Accept)
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

    let successes = results.iter().filter(|r| r.is_ok()).count();
    let conflicts = results
        .iter()
        .filter(|r| matches!(r, Err(WorkspaceError::ReadingPdfChanged(_))))
        .count();
    assert_eq!(successes, 1);
    assert_eq!(conflicts, 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn media_box_only_difference_is_rejected_even_when_visible_box_matches() {
    // Same visible box (CropBox ∩ MediaBox) on both sides; only the MediaBox differs.
    let mut candidate = golden("origin");
    let mut origin = golden("origin");
    candidate.pages[0].media_box = Some([0.0, 0.0, 620.0, 800.0]);
    candidate.pages[0].crop_box = Some([0.0, 0.0, 600.0, 780.0]);
    origin.pages[0].media_box = Some([0.0, 0.0, 612.0, 792.0]);
    origin.pages[0].crop_box = Some([0.0, 0.0, 600.0, 780.0]);
    candidate.pages[0].view_box = [0.0, 0.0, 600.0, 780.0];
    origin.pages[0].view_box = [0.0, 0.0, 600.0, 780.0];
    let pair = PdfPairSummary { candidate, origin };

    let error = pair
        .verify(fixture_bytes("origin"), fixture_bytes("origin"))
        .unwrap_err();
    assert!(error.contains("MediaBox"), "{error}");
}

#[test]
fn crop_box_only_difference_is_rejected() {
    let mut candidate = golden("origin");
    let origin = golden("origin");
    candidate.pages[1].crop_box = Some([0.0, 0.0, 600.0, 780.0]);
    let pair = PdfPairSummary { candidate, origin };

    let error = pair
        .verify(fixture_bytes("origin"), fixture_bytes("origin"))
        .unwrap_err();
    assert!(error.contains("CropBox"), "{error}");
}

#[test]
fn unproven_geometry_is_rejected_before_any_page_comparison() {
    let mut candidate = golden("origin");
    candidate.geometry_proof = GeometryProof::Unavailable;
    let pair = PdfPairSummary {
        candidate,
        origin: golden("origin"),
    };

    let error = pair
        .verify(fixture_bytes("origin"), fixture_bytes("origin"))
        .unwrap_err();
    assert!(error.contains("不能证明页面几何一致"), "{error}");
}
