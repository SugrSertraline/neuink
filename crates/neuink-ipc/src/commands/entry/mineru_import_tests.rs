use std::{collections::BTreeMap, fs};

use super::{
    check_pdf_duplicate, create_from_mineru_client_result, import_mineru_client_result,
    queue_pdf_parse,
    CheckPdfDuplicateRequest, CreateFromMineruClientResultRequest, ImportMineruClientResultRequest,
    PdfDuplicateSource, QueuePdfParseRequest,
};

#[test]
fn creates_entry_from_result_directory() {
    let root = tempfile::tempdir().unwrap();
    let workspace_root = root.path().join("workspace");
    let workspace = neuink_workspace::Workspace::create(&workspace_root).unwrap();
    let source = root.path().join("result");
    fs::create_dir_all(source.join("images")).unwrap();
    fs::write(
        source.join("paper_content_list.json"),
        br#"[{"type":"text","text":"Hello MinerU","page_idx":0,"bbox":[1,2,3,4]}]"#,
    )
    .unwrap();
    fs::write(source.join("paper_origin.pdf"), b"%PDF-1.4\n").unwrap();
    let result = create_from_mineru_client_result(CreateFromMineruClientResultRequest {
        root: workspace_root,
        title: "Paper".into(),
        fields: BTreeMap::new(),
        tags: Vec::new(),
        zip_path: source,
    })
    .unwrap();
    assert_eq!(result.segment_count, 1);
    assert_eq!(
        workspace.read_segments(&result.entry.id).unwrap()[0].text,
        "Hello MinerU"
    );
    assert!(result.entry.pdf.is_some());
}

#[test]
fn invalid_result_does_not_create_entry() {
    let root = tempfile::tempdir().unwrap();
    let workspace_root = root.path().join("workspace");
    let workspace = neuink_workspace::Workspace::create(&workspace_root).unwrap();
    let source = root.path().join("result");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("paper_origin.pdf"), b"%PDF-1.4\n").unwrap();
    let result = create_from_mineru_client_result(CreateFromMineruClientResultRequest {
        root: workspace_root,
        title: "Paper".into(),
        fields: BTreeMap::new(),
        tags: Vec::new(),
        zip_path: source,
    });
    assert!(result.is_err());
    assert!(workspace.list_entries().unwrap().is_empty());
}

#[test]
fn imports_text_only_result_into_existing_pdf_entry() {
    let root = tempfile::tempdir().unwrap();
    let workspace_root = root.path().join("workspace");
    let workspace = neuink_workspace::Workspace::create(&workspace_root).unwrap();
    let entry = workspace
        .create_entry_with_meta("Paper", BTreeMap::new(), Vec::new())
        .unwrap();
    let pdf = root.path().join("paper.pdf");
    fs::write(&pdf, b"%PDF-1.4\n").unwrap();
    workspace.import_pdf(&entry.id, pdf).unwrap();
    let source = root.path().join("result");
    fs::create_dir_all(&source).unwrap();
    fs::write(
        source.join("paper_content_list.json"),
        br#"[{"type":"text","text":"Existing paper","page_idx":0,"bbox":[1,2,3,4]}]"#,
    )
    .unwrap();
    let result = import_mineru_client_result(ImportMineruClientResultRequest {
        root: workspace_root,
        entry_id: entry.id.clone(),
        zip_path: source,
    })
    .unwrap();
    assert_eq!(result.segment_count, 1);
    assert_eq!(
        workspace.read_segments(&entry.id).unwrap()[0].text,
        "Existing paper"
    );
    assert!(result.entry.pdf.is_some());
}

#[test]
fn detects_renamed_pdf_and_refuses_duplicate_mineru_creation() {
    let root = tempfile::tempdir().unwrap();
    let workspace_root = root.path().join("workspace");
    let workspace = neuink_workspace::Workspace::create(&workspace_root).unwrap();
    let original = root.path().join("original.pdf");
    let renamed = root.path().join("another-name.pdf");
    fs::write(&original, b"%PDF-1.4\nidentical bytes").unwrap();
    fs::write(&renamed, b"%PDF-1.4\nidentical bytes").unwrap();
    let entry = workspace.create_entry("Existing").unwrap();
    workspace.import_pdf(&entry.id, &original).unwrap();
    let duplicate = check_pdf_duplicate(CheckPdfDuplicateRequest {
        root: workspace_root.clone(), path: renamed, source: PdfDuplicateSource::Pdf,
    }).unwrap().unwrap();
    assert_eq!(duplicate.entry_id, entry.id.to_string());
    let empty = workspace.create_entry("Not imported").unwrap();
    let rejected = queue_pdf_parse(QueuePdfParseRequest {
        root: workspace_root.clone(), entry_id: empty.id.clone(), pdf_path: original,
        enqueue: false,
    });
    assert!(rejected.unwrap_err().contains("Existing"));
    assert!(workspace.read_entry(&empty.id).unwrap().pdf.is_none());

    let source = root.path().join("result");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("paper_origin.pdf"), b"%PDF-1.4\nidentical bytes").unwrap();
    fs::write(source.join("paper_content_list.json"), br#"[{"type":"text","text":"Hello","page_idx":0,"bbox":[1,2,3,4]}]"#).unwrap();
    let result = create_from_mineru_client_result(CreateFromMineruClientResultRequest {
        root: workspace_root, title: "Duplicate".into(), fields: BTreeMap::new(),
        tags: Vec::new(), zip_path: source,
    });
    assert!(result.unwrap_err().contains("Existing"));
    assert_eq!(workspace.list_entries().unwrap().len(), 2);
}
