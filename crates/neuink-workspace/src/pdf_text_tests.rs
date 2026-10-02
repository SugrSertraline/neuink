use super::*;
use crate::source_availability::SourceStatus;
use std::time::{SystemTime, UNIX_EPOCH};

struct Fixture {
    root: std::path::PathBuf,
    workspace: Workspace,
    entry: EntryId,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "neuink_pdf_text_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let workspace = Workspace::create(&root).unwrap();
        let entry = workspace.create_entry("Unparsed paper").unwrap().id;
        fs::write(
            workspace.layout().entry_pdf_file(&entry),
            b"%PDF-1.7\nfixture contents",
        )
        .unwrap();
        Self {
            root,
            workspace,
            entry,
        }
    }
    fn info(&self) -> PdfTextInfo {
        self.workspace.inspect_pdf_text(&self.entry, 1, 3).unwrap()
    }
    fn store(&self, revision: &str) {
        self.workspace
            .cache_pdf_text(
                &self.entry,
                revision,
                2,
                vec![
                    PdfTextPage {
                        page_idx: 0,
                        text: "真实文字 / Real text".to_owned(),
                        truncated: false,
                    },
                    PdfTextPage {
                        page_idx: 1,
                        text: String::new(),
                        truncated: false,
                    },
                ],
            )
            .unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn cached_pages_are_not_parsed_segments_and_form_real_source_snapshots() {
    let f = Fixture::new();
    let original = f.workspace.read_entry(&f.entry).unwrap();
    let info = f.info();
    assert!(info.pages.is_empty());
    assert_eq!(info.page_count, None);
    f.store(&info.revision);
    let cached = f.info();
    assert_eq!(cached.page_count, Some(2));
    assert_eq!(cached.pages.len(), 2);
    assert!(f.workspace.read_segments(&f.entry).unwrap().is_empty());
    assert_eq!(
        f.workspace.read_entry(&f.entry).unwrap().updated_at,
        original.updated_at
    );
    let note_id = neuink_domain::NoteId::new();
    f.workspace
        .create_note_with_id(&f.entry, note_id.clone(), "Reading notes")
        .unwrap();
    let uid = SegmentUid::from_string(format!("{PDF_TEXT_PREFIX}{}:0", info.revision));
    let source = f
        .workspace
        .build_note_source_link(&f.entry, &note_id, &f.entry, uid)
        .unwrap();
    assert_eq!(source.sources[0].snapshot_text, "真实文字 / Real text");
    assert_eq!(source.sources[0].page, 1);
    assert_eq!(
        f.workspace.inspect_sources(&source.sources)[0].status,
        SourceStatus::Available
    );
    // Saved source links remain navigable after an independently rebuildable text cache is removed.
    fs::remove_file(f.workspace.pdf_text_cache_path(&f.entry).unwrap()).unwrap();
    assert_eq!(
        f.workspace.inspect_sources(&source.sources)[0].status,
        SourceStatus::Available
    );
}

#[test]
fn changed_pdf_cannot_reuse_old_sources_or_receive_late_extraction() {
    let f = Fixture::new();
    let info = f.info();
    f.store(&info.revision);
    let note_id = neuink_domain::NoteId::new();
    f.workspace
        .create_note_with_id(&f.entry, note_id.clone(), "Note")
        .unwrap();
    let uid = SegmentUid::from_string(format!("{PDF_TEXT_PREFIX}{}:0", info.revision));
    let link = f
        .workspace
        .build_note_source_link(&f.entry, &note_id, &f.entry, uid.clone())
        .unwrap();
    fs::write(
        f.workspace.layout().entry_pdf_file(&f.entry),
        b"%PDF-1.7\nnew version",
    )
    .unwrap();
    assert!(f.info().pages.is_empty());
    assert!(f
        .workspace
        .read_assistant_pdf_bytes(&f.entry, Some(&info.revision))
        .is_err());
    assert!(f.workspace.resolve_source_segment(&f.entry, &uid).is_err());
    assert!(f
        .workspace
        .cache_pdf_text(&f.entry, &info.revision, 2, vec![])
        .is_err());
    assert_eq!(
        f.workspace.inspect_sources(&link.sources)[0].status,
        SourceStatus::ContentChanged
    );
    assert_eq!(link.sources[0].snapshot_text, "真实文字 / Real text");
}

#[test]
fn rejects_empty_page_as_evidence_and_preserves_existing_snapshots() {
    let f = Fixture::new();
    let info = f.info();
    f.store(&info.revision);
    let empty = SegmentUid::from_string(format!("{PDF_TEXT_PREFIX}{}:1", info.revision));
    assert!(f
        .workspace
        .resolve_source_segment(&f.entry, &empty)
        .is_err());
    assert!(f
        .workspace
        .cache_pdf_text(
            &f.entry,
            &info.revision,
            2,
            vec![PdfTextPage {
                page_idx: 0,
                text: "Different".into(),
                truncated: false
            }]
        )
        .is_err());
    assert_eq!(f.info().pages[0].text, "真实文字 / Real text");
}

#[test]
fn validates_identity_ranges_sizes_and_rebuilds_corrupt_cache() {
    let f = Fixture::new();
    let info = f.info();
    for (start, count) in [(0, 1), (1, 21), (2001, 1)] {
        assert!(f
            .workspace
            .inspect_pdf_text(&f.entry, start, count)
            .is_err());
    }
    assert!(f
        .workspace
        .inspect_pdf_text(&EntryId::from_string("../escape"), 1, 1)
        .is_err());
    assert!(pdf_text_anchor("pdf-text-v1:../../secret:0").is_none());
    assert!(f
        .workspace
        .cache_pdf_text(
            &f.entry,
            &info.revision,
            1,
            vec![PdfTextPage {
                page_idx: 0,
                text: "x".repeat(20_001),
                truncated: false
            }]
        )
        .is_err());
    f.store(&info.revision);
    fs::write(
        f.workspace.pdf_text_cache_path(&f.entry).unwrap(),
        b"not json",
    )
    .unwrap();
    assert!(f.info().pages.is_empty());
    f.store(&info.revision);
    assert_eq!(f.info().pages.len(), 2);
    let file = fs::OpenOptions::new()
        .write(true)
        .open(f.workspace.layout().entry_pdf_file(&f.entry))
        .unwrap();
    file.set_len(MAX_PDF_BYTES + 1).unwrap();
    assert!(f.workspace.inspect_pdf_text(&f.entry, 1, 1).is_err());
}

#[test]
fn removed_entry_cannot_be_read_or_have_its_cache_rewritten() {
    let f = Fixture::new();
    let info = f.info();
    f.store(&info.revision);
    f.workspace.delete_entry(&f.entry).unwrap();
    assert!(f.workspace.inspect_pdf_text(&f.entry, 1, 1).is_err());
    assert!(f
        .workspace
        .cache_pdf_text(&f.entry, &info.revision, 2, vec![])
        .is_err());
}
