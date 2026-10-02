use super::*;
use std::path::PathBuf;

struct Fixture(Workspace);

impl Fixture {
    fn new() -> Self {
        Self(
            Workspace::create(
                std::env::temp_dir().join(format!("neuink_tag_archive_{}", TagId::new())),
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

fn stage_archive(workspace: &Workspace, archive: &TagArchive) -> PathBuf {
    let reading_root = workspace.layout().root().join("tag-reading");
    let staged = reading_root.join(format!(".purging-{}", archive.archive_id));
    fs::create_dir(&staged).unwrap();
    for tag in &archive.tags {
        fs::rename(
            reading_root.join(tag.id.as_str()),
            staged.join(tag.id.as_str()),
        )
        .unwrap();
    }
    staged
}

#[test]
fn tag_archive_restore_recovers_interrupted_purge_before_removing_archive() {
    let f = Fixture::new();
    let ws = &f.0;
    let tag = ws.create_tag("recover", None).unwrap();
    let note = ws
        .create_tag_note(&tag.id, "keep this note".into())
        .unwrap();
    let (_, asset) = ws
        .write_tag_note_asset(&tag.id, &note.note_id, "png", b"keep this asset")
        .unwrap();
    let note_path = ws.tag_note_file(&tag.id, &note.note_id).unwrap();
    let original_note = fs::read(&note_path).unwrap();
    ws.delete_tag(&tag.id).unwrap();
    let archive = ws.list_tag_archives().unwrap().remove(0);
    let staged = stage_archive(ws, &archive);

    // The user presses Restore after a failed purge, without refreshing first.
    ws.restore_tag_archive(&archive.archive_id).unwrap();
    assert!(ws.list_tag_archives().unwrap().is_empty());
    assert_eq!(ws.list_tags().unwrap(), vec![tag]);
    assert_eq!(fs::read(note_path).unwrap(), original_note);
    assert_eq!(fs::read(asset).unwrap(), b"keep this asset");
    assert!(!staged.exists());
}

#[cfg(windows)]
#[test]
fn tag_archive_purge_rolls_back_earlier_moves_when_later_directory_is_locked() {
    use std::os::windows::fs::OpenOptionsExt;

    let f = Fixture::new();
    let ws = &f.0;
    let parent = ws.create_tag("parent", None).unwrap();
    let child = ws.create_tag("child", Some(parent.id.clone())).unwrap();
    let note = ws
        .create_tag_note(&parent.id, "first directory".into())
        .unwrap();
    ws.create_tag_note(&child.id, "locked directory".into())
        .unwrap();
    let note_path = ws.tag_note_file(&parent.id, &note.note_id).unwrap();
    let original_note = fs::read(&note_path).unwrap();
    ws.delete_tag(&parent.id).unwrap();
    let archive = ws.list_tag_archives().unwrap().remove(0);
    assert_eq!(
        archive.tags.iter().map(|tag| &tag.id).collect::<Vec<_>>(),
        vec![&parent.id, &child.id]
    );
    let reading_root = ws.layout().root().join("tag-reading");
    // Open the directory without FILE_SHARE_DELETE so its rename really fails.
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(0x1 | 0x2)
        .custom_flags(0x0200_0000) // FILE_FLAG_BACKUP_SEMANTICS
        .open(reading_root.join(child.id.as_str()))
        .unwrap();

    assert!(ws.purge_tag_archive(&archive.archive_id).is_err());
    // Check before any list/restore call has a chance to recover the files.
    assert_eq!(fs::read(&note_path).unwrap(), original_note);
    assert!(!reading_root
        .join(format!(".purging-{}", archive.archive_id))
        .exists());
    assert_eq!(ws.read_workspace_file().unwrap().tag_archives.len(), 1);
    drop(locked);
    ws.restore_tag_archive(&archive.archive_id).unwrap();
    assert_eq!(fs::read(note_path).unwrap(), original_note);
}

#[test]
fn tag_archive_partial_recovery_failure_retains_files_and_archive_until_retry() {
    let f = Fixture::new();
    let ws = &f.0;
    let parent = ws.create_tag("parent", None).unwrap();
    let child = ws.create_tag("child", Some(parent.id.clone())).unwrap();
    let parent_note = ws
        .create_tag_note(&parent.id, "already recovered".into())
        .unwrap();
    let child_note = ws
        .create_tag_note(&child.id, "still staged".into())
        .unwrap();
    let parent_path = ws.tag_note_file(&parent.id, &parent_note.note_id).unwrap();
    let child_path = ws.tag_note_file(&child.id, &child_note.note_id).unwrap();
    let parent_bytes = fs::read(&parent_path).unwrap();
    let child_bytes = fs::read(&child_path).unwrap();
    ws.delete_tag(&parent.id).unwrap();
    let archive = ws.list_tag_archives().unwrap().remove(0);
    let staged = stage_archive(ws, &archive);
    let reading_root = ws.layout().root().join("tag-reading");
    // Simulate a prior rollback that restored one directory, then hit a conflict.
    fs::rename(
        staged.join(parent.id.as_str()),
        reading_root.join(parent.id.as_str()),
    )
    .unwrap();
    let blocked_target = reading_root.join(child.id.as_str());
    fs::create_dir(&blocked_target).unwrap();
    let staged_note = staged
        .join(child.id.as_str())
        .join("notes")
        .join(format!("{}.md", child_note.note_id));

    assert!(ws.restore_tag_archive(&archive.archive_id).is_err());
    assert!(ws.list_tag_archives().is_err());
    assert_eq!(ws.read_workspace_file().unwrap().tag_archives.len(), 1);
    assert!(ws.list_tags().unwrap().is_empty());
    assert_eq!(fs::read(&parent_path).unwrap(), parent_bytes);
    assert_eq!(fs::read(&staged_note).unwrap(), child_bytes);

    fs::remove_dir(blocked_target).unwrap();
    ws.restore_tag_archive(&archive.archive_id).unwrap();
    assert!(ws.list_tag_archives().unwrap().is_empty());
    assert_eq!(ws.list_tags().unwrap().len(), 2);
    assert_eq!(fs::read(parent_path).unwrap(), parent_bytes);
    assert_eq!(fs::read(child_path).unwrap(), child_bytes);
    assert!(!staged.exists());
}

#[test]
fn tag_archive_cleanup_preserves_active_tags_staged_by_older_restore_behavior() {
    let f = Fixture::new();
    let ws = &f.0;
    let tag = ws.create_tag("restored", None).unwrap();
    let note = ws.create_tag_note(&tag.id, "keep".into()).unwrap();
    let note_path = ws.tag_note_file(&tag.id, &note.note_id).unwrap();
    let original_note = fs::read(&note_path).unwrap();
    ws.delete_tag(&tag.id).unwrap();
    let archive = ws.list_tag_archives().unwrap().remove(0);
    let staged = stage_archive(ws, &archive);
    // The old restore path committed metadata while leaving reading files staged.
    let mut file = ws.read_workspace_file().unwrap();
    file.tags.extend(archive.tags);
    file.tag_archives.clear();
    ws.write_workspace_file(&file).unwrap();

    assert!(ws.list_tag_archives().unwrap().is_empty());
    assert_eq!(ws.list_tags().unwrap(), vec![tag]);
    assert_eq!(fs::read(note_path).unwrap(), original_note);
    assert!(!staged.exists());
}
