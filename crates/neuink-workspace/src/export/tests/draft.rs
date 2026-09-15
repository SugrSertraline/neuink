use super::*;

#[test]
fn image_notices_allow_normal_translation_export_in_every_format() {
    let fixture = representative_fixture();
    for kind in [PaperExportKind::Translation, PaperExportKind::Bilingual] {
        let report = fixture.inspect(kind);
        assert_eq!(
            (report.missing, report.stale, report.missing_assets),
            (0, 0, 0)
        );
        assert_eq!(report.unverified_images, 1);
        assert!(!report.requires_draft);
        for format in [
            PaperExportFormat::Docx,
            PaperExportFormat::Txt,
            PaperExportFormat::MarkdownZip,
        ] {
            let path = fixture.base.join(format!("normal.{}", format.extension()));
            let exported = export_paper(
                &fixture.workspace,
                &fixture.id,
                kind,
                format,
                &path,
                &report.fingerprint,
                false,
            )
            .unwrap();
            assert!(!exported.requires_draft);
            let bytes = fs::read(&path).unwrap();
            let text = match format {
                PaperExportFormat::Docx => {
                    let xml = zip_text(&bytes, "word/document.xml");
                    assert!(xml.contains("<w:drawing>"));
                    xml
                }
                PaperExportFormat::Txt => String::from_utf8(bytes).unwrap(),
                PaperExportFormat::MarkdownZip => {
                    let coverage: serde_json::Value =
                        serde_json::from_str(&zip_text(&bytes, "coverage.json")).unwrap();
                    assert_eq!(coverage["requires_draft"], false);
                    assert_eq!(coverage["unverified_images"], 1);
                    let markdown = zip_text(&bytes, "paper.md");
                    assert!(markdown.contains("assets/"));
                    markdown
                }
            };
            assert!(text.contains("数学模型预测反应产率"));
            assert!(text.contains("内容检查清单"));
            assert!(text.contains("图中文字未做 OCR 翻译核验，仅作提醒"));
            assert!(text.contains("未对原 PDF 逐页核验"));
            assert!(!text.contains("草稿"));
            assert!(!text.contains("完整译稿"));
        }
    }
}

#[test]
fn missing_translation_still_requires_consent_with_an_available_image() {
    let source = segment(
        SegmentType::Paragraph,
        "Source with ![figure](images/a.png)",
    );
    let fixture = Fixture::new(&[source]);
    fixture.image("images/a.png");
    let report = fixture.inspect(PaperExportKind::Translation);
    assert_eq!(
        (
            report.missing,
            report.unverified_images,
            report.missing_assets
        ),
        (1, 1, 0)
    );
    assert!(report.requires_draft);
    let path = fixture.base.join("missing.txt");
    assert!(export_paper(
        &fixture.workspace,
        &fixture.id,
        PaperExportKind::Translation,
        PaperExportFormat::Txt,
        &path,
        &report.fingerprint,
        false,
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
    assert!(text.contains("待翻译，保留原文"));
    assert!(text.contains("Source with"));
    assert!(text.contains("草稿"));
}

#[test]
fn stale_translation_alone_requires_consent_and_keeps_current_source() {
    let source = segment(SegmentType::Paragraph, "Current source");
    let fixture = Fixture::new(&[source.clone()]);
    let mut old = translated(&source, "不应导出的旧译文");
    old.source_hash = "outdated".into();
    fixture.translations(vec![old]);
    let report = fixture.inspect(PaperExportKind::Translation);
    assert_eq!(
        (report.missing, report.stale, report.missing_assets),
        (0, 1, 0)
    );
    assert!(report.requires_draft);
    let path = fixture.base.join("existing.txt");
    fs::write(&path, "existing content").unwrap();
    assert!(export_paper(
        &fixture.workspace,
        &fixture.id,
        PaperExportKind::Translation,
        PaperExportFormat::Txt,
        &path,
        &report.fingerprint,
        false,
    )
    .is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "existing content");
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
    assert!(text.contains("待重译，保留原文"));
    assert!(text.contains("Current source"));
    assert!(!text.contains("不应导出的旧译文"));
}

#[test]
fn missing_image_alone_requires_consent_for_every_content_kind() {
    let fixture = Fixture::new(&[segment(SegmentType::Figure, "![missing](images/gone.png)")]);
    for kind in [
        PaperExportKind::Source,
        PaperExportKind::Translation,
        PaperExportKind::Bilingual,
    ] {
        let report = fixture.inspect(kind);
        assert_eq!(
            (report.missing, report.stale, report.missing_assets),
            (0, 0, 1)
        );
        assert!(report.requires_draft);
        let path = fixture.base.join(format!("{kind:?}.txt"));
        assert!(export_paper(
            &fixture.workspace,
            &fixture.id,
            kind,
            PaperExportFormat::Txt,
            &path,
            &report.fingerprint,
            false,
        )
        .is_err());
        assert!(!path.exists());
        export_paper(
            &fixture.workspace,
            &fixture.id,
            kind,
            PaperExportFormat::Txt,
            &path,
            &report.fingerprint,
            true,
        )
        .unwrap();
        let text = fs::read_to_string(path).unwrap();
        assert!(text.contains("草稿"));
        assert!(text.contains("内容检查清单"));
    }
}
