use super::fixtures::{segment, translated, Fixture};
use crate::export::reading::{self, ReadingExportKind as Kind, ReadingExportScope as Scope};
use neuink_domain::{Annotation, AnnotationImportance, ContentItem, SegmentType};
use std::fs;

#[test]
fn reading_scope_excludes_other_categories_before_reading_their_files() {
    let source = segment(SegmentType::Paragraph, "Source");
    let fixture = Fixture::new(&[source.clone()]);
    let meta = fixture
        .workspace
        .create_note(&fixture.id, "Unrelated note")
        .unwrap();
    let ContentItem::Note { note_id, .. } = &meta.contents[0];
    fs::write(
        fixture
            .workspace
            .layout()
            .entry_note_file(&fixture.id, note_id),
        [0xff, 0xfe],
    )
    .unwrap();
    fixture
        .workspace
        .upsert_segment_note(&fixture.id, source.uid.clone(), "Selected record".into())
        .unwrap();
    fixture.translations(vec![translated(&source, "Unrelated translation")]);
    let report = reading::inspect_scoped(
        &fixture.workspace,
        &fixture.id,
        None,
        &Scope {
            kinds: Some(vec![Kind::SegmentNote]),
            ..Scope::default()
        },
    )
    .unwrap();
    assert!(report.scope_applied);
    assert_eq!(report.items.len(), 1);
    assert_eq!(report.items[0].kind, Kind::SegmentNote);
    assert!(report.items[0].preview.contains("Selected record"));
}

#[test]
fn reading_scope_resolves_continuation_groups_to_saved_note_ids() {
    let mut first = segment(SegmentType::Paragraph, "First page");
    first.continuation_group_id = Some("joined-paragraph".into());
    let mut next = segment(SegmentType::Paragraph, "Next page");
    next.continuation_group_id = first.continuation_group_id.clone();
    let other = segment(SegmentType::Paragraph, "Unrelated paragraph");
    let fixture = Fixture::new(&[first.clone(), next, other.clone()]);
    fixture
        .workspace
        .upsert_segment_note(&fixture.id, first.uid.clone(), "Group note".into())
        .unwrap();
    fixture
        .workspace
        .upsert_segment_note(&fixture.id, other.uid.clone(), "Unrelated note".into())
        .unwrap();
    let report = reading::inspect_scoped(
        &fixture.workspace,
        &fixture.id,
        None,
        &Scope {
            kinds: Some(vec![Kind::SegmentNote]),
            segment_uids: Some(vec!["joined-paragraph".into()]),
            ..Scope::default()
        },
    )
    .unwrap();
    assert_eq!(report.items.len(), 1);
    assert_eq!(report.items[0].id, format!("segment_note:{}", first.uid));
}

#[test]
fn reading_scope_highlight_selection_and_kind_are_intersected() {
    let source = segment(SegmentType::Paragraph, "Source");
    let fixture = Fixture::new(&[source.clone()]);
    let highlight =
        Annotation::new_for_segment(&source, "highlight", "chosen", AnnotationImportance::Normal);
    let note = Annotation::new_for_segment(
        &source,
        "question",
        "not chosen",
        AnnotationImportance::Normal,
    );
    crate::atomic_write_json(
        fixture
            .workspace
            .layout()
            .entry_annotations_file(&fixture.id),
        &[highlight.clone(), note],
    )
    .unwrap();
    let id = format!("annotation:{}", highlight.annotation_id);
    let report = reading::inspect_scoped(
        &fixture.workspace,
        &fixture.id,
        None,
        &Scope {
            kinds: Some(vec![Kind::Annotation]),
            item_ids: Some(vec![id.clone()]),
            ..Scope::default()
        },
    )
    .unwrap();
    assert_eq!(report.items.len(), 1);
    assert_eq!(report.items[0].id, id);
    let excluded = reading::inspect_scoped(
        &fixture.workspace,
        &fixture.id,
        None,
        &Scope {
            kinds: Some(vec![Kind::Translation]),
            item_ids: Some(vec![id]),
            ..Scope::default()
        },
    )
    .unwrap();
    assert!(excluded.items.is_empty());
}

#[test]
fn reading_scope_empty_explicit_selection_never_falls_back_to_all() {
    let source = segment(SegmentType::Paragraph, "Source");
    let fixture = Fixture::new(&[source.clone()]);
    fixture
        .workspace
        .upsert_segment_note(&fixture.id, source.uid.clone(), "Saved record".into())
        .unwrap();
    fixture.translations(vec![translated(&source, "Saved translation")]);
    for scope in [
        Scope {
            kinds: Some(vec![]),
            ..Scope::default()
        },
        Scope {
            item_ids: Some(vec![]),
            ..Scope::default()
        },
        Scope {
            segment_uids: Some(vec![]),
            ..Scope::default()
        },
    ] {
        assert!(
            reading::inspect_scoped(&fixture.workspace, &fixture.id, None, &scope)
                .unwrap()
                .items
                .is_empty()
        );
    }
    let translations = reading::inspect_scoped(
        &fixture.workspace,
        &fixture.id,
        None,
        &Scope {
            kinds: Some(vec![Kind::Translation]),
            ..Scope::default()
        },
    )
    .unwrap();
    assert_eq!(translations.items.len(), 1);
    assert_eq!(translations.items[0].kind, Kind::Translation);
}
