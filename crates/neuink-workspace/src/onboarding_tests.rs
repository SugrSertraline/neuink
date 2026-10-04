use super::*;
use neuink_domain::SegmentType;
use std::io::{Cursor, Write};
fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in files {
        zip.start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}
fn fixture() -> (
    Staging,
    Workspace,
    OnboardingDemo,
    Vec<SourceSegment>,
    Vec<u8>,
) {
    let path = std::env::temp_dir().join(format!("neuink-demo-test-{}", EntryId::new()));
    let workspace = Workspace::create(&path).unwrap();
    let segment = SourceSegment::new(
        SegmentType::Paragraph,
        0,
        Some([10., 10., 500., 100.]),
        "An abstract".into(),
    )
    .with_asset_path(Some("images/example.png".into()));
    let demo = OnboardingDemo {
        version: DEMO_ID.into(),
        pdf_hash: blake3::hash(b"%PDF-test").to_hex().to_string(),
        segment_uid: segment.uid.to_string(),
        note_title: "演示笔记".into(),
        note_markdown: "说明 {source}".into(),
        segment_note: "演示记录".into(),
        annotation: "演示批注".into(),
        translation: "摘要示例译文".into(),
    };
    (
        Staging(path),
        workspace,
        demo,
        vec![segment],
        zip(&[
            (
                "paper_content_list.json",
                br#"[{"type":"text","text":"An abstract"}]"#,
            ),
            ("paper_middle.json", br#"{"pdf_info":[{"page_idx":0}]}"#),
            ("images/example.png", b"fixture image"),
        ]),
    )
}
#[test]
fn complete_demo_is_isolated_and_replay_preserves_user_edits() {
    let (_temp, workspace, demo, segments, zip) = fixture();
    let original = workspace.create_entry("Attention Is All You Need").unwrap();
    let first = workspace
        .install_onboarding_demo(&demo, b"%PDF-test", &segments, &zip)
        .unwrap();
    assert_ne!(first.id, original.id);
    assert!(first.title.contains("演示版"));
    assert_eq!(
        first.pdf.as_ref().unwrap().parse.status,
        PdfParseStatus::Succeeded
    );
    assert_eq!(workspace.read_segments(&first.id).unwrap().len(), 1);
    assert_eq!(workspace.read_annotations(&first.id).unwrap().len(), 1);
    assert_eq!(workspace.read_segment_notes(&first.id).unwrap().len(), 1);
    let ContentItem::Note { note_id, .. } = &first.contents[0];
    let note = workspace.read_note(&first.id, note_id).unwrap();
    assert_eq!(note.links[0].sources[0].entry_id, first.id);
    assert_eq!(note.links[0].sources[0].segment_uid, segments[0].uid);
    assert!(note.markdown.contains(&note.links[0].anchor_id));
    workspace
        .update_note(&first.id, note_id, "edited", "my text")
        .unwrap();
    workspace
        .upsert_segment_note(&first.id, segments[0].uid.clone(), "my segment note".into())
        .unwrap();
    let second = workspace
        .install_onboarding_demo(&demo, b"%PDF-test", &segments, &zip)
        .unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(
        workspace.read_note(&first.id, note_id).unwrap().markdown,
        "my text"
    );
    assert_eq!(
        workspace.read_segment_notes(&first.id).unwrap()[0].text,
        "my segment note"
    );
    assert_eq!(workspace.list_entries().unwrap().len(), 2);
    assert_eq!(
        workspace.read_entry(&original.id).unwrap().title,
        "Attention Is All You Need"
    );
    let translation = workspace
        .read_entry_translation(&first.id)
        .unwrap()
        .unwrap();
    assert!(matches!(translation.status, TranslationStatus::Partial));
    assert!(translation.task.is_none());
    assert_eq!(
        translation.segments[0].source_hash,
        translation_hash("An abstract")
    );
}
#[test]
fn invalid_parser_artifacts_publish_nothing_and_leave_no_temporary_files() {
    let (_temp, workspace, demo, segments, _) = fixture();
    let bad = zip(&[
        ("paper_middle.json/child", b"x"),
        ("paper_middle.json", b"{}"),
    ]);
    assert!(workspace
        .install_onboarding_demo(&demo, b"%PDF-test", &segments, &bad)
        .is_err());
    assert!(workspace.list_entries().unwrap().is_empty());
    assert_eq!(
        fs::read_dir(workspace.layout().cache_dir())
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn replay_validates_bundle_before_reusing_a_saved_demo() {
    let (_temp, workspace, demo, segments, zip) = fixture();
    let entry = workspace
        .install_onboarding_demo(&demo, b"%PDF-test", &segments, &zip)
        .unwrap();
    let ContentItem::Note { note_id, .. } = &entry.contents[0];
    workspace
        .update_note(&entry.id, note_id, "edited", "keep this edit")
        .unwrap();
    for (pdf, source, archive) in [
        (b"bad".as_slice(), segments.as_slice(), zip.as_slice()),
        (b"%PDF-test".as_slice(), [].as_slice(), zip.as_slice()),
        (
            b"%PDF-test".as_slice(),
            segments.as_slice(),
            b"bad".as_slice(),
        ),
    ] {
        let error = workspace
            .install_onboarding_demo(&demo, pdf, source, archive)
            .unwrap_err();
        assert!(error.to_string().starts_with("缺少演示数据，无法演示"));
        assert_eq!(workspace.list_entries().unwrap().len(), 1);
        assert_eq!(
            workspace.read_note(&entry.id, note_id).unwrap().markdown,
            "keep this edit"
        );
    }
}

#[test]
fn missing_or_changed_installed_sources_fail_without_replacing_the_edited_demo() {
    let (_temp, workspace, demo, segments, zip) = fixture();
    let entry = workspace
        .install_onboarding_demo(&demo, b"%PDF-test", &segments, &zip)
        .unwrap();
    let ContentItem::Note { note_id, .. } = &entry.contents[0];
    workspace
        .update_note(&entry.id, note_id, "edited", "keep this edit")
        .unwrap();
    workspace
        .upsert_segment_note(
            &entry.id,
            segments[0].uid.clone(),
            "keep this segment edit".into(),
        )
        .unwrap();
    for path in [
        workspace.layout().entry_pdf_file(&entry.id),
        workspace.layout().entry_segments_file(&entry.id),
        workspace.layout().entry_mineru_output_zip(&entry.id),
        workspace
            .layout()
            .entry_mineru_output_dir(&entry.id)
            .join("paper_middle.json"),
        workspace
            .layout()
            .entry_mineru_output_dir(&entry.id)
            .join("paper_content_list.json"),
        workspace
            .layout()
            .entry_mineru_output_dir(&entry.id)
            .join("images/example.png"),
    ] {
        let original = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        let error = workspace
            .install_onboarding_demo(&demo, b"%PDF-test", &segments, &zip)
            .unwrap_err();
        assert!(error.to_string().starts_with("缺少演示数据，无法演示"));
        assert!(
            !path.exists(),
            "validation must not silently repair or overwrite edited demos"
        );
        fs::write(&path, &original).unwrap();
        assert_eq!(
            workspace
                .install_onboarding_demo(&demo, b"%PDF-test", &segments, &zip)
                .unwrap()
                .id,
            entry.id
        );
    }
    let mut changed = segments.clone();
    changed[0].text = "different source".into();
    workspace.write_segments(&entry.id, &changed).unwrap();
    assert!(workspace
        .install_onboarding_demo(&demo, b"%PDF-test", &segments, &zip)
        .is_err());
    assert_eq!(
        workspace.read_note(&entry.id, note_id).unwrap().markdown,
        "keep this edit"
    );
    assert_eq!(
        workspace.read_segment_notes(&entry.id).unwrap()[0].text,
        "keep this segment edit"
    );
    assert_eq!(workspace.list_entries().unwrap().len(), 1);
}

#[test]
fn bundle_requires_parsed_pages_content_and_referenced_images() {
    let (_temp, workspace, demo, segments, _) = fixture();
    for files in [
        vec![(
            "paper_content_list.json",
            br#"[{"type":"text"}]"#.as_slice(),
        )],
        vec![("paper_middle.json", br#"{"pdf_info":[{}]}"#.as_slice())],
        vec![
            (
                "paper_content_list.json",
                br#"[{"type":"text"}]"#.as_slice(),
            ),
            ("paper_middle.json", br#"{"pdf_info":[{}]}"#.as_slice()),
        ],
    ] {
        assert!(workspace
            .install_onboarding_demo(&demo, b"%PDF-test", &segments, &zip(&files))
            .is_err());
        assert!(workspace.list_entries().unwrap().is_empty());
    }
}
#[test]
fn bad_hash_duplicate_segments_and_unsafe_archives_publish_nothing() {
    let (_temp, workspace, demo, segments, zip_bytes) = fixture();
    assert!(workspace
        .install_onboarding_demo(&demo, b"%PDF-other", &segments, &zip_bytes)
        .is_err());
    assert!(workspace
        .install_onboarding_demo(
            &demo,
            b"%PDF-test",
            &[segments[0].clone(), segments[0].clone()],
            &zip_bytes
        )
        .is_err());
    assert!(workspace
        .install_onboarding_demo(
            &demo,
            b"%PDF-test",
            &segments,
            &zip(&[("../escape", b"bad")])
        )
        .is_err());
    assert!(workspace.list_entries().unwrap().is_empty());
}
#[test]
fn concurrent_preparation_does_not_create_duplicate_entries() {
    let (_temp, workspace, demo, segments, zip) = fixture();
    std::thread::scope(|scope| {
        let first = scope.spawn(|| {
            workspace
                .install_onboarding_demo(&demo, b"%PDF-test", &segments, &zip)
                .unwrap()
        });
        let second = scope.spawn(|| {
            workspace
                .install_onboarding_demo(&demo, b"%PDF-test", &segments, &zip)
                .unwrap()
        });
        assert_eq!(first.join().unwrap().id, second.join().unwrap().id);
    });
    assert_eq!(workspace.list_entries().unwrap().len(), 1);
}
#[test]
fn deleting_a_demo_allows_a_new_independent_copy() {
    let (_temp, workspace, demo, segments, zip) = fixture();
    let first = workspace
        .install_onboarding_demo(&demo, b"%PDF-test", &segments, &zip)
        .unwrap();
    workspace.delete_entry(&first.id).unwrap();
    let second = workspace
        .install_onboarding_demo(&demo, b"%PDF-test", &segments, &zip)
        .unwrap();
    assert_ne!(first.id, second.id);
    assert!(workspace.layout().trashed_entry_dir(&first.id).exists());
}
