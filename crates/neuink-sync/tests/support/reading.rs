use neuink_domain::{ContentItem, EntryId, SourceSegment};
use neuink_workspace::{
    folding::{FoldRecord, FoldTranslation},
    sentence_translation::SavedSentenceTranslation,
    Workspace,
};
use serde_json::json;
pub fn populate(a: &Workspace, id: &EntryId, figure: &SourceSegment) {
    let paragraph = SourceSegment::new(
        neuink_domain::SegmentType::Paragraph,
        0,
        None,
        "Figure evidence.".into(),
    );
    a.write_segments(id, &[figure.clone(), paragraph.clone()])
        .unwrap();
    let segment = &paragraph;
    a.upsert_segment_note(id, segment.uid.clone(), "Saved interpretation".into())
        .unwrap();
    a.set_segment_note_bookmark(id, segment.uid.clone(), true)
        .unwrap();
    a.upsert_entry_folds(
        id,
        vec![FoldRecord {
            segment_uid: segment.uid.to_string(),
            source: segment.text.clone(),
            evidence: vec![0],
            brief: vec!["Figure".into()],
            key: "Figure evidence".into(),
            takeaway: "Figure".into(),
            topic: "Figure".into(),
            model: "test".into(),
            generated_at: "2026-01-01".into(),
            translations: Default::default(),
        }],
    )
    .unwrap();
    a.save_fold_translation(
        id,
        segment.uid.as_str(),
        "takeaway",
        FoldTranslation {
            source_text: "Figure".into(),
            translated_text: "图示".into(),
            model: "test".into(),
            generated_at: "2026-01-01".into(),
        },
    )
    .unwrap();
    a.save_sentence_translation(
        id,
        SavedSentenceTranslation {
            segment_uid: segment.uid.to_string(),
            paragraph_source: segment.text.clone(),
            source: segment.text.clone(),
            source_start: 0,
            translation: "图示".into(),
        },
        None,
    )
    .unwrap();
    a.update_paragraph_translation(id,&segment.uid,|_|Ok(serde_json::from_value(json!({"segment_uid":segment.uid,"source_text":segment.text,"source_hash":"hash","job_id":"local-only","model":"test","view":"sentences","paragraph":{"status":"succeeded","value":"图示","error":null},"sentences":{"status":"succeeded","value":[{"id":0,"source":segment.text,"translation":"图示"}],"error":null}})).unwrap())).unwrap();
    let now = "2026-11-10T00:00:00Z";
    let translation=serde_json::from_value(json!({"schema_version":1,"entry_id":id,"source_language":"en","target_language":"zh","status":"succeeded","progress":{"total":1,"translated":1,"skipped":0,"failed":0},"paper_context":null,"model":"test","error":null,"created_at":now,"updated_at":now,"task":null,"segments":[{"segment_uid":segment.uid,"page_idx":0,"segment_type":"figure","source_hash":"hash","source_text":segment.text,"translated_text":"图示","status":"translated","error":null,"updated_at":now}]})).unwrap();
    a.write_entry_translation(id, &translation).unwrap();
    let initial = a.read_ideation().unwrap();
    let state=serde_json::from_value(json!({"version":1,"cards":[{"id":"confirmed-card","entry_id":id,"title":"Evidence","body":"User reviewed","kind":"method","origin":"ai_reviewed","sources":[{"segment_uid":segment.uid,"page_idx":0,"quote":segment.text}]}],"placements":[{"id":"p1","card_id":"confirmed-card","x":12,"y":30},{"id":"p2","card_id":"confirmed-card","x":80,"y":40}],"links":[{"id":"l1","from":"p1","to":"p2","description":"Connection"}]})).unwrap();
    a.save_ideation(&initial.revision, state).unwrap();
    a.save_ideation_draft("missing",serde_json::from_value(json!({"entry_id":id,"status":"ready","cards":[],"partial":false,"model":"test","relations":[]})).unwrap()).unwrap();
    let updated = a.create_note(id, "Confirmed research report").unwrap();
    let ContentItem::Note { note_id, .. } = updated.contents.last().unwrap();
    a.update_note(
        id,
        note_id,
        "Confirmed research report",
        "# Report\n\nConfirmed conclusions and evidence.",
    )
    .unwrap();
}
pub fn assert_received(a: &Workspace, b: &Workspace, id: &EntryId) {
    assert_eq!(
        b.read_segment_notes(id).unwrap(),
        a.read_segment_notes(id).unwrap()
    );
    assert_eq!(
        b.read_entry_folds(id).unwrap(),
        a.read_entry_folds(id).unwrap()
    );
    assert_eq!(
        b.read_sentence_translations(id).unwrap(),
        a.read_sentence_translations(id).unwrap()
    );
    let paragraph = b.read_paragraph_translations(id).unwrap();
    assert_eq!(paragraph.len(), 1);
    assert_eq!(
        paragraph
            .values()
            .next()
            .unwrap()
            .paragraph
            .value
            .as_deref(),
        Some("图示")
    );
    assert_eq!(
        b.read_entry_translation(id).unwrap().unwrap().segments[0]
            .translated_text
            .as_deref(),
        Some("图示")
    );
    assert_eq!(
        serde_json::to_value(b.read_ideation().unwrap().state).unwrap(),
        serde_json::to_value(a.read_ideation().unwrap().state).unwrap()
    );
    assert!(b.list_ideation_drafts().unwrap().is_empty());
    let entry = b.read_entry(id).unwrap();
    let ContentItem::Note { note_id, .. } = entry.contents.last().unwrap();
    assert!(b
        .read_note(id, note_id)
        .unwrap()
        .markdown
        .contains("Confirmed conclusions"));
}
