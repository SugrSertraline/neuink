use std::collections::BTreeMap;

use neuink_job::JobStatus;
use neuink_workspace::{
    paragraph_translation::{
        ParagraphRequestStatus as Status, ParagraphTranslation, ParagraphView, SentenceTranslation,
        TranslationPart,
    },
    WorkspaceError,
};

use super::*;

mod model;
mod partial;
mod progress;
mod sentences;
#[cfg(test)]
use model::validate_sentences;
#[cfg(test)]
use model::translate;
use model::TranslationResult;

const MAX_PARAGRAPH_CHARS: usize = 200_000;

#[derive(Deserialize)]
pub struct ParagraphRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub segment_uid: SegmentUid,
    #[serde(default)]
    pub retry_failed: bool,
}

#[derive(Deserialize)]
pub struct ParagraphViewRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub segment_uid: SegmentUid,
    pub view: ParagraphView,
}

fn active(job_id: &str) -> bool {
    job_manager()
        .get(job_id)
        .is_some_and(|job| matches!(job.status, JobStatus::Queued | JobStatus::Processing))
}

fn interrupted<T>(part: &mut TranslationPart<T>) {
    if part.status == Status::Running {
        part.status = Status::Failed;
        part.error = Some("上次翻译已中断，请重试未完成的请求。".into());
    }
}

fn requests_to_run(record: &ParagraphTranslation, retry_failed: bool) -> (bool, bool) {
    (
        !retry_failed
            || record.paragraph.status != Status::Succeeded
            || record
                .paragraph
                .value
                .as_ref()
                .is_none_or(|text| text.trim().is_empty()),
        false, // Sentence view is derived locally from the canonical segment translation.
    )
}

fn reuse_document_paragraph(
    record: &mut ParagraphTranslation,
    translation: Option<&EntryTranslation>,
) {
    if !requests_to_run(record, true).0 {
        return;
    }
    let Some(translation) =
        translation.filter(|value| value.target_language == default_target_language())
    else {
        return;
    };
    let Some(segment) = translation.segments.iter().find(|segment| {
        segment.segment_uid == record.segment_uid
            && segment.source_text == record.source_text
            && matches!(segment.status, TranslatedSegmentStatus::Translated)
            && segment
                .translated_text
                .as_ref()
                .is_some_and(|text| !text.trim().is_empty())
    }) else {
        return;
    };
    record.paragraph = TranslationPart {
        status: Status::Succeeded,
        value: segment.translated_text.clone(),
        error: None,
        timing: None,
    };
}

#[tauri::command]
pub fn read_paragraph_translations(
    request: ReadEntryTranslationRequest,
) -> Result<BTreeMap<String, ParagraphTranslation>, String> {
    let workspace = Workspace::open(request.root).map_err(|error| error.to_string())?;
    let mut records = workspace
        .read_paragraph_translations(&request.entry_id)
        .map_err(|error| error.to_string())?;
    for record in records.values_mut() {
        if !active(&record.job_id) {
            interrupted(&mut record.paragraph);
            interrupted(&mut record.sentences);
        }
    }
    Ok(records)
}

#[tauri::command]
pub fn set_paragraph_translation_view(
    request: ParagraphViewRequest,
) -> Result<ParagraphTranslation, String> {
    let workspace = Workspace::open(request.root).map_err(|error| error.to_string())?;
    workspace
        .update_paragraph_translation(&request.entry_id, &request.segment_uid, |record| {
            let mut record = record
                .ok_or_else(|| WorkspaceError::SegmentMissing(request.segment_uid.to_string()))?;
            record.view = request.view;
            Ok(record)
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn translate_paragraph<R: Runtime>(
    app: AppHandle<R>,
    request: ParagraphRequest,
) -> Result<ParagraphTranslation, String> {
    let client = TranslationClient::read(&app, neuink_config::TranslationKind::Paragraph)?;
    let workspace = Workspace::open(request.root.clone()).map_err(|error| error.to_string())?;
    let segment = workspace
        .read_segments(&request.entry_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|segment| segment.uid == request.segment_uid)
        .ok_or("原文段落不存在。")?;
    if !matches!(segment.segment_type, SegmentType::Paragraph) {
        return Err("逐句翻译仅支持正文段落。".into());
    }
    let source = source_text(&segment);
    if source.trim().is_empty() || source.chars().count() > MAX_PARAGRAPH_CHARS {
        return Err("请选择非空且不超过 200000 字符的正文片段。".into());
    }
    // Incremental requests may reuse the document translation, but never stale source text.
    let document_translation = if request.retry_failed {
        workspace
            .read_entry_translation(&request.entry_id)
            .map_err(|error| error.to_string())?
    } else {
        None
    };
    let mut created = None;
    let saved = workspace.update_paragraph_translation(
        &request.entry_id,
        &request.segment_uid,
        |previous| {
            // The storage lock makes duplicate submissions from different panes atomic.
            if let Some(previous) = previous.as_ref().filter(|record| active(&record.job_id)) {
                return Ok(previous.clone());
            }
            let mut record = previous
                .filter(|record| record.source_text == source)
                .unwrap_or_else(|| ParagraphTranslation {
                    segment_uid: request.segment_uid.clone(),
                    source_hash: source_hash(&source),
                    source_text: source.clone(),
                    job_id: String::new(),
                    model: client.label(),
                    view: ParagraphView::Sentences,
                    paragraph: TranslationPart::default(),
                    sentences: TranslationPart { status: Status::Succeeded, value: None, error: None, timing: None },
                });
            if request.retry_failed {
                reuse_document_paragraph(&mut record, document_translation.as_ref());
            }
            let (paragraph, sentences) = requests_to_run(&record, request.retry_failed);
            if !paragraph && !sentences {
                return Ok(record);
            }
            let event = job_manager().create(
                JobKind::ParagraphTranslation,
                Some(JobScope::Entry {
                    root: request.root.to_string_lossy().to_string(),
                    entry_id: request.entry_id.to_string(),
                }),
                usize::from(paragraph) + usize::from(sentences),
            );
            record.job_id = event.job.id.clone();
            record.model = client.label();
            if paragraph {
                record.paragraph.status = Status::Running;
                record.paragraph.error = None;
                record.paragraph.timing = None;
            }
            if sentences {
                record.sentences.status = Status::Running;
                record.sentences.error = None;
                record.sentences.timing = None;
            }
            created = Some((event, paragraph, sentences));
            Ok(record)
        },
    );
    let record = match saved {
        Ok(record) => record,
        Err(error) => {
            if let Some((event, _, _)) = created {
                if let Some(failed) =
                    job_manager().fail(&event.job.id, error.to_string(), json!({}))
                {
                    emit_job_event(&app, failed);
                }
            }
            return Err(error.to_string());
        }
    };
    if let Some((event, paragraph, sentences)) = created {
        emit_job_event(&app, event);
        let task_record = record.clone();
        tauri::async_runtime::spawn(async move {
            run(
                app,
                request,
                task_record,
                client,
                paragraph,
                sentences,
            )
            .await;
        });
    }
    Ok(record)
}

async fn run<R: Runtime>(
    app: AppHandle<R>,
    request: ParagraphRequest,
    record: ParagraphTranslation,
    client: TranslationClient,
    paragraph: bool,
    sentences: bool,
) {
    let job_id = &record.job_id;
    let _ = (paragraph, sentences); // Preserve compatibility with existing request snapshots.
    emit_started(&app, job_id, "翻译当前片段");
    let progress = progress::ParagraphProgress::new(&request, &record, false);
    let client = match client {
        TranslationClient::Model(client) => {
            let mut client = progress.client(&client, &app);
            // Segment JSON is committed only when complete, never parsed as paragraph JSON.
            client.output = None;
            TranslationClient::Model(client)
        }
        client => { progress.service_started(&app); client }
    };
    let result = single_segment::translate(TranslateEntrySegmentRequest {
        root: request.root.clone(), entry_id: request.entry_id.clone(),
        segment_uid: request.segment_uid.clone(), source_language: default_source_language(),
        target_language: default_target_language(),
    }, client).await.and_then(|response| {
        response.translation.and_then(|value| value.segments.into_iter()
            .find(|segment| segment.segment_uid == request.segment_uid)
            .and_then(|segment| segment.translated_text))
            .map(TranslationResult::Paragraph).ok_or_else(|| "片段译文为空，请重试。".to_string())
    });
    let mut finished = record.clone();
    finished.paragraph.timing = Some(progress.timing());
    let result = save_result(&request, &finished, false, result);
    let event = match result {
        Ok(()) => job_manager().succeed(job_id, "片段翻译完成", json!({"segment_uid":record.segment_uid})),
        Err(error) => job_manager().fail(job_id, error, json!({"segment_uid":record.segment_uid})),
    };
    if let Some(event) = event {
        emit_job_event(&app, event);
    }
}

fn finish<T>(part: &mut TranslationPart<T>, result: Result<T, String>) {
    match result {
        Ok(value) => {
            part.status = Status::Succeeded;
            part.value = Some(value);
            part.error = None;
        }
        Err(error) => {
            part.status = Status::Failed;
            part.error = Some(error);
        }
    }
}

fn save_result(
    request: &ParagraphRequest,
    expected: &ParagraphTranslation,
    sentence_mode: bool,
    result: Result<TranslationResult, String>,
) -> Result<(), String> {
    let workspace = Workspace::open(request.root.clone()).map_err(|error| error.to_string())?;
    let saved = workspace
        .update_paragraph_translation(&request.entry_id, &request.segment_uid, |record| {
            let mut record = record
                .ok_or_else(|| WorkspaceError::SegmentMissing(request.segment_uid.to_string()))?;
            if record.job_id != expected.job_id || record.source_hash != expected.source_hash {
                return Err(WorkspaceError::ParagraphTranslation(
                    "段落已有更新，未覆盖新的翻译结果。".into(),
                ));
            }
            let current = workspace
                .read_segments(&request.entry_id)?
                .into_iter()
                .find(|segment| segment.uid == request.segment_uid);
            let result = if current
                .as_ref()
                .is_some_and(|segment| source_text(segment) == expected.source_text)
            {
                result
            } else {
                Err("原文已改变，请重新翻译当前段落。".into())
            };
            if sentence_mode {
                record.sentences.timing = expected.sentences.timing.clone();
                finish(
                    &mut record.sentences,
                    result.and_then(|value| match value {
                        TranslationResult::Sentences(value) => Ok(value),
                        _ => Err("逐句结果类型错误".into()),
                    }),
                );
            } else {
                record.paragraph.timing = expected.paragraph.timing.clone();
                finish(
                    &mut record.paragraph,
                    result.and_then(|value| match value {
                        TranslationResult::Paragraph(value) => Ok(value),
                        _ => Err("整段结果类型错误".into()),
                    }),
                );
            }
            Ok(record)
        })
        .map_err(|error| error.to_string())?;
    let error = if sentence_mode {
        saved.sentences.error
    } else {
        saved.paragraph.error
    };
    error.map_or(Ok(()), Err)
}

#[cfg(test)]
mod tests;
