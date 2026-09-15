use super::*;
use crate::export::reading::{
    export_tag_notes, inspect_tag_notes, ReadingExportFormat, ReadingExportRequest,
    ReadingExportSelection,
};
use neuink_domain::{NoteOwner, NoteTarget, ReadingAuxiliaryView, SegmentType, SourceSegment};
use std::{
    collections::BTreeMap,
    io::Read,
    sync::{Arc, Barrier},
};

struct Fixture {
    root: PathBuf,
    workspace: Workspace,
    tag: TagId,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("neuink_tag_note_{}", NoteId::new()));
        let workspace = Workspace::create(root.join("workspace")).unwrap();
        let tag = workspace.create_tag("研究主题", None).unwrap().id;
        Self {
            root,
            workspace,
            tag,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn notes_are_tag_owned_atomic_and_revision_guarded() {
    let f = Fixture::new();
    let ws = &f.workspace;
    let mut note = ws.create_tag_note(&f.tag, "综合比较".into()).unwrap();
    assert!(ws.list_entries().unwrap().is_empty());
    let stale = note.clone();
    note.markdown = "# 全文\n\n中文与 English\n\n| 方法 | 结果 |\n| --- | --- |\n| A | B |\n\n```mermaid\ngraph LR\nA-->B\n```\n".into();
    let saved = ws
        .update_tag_note(&f.tag, &note.note_id, note.clone())
        .unwrap();
    assert_ne!(saved.revision, stale.revision);
    assert!(ws
        .update_tag_note(&f.tag, &stale.note_id, stale.clone())
        .is_err());
    let reopened = Workspace::open_existing(ws.layout().root()).unwrap();
    let loaded = reopened.read_tag_note(&f.tag, &saved.note_id).unwrap();
    assert_eq!(loaded.markdown, note.markdown);
    assert_eq!(loaded.revision, saved.revision);
    let path = ws.tag_note_file(&f.tag, &saved.note_id).unwrap();
    assert!(fs::read_to_string(path).unwrap().contains("neuink_note:"));
    assert_eq!(ws.list_tag_notes(&f.tag).unwrap().len(), 1);
}

#[test]
fn cross_paper_sources_accept_parsed_only_and_reject_wrong_owner() {
    let f = Fixture::new();
    let ws = &f.workspace;
    let mut note = ws.create_tag_note(&f.tag, "跨篇来源".into()).unwrap();
    for title in ["论文甲", "论文乙"] {
        let entry = ws
            .create_entry_with_meta(title, BTreeMap::new(), vec![f.tag.clone()])
            .unwrap();
        let segment = SourceSegment::new(
            SegmentType::Paragraph,
            2,
            None,
            format!("{title}的原文证据"),
        );
        ws.write_segments(&entry.id, &[segment.clone()]).unwrap();
        let link = ws
            .build_tag_note_source_link(&f.tag, &note.note_id, &entry.id, segment.uid)
            .unwrap();
        assert!(matches!(link.owner, LinkOwner::TagNote { .. }));
        assert!(link.display_text.contains(title));
        note.markdown
            .push_str(&format!("{}[^{}]\n\n", title, link.anchor_id));
        note.links.push(link);
    }
    let saved = ws
        .update_tag_note(&f.tag, &note.note_id, note.clone())
        .unwrap();
    assert_eq!(saved.links.len(), 2);
    let catalog = inspect_tag_notes(ws, &f.tag, Some(saved.note_id.as_str())).unwrap();
    let selected = catalog
        .items
        .into_iter()
        .map(|item| ReadingExportSelection {
            id: item.id,
            fingerprint: item.fingerprint,
        })
        .collect::<Vec<_>>();
    let exported = f.root.join("cross-paper.txt");
    export_tag_notes(
        ws,
        &f.tag,
        ReadingExportRequest {
            selected: &selected,
            format: ReadingExportFormat::Txt,
            target: &exported,
            allow_incomplete: false,
        },
    )
    .unwrap();
    let exported = fs::read_to_string(exported).unwrap();
    assert!(exported.contains("论文甲的原文证据"));
    assert!(exported.contains("论文乙的原文证据"));
    assert!(exported.contains("PDF 第 3 页"));
    assert!(!exported.contains("neuink://"));
    let mut wrong = saved.clone();
    wrong.links[0].owner = LinkOwner::TagNote {
        tag_id: TagId::new(),
        note_id: saved.note_id.clone(),
    };
    assert!(ws
        .update_tag_note(&f.tag, &wrong.note_id, wrong.clone())
        .is_err());
    assert_eq!(
        ws.read_tag_note(&f.tag, &saved.note_id).unwrap().revision,
        saved.revision
    );
    let mut pruned = saved.clone();
    pruned.markdown.clear();
    assert!(ws
        .update_tag_note(&f.tag, &pruned.note_id, pruned.clone())
        .unwrap()
        .links
        .is_empty());
}

#[test]
fn deletion_and_tag_archive_restore_markdown_and_assets() {
    let f = Fixture::new();
    let ws = &f.workspace;
    let mut note = ws.create_tag_note(&f.tag, "可恢复".into()).unwrap();
    let (relative, path) = ws
        .write_tag_note_asset(&f.tag, &note.note_id, "png", b"asset-bytes")
        .unwrap();
    note.markdown = format!("![图片]({relative})\n保留的正文");
    let note = ws
        .update_tag_note(&f.tag, &note.note_id, note.clone())
        .unwrap();
    ws.set_tag_note_deleted(&f.tag, &note.note_id, true, &note.revision)
        .unwrap();
    assert!(ws.read_tag_note(&f.tag, &note.note_id).is_err());
    assert!(ws
        .update_tag_note(&f.tag, &note.note_id, note.clone())
        .is_err());
    assert!(path.exists());
    let deleted = ws.list_tag_notes(&f.tag).unwrap().remove(0);
    assert!(deleted.deleted_at.is_some());
    ws.set_tag_note_deleted(&f.tag, &note.note_id, false, &deleted.revision)
        .unwrap();
    assert_eq!(
        ws.read_tag_note(&f.tag, &note.note_id).unwrap().markdown,
        note.markdown
    );
    ws.delete_tag(&f.tag).unwrap();
    assert!(ws.read_tag_note(&f.tag, &note.note_id).is_err());
    let archive = ws.list_tag_archives().unwrap().remove(0);
    ws.restore_tag_archive(&archive.archive_id).unwrap();
    assert_eq!(
        ws.read_tag_note(&f.tag, &note.note_id).unwrap().markdown,
        note.markdown
    );
    assert_eq!(fs::read(path).unwrap(), b"asset-bytes");
}

#[test]
fn reject_invalid_paths_metadata_and_stale_concurrent_writers() {
    let f = Fixture::new();
    let ws = &f.workspace;
    assert!(ws.tag_notes_dir(&TagId::from_string("../outside")).is_err());
    assert!(ws
        .tag_note_file(&f.tag, &NoteId::from_string("../outside"))
        .is_err());
    assert!(ws.create_tag_note(&f.tag, "  ".into()).is_err());
    let note = ws.create_tag_note(&f.tag, "同时编辑".into()).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = ["one", "two"]
        .into_iter()
        .map(|body| {
            let root = ws.layout().root().to_path_buf();
            let tag = f.tag.clone();
            let mut doc = note.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let ws = Workspace::open_existing(root).unwrap();
                doc.markdown = body.into();
                barrier.wait();
                ws.update_tag_note(&tag, &doc.note_id, doc.clone()).is_ok()
            })
        })
        .collect();
    assert_eq!(
        handles
            .into_iter()
            .filter_map(|handle| handle.join().ok())
            .filter(|ok| *ok)
            .count(),
        1
    );
    let path = ws.tag_note_file(&f.tag, &note.note_id).unwrap();
    let before = fs::read_to_string(&path)
        .unwrap()
        .replace("\"version\":1", "\"version\":99");
    fs::write(&path, &before).unwrap();
    assert!(ws.read_tag_note(&f.tag, &note.note_id).is_err());
    assert!(ws
        .update_tag_note(&f.tag, &note.note_id, note.clone())
        .is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), before);
}

#[test]
fn exports_word_txt_and_packages_with_fingerprint_protection() {
    let f = Fixture::new();
    let ws = &f.workspace;
    let mut note = ws.create_tag_note(&f.tag, "导出综合笔记".into()).unwrap();
    note.markdown = "# 比较结论\n\n所有中文和 English 正文。\n\n| 方向 | 证据 |\n| --- | --- |\n| 有机合成 | 实验 |\n".into();
    let mut note = ws
        .update_tag_note(&f.tag, &note.note_id, note.clone())
        .unwrap();
    let catalog = inspect_tag_notes(ws, &f.tag, Some(note.note_id.as_str())).unwrap();
    let selected: Vec<_> = catalog
        .items
        .into_iter()
        .map(|item| ReadingExportSelection {
            id: item.id,
            fingerprint: item.fingerprint,
        })
        .collect();
    assert_eq!(selected.len(), 1);
    for (format, file) in [
        (ReadingExportFormat::Txt, "notes.txt"),
        (ReadingExportFormat::Docx, "notes.docx"),
        (ReadingExportFormat::TxtZip, "texts.zip"),
        (ReadingExportFormat::DocxZip, "words.zip"),
    ] {
        let path = f.root.join(file);
        export_tag_notes(
            ws,
            &f.tag,
            ReadingExportRequest {
                selected: &selected,
                format,
                target: &path,
                allow_incomplete: false,
            },
        )
        .unwrap();
        assert!(fs::metadata(&path).unwrap().len() > 0);
        if format == ReadingExportFormat::Txt {
            let txt = fs::read_to_string(&path).unwrap();
            assert!(txt.contains("所有中文和 English 正文"));
            assert!(!txt.contains("neuink_note:"));
        }
        if format == ReadingExportFormat::Docx {
            let mut zip = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
            let mut xml = String::new();
            zip.by_name("word/document.xml")
                .unwrap()
                .read_to_string(&mut xml)
                .unwrap();
            assert!(xml.contains("比较结论"));
            assert!(xml.contains("<w:tbl>"));
        }
    }
    note.markdown.push_str("\n后续编辑");
    ws.update_tag_note(&f.tag, &note.note_id, note.clone())
        .unwrap();
    let path = f.root.join("must-not-overwrite.txt");
    fs::write(&path, "KEEP").unwrap();
    assert!(export_tag_notes(
        ws,
        &f.tag,
        ReadingExportRequest {
            selected: &selected,
            format: ReadingExportFormat::Txt,
            target: &path,
            allow_incomplete: false
        }
    )
    .is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "KEEP");
}

#[test]
fn reading_state_restores_note_target_and_loads_old_schema() {
    let f = Fixture::new();
    let ws = &f.workspace;
    let note = ws.create_tag_note(&f.tag, "布局".into()).unwrap();
    let mut state = ws.read_tag_reading(&f.tag).unwrap().state;
    let old = serde_json::to_value(&state).unwrap();
    state.active_note = Some(NoteTarget {
        owner: NoteOwner::TagReading {
            tag_id: f.tag.clone(),
        },
        note_id: note.note_id,
    });
    state.auxiliary_view = ReadingAuxiliaryView::Note;
    let saved = ws.save_tag_reading(state, 0).unwrap();
    assert_eq!(ws.read_tag_reading(&f.tag).unwrap().state, saved);
    let mut legacy = old;
    legacy.as_object_mut().unwrap().remove("active_note");
    legacy.as_object_mut().unwrap().remove("auxiliary_view");
    let legacy: neuink_domain::TagReadingWorkspace = serde_json::from_value(legacy).unwrap();
    assert!(legacy.active_note.is_none());
    assert_eq!(legacy.auxiliary_view, ReadingAuxiliaryView::Compare);
}

#[test]
fn tag_note_word_embeds_assets_without_reading_an_entry_directory() {
    let f = Fixture::new();
    let ws = &f.workspace;
    let mut note = ws
        .create_tag_note(&f.tag, "带图片的综合笔记".into())
        .unwrap();
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(2, 2)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let (relative, _) = ws
        .write_tag_note_asset(&f.tag, &note.note_id, "png", png.get_ref())
        .unwrap();
    note.markdown = format!("## 流程图\n\n![实验流程]({relative})\n\n图片说明");
    ws.update_tag_note(&f.tag, &note.note_id, note.clone())
        .unwrap();
    let items = inspect_tag_notes(ws, &f.tag, Some(note.note_id.as_str()))
        .unwrap()
        .items;
    assert!(items[0].warnings.is_empty());
    let selected = items
        .into_iter()
        .map(|item| ReadingExportSelection {
            id: item.id,
            fingerprint: item.fingerprint,
        })
        .collect::<Vec<_>>();
    let target = f.root.join("image.docx");
    export_tag_notes(
        ws,
        &f.tag,
        ReadingExportRequest {
            selected: &selected,
            format: ReadingExportFormat::Docx,
            target: &target,
            allow_incomplete: false,
        },
    )
    .unwrap();
    let zip = zip::ZipArchive::new(fs::File::open(target).unwrap()).unwrap();
    assert!(zip.file_names().any(|name| name.starts_with("word/media/")));
    assert!(ws.list_entries().unwrap().is_empty());
}
