use super::*;
use crate::Workspace;
use neuink_domain::{ContentItem, NoteId, PdfAsset, PdfParseState, PdfParseStatus};

fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("neuink_data");
    let data = temp.path().join("Neuink/data");
    Workspace::create(&source).unwrap();
    Workspace::create(data.join("library")).unwrap();
    (temp, source, data)
}

#[test]
fn merges_new_entries_notes_and_tags_and_preserves_existing_files_and_source() {
    let (_temp, source, data) = fixture();
    let old = Workspace::open_existing(&source).unwrap();
    let entry = old.create_entry("Imported paper").unwrap();
    let tag = old.create_tag("Imported tag", None).unwrap();
    fs::write(source.join("custom.txt"), "old value").unwrap();
    fs::write(source.join("new.txt"), "new file").unwrap();
    fs::write(data.join("library/custom.txt"), "current value").unwrap();
    let before = snapshot(&source).unwrap();
    let result = merge(&source, &data).unwrap();
    assert!(result.conflicts >= 1);
    assert_eq!(snapshot(&source).unwrap(), before);
    assert!(result.source_unchanged(&source).unwrap());
    assert_eq!(
        fs::read_to_string(data.join("library/custom.txt")).unwrap(),
        "current value"
    );
    assert_eq!(
        fs::read_to_string(data.join("library/new.txt")).unwrap(),
        "new file"
    );
    assert!(Workspace::open_existing(data.join("library"))
        .unwrap()
        .list_entries()
        .unwrap()
        .iter()
        .any(|e| e.id == entry.id));
    assert!(Workspace::open_existing(data.join("library"))
        .unwrap()
        .list_tags()
        .unwrap()
        .iter()
        .any(|item| item.id == tag.id));
    assert!(!data.join(JOURNAL).exists());
    // A failed recycle may leave the original. Next startup is idempotent.
    let first = snapshot(&data.join("library")).unwrap();
    merge(&source, &data).unwrap();
    assert_eq!(snapshot(&data.join("library")).unwrap(), first);
    fs::write(source.join("new.txt"), "late edit").unwrap();
    assert!(!result.source_unchanged(&source).unwrap());
}

#[test]
fn supplements_matching_pdf_parse_and_note_catalog_without_replacing_title() {
    let (_temp, source, data) = fixture();
    let old = Workspace::open_existing(&source).unwrap();
    let mut entry = old.create_entry("Old title").unwrap();
    let relative = PathBuf::from("entries").join(entry.id.as_str());
    let pdf = b"matching PDF";
    entry.pdf = Some(PdfAsset {
        file_name: "paper.pdf".into(),
        content_hash: blake3::hash(pdf).to_hex().to_string(),
        imported_at: chrono::Utc::now(),
        parse: PdfParseState::not_started(),
    });
    fs::create_dir_all(data.join("library").join(&relative)).unwrap();
    let mut current = entry.clone();
    current.title = "Current title".into();
    crate::atomic_write_json(
        data.join("library").join(&relative).join("entry.meta.json"),
        &current,
    )
    .unwrap();
    fs::write(data.join("library").join(&relative).join("paper.pdf"), pdf).unwrap();
    fs::write(source.join(&relative).join("paper.pdf"), pdf).unwrap();
    fs::write(source.join(&relative).join("paper.segments.json"), "[]").unwrap();
    entry.pdf.as_mut().unwrap().parse.status = PdfParseStatus::Succeeded;
    let note_id = NoteId::new();
    entry.contents.push(ContentItem::Note {
        note_id: note_id.clone(),
        title: "Imported note".into(),
    });
    fs::create_dir_all(source.join(&relative).join("notes")).unwrap();
    fs::write(
        source.join(&relative).join(format!("notes/{note_id}.md")),
        "note",
    )
    .unwrap();
    crate::atomic_write_json(source.join(&relative).join("entry.meta.json"), &entry).unwrap();
    merge(&source, &data).unwrap();
    let restored: neuink_domain::EntryMeta = serde_json::from_slice(
        &fs::read(data.join("library").join(&relative).join("entry.meta.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(restored.title, "Current title");
    assert_eq!(
        restored.pdf.unwrap().parse.status,
        PdfParseStatus::Succeeded
    );
    assert_eq!(restored.contents.len(), 1);
    assert!(data
        .join("library")
        .join(&relative)
        .join("paper.segments.json")
        .exists());
}

#[test]
fn conflicting_pdf_does_not_mix_old_parse_results_into_current_entry() {
    let (_temp, source, data) = fixture();
    let entry = Workspace::open_existing(&source)
        .unwrap()
        .create_entry("Paper")
        .unwrap();
    let relative = PathBuf::from("entries").join(entry.id.as_str());
    fs::create_dir_all(data.join("library").join(&relative)).unwrap();
    fs::copy(
        source.join(&relative).join("entry.meta.json"),
        data.join("library").join(&relative).join("entry.meta.json"),
    )
    .unwrap();
    fs::write(
        data.join("library").join(&relative).join("paper.pdf"),
        "current",
    )
    .unwrap();
    fs::write(source.join(&relative).join("paper.pdf"), "old").unwrap();
    fs::write(source.join(&relative).join("paper.segments.json"), "[]").unwrap();
    merge(&source, &data).unwrap();
    assert!(!data
        .join("library")
        .join(&relative)
        .join("paper.segments.json")
        .exists());
    assert_eq!(
        fs::read_to_string(data.join("library").join(&relative).join("paper.pdf")).unwrap(),
        "current"
    );
}

#[test]
fn invalid_source_and_unfinished_writes_leave_both_directories_untouched() {
    let (_temp, source, data) = fixture();
    let before = snapshot(&data.join("library")).unwrap();
    fs::write(source.join("tag-operation.journal.json"), "{}").unwrap();
    assert!(merge(&source, &data).is_err());
    assert_eq!(snapshot(&data.join("library")).unwrap(), before);
    fs::remove_file(source.join("tag-operation.journal.json")).unwrap();
    fs::write(source.join("neuink.workspace.json"), "invalid").unwrap();
    assert!(merge(&source, &data).is_err());
    assert_eq!(snapshot(&data.join("library")).unwrap(), before);
    assert!(source.exists());
}

#[test]
fn recovers_interruption_between_directory_renames_without_empty_fallback() {
    let (_temp, source, data) = fixture();
    let stage = data.join(".legacy-stage-test");
    Workspace::create(&stage).unwrap();
    fs::write(stage.join("proof"), "verified import").unwrap();
    let journal = Journal {
        stage: ".legacy-stage-test".into(),
        backup: ".legacy-backup-test".into(),
    };
    crate::atomic_write_json(data.join(JOURNAL), &journal).unwrap();
    fs::rename(data.join("library"), data.join(&journal.backup)).unwrap();
    recover(&data).unwrap();
    assert_eq!(
        fs::read_to_string(data.join("library/proof")).unwrap(),
        "verified import"
    );
    assert!(!data.join(JOURNAL).exists());
    assert!(source.exists());
}

#[test]
fn recovery_rejects_paths_outside_data() {
    let (_temp, source, data) = fixture();
    crate::atomic_write_json(
        data.join(JOURNAL),
        &Journal {
            stage: "../neuink_data".into(),
            backup: ".legacy-backup-test".into(),
        },
    )
    .unwrap();
    assert!(recover(&data).is_err());
    assert!(source.exists());
    assert!(data.join("library/neuink.workspace.json").exists());
}

#[cfg(windows)]
#[test]
fn source_junction_is_never_merged_or_recycled() {
    use std::process::Command;
    let (temp, source, data) = fixture();
    let linked = temp.path().join("linked");
    // All paths belong to this synthetic fixture. No shell-expanded user input.
    let status = Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(&linked)
        .arg(&source)
        .output()
        .unwrap();
    assert!(status.status.success());
    assert!(merge(&linked, &data).is_err());
    fs::remove_dir(&linked).unwrap(); // Junction only; original fixture remains intact.
    assert!(source.exists());
}
