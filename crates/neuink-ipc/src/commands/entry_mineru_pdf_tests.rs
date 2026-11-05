use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use neuink_domain::PdfParseStatus;
use neuink_workspace::{reading_pdf::PdfPairSummary, reading_pdf::PdfDocumentSummary, Workspace};

use super::entry::{create_from_mineru_client_result_with, CreateFromMineruClientResultRequest};

/// Real PDF fixtures. The origin copy inside the ZIP and the candidate must come from these bytes.
const ORIGIN: &[u8] = include_bytes!("../../../neuink-workspace/tests/fixtures/reading_pdf/origin.pdf");
const RESAVED: &[u8] = include_bytes!("../../../neuink-workspace/tests/fixtures/reading_pdf/resaved.pdf");
const PAGE_COUNT: &[u8] =
    include_bytes!("../../../neuink-workspace/tests/fixtures/reading_pdf/page_count.pdf");

fn golden(name: &str) -> PdfDocumentSummary {
    let all: BTreeMap<String, PdfDocumentSummary> = serde_json::from_str(include_str!(
        "../../../neuink-workspace/tests/fixtures/reading_pdf/summaries.json"
    ))
    .unwrap();
    all[name].clone()
}

/// Summary pair as the frontend would send it for `candidate` against the ZIP's origin copy.
fn verification(candidate: &str) -> PdfPairSummary {
    PdfPairSummary {
        candidate: golden(candidate),
        origin: golden("origin"),
    }
}

fn temp_root(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("neuink_mineru_pdf_{tag}_{nanos}"))
}

fn mineru_zip() -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let files: [(&str, &[u8]); 4] = [
        (
            "paper_content_list.json",
            br#"[{"type":"text","text":"An abstract"}]"#,
        ),
        ("paper_middle.json", br#"{"pdf_info":[{"page_idx":0}]}"#),
        ("paper_origin.pdf", ORIGIN),
        ("images/example.png", b"fixture image"),
    ];
    for (name, bytes) in files {
        zip.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

fn write_zip(root: &Path) -> PathBuf {
    let path = root.with_extension("zip");
    fs::write(&path, mineru_zip()).unwrap();
    path
}

fn write_candidate(root: &Path, bytes: &[u8]) -> PathBuf {
    let path = root.with_extension("candidate.pdf");
    fs::write(&path, bytes).unwrap();
    path
}

fn request(
    root: &Path,
    zip_path: PathBuf,
    pdf_path: Option<PathBuf>,
    pdf_verification: Option<PdfPairSummary>,
) -> CreateFromMineruClientResultRequest {
    CreateFromMineruClientResultRequest {
        root: root.to_path_buf(),
        title: "Imported paper".into(),
        fields: Default::default(),
        tags: Vec::new(),
        zip_path,
        pdf_path,
        pdf_verification,
        confirmed_duplicate_hash: None,
    }
}

/// Lists every file under `root` so a test can prove nothing was written.
fn file_listing(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        if let Ok(read) = fs::read_dir(dir) {
            for item in read.flatten() {
                let path = item.path();
                if path.is_dir() {
                    walk(&path, out);
                } else {
                    out.push(path);
                }
            }
        }
    }
    let mut out = Vec::new();
    walk(root, &mut out);
    out.sort();
    out
}

#[test]
fn combined_import_with_matching_pdf_keeps_original_pdf_and_mineru_segments() {
    let root = temp_root("combined");
    Workspace::create(&root).unwrap();
    let zip_path = write_zip(&root);
    let pdf_path = write_candidate(&root, RESAVED);

    let response = create_from_mineru_client_result_with(
        request(
            &root,
            zip_path.clone(),
            Some(pdf_path.clone()),
            Some(verification("resaved")),
        ),
        Some(&verification("resaved")),
    )
    .unwrap();

    let workspace = Workspace::open(&root).unwrap();
    let entry = workspace.read_entry(&response.entry.id).unwrap();
    let pdf = entry.pdf.unwrap();
    assert_eq!(
        pdf.file_name,
        pdf_path.file_name().unwrap().to_str().unwrap()
    );
    assert_eq!(pdf.content_hash, blake3::hash(RESAVED).to_hex().to_string());
    assert_eq!(pdf.parse.status, PdfParseStatus::Succeeded);
    assert_eq!(pdf.parse.endpoint.as_deref(), Some("mineru-client-import"));
    assert_eq!(pdf.parse.task_id, None);
    assert_eq!(
        fs::read(workspace.layout().entry_pdf_file(&entry.id)).unwrap(),
        RESAVED
    );
    assert_eq!(response.segment_count, 1);
    assert_eq!(workspace.read_segments(&entry.id).unwrap().len(), 1);
    assert!(workspace
        .layout()
        .entry_mineru_output_dir(&entry.id)
        .join("paper_origin.pdf")
        .exists());
    fs::remove_dir_all(root).unwrap();
    fs::remove_file(zip_path).unwrap();
    fs::remove_file(pdf_path).unwrap();
}

#[test]
fn combined_folder_import_preserves_source_tracking_and_preflight() {
    use super::entry::{
        check_mineru_zip_reading_pdf, create_from_mineru_client_result,
        CheckMineruZipReadingPdfRequest,
    };

    let scratch = tempfile::tempdir().unwrap();
    let root = scratch.path().join("workspace");
    let workspace = Workspace::create(&root).unwrap();
    let source = scratch.path().join("result");
    fs::create_dir_all(&source).unwrap();
    let zip_bytes = mineru_zip();
    zip::ZipArchive::new(Cursor::new(zip_bytes)).unwrap().extract(&source).unwrap();
    let pdf_path = scratch.path().join("original.pdf");
    fs::write(&pdf_path, RESAVED).unwrap();
    check_mineru_zip_reading_pdf(CheckMineruZipReadingPdfRequest {
        zip_path: source.clone(), pdf_path: pdf_path.clone(),
        pdf_verification: verification("resaved"),
    }).unwrap();
    assert!(workspace.list_entries().unwrap().is_empty());
    let response = create_from_mineru_client_result(request(
        &root, source.clone(), Some(pdf_path), Some(verification("resaved")),
    )).unwrap();
    assert_eq!(fs::read(workspace.layout().entry_pdf_file(&response.entry.id)).unwrap(), RESAVED);
    let source_id = blake3::hash(source.canonicalize().unwrap().to_string_lossy().as_bytes())
        .to_hex().to_string();
    assert_eq!(workspace.mineru_matches().unwrap()[&source_id], response.entry.id);
}

#[test]
fn combined_import_checks_duplicates_of_verified_reading_bytes() {
    use super::entry::create_from_mineru_client_result;

    let root = temp_root("combined_duplicate");
    let workspace = Workspace::create(&root).unwrap();
    let existing = workspace.create_entry("Existing original").unwrap();
    workspace.import_pdf_bytes(&existing.id, "original.pdf", RESAVED).unwrap();
    let zip_path = write_zip(&root);
    let pdf_path = write_candidate(&root, RESAVED);
    let before = file_listing(&root);
    let error = create_from_mineru_client_result(request(
        &root, zip_path.clone(), Some(pdf_path.clone()), Some(verification("resaved")),
    )).unwrap_err();
    assert!(error.contains("Existing original"), "{error}");
    assert_eq!(file_listing(&root), before);
    let mut confirmed = request(
        &root, zip_path.clone(), Some(pdf_path.clone()), Some(verification("resaved")),
    );
    confirmed.confirmed_duplicate_hash = Some(blake3::hash(RESAVED).to_hex().to_string());
    let imported = create_from_mineru_client_result(confirmed).unwrap();
    assert_eq!(fs::read(workspace.layout().entry_pdf_file(&imported.entry.id)).unwrap(), RESAVED);
    assert_eq!(workspace.list_entries().unwrap().len(), 2);
    fs::remove_dir_all(root).unwrap();
    fs::remove_file(zip_path).unwrap();
    fs::remove_file(pdf_path).unwrap();
}

#[test]
fn page_count_mismatch_creates_no_entry_and_writes_nothing() {
    let root = temp_root("page_count");
    Workspace::create(&root).unwrap();
    let zip_path = write_zip(&root);
    let pdf_path = write_candidate(&root, PAGE_COUNT);
    let before = file_listing(&root);

    let error = create_from_mineru_client_result_with(
        request(
            &root,
            zip_path.clone(),
            Some(pdf_path.clone()),
            Some(verification("page_count")),
        ),
        Some(&verification("page_count")),
    )
    .unwrap_err();

    assert!(error.contains("页数不一致"), "{error}");
    assert_eq!(file_listing(&root), before);
    assert!(Workspace::open(&root)
        .unwrap()
        .list_entries()
        .unwrap()
        .is_empty());
    fs::remove_dir_all(root).unwrap();
    fs::remove_file(zip_path).unwrap();
    fs::remove_file(pdf_path).unwrap();
}

#[test]
fn missing_verification_for_pdf_creates_no_entry() {
    let root = temp_root("no_summary");
    Workspace::create(&root).unwrap();
    let zip_path = write_zip(&root);
    let pdf_path = write_candidate(&root, RESAVED);
    let before = file_listing(&root);

    let error = create_from_mineru_client_result_with(
        request(&root, zip_path.clone(), Some(pdf_path.clone()), None),
        None,
    )
    .unwrap_err();

    assert!(error.contains("缺少原始 PDF 的校验摘要"), "{error}");
    assert_eq!(file_listing(&root), before);
    fs::remove_dir_all(root).unwrap();
    fs::remove_file(zip_path).unwrap();
    fs::remove_file(pdf_path).unwrap();
}

#[test]
fn candidate_bytes_changed_after_summary_are_rejected() {
    // The summary was taken from `resaved`, but the file on disk now holds `page_count`.
    let root = temp_root("toctou");
    Workspace::create(&root).unwrap();
    let zip_path = write_zip(&root);
    let pdf_path = write_candidate(&root, PAGE_COUNT);
    let before = file_listing(&root);

    let error = create_from_mineru_client_result_with(
        request(
            &root,
            zip_path.clone(),
            Some(pdf_path.clone()),
            Some(verification("resaved")),
        ),
        Some(&verification("resaved")),
    )
    .unwrap_err();

    assert!(error.contains("校验摘要不一致"), "{error}");
    assert_eq!(file_listing(&root), before);
    fs::remove_dir_all(root).unwrap();
    fs::remove_file(zip_path).unwrap();
    fs::remove_file(pdf_path).unwrap();
}

#[test]
fn zip_only_import_keeps_extracted_origin_pdf_without_verification() {
    let root = temp_root("zip_only");
    Workspace::create(&root).unwrap();
    let zip_path = write_zip(&root);

    let response =
        create_from_mineru_client_result_with(request(&root, zip_path.clone(), None, None), None)
            .unwrap();

    let workspace = Workspace::open(&root).unwrap();
    let pdf = workspace
        .read_entry(&response.entry.id)
        .unwrap()
        .pdf
        .unwrap();
    assert_eq!(pdf.content_hash, blake3::hash(ORIGIN).to_hex().to_string());
    assert_eq!(pdf.parse.status, PdfParseStatus::Succeeded);
    fs::remove_dir_all(root).unwrap();
    fs::remove_file(zip_path).unwrap();
}

#[test]
fn preflight_check_accepts_matching_pdf_and_rejects_mismatch_without_side_effects() {
    use super::entry::{check_mineru_zip_reading_pdf, CheckMineruZipReadingPdfRequest};

    let root = temp_root("preflight");
    let zip_path = write_zip(&root);
    // Each candidate needs its own path; `write_candidate` derives it from the root.
    let matching = write_candidate(&temp_root("preflight_ok"), RESAVED);
    let mismatched = write_candidate(&temp_root("preflight_bad"), PAGE_COUNT);

    let accepted = check_mineru_zip_reading_pdf(CheckMineruZipReadingPdfRequest {
        zip_path: zip_path.clone(),
        pdf_path: matching,
        pdf_verification: verification("resaved"),
    });
    assert!(accepted.is_ok(), "{accepted:?}");

    let rejected = check_mineru_zip_reading_pdf(CheckMineruZipReadingPdfRequest {
        zip_path: zip_path.clone(),
        pdf_path: mismatched,
        pdf_verification: verification("page_count"),
    });
    let reason = rejected.unwrap_err();
    assert!(reason.contains("页数不一致"), "{reason}");
    assert!(reason.starts_with("原始 PDF 未通过校验"), "{reason}");

    fs::remove_file(zip_path).unwrap();
}

/// Verifier that verifies normally, then replaces the candidate file on disk.
/// Models an attacker or a concurrent writer changing the path after the check.
struct SwapCandidateAfterVerify {
    inner: PdfPairSummary,
    path: PathBuf,
    replacement: &'static [u8],
}

impl neuink_workspace::reading_pdf::ReadingPdfVerifier for SwapCandidateAfterVerify {
    fn verify(&self, candidate_pdf: &[u8], mineru_origin_pdf: &[u8]) -> Result<(), String> {
        let result = self.inner.verify(candidate_pdf, mineru_origin_pdf);
        fs::write(&self.path, self.replacement).unwrap();
        result
    }
}

#[test]
fn combined_import_writes_the_verified_candidate_bytes_even_if_the_path_changes_later() {
    let root = temp_root("toctou");
    Workspace::create(&root).unwrap();
    let zip_path = write_zip(&root);
    let pdf_path = write_candidate(&root, RESAVED);
    let verifier = SwapCandidateAfterVerify {
        inner: verification("resaved"),
        path: pdf_path.clone(),
        replacement: PAGE_COUNT,
    };

    let response = create_from_mineru_client_result_with(
        request(&root, zip_path.clone(), Some(pdf_path.clone()), None),
        Some(&verifier),
    )
    .unwrap();

    let workspace = Workspace::open(&root).unwrap();
    assert_eq!(
        fs::read(workspace.layout().entry_pdf_file(&response.entry.id)).unwrap(),
        RESAVED,
        "stored PDF must be the bytes that passed verification"
    );
    let pdf = response.entry.pdf.as_ref().unwrap();
    assert_eq!(pdf.content_hash, blake3::hash(RESAVED).to_hex().to_string());
    assert_eq!(
        pdf.file_name,
        pdf_path.file_name().unwrap().to_str().unwrap()
    );
    // The path now holds other bytes, which proves the later read did not reach the store.
    assert_eq!(fs::read(&pdf_path).unwrap(), PAGE_COUNT);

    fs::remove_file(zip_path).unwrap();
    fs::remove_file(pdf_path).unwrap();
}
