use crate::{note_catalog::source_reference_ranges, source_availability::SourceStatus, Workspace};
use neuink_domain::{EntryId, NoteOwner, NoteId, SegmentType, SourceSegment, TagId};
use std::{collections::BTreeMap, fs};

struct Fixture(Workspace);
impl Fixture {
    fn new() -> Self { Self(Workspace::create(std::env::temp_dir().join(format!("neuink_catalog_{}", EntryId::new()))).unwrap()) }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(self.0.layout().root()); } }

#[test]
fn description_is_backward_compatible_conflict_checked_and_restored_with_subtree() {
    let f = Fixture::new(); let ws = &f.0;
    let tag = ws.create_tag("主题", None).unwrap();
    let child = ws.create_tag("子主题", Some(tag.id.clone())).unwrap();
    let mut old = serde_json::to_value(&tag).unwrap(); old.as_object_mut().unwrap().remove("description");
    assert_eq!(serde_json::from_value::<neuink_domain::TagMeta>(old).unwrap().description, "");
    ws.update_tag_description(&tag.id, "多篇论文共同研究的问题".into(), "").unwrap();
    ws.rename_tag(&tag.id, "新主题").unwrap();
    assert!(ws.update_tag_description(&tag.id, "旧窗口覆盖".into(), "").is_err());
    let note = ws.create_tag_note(&child.id, "已删除的笔记".into()).unwrap();
    ws.set_tag_note_deleted(&child.id, &note.note_id, true, &note.revision).unwrap();
    ws.delete_tag(&tag.id).unwrap();
    assert!(ws.read_note_catalog().unwrap().notes.is_empty());
    assert!(ws.update_tag_description(&tag.id, "不应写入".into(), "多篇论文共同研究的问题").is_err());
    let archives = ws.list_tag_archives().unwrap(); assert_eq!(archives.len(), 1);
    ws.restore_tag_archive(&archives[0].archive_id).unwrap();
    assert_eq!(ws.list_tags().unwrap().iter().find(|item| item.id == tag.id).unwrap().description, "多篇论文共同研究的问题");
    assert!(ws.read_note_catalog().unwrap().notes[0].deleted_at.is_some());
}

#[test]
fn evidence_survives_membership_removal_trash_restore_purge_and_reparse() {
    let f = Fixture::new(); let ws = &f.0;
    let tag = ws.create_tag("平行阅读", None).unwrap();
    let mut note = ws.create_tag_note(&tag.id, "多篇论文比较".into()).unwrap();
    let mut papers = Vec::new();
    for title in ["论文 A", "论文 B"] {
        let entry = ws.create_entry_with_meta(title, BTreeMap::new(), vec![tag.id.clone()]).unwrap();
        let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, format!("{title} 原始证据"));
        ws.write_segments(&entry.id, &[segment.clone()]).unwrap();
        let link = ws.build_tag_note_source_link(&tag.id, &note.note_id, &entry.id, segment.uid.clone()).unwrap();
        note.markdown.push_str(&format!("比较 [^{}]\n", link.anchor_id)); note.links.push(link);
        papers.push((entry, segment));
    }
    let saved = ws.update_tag_note(&tag.id, &note.note_id, note.clone()).unwrap();
    let refs = saved.links.iter().flat_map(|link| link.sources.clone()).collect::<Vec<_>>();
    let statuses = || ws.inspect_sources(&refs).into_iter().map(|item| item.status).collect::<Vec<_>>();
    assert_eq!(statuses(), vec![SourceStatus::Available, SourceStatus::Available]);
    let (entry, _) = &papers[0];
    ws.update_entry_meta(&entry.id, entry.title.clone(), entry.fields.clone(), Vec::new()).unwrap();
    assert_eq!(ws.read_note_catalog().unwrap().notes[0].links.len(), 2);
    assert_eq!(statuses()[0], SourceStatus::Available);
    ws.delete_entry(&entry.id).unwrap(); assert_eq!(statuses()[0], SourceStatus::EntryTrashed);
    assert!(!ws.inspect_sources(&refs)[0].can_locate);
    ws.restore_entry(&entry.id).unwrap(); assert_eq!(statuses()[0], SourceStatus::Available);
    ws.delete_entry(&entry.id).unwrap(); ws.purge_entry(&entry.id).unwrap();
    assert_eq!(statuses()[0], SourceStatus::EntryDeleted);
    let (entry, segment) = &papers[1];
    let mut changed = segment.clone(); changed.text = "重解析后的新内容".into();
    ws.write_segments(&entry.id, &[changed]).unwrap(); assert_eq!(statuses()[1], SourceStatus::ContentChanged);
    ws.write_segments(&entry.id, &[]).unwrap(); assert_eq!(statuses()[1], SourceStatus::SegmentMissing);
    let reloaded = ws.read_tag_note(&tag.id, &note.note_id).unwrap();
    assert_eq!(reloaded.markdown, saved.markdown); assert_eq!(reloaded.links, saved.links);
    let mut edited = reloaded; edited.markdown.push_str("\n删除论文后仍可编辑。");
    assert!(ws.update_tag_note(&tag.id, &note.note_id, edited).is_ok());
}

#[test]
fn catalog_isolates_damaged_notes_and_excludes_unused_code_and_escaped_sources() {
    let f = Fixture::new(); let ws = &f.0;
    let tag = ws.create_tag("主题", None).unwrap();
    let note = ws.create_tag_note(&tag.id, "没有来源的想法".into()).unwrap();
    fs::write(ws.tag_note_file(&tag.id, &NoteId::new()).unwrap(), "broken metadata").unwrap();
    let entry = ws.create_entry("条目").unwrap(); ws.create_note(&entry.id, "条目笔记").unwrap();
    let catalog = ws.read_note_catalog().unwrap();
    assert_eq!(catalog.notes.len(), 3); assert_eq!(catalog.notes.iter().filter(|note| note.error.is_some()).count(), 1);
    assert!(catalog.notes.iter().any(|row| row.target.note_id == note.note_id && row.links.is_empty()));
    assert!(catalog.notes.iter().any(|row| matches!(row.target.owner, NoteOwner::Entry { .. })));
    let refs = source_reference_ranges("[^sl-real] `[^sl-inline]`\n\n```\n[^sl-code]\n```\n\n\\[^sl-escaped]\n");
    assert_eq!(refs.into_iter().map(|(_, id)| id).collect::<Vec<_>>(), ["sl-real"]);
    assert!(ws.tag_notes_dir(&TagId::from_string("../escape")).is_err());
}

#[test]
#[ignore = "manual UI QA: creates an isolated library at NEUINK_TAG_NOTES_QA_ROOT"]
fn write_tag_notes_qa_fixture() {
    let root = std::env::var_os("NEUINK_TAG_NOTES_QA_ROOT").expect("explicit QA output root required");
    assert!(!std::path::Path::new(&root).exists(), "QA output must be a new directory");
    let ws = Workspace::create(root).unwrap();
    let tag = ws.create_tag("跨论文阅读验证", None).unwrap();
    ws.update_tag_description(&tag.id, "用于验证标签笔记、多论文来源与回收站恢复的独立资料库。".into(), "").unwrap();
    let mut note = ws.create_tag_note(&tag.id, "多篇论文的证据比较".into()).unwrap();
    for (index, title) in ["论文 A：在读", "论文 B：已移入回收站", "论文 C：已永久删除"].into_iter().enumerate() {
        let entry = ws.create_entry_with_meta(title, BTreeMap::new(), vec![tag.id.clone()]).unwrap();
        let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, format!("{title}。这是引用时保存的原文证据，可用于跨论文比较。"));
        ws.write_segments(&entry.id, &[segment.clone()]).unwrap();
        let link = ws.build_tag_note_source_link(&tag.id, &note.note_id, &entry.id, segment.uid).unwrap();
        note.markdown.push_str(&format!("- {title} [^{}]\n\n", link.anchor_id)); note.links.push(link);
        if index > 0 { ws.delete_entry(&entry.id).unwrap(); }
        if index > 1 { ws.purge_entry(&entry.id).unwrap(); }
    }
    ws.update_tag_note(&tag.id, &note.note_id, note.clone()).unwrap();
    ws.create_tag_note(&tag.id, "尚未添加来源的研究想法".into()).unwrap();
    let archived = ws.create_tag("可恢复的主题", None).unwrap();
    ws.update_tag_description(&archived.id, "恢复后应保留这段描述和笔记".into(), "").unwrap();
    ws.create_tag_note(&archived.id, "待恢复的标签笔记".into()).unwrap(); ws.delete_tag(&archived.id).unwrap();
}
