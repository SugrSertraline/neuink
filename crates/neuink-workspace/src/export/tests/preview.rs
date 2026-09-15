use super::*;
use base64::Engine;

fn preview(
    fixture: &Fixture,
    uid: &str,
    kind: PaperExportKind,
    options: &PaperExportOptions,
) -> PaperExportPreview {
    let report =
        super::super::inspect_paper_export(&fixture.workspace, &fixture.id, kind, options).unwrap();
    preview_paper_export(
        &fixture.workspace,
        &fixture.id,
        PaperExportPreviewRequest {
            kind,
            options,
            expected_fingerprint: &report.fingerprint,
            segment_uid: uid,
        },
    )
    .unwrap()
}

#[test]
fn selected_image_preview_uses_the_export_body_and_only_verified_embedded_assets() {
    let figure = segment(SegmentType::Figure, "![Figure caption](images/a.png)");
    let other = segment(
        SegmentType::Paragraph,
        "Other segment must not leak into preview",
    );
    let fixture = Fixture::new(&[figure.clone(), other]);
    fixture.image("images/a.png");
    let preview = preview(
        &fixture,
        figure.uid.as_str(),
        PaperExportKind::Translation,
        &PaperExportOptions::default(),
    );
    assert_eq!(preview.segment_uid, figure.uid.as_str());
    assert_eq!(preview.page, 1);
    assert_eq!(preview.assets.len(), 1);
    let (name, url) = preview.assets.iter().next().unwrap();
    assert!(preview.markdown.contains(name));
    assert!(preview.markdown.contains("Figure caption"));
    assert!(!preview.markdown.contains("Other segment"));
    assert!(!preview.markdown.contains("images/a.png"));
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(url.strip_prefix("data:image/png;base64,").unwrap())
        .unwrap();
    assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    let document = prepare(
        &fixture.workspace,
        &fixture.id,
        PaperExportKind::Translation,
    )
    .unwrap();
    assert!(document.markdown.contains(&preview.markdown));
    assert!(!serde_json::to_string(&preview)
        .unwrap()
        .contains(&fixture.base.to_string_lossy().to_string()));
}

#[test]
fn missing_and_stale_translation_previews_keep_current_originals() {
    let missing = segment(
        SegmentType::Table,
        "| Current table | Value |\n| --- | --- |\n| A | 42 |",
    );
    let stale = segment(SegmentType::Paragraph, "Changed current source");
    let fixture = Fixture::new(&[missing.clone(), stale.clone()]);
    let mut old = translated(&stale, "Do not show obsolete translation");
    old.source_hash = "stale".into();
    fixture.translations(vec![old]);
    for kind in [PaperExportKind::Translation, PaperExportKind::Bilingual] {
        let table = preview(
            &fixture,
            missing.uid.as_str(),
            kind,
            &PaperExportOptions::default(),
        );
        assert!(table.markdown.contains("待翻译，保留原文"));
        assert!(table.markdown.contains("Current table"));
        let paragraph = preview(
            &fixture,
            stale.uid.as_str(),
            kind,
            &PaperExportOptions::default(),
        );
        assert!(paragraph.markdown.contains("待重译，保留原文"));
        assert!(paragraph.markdown.contains("Changed current source"));
        assert!(!paragraph
            .markdown
            .contains("Do not show obsolete translation"));
    }
}

#[test]
fn preview_does_not_return_untrusted_or_missing_image_destinations() {
    for reference in [
        "../private.png",
        "C:/private.png",
        "https://example.com/private.png",
        "images/gone.png",
    ] {
        let figure = segment(SegmentType::Figure, &format!("![Unavailable]({reference})"));
        let fixture = Fixture::new(&[figure.clone()]);
        let preview = preview(
            &fixture,
            figure.uid.as_str(),
            PaperExportKind::Source,
            &PaperExportOptions::default(),
        );
        assert!(preview.assets.is_empty());
        assert!(!preview.markdown.contains(reference));
        assert!(preview.markdown.contains("missing-asset"));
    }
}

#[test]
fn preview_rejects_changed_snapshots_and_segments_outside_the_inspection() {
    let figure = segment(SegmentType::Figure, "![Figure](images/a.png)");
    let paragraph = segment(SegmentType::Paragraph, "Clean source paragraph");
    let fixture = Fixture::new(&[figure.clone(), paragraph.clone()]);
    let options = PaperExportOptions::default();
    let report = fixture.inspect(PaperExportKind::Source);
    for uid in [paragraph.uid.as_str(), "unknown"] {
        let result = preview_paper_export(
            &fixture.workspace,
            &fixture.id,
            PaperExportPreviewRequest {
                kind: PaperExportKind::Source,
                options: &options,
                expected_fingerprint: &report.fingerprint,
                segment_uid: uid,
            },
        );
        assert!(result.unwrap_err().contains("不在当前检查清单"));
    }
    fixture.image("images/a.png");
    let result = preview_paper_export(
        &fixture.workspace,
        &fixture.id,
        PaperExportPreviewRequest {
            kind: PaperExportKind::Source,
            options: &options,
            expected_fingerprint: &report.fingerprint,
            segment_uid: figure.uid.as_str(),
        },
    );
    assert!(result.unwrap_err().contains("已变化"));
}

#[test]
fn diagram_preview_follows_original_source_and_rendered_export_modes() {
    let mut figure = segment(
        SegmentType::Figure,
        "```mermaid\ngraph LR; A-->B\n```\n\nFigure caption",
    );
    figure.asset_path = Some("images/a.png".into());
    let fixture = Fixture::new(&[figure.clone()]);
    fixture.image("images/a.png");
    for mode in [
        DiagramExportMode::Original,
        DiagramExportMode::Mermaid,
        DiagramExportMode::Rendered,
    ] {
        let options = PaperExportOptions {
            diagrams: mode,
            ..Default::default()
        };
        let preview = preview(
            &fixture,
            figure.uid.as_str(),
            PaperExportKind::Translation,
            &options,
        );
        assert!(preview.markdown.contains("Figure caption"));
        match mode {
            DiagramExportMode::Original => {
                assert_eq!(preview.assets.len(), 1);
                assert!(preview.diagrams.is_empty());
                assert!(!preview.markdown.contains("graph LR"));
            }
            DiagramExportMode::Mermaid => {
                assert!(preview.assets.is_empty());
                assert!(preview.diagrams.is_empty());
                assert!(preview.markdown.contains("```mermaid"));
            }
            DiagramExportMode::Rendered => {
                assert!(preview.assets.is_empty());
                assert_eq!(preview.diagrams.len(), 1);
                assert_eq!(preview.diagrams[0].segment_uid, figure.uid.as_str());
                assert!(preview
                    .markdown
                    .contains(&format!("diagrams/{}.png", preview.diagrams[0].id)));
            }
            _ => unreachable!(),
        }
    }
}
