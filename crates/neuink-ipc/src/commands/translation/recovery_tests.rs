use super::*;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
};

fn profile(base_url: String) -> LlmProfile {
    serde_json::from_value(json!({
        "id": "recovery-test", "name": "test", "base_url": base_url, "model": "test"
    }))
    .unwrap()
}

fn saved_task(
    workspace: &Workspace,
    entry_id: &EntryId,
    segments: &[SourceSegment],
) -> EntryTranslation {
    let mut saved = new_translation(
        entry_id.clone(),
        "en".into(),
        "zh-CN".into(),
        Some("test".into()),
        segments.len(),
    );
    saved.task = Some(TranslationTaskSnapshot {
        job_id: format!("recovery-{entry_id}"),
        profile_id: "recovery-test".into(),
        force: true,
        source_hashes: segments
            .iter()
            .map(|segment| (segment.uid.clone(), source_hash(&source_text(segment))))
            .collect(),
        remaining_segment_uids: segments.iter().map(|segment| segment.uid.clone()).collect(),
        created_at: Utc::now(),
    });
    workspace.write_entry_translation(entry_id, &saved).unwrap();
    saved
}

#[tokio::test]
async fn independent_segment_translation_rejects_running_and_paused_tasks_before_requesting() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(temp.path()).unwrap();
    let entry = workspace
        .create_entry("Independent translation guard")
        .unwrap();
    let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "Original".into());
    workspace
        .write_segments(&entry.id, std::slice::from_ref(&segment))
        .unwrap();
    let mut saved = saved_task(&workspace, &entry.id, std::slice::from_ref(&segment));
    for status in [TranslationStatus::Running, TranslationStatus::Paused] {
        saved.status = status;
        workspace
            .write_entry_translation(&entry.id, &saved)
            .unwrap();
        let result = single_segment::translate(
            TranslateEntrySegmentRequest {
                root: temp.path().into(),
                entry_id: entry.id.clone(),
                segment_uid: segment.uid.clone(),
                source_language: "en".into(),
                target_language: "zh-CN".into(),
            },
            profile("http://127.0.0.1:1/v1".into()),
        )
        .await;
        assert!(result.err().unwrap().contains("请先完成或取消任务"));
        let after = workspace
            .read_entry_translation(&entry.id)
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(&after).unwrap(),
            serde_json::to_value(&saved).unwrap()
        );
        if matches!(saved.status, TranslationStatus::Paused) {
            let request = lifecycle::TranslationTaskActionRequest {
                root: temp.path().into(),
                entry_id: entry.id.clone(),
                job_id: saved.task.as_ref().unwrap().job_id.clone(),
            };
            assert!(
                lifecycle::load_paused_task(&request).is_ok(),
                "independent action must not break resume"
            );
            assert!(
                lifecycle::cancel_saved_task(&request).is_ok(),
                "independent action must not break cancel"
            );
        }
    }
}

#[test]
fn late_independent_result_does_not_overwrite_a_new_full_task() {
    let temp = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(temp.path()).unwrap();
    let entry = workspace
        .create_entry("Late independent translation")
        .unwrap();
    let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, "Original".into());
    let saved = saved_task(&workspace, &entry.id, std::slice::from_ref(&segment));
    let result = single_segment::save(
        &workspace,
        &entry.id,
        translated_segment(&segment, Some(&"Late result".into())),
    );
    assert!(result.err().unwrap().contains("请先完成或取消任务"));
    assert_eq!(
        serde_json::to_value(
            workspace
                .read_entry_translation(&entry.id)
                .unwrap()
                .unwrap()
        )
        .unwrap(),
        serde_json::to_value(saved).unwrap()
    );
}

fn read_prompt(socket: &mut TcpStream) -> Value {
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut bytes = Vec::new();
    loop {
        let mut buffer = [0; 4096];
        let count = socket.read(&mut buffer).unwrap();
        assert_ne!(count, 0);
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
            let length: usize = headers
                .lines()
                .find_map(|line| line.strip_prefix("content-length:"))
                .unwrap()
                .trim()
                .parse()
                .unwrap();
            if bytes.len() >= end + 4 + length {
                let body: Value =
                    serde_json::from_slice(&bytes[end + 4..end + 4 + length]).unwrap();
                return serde_json::from_str(body["messages"][1]["content"].as_str().unwrap())
                    .unwrap();
            }
        }
    }
}

#[tokio::test]
async fn stopping_recovery_keeps_each_completed_response_and_only_resumes_remaining_segments() {
    for reason in [TranslationStop::Pause, TranslationStop::Cancel] {
        let temp = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(temp.path()).unwrap();
        let entry = workspace.create_entry("Recover then stop").unwrap();
        let segments: Vec<_> = ["First", "Second", "Third"]
            .into_iter()
            .map(|text| SourceSegment::new(SegmentType::Paragraph, 0, None, text.into()))
            .collect();
        workspace.write_segments(&entry.id, &segments).unwrap();
        saved_task(&workspace, &entry.id, &segments);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (third_started, third_request) = tokio::sync::oneshot::channel();
        let (release, released) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for index in 0..3 {
                let (mut socket, _) = listener.accept().unwrap();
                let prompt = read_prompt(&mut socket);
                let inputs = prompt["segments"].as_array().unwrap();
                requests.push(
                    inputs
                        .iter()
                        .map(|input| input["segment_uid"].as_str().unwrap().to_string())
                        .collect::<Vec<_>>(),
                );
                if index == 2 {
                    third_started.send(requests).unwrap();
                    let _ = released.recv_timeout(Duration::from_secs(10));
                    break;
                }
                // The merged response omits two members; the first individual
                // retry succeeds and the second stays in flight until stopped.
                let output = json!({"segments": [{"segment_uid": inputs[0]["segment_uid"], "translated_text": format!("已完成译文 {index}")}]}).to_string();
                let body = json!({"choices":[{"message":{"content":output}}]}).to_string();
                write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            }
        });
        let control = Arc::new(TranslationTaskControl::default());
        let pipeline = TranslationPipeline::new(TranslationTask {
            control: control.clone(),
            entry_id: entry.id.clone(),
            root: temp.path().into(),
            profile: profile(format!("http://{address}/v1")),
            force: true,
            job_total: 3,
            selected_segment_uids: None,
            strategy: RunTranslationStrategy::Resume,
        });
        let original_segments = segments.clone();
        let worker = tokio::spawn(async move {
            let context = TranslationPaperContext {
                summary: String::new(),
                terminology: Vec::new(),
                generated_at: Utc::now(),
            };
            let outcome = pipeline
                .task
                .control
                .run_until_stopped(pipeline.client.translate_batch_recovering(
                    "test",
                    &context,
                    segments,
                    &pipeline.task.control,
                    |completed| {
                        pipeline
                            .update_translation(|translation| {
                                upsert_segments(translation, completed)
                            })
                            .map(|_| ())
                    },
                ))
                .await;
            assert!(outcome.is_none());
            pipeline
                .mark_stopped(reason == TranslationStop::Cancel)
                .unwrap();
            pipeline
        });
        let requested = timeout(Duration::from_secs(5), third_request)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            requested,
            vec![
                original_segments
                    .iter()
                    .map(|segment| segment.uid.to_string())
                    .collect::<Vec<_>>(),
                vec![original_segments[1].uid.to_string()],
                vec![original_segments[2].uid.to_string()],
            ]
        );
        let before_stop = workspace
            .read_entry_translation(&entry.id)
            .unwrap()
            .unwrap();
        assert_eq!(
            before_stop.progress.translated, 2,
            "completed requests must be on disk while a later retry is pending"
        );
        assert_eq!(
            before_stop.task.as_ref().unwrap().remaining_segment_uids,
            vec![original_segments[2].uid.clone()]
        );
        control.request_stop(reason);
        let pipeline = timeout(Duration::from_secs(5), worker)
            .await
            .unwrap()
            .unwrap();
        release.send(()).unwrap();
        server.join().unwrap();
        let stopped = workspace
            .read_entry_translation(&entry.id)
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(&stopped.segments).unwrap(),
            serde_json::to_value(&before_stop.segments).unwrap()
        );
        if reason == TranslationStop::Pause {
            assert!(matches!(stopped.status, TranslationStatus::Paused));
            let pending =
                lifecycle::pending_segments(&pipeline.task, original_segments.clone(), &stopped);
            assert_eq!(pending, vec![original_segments[2].clone()]);
        } else {
            assert!(matches!(stopped.status, TranslationStatus::Canceled));
            assert!(stopped.task.is_none());
        }
    }
}
