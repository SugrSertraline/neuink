use std::{collections::BTreeMap, fs};

use super::{
    create_from_mineru_client_result, import_mineru_client_result,
    CreateFromMineruClientResultRequest, ImportMineruClientResultRequest,
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
