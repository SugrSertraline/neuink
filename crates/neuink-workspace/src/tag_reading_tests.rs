use super::*;
use chrono::Utc;
use neuink_domain::{EntryId, SegmentType, SourceSegment, TagMemberReadingState, TagMemberStatus};
use std::{
    collections::BTreeMap,
    fs,
    sync::{Arc, Barrier},
};

struct Fixture(Workspace);
impl Fixture {
    fn new() -> Self {
        Self(
            Workspace::create(
                std::env::temp_dir().join(format!("neuink_tag_reading_{}", EntryId::new())),
            )
            .unwrap(),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0.layout().root());
    }
}

#[test]
fn derives_descendants_deduplicates_and_accepts_parsed_only_entries() {
    let f = Fixture::new();
    let ws = &f.0;
    let parent = ws.create_tag("parent", None).unwrap();
    let child = ws.create_tag("child", Some(parent.id.clone())).unwrap();
    let parsed = ws
        .create_entry_with_meta(
            "parsed only",
            BTreeMap::new(),
            vec![child.id.clone(), parent.id.clone()],
        )
        .unwrap();
    ws.write_segments(
        &parsed.id,
        &[SourceSegment::new(
            SegmentType::Paragraph,
            0,
            None,
            "text".into(),
        )],
    )
    .unwrap();
    let metadata = ws
        .create_entry_with_meta("metadata", BTreeMap::new(), vec![child.id])
        .unwrap();
    let response = ws.read_tag_reading(&parent.id).unwrap();
    assert_eq!(response.members.len(), 2);
    assert!(response.members[0].reflow_available);
    assert!(!response.members[0].pdf_available);
    assert_eq!(response.members[0].preferred_mode, ReadingMode::Reflow);
    assert!(response.members[1].issue.is_some());
    let mut state = response.state;
    state.include_descendants = false;
    ws.save_tag_reading(state, 0).unwrap();
    assert_eq!(ws.read_tag_reading(&parent.id).unwrap().members.len(), 1);
    ws.delete_entry(&metadata.id).unwrap();
    assert_eq!(ws.read_tag_reading(&parent.id).unwrap().members.len(), 1);
}

#[test]
fn persists_task_state_rename_and_removed_member_history_without_copying_positions() {
    let f = Fixture::new();
    let ws = &f.0;
    let a = ws.create_tag("A", None).unwrap();
    let b = ws.create_tag("B", None).unwrap();
    let entry = ws
        .create_entry_with_meta("entry", BTreeMap::new(), vec![a.id.clone(), b.id.clone()])
        .unwrap();
    let mut state = ws.read_tag_reading(&a.id).unwrap().state;
    state.member_states.insert(
        entry.id.clone(),
        TagMemberReadingState {
            status: TagMemberStatus::Done,
            order: 0,
            updated_at: Utc::now(),
        },
    );
    let saved = ws.save_tag_reading(state, 0).unwrap();
    ws.rename_tag(&a.id, "renamed").unwrap();
    ws.update_entry_meta(
        &entry.id,
        &entry.title,
        entry.fields.clone(),
        vec![b.id.clone()],
    )
    .unwrap();
    assert!(ws.read_tag_reading(&a.id).unwrap().members.is_empty());
    assert!(ws
        .read_tag_reading(&b.id)
        .unwrap()
        .state
        .member_states
        .is_empty());
    ws.update_entry_meta(
        &entry.id,
        &entry.title,
        entry.fields,
        vec![a.id.clone(), b.id],
    )
    .unwrap();
    let reopened = Workspace::open_existing(ws.layout().root()).unwrap();
    assert_eq!(reopened.read_tag_reading(&a.id).unwrap().state, saved);
    assert!(!ws.layout().entry_reading_state_file(&entry.id).exists());
}

#[test]
fn rejects_concurrent_stale_writes_and_unknown_schema_without_overwriting() {
    let f = Fixture::new();
    let ws = &f.0;
    let tag = ws.create_tag("A", None).unwrap();
    let state = ws.read_tag_reading(&tag.id).unwrap().state;
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let ws = ws.clone();
            let state = state.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                ws.save_tag_reading(state, 0).is_ok()
            })
        })
        .collect();
    assert_eq!(
        handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .filter(|ok| *ok)
            .count(),
        1
    );
    assert_eq!(ws.read_tag_reading(&tag.id).unwrap().state.revision, 1);
}

#[test]
fn corrupt_or_future_files_are_never_reset_and_ids_are_bounded() {
    let f = Fixture::new();
    let ws = &f.0;
    let tag = ws.create_tag("A", None).unwrap();
    let original = ws.read_tag_reading(&tag.id).unwrap().state;
    let mut future = original.clone();
    future.version = 9;
    let path = ws.tag_reading_path(&tag.id).unwrap();
    atomic_write_json(&path, &future).unwrap();
    assert!(ws.read_tag_reading(&tag.id).is_err());
    assert!(ws.save_tag_reading(original, 0).is_err());
    assert_eq!(
        serde_json::from_slice::<TagReadingWorkspace>(&fs::read(&path).unwrap())
            .unwrap()
            .version,
        9
    );
    assert!(ws
        .read_tag_reading(&TagId::from_string("../escape"))
        .is_err());
}

#[test]
fn tag_archive_restores_tree_members_in_trash_and_task_state() {
    let f = Fixture::new();
    let ws = &f.0;
    let parent = ws.create_tag("parent", None).unwrap();
    let child = ws.create_tag("child", Some(parent.id.clone())).unwrap();
    let entry = ws
        .create_entry_with_meta("entry", BTreeMap::new(), vec![child.id.clone()])
        .unwrap();
    let saved = ws
        .save_tag_reading(ws.read_tag_reading(&child.id).unwrap().state, 0)
        .unwrap();
    ws.delete_entry(&entry.id).unwrap();
    ws.delete_tag(&parent.id).unwrap();
    assert!(ws.list_tags().unwrap().is_empty());
    assert!(ws.list_trashed_entries().unwrap()[0].tags.is_empty());
    assert!(ws.save_tag_reading(saved.clone(), saved.revision).is_err());
    let archive = ws.list_tag_archives().unwrap().remove(0);
    assert_eq!(archive.tags.len(), 2);
    ws.restore_tag_archive(&archive.archive_id).unwrap();
    ws.restore_entry(&entry.id).unwrap();
    assert_eq!(
        ws.read_entry(&entry.id).unwrap().tags,
        vec![child.id.clone()]
    );
    assert_eq!(ws.read_tag_reading(&child.id).unwrap().state, saved);
    assert!(ws.list_tag_archives().unwrap().is_empty());
}

#[test]
fn restore_conflict_does_not_overwrite_later_tags_or_metadata() {
    let f = Fixture::new();
    let ws = &f.0;
    let a = ws.create_tag("A", None).unwrap();
    let b = ws.create_tag("B", None).unwrap();
    let entry = ws
        .create_entry_with_meta("entry", BTreeMap::new(), vec![a.id.clone()])
        .unwrap();
    ws.delete_tag(&a.id).unwrap();
    let archive = ws.list_tag_archives().unwrap().remove(0);
    ws.update_entry_meta(&entry.id, "new title", BTreeMap::new(), vec![b.id.clone()])
        .unwrap();
    assert!(ws.restore_tag_archive(&archive.archive_id).is_err());
    let current = ws.read_entry(&entry.id).unwrap();
    assert_eq!(current.tags, vec![b.id]);
    assert_eq!(current.title, "new title");
    assert_eq!(ws.list_tag_archives().unwrap().len(), 1);
}
