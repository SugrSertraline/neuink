use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
};

fn pairs() -> Vec<SentenceTranslation> {
    vec![
        SentenceTranslation {
            id: 1,
            source: "Dr. Lee measured 3.5 cm [1].".into(),
            translation: "李博士测量到 3.5 厘米 [1]。".into(),
        },
        SentenceTranslation {
            id: 2,
            source: "It worked.".into(),
            translation: "它有效。".into(),
        },
    ]
}
const SOURCE: &str = "Dr. Lee measured 3.5 cm [1].  It worked.";

struct Fixture {
    root: PathBuf,
    workspace: Workspace,
    request: ParagraphRequest,
    record: ParagraphTranslation,
    segment: SourceSegment,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("neuink-paragraph-{}", EntryId::new()));
        let workspace = Workspace::create(&root).unwrap();
        let entry = workspace.create_entry("Paragraph test").unwrap();
        let segment = SourceSegment::new(SegmentType::Paragraph, 0, None, SOURCE.into());
        workspace
            .write_segments(&entry.id, &[segment.clone()])
            .unwrap();
        let request = ParagraphRequest {
            root: root.clone(),
            entry_id: entry.id,
            segment_uid: segment.uid.clone(),
            retry_failed: false,
        };
        let record = ParagraphTranslation {
            segment_uid: segment.uid.clone(),
            source_text: SOURCE.into(),
            source_hash: source_hash(SOURCE),
            job_id: "test-job".into(),
            model: "test-model".into(),
            view: ParagraphView::Sentences,
            paragraph: TranslationPart::default(),
            sentences: TranslationPart::default(),
        };
        workspace
            .update_paragraph_translation(&request.entry_id, &segment.uid, |_| Ok(record.clone()))
            .unwrap();
        Self {
            root,
            workspace,
            request,
            record,
            segment,
        }
    }
    fn read(&self) -> ParagraphTranslation {
        Workspace::open(&self.root)
            .unwrap()
            .read_paragraph_translations(&self.request.entry_id)
            .unwrap()
            .remove(self.segment.uid.as_str())
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn sentence_alignment_preserves_abbreviations_numbers_and_rejects_missing_or_rewritten_source() {
    assert!(validate_sentences(SOURCE, &pairs()).is_ok());
    assert!(validate_sentences(SOURCE, &pairs()[..1]).is_err());
    assert!(validate_sentences(SOURCE, &[]).is_err());
    let mut changed = pairs();
    changed[0].source = "Dr. Lee measured 4 cm [1].".into();
    assert!(validate_sentences(SOURCE, &changed).is_err());
    let mut changed = pairs();
    changed[1].id = 3;
    assert!(validate_sentences(SOURCE, &changed).is_err());
    let mut changed = pairs();
    changed[1].translation.clear();
    assert!(validate_sentences(SOURCE, &changed).is_err());
    let mut changed = pairs();
    changed.swap(0, 1);
    assert!(validate_sentences(SOURCE, &changed).is_err());
}

fn document_translation(fixture: &Fixture) -> EntryTranslation {
    EntryTranslation {
        schema_version: 1,
        entry_id: fixture.request.entry_id.clone(),
        source_language: "en".into(),
        target_language: "zh-CN".into(),
        status: TranslationStatus::Succeeded,
        progress: TranslationProgress {
            total: 1,
            translated: 1,
            skipped: 0,
            failed: 0,
        },
        paper_context: None,
        model: Some("document-model".into()),
        error: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        segments: vec![TranslatedSegment {
            segment_uid: fixture.segment.uid.clone(),
            page_idx: 0,
            segment_type: SegmentType::Paragraph,
            source_hash: source_hash(SOURCE),
            source_text: SOURCE.into(),
            translated_text: Some("已有整段译文".into()),
            status: TranslatedSegmentStatus::Translated,
            error: None,
            updated_at: Utc::now(),
        }],
    }
}

#[test]
fn incremental_sentences_reuse_document_paragraph_and_survive_completion_and_reopen() {
    let fixture = Fixture::new();
    let document = document_translation(&fixture);
    fixture
        .workspace
        .write_entry_translation(&fixture.request.entry_id, &document)
        .unwrap();
    let cached = fixture
        .workspace
        .read_entry_translation(&fixture.request.entry_id)
        .unwrap();
    let saved = fixture
        .workspace
        .update_paragraph_translation(&fixture.request.entry_id, &fixture.segment.uid, |record| {
            let mut record = record.unwrap();
            reuse_document_paragraph(&mut record, cached.as_ref());
            Ok(record)
        })
        .unwrap();
    assert_eq!(requests_to_run(&saved, true), (false, true));
    save_result(
        &fixture.request,
        &saved,
        true,
        Ok(TranslationResult::Sentences(pairs())),
    )
    .unwrap();
    let reopened = fixture.read();
    assert_eq!(reopened.paragraph.value.as_deref(), Some("已有整段译文"));
    assert_eq!(reopened.sentences.value, Some(pairs()));
    assert_eq!(requests_to_run(&reopened, true), (false, false));
    assert_eq!(requests_to_run(&reopened, false), (true, true));
}

#[test]
fn document_reuse_rejects_wrong_source_uid_language_failed_and_empty_results() {
    let fixture = Fixture::new();
    for variant in 0..5 {
        let mut document = document_translation(&fixture);
        match variant {
            0 => document.segments[0].source_text = "Changed paragraph".into(),
            1 => document.segments[0].segment_uid = SegmentUid::new(),
            2 => document.target_language = "fr".into(),
            3 => document.segments[0].status = TranslatedSegmentStatus::Failed,
            _ => document.segments[0].translated_text = Some(" ".into()),
        }
        let mut record = fixture.record.clone();
        reuse_document_paragraph(&mut record, Some(&document));
        assert_eq!(requests_to_run(&record, true), (true, true));
    }
    let mut record = fixture.record.clone();
    record.paragraph.status = Status::Succeeded;
    record.paragraph.value = Some("独立段落译文".into());
    record.sentences.status = Status::Succeeded;
    record.sentences.value = Some(vec![]);
    reuse_document_paragraph(&mut record, Some(&document_translation(&fixture)));
    assert_eq!(record.paragraph.value.as_deref(), Some("独立段落译文"));
    assert_eq!(requests_to_run(&record, true), (false, true));
}

#[test]
fn independent_completion_and_view_updates_survive_reopening_without_lost_writes() {
    let mut fixture = Fixture::new();
    fixture.record.paragraph.timing =
        Some(neuink_workspace::paragraph_translation::TranslationTiming {
            queued_ms: 100,
            rate_limit_ms: 200,
            generation_ms: 300,
            total_ms: 600,
        });
    std::thread::scope(|scope| {
        scope.spawn(|| {
            save_result(
                &fixture.request,
                &fixture.record,
                false,
                Ok(TranslationResult::Paragraph("整段译文".into())),
            )
            .unwrap()
        });
        scope.spawn(|| {
            save_result(
                &fixture.request,
                &fixture.record,
                true,
                Ok(TranslationResult::Sentences(pairs())),
            )
            .unwrap()
        });
        scope.spawn(|| {
            set_paragraph_translation_view(ParagraphViewRequest {
                root: fixture.root.clone(),
                entry_id: fixture.request.entry_id.clone(),
                segment_uid: fixture.segment.uid.clone(),
                view: ParagraphView::Paragraph,
            })
            .unwrap()
        });
    });
    let saved = fixture.read();
    assert_eq!(saved.paragraph.value.as_deref(), Some("整段译文"));
    assert_eq!(saved.sentences.value, Some(pairs()));
    let timing = saved.paragraph.timing.as_ref().unwrap();
    assert_eq!(
        (
            timing.queued_ms,
            timing.rate_limit_ms,
            timing.generation_ms,
            timing.total_ms
        ),
        (100, 200, 300, 600)
    );
    assert!(saved.sentences.timing.is_none());
    let mut legacy = serde_json::to_value(&saved).unwrap();
    legacy["paragraph"]
        .as_object_mut()
        .unwrap()
        .remove("timing");
    legacy["sentences"]
        .as_object_mut()
        .unwrap()
        .remove("timing");
    let legacy: ParagraphTranslation = serde_json::from_value(legacy).unwrap();
    assert!(legacy.paragraph.timing.is_none());
    assert_eq!(legacy.paragraph.value, saved.paragraph.value);
    assert_eq!(saved.view, ParagraphView::Paragraph);
    assert_eq!(requests_to_run(&saved, true), (false, false));
    assert_eq!(requests_to_run(&saved, false), (true, true));
}

#[test]
fn one_failure_keeps_the_other_result_and_retries_only_failed_part() {
    let fixture = Fixture::new();
    save_result(
        &fixture.request,
        &fixture.record,
        false,
        Ok(TranslationResult::Paragraph("保留译文".into())),
    )
    .unwrap();
    assert!(save_result(
        &fixture.request,
        &fixture.record,
        true,
        Err("模拟断网".into())
    )
    .is_err());
    let saved = fixture.read();
    assert_eq!(saved.paragraph.status, Status::Succeeded);
    assert_eq!(saved.sentences.status, Status::Failed);
    assert_eq!(requests_to_run(&saved, true), (false, true));
    assert!(save_result(
        &fixture.request,
        &fixture.record,
        false,
        Err("重新生成失败".into())
    )
    .is_err());
    assert_eq!(fixture.read().paragraph.value.as_deref(), Some("保留译文"));
}

#[test]
fn changed_source_and_newer_jobs_reject_late_results() {
    let mut fixture = Fixture::new();
    fixture.segment.text = "Changed source.".into();
    fixture
        .workspace
        .write_segments(&fixture.request.entry_id, &[fixture.segment.clone()])
        .unwrap();
    assert!(save_result(
        &fixture.request,
        &fixture.record,
        false,
        Ok(TranslationResult::Paragraph("旧译文".into()))
    )
    .is_err());
    assert_eq!(fixture.read().paragraph.status, Status::Failed);
    assert!(fixture.read().paragraph.value.is_none());
    fixture
        .workspace
        .update_paragraph_translation(&fixture.request.entry_id, &fixture.segment.uid, |record| {
            let mut record = record.unwrap();
            record.job_id = "new-job".into();
            Ok(record)
        })
        .unwrap();
    assert!(save_result(
        &fixture.request,
        &fixture.record,
        true,
        Ok(TranslationResult::Sentences(pairs()))
    )
    .is_err());
    assert_eq!(fixture.read().job_id, "new-job");
    assert!(fixture.read().sentences.value.is_none());
}

#[test]
fn interrupted_requests_can_be_retried_without_losing_completed_part() {
    let fixture = Fixture::new();
    save_result(
        &fixture.request,
        &fixture.record,
        false,
        Ok(TranslationResult::Paragraph("完成".into())),
    )
    .unwrap();
    let mut records = read_paragraph_translations(ReadEntryTranslationRequest {
        root: fixture.root.clone(),
        entry_id: fixture.request.entry_id.clone(),
    })
    .unwrap();
    let record = records.remove(fixture.segment.uid.as_str()).unwrap();
    assert_eq!(record.paragraph.status, Status::Succeeded);
    assert_eq!(record.sentences.status, Status::Failed);
    assert_eq!(requests_to_run(&record, true), (false, true));
}

#[tokio::test]
async fn two_model_requests_contain_only_current_paragraph_and_fail_independently() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 4096];
            let body = loop {
                let count = socket.read(&mut buffer).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let length: usize = header
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        break serde_json::from_slice::<Value>(&bytes[end + 4..end + 4 + length])
                            .unwrap();
                    }
                }
            };
            let sentence_mode = body["messages"][0]["content"]
                .as_str()
                .unwrap()
                .contains("Translate each numbered sentence");
            // A malformed sentence result must not invalidate the successful paragraph response.
            let output = if sentence_mode {
                json!({"sentences": []})
            } else {
                json!({"translation": "完整译文"})
            };
            let response =
                json!({"choices":[{"message":{"content":output.to_string()}}]}).to_string();
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
            requests.push(body);
        }
        requests
    });
    let profile: LlmProfile = serde_json::from_value(
        json!({"id":"test","name":"test","base_url":format!("http://{address}/v1"),"model":"test"}),
    )
    .unwrap();
    let client = LlmClient::new(profile);
    let (paragraph, sentences) = futures_util::future::join(
        translate(&client, SOURCE, false),
        translate(&client, SOURCE, true),
    )
    .await;
    assert!(matches!(paragraph, Ok(TranslationResult::Paragraph(ref text)) if text == "完整译文"));
    assert!(sentences.is_err());
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 2);
    for request in requests {
        let messages = request["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert!(messages[0]["content"].as_str().unwrap().len() < 1000);
        let prompt: Value = serde_json::from_str(messages[1]["content"].as_str().unwrap()).unwrap();
        if messages[0]["content"]
            .as_str()
            .unwrap()
            .contains("Translate each numbered sentence")
        {
            assert_eq!(
                prompt,
                json!({"sentences":[{"id":1,"text":"Dr. Lee measured 3.5 cm [1]."},{"id":2,"text":"It worked."}]})
            );
        } else {
            assert_eq!(prompt, json!({"paragraph":SOURCE}));
        }
    }
}
