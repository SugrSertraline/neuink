use super::fixtures::{segment, translated, zip_text, Fixture};
use crate::export::reading::{
    self, ReadingExportFormat as Format, ReadingExportRequest, ReadingExportSelection,
};
use neuink_domain::{
    Annotation, AnnotationImportance, ContentItem, NoteId, SegmentRef, SegmentType, SourceLink,
};
use std::{
    fs,
    io::{Cursor, Read},
    path::Path,
};

fn note(fixture: &Fixture, title: &str, markdown: &str) -> NoteId {
    let entry = fixture.workspace.create_note(&fixture.id, title).unwrap();
    let ContentItem::Note { note_id, .. } = entry.contents.last().unwrap();
    fixture
        .workspace
        .update_note(&fixture.id, note_id, title, markdown)
        .unwrap();
    note_id.clone()
}

fn selected(fixture: &Fixture, note_id: Option<&NoteId>) -> Vec<ReadingExportSelection> {
    reading::inspect(
        &fixture.workspace,
        &fixture.id,
        note_id.map(|id| id.as_str()),
    )
    .unwrap()
    .items
    .into_iter()
    .map(|item| ReadingExportSelection {
        id: item.id,
        fingerprint: item.fingerprint,
    })
    .collect()
}

fn export(
    fixture: &Fixture,
    selected: &[ReadingExportSelection],
    format: Format,
    target: &Path,
    allow: bool,
) -> Result<(), String> {
    reading::export(
        &fixture.workspace,
        &fixture.id,
        ReadingExportRequest {
            selected,
            format,
            target,
            allow_incomplete: allow,
        },
    )
}

#[test]
fn note_only_entry_exports_without_pdf_or_translation_and_never_includes_unselected_notes() {
    let fixture = Fixture::new(&[]);
    let id = note(&fixture, "组会记录", "# 阅读结论\n\n中文与 English 都应保留。\n\n- 论点一\n- 论点二\n\n```mermaid\ngraph LR\nA-->B\n```\n");
    let private = note(&fixture, "私人记录", "PRIVATE_DO_NOT_SHARE");
    let picks = selected(&fixture, Some(&id));
    fixture
        .workspace
        .update_note(&fixture.id, &private, "私人记录", "PRIVATE_NEW")
        .unwrap();
    for (format, extension) in [(Format::Txt, "txt"), (Format::Docx, "docx")] {
        let target = fixture.base.join(format!("selected.{extension}"));
        export(&fixture, &picks, format, &target, false).unwrap();
        let bytes = fs::read(target).unwrap();
        let text = if format == Format::Docx {
            zip_text(&bytes, "word/document.xml")
        } else {
            String::from_utf8(bytes).unwrap()
        };
        assert!(text.contains("中文与 English"));
        assert!(text.contains("A--&gt;B") || text.contains("A-->B"));
        assert!(!text.contains("PRIVATE"));
        assert!(!text.contains("paper.segments"));
    }
}

#[test]
fn selected_revision_changes_block_writes_and_preserve_existing_destination() {
    let fixture = Fixture::new(&[]);
    let id = note(&fixture, "旧标题", "旧内容");
    let picks = selected(&fixture, Some(&id));
    let target = fixture.base.join("result.txt");
    fs::write(&target, "existing destination").unwrap();
    fixture
        .workspace
        .update_note(&fixture.id, &id, "新标题", "新内容")
        .unwrap();
    assert!(export(&fixture, &picks, Format::Txt, &target, false)
        .unwrap_err()
        .contains("已变化"));
    assert_eq!(fs::read_to_string(target).unwrap(), "existing destination");
}

#[test]
fn package_has_unique_safe_names_index_and_only_selected_content() {
    let fixture = Fixture::new(&[]);
    note(&fixture, "CON / 同名", "第一项");
    note(&fixture, "CON / 同名", "第二项");
    let picks = selected(&fixture, None);
    for (format, name) in [(Format::TxtZip, "text.zip"), (Format::DocxZip, "word.zip")] {
        let path = fixture.base.join(name);
        export(&fixture, &picks, format, &path, false).unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(fs::read(path).unwrap())).unwrap();
        assert_eq!(archive.len(), 3);
        let names: Vec<_> = archive.file_names().map(str::to_owned).collect();
        assert_eq!(
            names
                .iter()
                .filter(|name| name.ends_with("索引.txt"))
                .count(),
            1
        );
        for name in &names {
            assert_eq!(name.split('/').count(), 2);
            assert!(!name.contains(".."));
            assert!(!name.contains(':'));
        }
        let mut index = String::new();
        archive
            .by_name(
                names
                    .iter()
                    .find(|name| name.ends_with("索引.txt"))
                    .unwrap(),
            )
            .unwrap()
            .read_to_string(&mut index)
            .unwrap();
        assert!(index.contains("共 2 项"));
    }
}

#[test]
fn empty_duplicate_unknown_and_workspace_targets_are_rejected() {
    let fixture = Fixture::new(&[]);
    note(&fixture, "记录", "内容");
    let mut picks = selected(&fixture, None);
    let outside = fixture.base.join("result.txt");
    assert!(export(&fixture, &[], Format::Txt, &outside, false).is_err());
    assert!(export(
        &fixture,
        &picks,
        Format::Txt,
        &fixture.workspace.layout().root().join("bad.txt"),
        false
    )
    .is_err());
    picks.push(ReadingExportSelection {
        id: picks[0].id.clone(),
        fingerprint: picks[0].fingerprint.clone(),
    });
    assert!(export(&fixture, &picks, Format::Txt, &outside, false).is_err());
    picks[1].id = "note:missing".into();
    assert!(export(&fixture, &picks, Format::Txt, &outside, false).is_err());
    assert!(!outside.exists());
}

#[test]
fn source_links_are_portable_and_unused_and_code_only_links_are_not_materialized() {
    let source = segment(SegmentType::Paragraph, "Current source");
    let fixture = Fixture::new(&[source.clone()]);
    let mut entry = fixture.workspace.read_entry(&fixture.id).unwrap();
    entry
        .fields
        .insert("doi".into(), "10.1234/test-paper".into());
    crate::atomic_write_json(
        fixture.workspace.layout().entry_meta_file(&fixture.id),
        &entry,
    )
    .unwrap();
    let id = note(
        &fixture,
        "引用笔记",
        "观点 [^sl-real]\n\n`[^sl-code]`\n\n```txt\n[^sl-fenced]\n```\n",
    );
    let links: Vec<_> = [
        ("sl-real", "保存的引用文字"),
        ("sl-code", "PRIVATE_CODE_QUOTE"),
        ("sl-fenced", "PRIVATE_FENCED_QUOTE"),
        ("sl-unused", "PRIVATE_UNUSED_QUOTE"),
    ]
    .into_iter()
    .map(|(anchor, quote)| {
        SourceLink::note(
            fixture.id.clone(),
            id.clone(),
            anchor.into(),
            SegmentRef {
                entry_id: fixture.id.clone(),
                segment_uid: source.uid.clone(),
                page: 3,
                bbox: None,
                segment_type: None,
                snapshot_text: quote.into(),
                snapshot_asset_path: None,
                quote_hash: "snapshot".into(),
            },
            "source".into(),
        )
    })
    .collect();
    crate::atomic_write_json(
        fixture
            .workspace
            .layout()
            .entry_note_links_file(&fixture.id, &id),
        &links,
    )
    .unwrap();
    let target = fixture.base.join("references.txt");
    let catalog = reading::inspect(&fixture.workspace, &fixture.id, Some(id.as_str())).unwrap();
    assert!(catalog.items.iter().any(|item| item.warnings.iter().any(|warning| warning.contains("原文内容已变化"))));
    export(
        &fixture,
        &selected(&fixture, Some(&id)),
        Format::Txt,
        &target,
        true,
    )
    .unwrap();
    let text = fs::read_to_string(target).unwrap();
    assert!(text.contains("保存的引用文字"));
    assert!(text.contains("PDF 第 3 页"));
    assert!(text.contains("DOI: 10.1234/test-paper"));
    assert!(text.contains("【来源 1】"));
    assert!(text.contains("[^sl-code]"));
    assert!(!text.contains("PRIVATE"));
}

#[test]
fn missing_sources_images_and_stale_translation_require_acknowledgement() {
    let source = segment(SegmentType::Paragraph, "source");
    let fixture = Fixture::new(&[source.clone()]);
    note(
        &fixture,
        "待核对",
        "正文 [^sl-missing]\n\n![图片说明](C:/private/missing.png)",
    );
    let mut old = translated(&source, "保存的旧译文");
    old.source_text = "older source".into();
    fixture.translations(vec![old]);
    let catalog = reading::inspect(&fixture.workspace, &fixture.id, None).unwrap();
    assert!(catalog.items.iter().all(|item| !item.warnings.is_empty()));
    let target = fixture.base.join("draft.txt");
    let picks = selected(&fixture, None);
    assert!(export(&fixture, &picks, Format::Txt, &target, false).is_err());
    assert!(!target.exists());
    export(&fixture, &picks, Format::Txt, &target, true).unwrap();
    let text = fs::read_to_string(target).unwrap();
    assert!(text.contains("待核对"));
    assert!(text.contains("保存的旧译文"));
    assert!(text.contains("older source"));
    assert!(!text.contains("C:/private"));
}

#[test]
fn segment_notes_and_annotation_snapshots_survive_reparse_without_silent_loss() {
    let source = segment(SegmentType::Paragraph, "original snapshot");
    let fixture = Fixture::new(&[source.clone()]);
    fixture
        .workspace
        .upsert_segment_note(&fixture.id, source.uid.clone(), "片段想法".into())
        .unwrap();
    let annotation =
        Annotation::new_for_segment(&source, "highlight", "", AnnotationImportance::Core);
    crate::atomic_write_json(
        fixture
            .workspace
            .layout()
            .entry_annotations_file(&fixture.id),
        &[annotation],
    )
    .unwrap();
    fixture.workspace.write_segments(&fixture.id, &[]).unwrap();
    let picks = selected(&fixture, None);
    assert_eq!(picks.len(), 2);
    let target = fixture.base.join("orphans.txt");
    export(&fixture, &picks, Format::Txt, &target, true).unwrap();
    let text = fs::read_to_string(target).unwrap();
    assert!(text.contains("片段想法"));
    assert!(text.contains("original snapshot"));
    assert!(text.contains("原片段已不可用"));
}

#[test]
fn note_images_embed_and_asset_changes_invalidate_inspection() {
    let fixture = Fixture::new(&[]);
    let id = note(&fixture, "图文笔记", "占位");
    let asset_dir = fixture
        .workspace
        .layout()
        .entry_note_assets_dir(&fixture.id, &id);
    fs::create_dir_all(&asset_dir).unwrap();
    let image_path = asset_dir.join("image.png");
    image::RgbaImage::from_pixel(32, 16, image::Rgba([80, 90, 100, 255]))
        .save(&image_path)
        .unwrap();
    fixture.workspace.update_note(&fixture.id, &id, "图文笔记", format!("## 实验观察\n\n**保留加粗**\n\n![实验图]({id}.assets/image.png)\n\n| 对象 | 结果 |\n|---|---|\n| A | 通过 |\n")).unwrap();
    let picks = selected(&fixture, Some(&id));
    let target = fixture.base.join("illustrated.docx");
    export(&fixture, &picks, Format::Docx, &target, false).unwrap();
    let bytes = fs::read(&target).unwrap();
    let archive = zip::ZipArchive::new(Cursor::new(&bytes)).unwrap();
    assert_eq!(
        archive
            .file_names()
            .filter(|name| name.starts_with("word/media/") && name.ends_with(".png"))
            .count(),
        1
    );
    let xml = zip_text(&bytes, "word/document.xml");
    assert!(xml.contains("<w:tbl>"));
    assert!(xml.contains("保留加粗"));
    image::RgbaImage::from_pixel(32, 16, image::Rgba([120, 90, 100, 255]))
        .save(&image_path)
        .unwrap();
    assert!(export(&fixture, &picks, Format::Docx, &target, false).is_err());
    assert_eq!(fs::read(target).unwrap(), bytes);
}

#[test]
#[ignore = "manual QA: writes an illustrative export to target/export-qa"]
fn write_reading_export_qa_sample() {
    let fixture = Fixture::new(&[]);
    let id = note(&fixture, "论文组会笔记", "# 阅读结论\n\n这是用于检查导出功能的示例，不是真实研究结论。\n\n## 核心方法\n\n保留 **重点**、*强调*、`代码` 与中文段落。\n\n| 项目 | 状态 |\n|---|---|\n| 来源与页码 | 可携带 |\n| 已保存内容 | 按勾选导出 |\n\n## 待讨论问题\n\n1. 如何验证方法？\n2. 数据是否覆盖目标场景？\n\n```mermaid\ngraph LR\nA[输入] --> B[方法] --> C[结果]\n```\n");
    let output = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/export-qa");
    fs::create_dir_all(&output).unwrap();
    export(
        &fixture,
        &selected(&fixture, Some(&id)),
        Format::Docx,
        &output.join("reading-notes.docx"),
        false,
    )
    .unwrap();
}
