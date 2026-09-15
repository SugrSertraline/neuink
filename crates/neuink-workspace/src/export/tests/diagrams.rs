use super::super::*;
use super::fixtures::{segment, zip_text, Fixture};
use base64::Engine;
use neuink_domain::SegmentType;
use std::{fs, io::Cursor};

const MERMAID: &str = "```mermaid\ngraph LR\n  A[\"输入\"] --> B[\"分析\"]\n```";

fn fixture() -> Fixture {
    let mut figure = segment(SegmentType::Figure, MERMAID);
    figure.asset_path = Some("images/diagram.png".into());
    figure.sub_type = Some("flowchart".into());
    figure.visual_group_id = Some("visual-image-p2".into());
    let mut caption = segment(SegmentType::Paragraph, "Fig. 1 **Pipeline** caption");
    caption.block_role = Some("caption".into());
    caption.visual_group_id = figure.visual_group_id.clone();
    let mut heading = segment(SegmentType::Heading, "2 Methods");
    heading.mineru_metadata.insert("level".into(), "2".into());
    let result = Fixture::new(&[heading, figure, caption]);
    result.image("images/diagram.png");
    result
}

fn prepare_mode(fixture: &Fixture, mode: DiagramExportMode) -> PreparedExport {
    prepare(
        &fixture.workspace,
        &fixture.id,
        PaperExportKind::Source,
        &PaperExportOptions {
            diagrams: mode,
            ..Default::default()
        },
    )
    .unwrap()
}

#[test]
fn real_mineru_figure_defaults_to_original_not_raw_mermaid() {
    let fixture = fixture();
    let prepared = prepare_mode(&fixture, DiagramExportMode::Original);
    assert_eq!(prepared.report.diagrams.len(), 1);
    assert!(!prepared.report.requires_draft);
    assert!(!prepared.markdown.contains("graph LR"));
    assert!(prepared.markdown.contains("![原图](assets/"));
    assert!(prepared.markdown.contains("## 2 Methods"));
    assert!(!prepared.markdown.contains("来源：第"));
    assert!(prepared.markdown.contains("Pipeline"));
    let xml = zip_text(
        &writers::write(&prepared, PaperExportFormat::Docx).unwrap(),
        "word/document.xml",
    );
    assert_eq!(xml.matches("<w:drawing>").count(), 1);
    assert!(xml.contains("w:val=\"Heading2\"") && xml.contains("w:val=\"Caption\""));
    assert!(xml.contains("<w:b") && xml.contains("<w:keepNext"));
    let archive = writers::write(&prepared, PaperExportFormat::MarkdownZip).unwrap();
    assert!(!zip_text(&archive, "coverage.json").contains("graph LR"));
}

#[test]
fn source_mode_omits_original_and_keeps_editable_mermaid_without_double_fences() {
    let fixture = fixture();
    let prepared = prepare_mode(&fixture, DiagramExportMode::Mermaid);
    assert!(prepared.assets.is_empty());
    assert!(!prepared.report.requires_draft);
    assert!(prepared.markdown.contains(MERMAID));
    assert_eq!(prepared.diagram_sources.len(), 1);
    let bytes = writers::write(&prepared, PaperExportFormat::MarkdownZip).unwrap();
    let archive = zip::ZipArchive::new(Cursor::new(&bytes)).unwrap();
    assert_eq!(
        archive
            .file_names()
            .filter(|name| name.ends_with(".mmd"))
            .count(),
        1
    );
    let xml = zip_text(
        &writers::write(&prepared, PaperExportFormat::Docx).unwrap(),
        "word/document.xml",
    );
    assert!(xml.contains("SourceCode") && !xml.contains("<w:drawing>"));
    assert!(!xml.contains("```mermaid"));
    let code = segment(SegmentType::Code, MERMAID);
    let source = super::super::diagrams::source_body(&code);
    assert_eq!(source, MERMAID);
    assert_eq!(super::super::diagrams::extract(&source, &code).len(), 1);
}

#[test]
fn both_mode_moves_code_to_appendix_and_preserves_caption_order() {
    let fixture = fixture();
    let prepared = prepare_mode(&fixture, DiagramExportMode::OriginalWithSource);
    assert!(
        prepared.markdown.find("Fig. 1").unwrap()
            < prepared.markdown.find("Mermaid 源码附录").unwrap()
    );
    assert_eq!(prepared.markdown.matches("graph LR").count(), 1);
    assert_eq!(prepared.assets.len(), 1);
}

#[test]
fn missing_original_falls_back_to_code_and_requires_draft() {
    let fixture = Fixture::new(&[segment(SegmentType::Figure, MERMAID)]);
    let prepared = prepare_mode(&fixture, DiagramExportMode::Original);
    assert!(prepared.markdown.contains(MERMAID));
    assert!(prepared.report.requires_draft);
    assert!(prepared
        .report
        .issues
        .iter()
        .any(|issue| issue.message.contains("已保留 Mermaid")));
    assert!(
        !prepare_mode(&fixture, DiagramExportMode::Mermaid)
            .report
            .requires_draft
    );
}

#[test]
fn rendered_images_are_bound_to_the_inspected_diagram_and_png_is_validated() {
    let fixture = fixture();
    let mut prepared = prepare_mode(&fixture, DiagramExportMode::Rendered);
    let id = prepared.report.diagrams[0].id.clone();
    assert!(prepared.assets.is_empty());
    assert!(prepared.markdown.contains(&format!("diagrams/{id}.png")));
    assert!(
        super::super::diagrams::attach_rendered(&mut prepared, &[], PaperExportFormat::Docx)
            .is_err()
    );
    let bytes = fs::read(
        fixture
            .workspace
            .layout()
            .entry_mineru_output_dir(&fixture.id)
            .join("images/diagram.png"),
    )
    .unwrap();
    let mut render = RenderedExportDiagram {
        id,
        png_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    };
    let real_id = render.id.clone();
    render.id = "forged".into();
    assert!(super::super::diagrams::attach_rendered(
        &mut prepared,
        &[render.clone()],
        PaperExportFormat::Docx
    )
    .is_err());
    render.id = real_id;
    super::super::diagrams::attach_rendered(
        &mut prepared,
        &[render.clone()],
        PaperExportFormat::Docx,
    )
    .unwrap();
    let xml = zip_text(
        &writers::write(&prepared, PaperExportFormat::Docx).unwrap(),
        "word/document.xml",
    );
    assert_eq!(xml.matches("<w:drawing>").count(), 1);
    assert!(!xml.contains("graph LR"));
    render.png_base64 = base64::engine::general_purpose::STANDARD.encode(b"not a PNG");
    assert!(super::super::diagrams::attach_rendered(
        &mut prepared,
        &[render],
        PaperExportFormat::Docx
    )
    .is_err());
}

#[test]
fn options_invalidate_fingerprint_and_source_numbers_are_optional() {
    let fixture = fixture();
    let initial = prepare_mode(&fixture, DiagramExportMode::Original);
    let options = PaperExportOptions {
        include_source_refs: true,
        image_width: ExportImageWidth::Compact,
        ..Default::default()
    };
    let prepared = prepare(
        &fixture.workspace,
        &fixture.id,
        PaperExportKind::Source,
        &options,
    )
    .unwrap();
    assert_ne!(initial.report.fingerprint, prepared.report.fingerprint);
    assert!(prepared.markdown.contains("来源：第"));
    let target = fixture.base.join("stale.docx");
    assert!(export_paper(
        &fixture.workspace,
        &fixture.id,
        PaperExportRequest {
            kind: PaperExportKind::Source,
            format: PaperExportFormat::Docx,
            target: &target,
            expected_fingerprint: &initial.report.fingerprint,
            allow_draft: true,
            options: &options,
            rendered_diagrams: &[]
        }
    )
    .is_err());
    assert!(!target.exists());
}

#[test]
fn mixed_markdown_image_and_text_mermaid_obey_selection_without_losing_caption() {
    let mut figure = segment(SegmentType::Figure, MERMAID);
    figure.markdown = Some("![diagram](images/diagram.png)\n\nFigure explanation".into());
    figure.asset_path = Some("images/diagram.png".into());
    let fixture = Fixture::new(&[figure]);
    fixture.image("images/diagram.png");
    for mode in [DiagramExportMode::Mermaid, DiagramExportMode::Rendered] {
        let prepared = prepare_mode(&fixture, mode);
        assert!(prepared.assets.is_empty());
        assert!(prepared.markdown.contains("Figure explanation"));
        assert!(!prepared.markdown.contains("assets/"));
        assert_eq!(prepared.report.missing_assets, 0);
    }
}

#[test]
#[ignore = "Reads explicit local paper and writes review files; requires NEUINK_EXPORT_QA_DIR and NEUINK_EXPORT_QA_ROOT"]
fn write_real_paper_review_samples() {
    let output = std::path::PathBuf::from(std::env::var("NEUINK_EXPORT_QA_DIR").unwrap());
    let workspace =
        crate::Workspace::open_existing(std::env::var("NEUINK_EXPORT_QA_ROOT").unwrap()).unwrap();
    let id = neuink_domain::EntryId::from_string(&std::env::var("NEUINK_EXPORT_QA_ENTRY").unwrap());
    for (mode, name) in [
        (DiagramExportMode::Original, "original"),
        (DiagramExportMode::Mermaid, "mermaid"),
        (DiagramExportMode::OriginalWithSource, "both"),
        (DiagramExportMode::Rendered, "rendered"),
    ] {
        let options = PaperExportOptions {
            diagrams: mode,
            ..Default::default()
        };
        let inspection =
            inspect_paper_export(&workspace, &id, PaperExportKind::Source, &options).unwrap();
        let rendered = if mode == DiagramExportMode::Rendered {
            assert_eq!(
                inspection.diagrams.len(),
                1,
                "This fixture needs exactly one pre-rendered PNG"
            );
            vec![RenderedExportDiagram {
                id: inspection.diagrams[0].id.clone(),
                png_base64: base64::engine::general_purpose::STANDARD
                    .encode(fs::read(std::env::var("NEUINK_EXPORT_QA_PNG").unwrap()).unwrap()),
            }]
        } else {
            Vec::new()
        };
        for format in [PaperExportFormat::Docx, PaperExportFormat::MarkdownZip] {
            export_paper(
                &workspace,
                &id,
                PaperExportRequest {
                    kind: PaperExportKind::Source,
                    format,
                    target: &output.join(format!("real-{name}.{}", format.extension())),
                    expected_fingerprint: &inspection.fingerprint,
                    allow_draft: true,
                    options: &options,
                    rendered_diagrams: &rendered,
                },
            )
            .unwrap();
        }
    }
}
