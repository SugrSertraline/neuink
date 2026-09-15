use super::*;
use neuink_domain::{EntryId, SegmentType};
use std::{fs, io::Cursor, path::PathBuf};
mod fixtures;
use fixtures::{representative_fixture, segment, translated, zip_text, Fixture};
mod diagrams;
mod draft;
mod preview;
mod reading;
mod reading_scope;

// Legacy cases exercise the recommended defaults; configurable modes have dedicated regression cases.
fn prepare(
    workspace: &crate::Workspace,
    id: &EntryId,
    kind: PaperExportKind,
) -> Result<PreparedExport, String> {
    super::prepare(workspace, id, kind, &PaperExportOptions::default())
}
fn inspect_paper_export(
    workspace: &crate::Workspace,
    id: &EntryId,
    kind: PaperExportKind,
) -> Result<PaperExportInspection, String> {
    super::inspect_paper_export(workspace, id, kind, &PaperExportOptions::default())
}
fn export_paper(
    workspace: &crate::Workspace,
    id: &EntryId,
    kind: PaperExportKind,
    format: PaperExportFormat,
    target: &std::path::Path,
    expected_fingerprint: &str,
    allow_draft: bool,
) -> Result<PaperExportInspection, String> {
    super::export_paper(
        workspace,
        id,
        PaperExportRequest {
            kind,
            format,
            target,
            expected_fingerprint,
            allow_draft,
            options: &PaperExportOptions::default(),
            rendered_diagrams: &[],
        },
    )
}

#[test]
fn image_rewriting_preserves_prose_code_alt_text_and_html_tables() {
    let source = "A file named a is data. `![code](a)`\n\n![caption](a)\n\n![reference][image]\n\n[image]: a\n\n<table><tr><td>Keep a</td><td><img src='a' alt='a'></td></tr></table>";
    let rewritten = resources::rewrite_images(
        source,
        &BTreeMap::from([("a".into(), "assets/image.png".into())]),
    );
    assert!(rewritten.contains("A file named a is data. `![code](a)`"));
    assert!(rewritten.contains("![caption](assets/image.png)"));
    assert!(rewritten.contains("![reference](assets/image.png)"));
    assert!(rewritten.contains("<td>Keep a</td>"));
    assert_eq!(
        resources::image_references(&rewritten),
        vec!["assets/image.png"; 3]
    );
}

#[test]
fn translation_accounts_for_every_source_instead_of_trusting_progress() {
    let a = segment(SegmentType::Paragraph, "First statement");
    let b = segment(SegmentType::PageFootnote, "Footnote cannot disappear");
    let c = segment(SegmentType::Paragraph, "Appendix changed");
    let d = segment(SegmentType::Math, "$$a^2+b^2=c^2$$");
    let fixture = Fixture::new(&[a.clone(), b.clone(), c.clone(), d]);
    let mut old = translated(&c, "旧附录");
    old.source_hash = "old".into();
    fixture.translations(vec![translated(&a, "第一项"), translated(&b, ""), old]);
    let prepared = prepare(
        &fixture.workspace,
        &fixture.id,
        PaperExportKind::Translation,
    )
    .unwrap();
    let report = &prepared.report;
    assert_eq!(
        (
            report.total,
            report.translated,
            report.preserved,
            report.missing,
            report.stale
        ),
        (4, 1, 1, 1, 1)
    );
    assert!(report.requires_draft);
    for text in [
        "第一项",
        "Footnote cannot disappear",
        "Appendix changed",
        "a^2+b^2=c^2",
    ] {
        assert!(prepared.markdown.contains(text));
    }
    assert!(!prepared.markdown.contains("旧附录"));
}

#[test]
fn source_export_needs_neither_pdf_nor_translation() {
    let mut source = segment(
        SegmentType::Heading,
        "Text must survive an empty markdown field",
    );
    source.markdown = Some(String::new());
    let fixture = Fixture::new(&[source]);
    let report = fixture.inspect(PaperExportKind::Source);
    assert!(!report.requires_draft);
    let path = fixture.base.join("source.txt");
    export_paper(
        &fixture.workspace,
        &fixture.id,
        PaperExportKind::Source,
        PaperExportFormat::Txt,
        &path,
        &report.fingerprint,
        false,
    )
    .unwrap();
    assert!(fs::read_to_string(path)
        .unwrap()
        .contains("Text must survive"));
}

#[test]
fn missing_translation_requires_explicit_draft_and_keeps_original() {
    let fixture = Fixture::new(&[segment(SegmentType::Paragraph, "All source text remains")]);
    let report = fixture.inspect(PaperExportKind::Translation);
    let path = fixture.base.join("draft.txt");
    assert!(export_paper(
        &fixture.workspace,
        &fixture.id,
        PaperExportKind::Translation,
        PaperExportFormat::Txt,
        &path,
        &report.fingerprint,
        false
    )
    .is_err());
    assert!(!path.exists());
    export_paper(
        &fixture.workspace,
        &fixture.id,
        PaperExportKind::Translation,
        PaperExportFormat::Txt,
        &path,
        &report.fingerprint,
        true,
    )
    .unwrap();
    let text = fs::read_to_string(path).unwrap();
    assert!(text.contains("草稿") && text.contains("All source text remains"));
}

#[test]
fn changed_snapshot_never_overwrites_destination() {
    let fixture = Fixture::new(&[segment(SegmentType::Paragraph, "Before")]);
    let report = fixture.inspect(PaperExportKind::Source);
    fixture
        .workspace
        .write_segments(&fixture.id, &[segment(SegmentType::Paragraph, "After")])
        .unwrap();
    let path = fixture.base.join("existing.txt");
    fs::write(&path, "do not overwrite").unwrap();
    assert!(export_paper(
        &fixture.workspace,
        &fixture.id,
        PaperExportKind::Source,
        PaperExportFormat::Txt,
        &path,
        &report.fingerprint,
        true
    )
    .is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "do not overwrite");
}

#[test]
fn figure_and_resource_checks_are_independent_of_translation_success() {
    let mut figure = segment(SegmentType::Figure, "Flow diagram");
    figure.asset_path = Some("images/diagram.png".into());
    let fixture = Fixture::new(&[figure.clone()]);
    let missing = fixture.inspect(PaperExportKind::Translation);
    assert_eq!((missing.unverified_images, missing.missing_assets), (1, 1));
    assert!(missing.requires_draft);
    fixture.image("images/diagram.png");
    let found = fixture.inspect(PaperExportKind::Translation);
    assert_eq!((found.unverified_images, found.missing_assets), (1, 0));
    assert!(!found.requires_draft);
    assert_ne!(missing.fingerprint, found.fingerprint);
    assert!(!fixture.inspect(PaperExportKind::Source).requires_draft);
}

#[test]
fn archive_contains_only_referenced_assets_and_portable_names() {
    let mut figure = segment(SegmentType::Figure, "![diagram](images/a.png)");
    figure.asset_path = Some("images/a.png".into());
    let fixture = Fixture::new(&[figure]);
    fixture.image("images/a.png");
    fixture.image("images/unrelated.png");
    let prepared = prepare(&fixture.workspace, &fixture.id, PaperExportKind::Source).unwrap();
    let bytes = writers::write(&prepared, PaperExportFormat::MarkdownZip).unwrap();
    let archive = zip::ZipArchive::new(Cursor::new(&bytes)).unwrap();
    assert_eq!(archive.len(), 4);
    assert_eq!(
        archive
            .file_names()
            .filter(|name| name.starts_with("assets/"))
            .count(),
        1
    );
    let md = zip_text(&bytes, "paper.md");
    assert!(md.contains("assets/") && !md.contains("images/a.png"));
    assert!(!md.contains(&fixture.base.to_string_lossy().to_string()));
    assert!(zip_text(&bytes, "coverage.json").contains("fingerprint"));
}

#[test]
fn untrusted_image_paths_are_not_read_or_leaked() {
    for reference in [
        "../secret.png",
        "C:/private.png",
        "https://example.com/private.png",
        "images\\private.png",
    ] {
        let mut figure = segment(SegmentType::Figure, &format!("![Figure]({reference})"));
        figure.asset_path = Some(reference.into());
        let fixture = Fixture::new(&[figure]);
        let prepared = prepare(&fixture.workspace, &fixture.id, PaperExportKind::Source).unwrap();
        assert!(prepared.report.missing_assets > 0);
        assert!(prepared.assets.is_empty());
        assert!(!prepared.markdown.contains(reference));
    }
}

#[test]
fn destination_cannot_replace_workspace_files_or_use_wrong_extension() {
    let fixture = Fixture::new(&[segment(SegmentType::Paragraph, "Hello")]);
    let report = fixture.inspect(PaperExportKind::Source);
    for path in [
        fixture
            .workspace
            .layout()
            .entry_dir(&fixture.id)
            .join("paper.txt"),
        fixture.base.join("bad.pdf"),
    ] {
        assert!(export_paper(
            &fixture.workspace,
            &fixture.id,
            PaperExportKind::Source,
            PaperExportFormat::Txt,
            &path,
            &report.fingerprint,
            true
        )
        .is_err());
        assert!(!path.exists());
    }
    assert!(inspect_paper_export(
        &fixture.workspace,
        &EntryId::from_string("../outside"),
        PaperExportKind::Source
    )
    .is_err());
}

#[test]
fn docx_contains_chinese_table_formula_and_embedded_picture() {
    let fixture = representative_fixture();
    let prepared = prepare(&fixture.workspace, &fixture.id, PaperExportKind::Bilingual).unwrap();
    let bytes = writers::write(&prepared, PaperExportFormat::Docx).unwrap();
    let xml = zip_text(&bytes, "word/document.xml");
    for expected in [
        "有机合成研究",
        "反应条件",
        "Catalyst",
        "<w:tbl>",
        "<w:drawing>",
        "E=mc^2",
        "脚注",
    ] {
        assert!(xml.contains(expected), "Missing {expected}");
    }
    let archive = zip::ZipArchive::new(Cursor::new(&bytes)).unwrap();
    assert!(archive
        .file_names()
        .any(|name| name.starts_with("word/media/")));
    assert!(zip_text(&bytes, "word/styles.xml").contains("Microsoft YaHei"));
}

#[test]
fn code_and_empty_image_references_do_not_erase_text() {
    let code = segment(
        SegmentType::Code,
        "<script>do_not_execute()</script>\nif x < 2:\n    y = 3",
    );
    let image = segment(SegmentType::Figure, "<img src=''> Caption survives");
    let fixture = Fixture::new(&[code, image]);
    let prepared = prepare(&fixture.workspace, &fixture.id, PaperExportKind::Source).unwrap();
    let text =
        String::from_utf8(writers::write(&prepared, PaperExportFormat::Txt).unwrap()).unwrap();
    assert!(
        text.contains("do_not_execute()")
            && text.contains("    y = 3")
            && text.contains("Caption survives")
    );
    assert!(prepared.report.requires_draft);
}

#[test]
fn generated_images_are_never_fetched_or_mislabeled_as_complete() {
    let source = segment(SegmentType::Paragraph, "Some text");
    let fixture = Fixture::new(&[source.clone()]);
    fixture.translations(vec![translated(
        &source,
        "一些文字 ![unexpected](https://example.com/private.png)",
    )]);
    let prepared = prepare(
        &fixture.workspace,
        &fixture.id,
        PaperExportKind::Translation,
    )
    .unwrap();
    assert!(prepared.report.requires_draft);
    assert_eq!(prepared.report.missing_assets, 1);
    assert!(!prepared
        .markdown
        .contains("https://example.com/private.png"));
}

#[test]
fn pdf_import_and_mineru_archive_preserve_the_same_export_content() {
    let source = segment(SegmentType::Figure, "![diagram](images/a.png)");
    let fixture = Fixture::new(&[source]);
    fixture.image("images/a.png");
    let before = fixture.inspect(PaperExportKind::Source);
    let asset_bytes = fs::read(
        fixture
            .workspace
            .layout()
            .entry_mineru_output_dir(&fixture.id)
            .join("images/a.png"),
    )
    .unwrap();
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    archive
        .start_file("images/a.png", zip::write::SimpleFileOptions::default())
        .unwrap();
    std::io::Write::write_all(&mut archive, &asset_bytes).unwrap();
    fixture
        .workspace
        .write_mineru_output_zip(&fixture.id, &archive.finish().unwrap().into_inner())
        .unwrap();
    assert_eq!(
        before.fingerprint,
        fixture.inspect(PaperExportKind::Source).fingerprint
    );
    let pdf = fixture.base.join("source.pdf");
    fs::write(&pdf, b"%PDF-1.7\n%%EOF").unwrap();
    fixture.workspace.import_pdf(&fixture.id, &pdf).unwrap();
    assert_eq!(
        before.fingerprint,
        fixture.inspect(PaperExportKind::Source).fingerprint
    );
}

#[test]
#[ignore = "Generates review samples through the production exporter; requires NEUINK_EXPORT_QA_DIR"]
fn write_review_samples() {
    let output =
        PathBuf::from(std::env::var("NEUINK_EXPORT_QA_DIR").expect("Set explicit QA directory"));
    fs::create_dir_all(&output).unwrap();
    let fixture = representative_fixture();
    for (kind, name) in [
        (PaperExportKind::Source, "source"),
        (PaperExportKind::Translation, "translation"),
        (PaperExportKind::Bilingual, "bilingual"),
    ] {
        let report = fixture.inspect(kind);
        export_paper(
            &fixture.workspace,
            &fixture.id,
            kind,
            PaperExportFormat::Docx,
            &output.join(format!("{name}.docx")),
            &report.fingerprint,
            true,
        )
        .unwrap();
    }
}
