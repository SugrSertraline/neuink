use super::*;

#[test]
fn stop_persists_distinct_status_and_keeps_completed_translation_for_resume() {
    for canceled in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(temp.path()).unwrap();
        let entry = workspace.create_entry("Translation stop").unwrap();
        let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "Original".into());
        workspace
            .write_segments(&entry.id, &[segment.clone()])
            .unwrap();
        let mut translation = new_translation(
            entry.id.clone(),
            "en".into(),
            "zh-CN".into(),
            Some("test".into()),
            2,
        );
        let saved = TranslatedSegment {
            segment_uid: segment.uid.clone(),
            page_idx: 0,
            segment_type: SegmentType::Paragraph,
            source_hash: "hash".into(),
            source_text: "Original".into(),
            translated_text: Some("已完成译文".into()),
            status: TranslatedSegmentStatus::Translated,
            error: None,
            updated_at: Utc::now(),
        };
        translation.segments.push(saved.clone());
        workspace
            .write_entry_translation(&entry.id, &translation)
            .unwrap();
        let pipeline = TranslationPipeline::new(TranslationTask {
            control: Arc::new(TranslationTaskControl::default()),
            entry_id: entry.id.clone(),
            force: false,
            job_total: 2,
            profile: serde_json::from_value(
                json!({"id":"test","name":"test","base_url":"http://localhost/v1","model":"test"}),
            )
            .unwrap(),
            root: temp.path().to_path_buf(),
            selected_segment_uids: None,
            strategy: RunTranslationStrategy::Resume,
        });
        pipeline.mark_stopped(canceled).unwrap();
        let reopened = Workspace::open(temp.path())
            .unwrap()
            .read_entry_translation(&entry.id)
            .unwrap()
            .unwrap();
        assert!(matches!(
            (canceled, reopened.status),
            (true, TranslationStatus::Canceled) | (false, TranslationStatus::Paused)
        ));
        assert_eq!(reopened.progress.translated, 1);
        assert_eq!(reopened.progress.failed, 0);
        assert!(reopened.error.is_none());
        assert_eq!(
            serde_json::to_value(&reopened.segments[0]).unwrap(),
            serde_json::to_value(&saved).unwrap()
        );
        assert_eq!(pipeline.completed_count(&reopened), 1);
    }
}

#[test]
fn stop_rejects_missing_and_unrelated_jobs() {
    assert!(stop_entry_translation("missing-translation-job", TranslationStop::Cancel).is_err());
    let job = job_manager().create(JobKind::Parser, None, 1);
    assert!(stop_entry_translation(&job.job.id, TranslationStop::Pause).is_err());
    job_manager().cancel(&job.job.id, "test cleanup", Value::Null);
}

#[test]
fn paused_force_task_reopens_with_exact_remaining_scope_and_cancel_removes_only_task() {
    use lifecycle::{
        cancel_saved_task, load_paused_task, pending_segments, restore_paused_job,
        TranslationTaskActionRequest,
    };
    let temp = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(temp.path()).unwrap();
    let entry = workspace.create_entry("Resume test").unwrap();
    let segments: Vec<_> = ["Completed", "Remaining", "Not selected"]
        .iter()
        .map(|text| SourceSegment::new(SegmentType::Paragraph, 0, None, (*text).into()))
        .collect();
    workspace.write_segments(&entry.id, &segments).unwrap();
    let mut saved = new_translation(
        entry.id.clone(),
        "en".into(),
        "zh-CN".into(),
        Some("test".into()),
        3,
    );
    let job_id = format!("resume-{}", entry.id);
    saved.task = Some(TranslationTaskSnapshot {
        job_id: job_id.clone(),
        profile_id: "profile".into(),
        force: true,
        created_at: Utc::now(),
        source_hashes: segments[..2]
            .iter()
            .map(|segment| (segment.uid.clone(), source_hash(&source_text(segment))))
            .collect(),
        remaining_segment_uids: segments[..2]
            .iter()
            .map(|segment| segment.uid.clone())
            .collect(),
    });
    // Force mode may have old output for a segment that still needs work.
    saved
        .segments
        .push(translated_segment(&segments[1], Some(&"以前的译文".into())));
    upsert_segments(
        &mut saved,
        [translated_segment(&segments[0], Some(&"本次已完成".into()))],
    );
    workspace
        .write_entry_translation(&entry.id, &saved)
        .unwrap();
    let task = TranslationTask {
        control: Arc::new(TranslationTaskControl::default()),
        entry_id: entry.id.clone(),
        root: temp.path().into(),
        profile: serde_json::from_value(
            json!({"id":"profile","name":"test","base_url":"http://localhost/v1","model":"test"}),
        )
        .unwrap(),
        force: true,
        job_total: 2,
        selected_segment_uids: Some(
            segments[..2]
                .iter()
                .map(|segment| segment.uid.clone())
                .collect(),
        ),
        strategy: RunTranslationStrategy::Resume,
    };
    let pipeline = TranslationPipeline::new(task);
    pipeline.mark_stopped(false).unwrap();
    let request = TranslationTaskActionRequest {
        root: temp.path().into(),
        entry_id: entry.id.clone(),
        job_id: job_id.clone(),
    };
    let (_, reopened, snapshot) = load_paused_task(&request).unwrap();
    assert_eq!(
        snapshot.remaining_segment_uids,
        vec![segments[1].uid.clone()]
    );
    assert!(snapshot.force);
    let paused = restore_paused_job(temp.path(), &reopened).unwrap().unwrap();
    assert_eq!(paused.id, job_id);
    assert_eq!(paused.status, neuink_job::JobStatus::Paused);
    assert_eq!((paused.progress.current, paused.progress.total), (1, 2));
    let remaining = pending_segments(&pipeline.task, segments.clone(), &reopened);
    assert_eq!(remaining.len(), 1);
    assert_eq!(
        remaining[0].uid, segments[1].uid,
        "neither already redone nor unselected content should be sent again"
    );
    let canceled = cancel_saved_task(&request).unwrap();
    assert!(canceled.task.is_none());
    assert!(matches!(canceled.status, TranslationStatus::Canceled));
    assert_eq!(
        serde_json::to_value(canceled.segments).unwrap(),
        serde_json::to_value(reopened.segments).unwrap()
    );
    assert!(load_paused_task(&request).is_err(), "cancel is not resume");
    job_manager().cancel(&job_id, "cleanup", Value::Null);
}

#[test]
fn obsolete_worker_cleanup_cannot_remove_resumed_worker() {
    let id = format!("control-{}", EntryId::new());
    let old = register_translation_task_control(&id);
    clear_translation_task_control(&id, &old);
    let new = register_translation_task_control(&id);
    clear_translation_task_control(&id, &old);
    assert!(Arc::ptr_eq(
        &get_translation_task_control(&id).unwrap(),
        &new
    ));
    clear_translation_task_control(&id, &new);
    assert!(get_translation_task_control(&id).is_none());
}

#[test]
fn changed_pending_source_is_rejected_without_destroying_paused_task() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(temp.path()).unwrap();
    let entry = workspace.create_entry("Changed source").unwrap();
    let mut segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "Before".into());
    let mut saved = new_translation(
        entry.id.clone(),
        "en".into(),
        "zh-CN".into(),
        Some("test".into()),
        1,
    );
    saved.status = TranslationStatus::Paused;
    saved.task = Some(TranslationTaskSnapshot {
        job_id: "changed-source".into(),
        profile_id: "profile".into(),
        force: false,
        created_at: Utc::now(),
        source_hashes: [(segment.uid.clone(), source_hash(&source_text(&segment)))].into(),
        remaining_segment_uids: vec![segment.uid.clone()],
    });
    workspace
        .write_entry_translation(&entry.id, &saved)
        .unwrap();
    segment.text = "After".into();
    workspace.write_segments(&entry.id, &[segment]).unwrap();
    let request = lifecycle::TranslationTaskActionRequest {
        root: temp.path().into(),
        entry_id: entry.id,
        job_id: "changed-source".into(),
    };
    assert!(lifecycle::load_paused_task(&request)
        .err()
        .unwrap()
        .contains("原文已改变"));
    assert!(workspace
        .read_entry_translation(&request.entry_id)
        .unwrap()
        .unwrap()
        .task
        .is_some());
    assert!(lifecycle::cancel_saved_task(&request).is_ok());
}
