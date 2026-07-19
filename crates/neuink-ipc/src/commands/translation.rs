use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

use chrono::Utc;
use neuink_config::LlmProfile;
use neuink_domain::{EntryId, SegmentType, SegmentUid, SourceSegment};
use neuink_job::{Job, JobKind, JobScope};
use neuink_workspace::{
    EntryTranslation, TranslatedSegment, TranslatedSegmentStatus, TranslationPaperContext,
    TranslationProgress, TranslationStatus, TranslationTerm, Workspace,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};
use tokio::time::timeout;

use super::{
    job::{emit_job_event, job_manager},
    settings::read_translation_profile,
};

const MAX_PAPER_CONTEXT_BUDGET: usize = 28_000;
const MAX_BATCH_CHAR_BUDGET: usize = 7_500;
const MAX_BATCH_SEGMENTS: usize = 3;
const LLM_REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

static TRANSLATION_TASK_CONTROLS: OnceLock<Mutex<HashMap<String, Arc<TranslationTaskControl>>>> =
    OnceLock::new();

#[derive(Debug, Deserialize)]
pub struct ReadEntryTranslationRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
}

#[derive(Debug, Deserialize)]
pub struct BeginEntryTranslationRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    #[serde(default = "default_source_language")]
    pub source_language: String,
    #[serde(default = "default_target_language")]
    pub target_language: String,
    #[serde(default)]
    pub model: Option<String>,
    pub total: usize,
}

#[derive(Debug, Deserialize)]
pub struct RunEntryTranslationRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    #[serde(default = "default_source_language")]
    pub source_language: String,
    #[serde(default = "default_target_language")]
    pub target_language: String,
    #[serde(default)]
    pub strategy: RunTranslationStrategy,
    #[serde(default)]
    pub segment_uids: Option<Vec<SegmentUid>>,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Deserialize)]
pub struct PauseEntryTranslationRequest {
    pub job_id: String,
}

#[derive(Debug, Deserialize)]
pub struct TranslateEntrySegmentRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub segment_uid: SegmentUid,
    #[serde(default = "default_source_language")]
    pub source_language: String,
    #[serde(default = "default_target_language")]
    pub target_language: String,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RunTranslationStrategy {
    Restart,
    #[default]
    Resume,
}

#[derive(Debug, Deserialize)]
pub struct SaveTranslationContextRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub context: SaveTranslationContextPayload,
}

#[derive(Debug, Deserialize)]
pub struct SaveTranslationContextPayload {
    pub summary: String,
    #[serde(default)]
    pub terminology: Vec<TranslationTerm>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertTranslatedSegmentsRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    #[serde(default)]
    pub segments: Vec<TranslatedSegmentPatch>,
}

#[derive(Debug, Deserialize)]
pub struct TranslatedSegmentPatch {
    pub segment_uid: SegmentUid,
    pub page_idx: u32,
    pub segment_type: SegmentType,
    pub source_hash: String,
    pub source_text: String,
    #[serde(default)]
    pub translated_text: Option<String>,
    pub status: TranslatedSegmentStatus,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FinishEntryTranslationRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub status: TranslationStatus,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EntryTranslationResponse {
    pub translation: Option<EntryTranslation>,
}

#[derive(Debug, Serialize)]
pub struct RunEntryTranslationResponse {
    pub job: Job,
    pub translation: EntryTranslation,
}

#[tauri::command]
pub fn read_entry_translation(
    request: ReadEntryTranslationRequest,
) -> Result<EntryTranslationResponse, String> {
    let workspace = Workspace::open(request.root).map_err(|error| error.to_string())?;
    Ok(EntryTranslationResponse {
        translation: workspace
            .read_entry_translation(&request.entry_id)
            .map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
pub fn begin_entry_translation(
    request: BeginEntryTranslationRequest,
) -> Result<EntryTranslationResponse, String> {
    let workspace = Workspace::open(request.root).map_err(|error| error.to_string())?;
    let translation = new_translation(
        request.entry_id.clone(),
        request.source_language,
        request.target_language,
        request.model,
        request.total,
    );
    workspace
        .write_entry_translation(&request.entry_id, &translation)
        .map_err(|error| error.to_string())?;
    Ok(EntryTranslationResponse {
        translation: Some(translation),
    })
}

#[tauri::command]
pub async fn run_entry_translation<R: Runtime>(
    app: AppHandle<R>,
    request: RunEntryTranslationRequest,
) -> Result<RunEntryTranslationResponse, String> {
    let profile = read_translation_profile(&app)?
        .ok_or_else(|| "Please configure a translation model first.".to_string())?;
    let workspace = Workspace::open(request.root.clone()).map_err(|error| error.to_string())?;
    let segments = workspace
        .read_segments(&request.entry_id)
        .map_err(|error| error.to_string())?;
    let total = segments.len();
    let selected_segment_uids = request
        .segment_uids
        .map(|uids| uids.into_iter().collect::<HashSet<_>>());
    let selected_total = segments
        .iter()
        .filter(|segment| {
            selected_segment_uids
                .as_ref()
                .is_none_or(|uids| uids.contains(&segment.uid))
        })
        .count();
    if selected_total == 0 {
        return Err("没有可翻译的选中内容。".to_string());
    }
    let previous = workspace
        .read_entry_translation(&request.entry_id)
        .map_err(|error| error.to_string())?;
    let should_restart = (selected_segment_uids.is_none()
        && matches!(request.strategy, RunTranslationStrategy::Restart))
        || previous
            .as_ref()
            .is_none_or(|translation| translation.progress.total != total);
    let translation = if should_restart {
        new_translation(
            request.entry_id.clone(),
            request.source_language.clone(),
            request.target_language.clone(),
            Some(profile.model.clone()),
            total,
        )
    } else {
        let mut translation = previous.ok_or_else(|| "translation missing".to_string())?;
        translation.status = TranslationStatus::Running;
        translation.error = None;
        translation.model = Some(profile.model.clone());
        translation.source_language = request.source_language.clone();
        translation.target_language = request.target_language.clone();
        translation.updated_at = Utc::now();
        translation
    };
    workspace
        .write_entry_translation(&request.entry_id, &translation)
        .map_err(|error| error.to_string())?;

    let scope = JobScope::Entry {
        root: request.root.to_string_lossy().to_string(),
        entry_id: request.entry_id.to_string(),
    };
    let event = job_manager().create(JobKind::Translation, Some(scope), selected_total);
    emit_job_event(&app, event.clone());

    let job_id = event.job.id.clone();
    let control = register_translation_task_control(&job_id);
    let task = TranslationTask {
        control,
        entry_id: request.entry_id,
        force: request.force,
        job_total: selected_total,
        profile,
        root: request.root,
        selected_segment_uids,
        strategy: request.strategy,
    };
    tauri::async_runtime::spawn(async move {
        run_translation_task(app, job_id, task).await;
    });

    Ok(RunEntryTranslationResponse {
        job: event.job,
        translation,
    })
}

/// Starts the user-configured post-parse translation without making parsing depend
/// on the availability of a translation model.  The caller intentionally treats an
/// error as non-fatal because the PDF has already been parsed successfully.
pub async fn start_auto_entry_translation<R: Runtime>(
    app: AppHandle<R>,
    root: PathBuf,
    entry_id: EntryId,
    segment_types: &[String],
) -> Result<Option<RunEntryTranslationResponse>, String> {
    let workspace = Workspace::open(root.clone()).map_err(|error| error.to_string())?;
    let selected_segment_uids = workspace
        .read_segments(&entry_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|segment| {
            segment_types
                .iter()
                .any(|value| value == segment_type_key(segment.segment_type))
        })
        .map(|segment| segment.uid)
        .collect::<Vec<_>>();
    if selected_segment_uids.is_empty() {
        return Ok(None);
    }
    run_entry_translation(
        app,
        RunEntryTranslationRequest {
            root,
            entry_id,
            source_language: default_source_language(),
            target_language: default_target_language(),
            strategy: RunTranslationStrategy::Resume,
            segment_uids: Some(selected_segment_uids),
            force: false,
        },
    )
    .await
    .map(Some)
}

#[tauri::command]
pub async fn translate_entry_segment<R: Runtime>(
    app: AppHandle<R>,
    request: TranslateEntrySegmentRequest,
) -> Result<EntryTranslationResponse, String> {
    let profile = read_translation_profile(&app)?
        .ok_or_else(|| "Please configure a translation model first.".to_string())?;
    let workspace = Workspace::open(request.root.clone()).map_err(|error| error.to_string())?;
    let entry = workspace
        .read_entry(&request.entry_id)
        .map_err(|error| error.to_string())?;
    let segments = workspace
        .read_segments(&request.entry_id)
        .map_err(|error| error.to_string())?;
    let segment = segments
        .iter()
        .find(|segment| segment.uid == request.segment_uid)
        .cloned()
        .ok_or_else(|| "Source segment not found.".to_string())?;
    if !should_translate_segment(&segment) {
        return Err("This block is not suitable for translation.".to_string());
    }

    let existing = workspace
        .read_entry_translation(&request.entry_id)
        .map_err(|error| error.to_string())?;
    if existing.is_none() {
        let translation = new_translation(
            request.entry_id.clone(),
            request.source_language,
            request.target_language,
            Some(profile.model.clone()),
            segments.len(),
        );
        workspace
            .write_entry_translation(&request.entry_id, &translation)
            .map_err(|error| error.to_string())?;
    }
    let context = existing
        .and_then(|translation| translation.paper_context)
        .unwrap_or(TranslationPaperContext {
            summary: String::new(),
            terminology: Vec::new(),
            generated_at: Utc::now(),
        });
    let translated = LlmClient::new(profile)
        .translate_batch(&entry.title, &context, std::slice::from_ref(&segment))
        .await?;
    update_translation(request.root, request.entry_id, |translation| {
        upsert_segments(
            translation,
            [translated_segment(&segment, translated.get(&segment.uid))],
        );
        translation.status = TranslationStatus::Partial;
        translation.error = None;
    })
}

#[tauri::command]
pub fn pause_entry_translation(
    request: PauseEntryTranslationRequest,
) -> Result<Option<Job>, String> {
    if let Some(control) = get_translation_task_control(&request.job_id) {
        control.request_pause();
    }
    Ok(job_manager().get(&request.job_id))
}

#[tauri::command]
pub fn save_translation_context(
    request: SaveTranslationContextRequest,
) -> Result<EntryTranslationResponse, String> {
    update_translation(request.root, request.entry_id, |translation| {
        translation.paper_context = Some(TranslationPaperContext {
            summary: request.context.summary,
            terminology: request.context.terminology,
            generated_at: Utc::now(),
        });
        translation.status = TranslationStatus::Running;
        translation.error = None;
    })
}

#[tauri::command]
pub fn upsert_translated_segments(
    request: UpsertTranslatedSegmentsRequest,
) -> Result<EntryTranslationResponse, String> {
    update_translation(request.root, request.entry_id, |translation| {
        upsert_segments(
            translation,
            request.segments.into_iter().map(segment_from_patch),
        );
    })
}

#[tauri::command]
pub fn finish_entry_translation(
    request: FinishEntryTranslationRequest,
) -> Result<EntryTranslationResponse, String> {
    update_translation(request.root, request.entry_id, |translation| {
        recompute_progress(translation);
        translation.status = request.status;
        translation.error = request.error;
    })
}

async fn run_translation_task<R: Runtime>(
    app: AppHandle<R>,
    job_id: String,
    task: TranslationTask,
) {
    let pipeline = TranslationPipeline::new(task);
    let result = pipeline.run(&app, &job_id).await;
    clear_translation_task_control(&job_id);
    match result {
        Ok(TranslationRunOutcome::Completed) | Ok(TranslationRunOutcome::Paused) => {}
        Err(error) => {
            let _ = pipeline.mark_failed(error.clone());
            if let Some(event) = job_manager().fail(&job_id, error.clone(), Value::Null) {
                emit_job_event(&app, event);
            }
        }
    }
}

struct TranslationTask {
    control: Arc<TranslationTaskControl>,
    entry_id: EntryId,
    force: bool,
    job_total: usize,
    profile: LlmProfile,
    root: PathBuf,
    selected_segment_uids: Option<HashSet<SegmentUid>>,
    strategy: RunTranslationStrategy,
}

enum TranslationRunOutcome {
    Completed,
    Paused,
}

#[derive(Debug, Default)]
struct TranslationTaskControl {
    pause_requested: AtomicBool,
}

impl TranslationTaskControl {
    fn request_pause(&self) {
        self.pause_requested.store(true, Ordering::Relaxed);
    }

    fn pause_requested(&self) -> bool {
        self.pause_requested.load(Ordering::Relaxed)
    }
}

struct TranslationPipeline {
    client: LlmClient,
    task: TranslationTask,
}

impl TranslationPipeline {
    fn new(task: TranslationTask) -> Self {
        Self {
            client: LlmClient::new(task.profile.clone()),
            task,
        }
    }

    async fn run<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        job_id: &str,
    ) -> Result<TranslationRunOutcome, String> {
        let workspace =
            Workspace::open(self.task.root.clone()).map_err(|error| error.to_string())?;
        let entry = workspace
            .read_entry(&self.task.entry_id)
            .map_err(|error| error.to_string())?;
        let segments = workspace
            .read_segments(&self.task.entry_id)
            .map_err(|error| error.to_string())?;
        let previous_translation = workspace
            .read_entry_translation(&self.task.entry_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "translation has not been started".to_string())?;
        let selected_segments = segments.into_iter().filter(|segment| {
            self.task
                .selected_segment_uids
                .as_ref()
                .is_none_or(|uids| uids.contains(&segment.uid))
        });
        let (candidates, skipped): (Vec<_>, Vec<_>) =
            selected_segments.partition(should_translate_segment);
        emit_started(app, job_id, "准备论文背景");

        if let Some(outcome) = self.pause_if_requested(app, job_id)? {
            return Ok(outcome);
        }

        let existing_by_segment_uid = previous_translation
            .segments
            .iter()
            .map(|segment| (segment.segment_uid.clone(), segment))
            .collect::<HashMap<_, _>>();
        let candidate_count = candidates.len();
        let pending_candidates = candidates
            .into_iter()
            .filter(|segment| {
                self.task.force
                    || !is_reusable_translated_segment(
                        segment,
                        existing_by_segment_uid.get(&segment.uid).copied(),
                    )
            })
            .collect::<Vec<_>>();
        let reused_count = candidate_count.saturating_sub(pending_candidates.len());

        if !skipped.is_empty() {
            self.update_translation(|translation| {
                upsert_segments(translation, skipped.iter().map(skipped_segment));
            })?;
            self.emit_translation_progress(app, job_id, "已跳过不适合翻译的区域")?;
        }

        if !skipped.is_empty() {
            if let Some(outcome) = self.pause_if_requested(app, job_id)? {
                return Ok(outcome);
            }
        }

        if reused_count > 0 && matches!(self.task.strategy, RunTranslationStrategy::Resume) {
            self.emit_translation_progress(
                app,
                job_id,
                &format!("已复用 {} 个既有译文 Segment", reused_count),
            )?;
        }

        if reused_count > 0 && matches!(self.task.strategy, RunTranslationStrategy::Resume) {
            if let Some(outcome) = self.pause_if_requested(app, job_id)? {
                return Ok(outcome);
            }
        }

        if pending_candidates.is_empty() {
            let final_translation = self.update_translation(|translation| {
                recompute_progress(translation);
                translation.status = completed_translation_status(translation);
                translation.error = None;
            })?;
            let message = if matches!(final_translation.status, TranslationStatus::Partial) {
                "翻译部分完成"
            } else {
                "翻译已是最新"
            };
            if let Some(event) =
                job_manager().succeed(job_id, message, translation_payload(&final_translation))
            {
                emit_job_event(app, event);
            }
            return Ok(TranslationRunOutcome::Completed);
        }

        let context = if let Some(context) = previous_translation.paper_context.clone() {
            self.update_translation(|translation| {
                translation.paper_context = Some(context.clone());
                translation.status = TranslationStatus::Running;
                translation.error = None;
            })?;
            self.emit_translation_progress(app, job_id, "已复用论文背景和术语表")?;
            context
        } else {
            if let Some(outcome) = self.pause_if_requested(app, job_id)? {
                return Ok(outcome);
            }
            let context = self
                .build_context(&entry.title, &pending_candidates)
                .await?;
            self.update_translation(|translation| {
                translation.paper_context = Some(context.clone());
                translation.status = TranslationStatus::Running;
                translation.error = None;
            })?;
            self.emit_translation_progress(app, job_id, "论文背景已生成")?;
            context
        };

        if let Some(outcome) = self.pause_if_requested(app, job_id)? {
            return Ok(outcome);
        }

        let budgets = translation_budgets(self.task.profile.max_context_length);
        let batches = build_translation_batches(pending_candidates, budgets.batch);
        let batch_total = batches
            .iter()
            .map(|batch| {
                batch
                    .iter()
                    .filter(|segment| segment.segment_type != SegmentType::List)
                    .count()
                    + batch
                        .iter()
                        .filter(|segment| segment.segment_type == SegmentType::List)
                        .count()
            })
            .sum::<usize>();
        self.emit_translation_progress(app, job_id, &format!("开始翻译，共 {batch_total} 批"))?;
        let mut completed_batches = 0usize;
        for batch in batches {
            let (list_segments, ordinary_segments): (Vec<_>, Vec<_>) = batch
                .into_iter()
                .partition(|segment| segment.segment_type == SegmentType::List);

            if !ordinary_segments.is_empty() {
                let translated = self
                    .client
                    .translate_batch(&entry.title, &context, &ordinary_segments)
                    .await
                    .map_err(|error| format!("翻译模型调用失败，已停止全部任务：{error}"))?;
                if let Some(missing) = ordinary_segments.iter().find(|segment| {
                    translated
                        .get(&segment.uid)
                        .is_none_or(|text| text.trim().is_empty())
                }) {
                    return Err(format!(
                        "翻译模型未返回 Block {} 的有效译文，已停止全部任务。",
                        missing.uid
                    ));
                }
                self.update_translation(|translation| {
                    let segments = ordinary_segments
                        .iter()
                        .map(|segment| translated_segment(segment, translated.get(&segment.uid)));
                    upsert_segments(translation, segments);
                })?;
                completed_batches += 1;
                self.emit_translation_progress(
                    app,
                    job_id,
                    &format!("翻译批次 {completed_batches}/{batch_total}"),
                )?;
            }

            for segment in list_segments {
                let translated_text = self
                    .translate_list_segment(&entry.title, &context, &segment)
                    .await
                    .map_err(|error| format!("列表项翻译失败，已停止全部任务：{error}"))?;
                self.update_translation(|translation| {
                    upsert_segments(
                        translation,
                        [translated_segment(&segment, Some(&translated_text))],
                    );
                })?;
                completed_batches += 1;
                self.emit_translation_progress(
                    app,
                    job_id,
                    &format!("已逐项翻译列表 {completed_batches}/{batch_total}"),
                )?;
                if let Some(outcome) = self.pause_if_requested(app, job_id)? {
                    return Ok(outcome);
                }
            }

            if let Some(outcome) = self.pause_if_requested(app, job_id)? {
                return Ok(outcome);
            }
        }

        let final_translation = self.update_translation(|translation| {
            recompute_progress(translation);
            translation.status = completed_translation_status(translation);
            translation.error = None;
        })?;
        let message = if matches!(final_translation.status, TranslationStatus::Partial) {
            "翻译部分完成"
        } else {
            "翻译完成"
        };
        if let Some(event) =
            job_manager().succeed(job_id, message, translation_payload(&final_translation))
        {
            emit_job_event(app, event);
        }
        Ok(TranslationRunOutcome::Completed)
    }

    async fn translate_list_segment(
        &self,
        entry_title: &str,
        context: &TranslationPaperContext,
        segment: &SourceSegment,
    ) -> Result<String, String> {
        let units = list_translation_units(segment);
        if units.is_empty() {
            let translated = self
                .client
                .translate_batch(entry_title, context, std::slice::from_ref(segment))
                .await?;
            return translated
                .get(&segment.uid)
                .filter(|text| !text.trim().is_empty())
                .cloned()
                .ok_or_else(|| format!("模型未返回列表 Block {} 的有效译文", segment.uid));
        }

        let mut translated_items = Vec::with_capacity(units.len());
        for (index, unit) in units.iter().enumerate() {
            let mut item = segment.clone();
            item.uid = SegmentUid::from_string(format!("{}::list-item-{index}", segment.uid));
            item.text = unit.text.clone();
            item.markdown = None;
            let translated = self
                .client
                .translate_batch(entry_title, context, std::slice::from_ref(&item))
                .await?;
            let translated_text = translated
                .get(&item.uid)
                .filter(|text| !text.trim().is_empty())
                .ok_or_else(|| format!("模型未返回第 {} 个列表项的有效译文", index + 1))?;
            translated_items.push(format!("{}{}", unit.prefix, translated_text.trim()));
        }
        Ok(translated_items.join("\n"))
    }

    async fn build_context(
        &self,
        entry_title: &str,
        segments: &[SourceSegment],
    ) -> Result<TranslationPaperContext, String> {
        let markdown = trim_to_budget(
            &segments
                .iter()
                .filter(|segment| segment.segment_type != SegmentType::Figure)
                .map(source_text)
                .collect::<Vec<_>>()
                .join("\n\n"),
            translation_budgets(self.task.profile.max_context_length).context,
        );
        let prompt = format!(
            "Paper title: {entry_title}\n\nRead the parsed Markdown below. Identify the paper background, research problem, method/data terms, abbreviations, and translation conventions. Output Chinese summary and terminology pairs.\n\nParsed Markdown:\n{markdown}"
        );
        let text = self
            .client
            .generate_text(
                "You prepare context for academic paper translation. Return strict JSON only: {\"summary\":\"...\",\"terminology\":[{\"source\":\"...\",\"target\":\"...\",\"note\":null}]}. Do not translate the full paper.",
                &prompt,
            )
            .await?;
        let parsed: PaperContextJson = parse_json_object(&text)?;
        Ok(TranslationPaperContext {
            summary: parsed.summary.unwrap_or_default().trim().to_string(),
            terminology: normalize_terms(parsed.terminology),
            generated_at: Utc::now(),
        })
    }

    fn update_translation(
        &self,
        update: impl FnOnce(&mut EntryTranslation),
    ) -> Result<EntryTranslation, String> {
        update_translation_value(self.task.root.clone(), self.task.entry_id.clone(), update)
    }

    fn emit_translation_progress<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        job_id: &str,
        message: &str,
    ) -> Result<(), String> {
        let workspace =
            Workspace::open(self.task.root.clone()).map_err(|error| error.to_string())?;
        let translation = workspace
            .read_entry_translation(&self.task.entry_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "translation has not been started".to_string())?;
        let done = self
            .task
            .selected_segment_uids
            .as_ref()
            .map(|selected| {
                translation
                    .segments
                    .iter()
                    .filter(|segment| {
                        selected.contains(&segment.segment_uid)
                            && !matches!(segment.status, TranslatedSegmentStatus::Pending)
                    })
                    .count()
            })
            .unwrap_or_else(|| {
                translation.progress.translated
                    + translation.progress.skipped
                    + translation.progress.failed
            })
            .min(self.task.job_total);
        if let Some(event) = job_manager().progress(
            job_id,
            done,
            self.task.job_total,
            message,
            translation_payload(&translation),
        ) {
            emit_job_event(app, event);
        }
        Ok(())
    }

    fn mark_failed(&self, error: String) -> Result<(), String> {
        let _ = self.update_translation(|translation| {
            recompute_progress(translation);
            let has_completed = translation.progress.translated + translation.progress.skipped > 0;
            translation.status = if has_completed {
                TranslationStatus::Partial
            } else {
                TranslationStatus::Failed
            };
            translation.error = Some(error);
        })?;
        Ok(())
    }

    fn pause_if_requested<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        job_id: &str,
    ) -> Result<Option<TranslationRunOutcome>, String> {
        if !self.task.control.pause_requested() {
            return Ok(None);
        }

        let translation = self.update_translation(|translation| {
            recompute_progress(translation);
            translation.status = TranslationStatus::Partial;
            translation.error = Some("已暂停全文翻译".to_string());
        })?;
        if let Some(event) =
            job_manager().cancel(job_id, "已暂停全文翻译", translation_payload(&translation))
        {
            emit_job_event(app, event);
        }
        Ok(Some(TranslationRunOutcome::Paused))
    }
}

fn translation_task_controls() -> &'static Mutex<HashMap<String, Arc<TranslationTaskControl>>> {
    TRANSLATION_TASK_CONTROLS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_translation_task_control(job_id: &str) -> Arc<TranslationTaskControl> {
    let control = Arc::new(TranslationTaskControl::default());
    if let Ok(mut controls) = translation_task_controls().lock() {
        controls.insert(job_id.to_string(), control.clone());
    }
    control
}

fn get_translation_task_control(job_id: &str) -> Option<Arc<TranslationTaskControl>> {
    translation_task_controls()
        .lock()
        .ok()?
        .get(job_id)
        .cloned()
}

fn clear_translation_task_control(job_id: &str) {
    if let Ok(mut controls) = translation_task_controls().lock() {
        controls.remove(job_id);
    }
}

#[derive(Clone)]
struct LlmClient {
    client: Client,
    profile: LlmProfile,
}

impl LlmClient {
    fn new(profile: LlmProfile) -> Self {
        Self {
            client: Client::new(),
            profile,
        }
    }

    async fn translate_batch(
        &self,
        entry_title: &str,
        context: &TranslationPaperContext,
        batch: &[SourceSegment],
    ) -> Result<HashMap<SegmentUid, String>, String> {
        let terminology = context
            .terminology
            .iter()
            .take(40)
            .map(|term| {
                format!(
                    "- {} => {}{}",
                    term.source,
                    term.target,
                    term.note
                        .as_deref()
                        .map(|note| format!(" ({note})"))
                        .unwrap_or_default()
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        let protected_by_segment_uid = batch
            .iter()
            .map(|segment| {
                (
                    segment.uid.clone(),
                    protect_formula_spans(
                        &source_text(segment),
                        matches!(segment.segment_type, SegmentType::Math),
                    ),
                )
            })
            .collect::<HashMap<_, _>>();
        let segments = batch
            .iter()
            .map(|segment| {
                let protected = protected_by_segment_uid
                    .get(&segment.uid)
                    .expect("formula protection prepared for every segment");
                format!(
                    "<segment uid=\"{}\" type=\"{:?}\" page=\"{}\">\n{}\n</segment>",
                    segment.uid,
                    segment.segment_type,
                    segment.page_idx + 1,
                    protected.text
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let prompt = format!(
            "Paper title: {entry_title}\n\nPaper context:\n{}\n\nTerminology:\n{}\n\nTranslate these segments:\n{}",
            context.summary,
            if terminology.is_empty() {
                "None".to_string()
            } else {
                terminology
            },
            segments
        );
        let text = self
            .generate_text(
                &[
                    "You are an academic paper translator.",
                    "Translate source segments into Simplified Chinese.",
                    "Preserve citations, numbers, code, markdown tables, list boundaries, and technical symbols.",
                    "Formula spans are replaced by tokens such as ⟪NEUINK_MATH_0⟫. Copy every formula token exactly once and never alter, translate, remove, duplicate, or move it.",
                    "Keep surrounding inline and display math layout unchanged.",
                    "Do not translate references or image placeholders.",
                    "Return strict JSON only: {\"segments\":[{\"segment_uid\":\"...\",\"translated_text\":\"...\"}]}",
                    "Return one translation per segment_uid only.",
                ]
                .join("\n"),
                &prompt,
            )
            .await?;
        let parsed: BatchTranslationJson = parse_json_object(&text)?;
        let mut translations = HashMap::new();
        for segment in parsed.segments {
            let Some(uid) = segment.segment_uid.map(SegmentUid::from_string) else {
                continue;
            };
            let Some(text) = segment.translated_text else {
                continue;
            };
            let Some(protected) = protected_by_segment_uid.get(&uid) else {
                continue;
            };
            translations.insert(uid, restore_formula_spans(&text, &protected.formulas)?);
        }
        Ok(translations)
    }

    async fn generate_text(&self, system: &str, prompt: &str) -> Result<String, String> {
        let response = timeout(
            LLM_REQUEST_TIMEOUT,
            self.client
                .post(chat_completions_url(&self.profile.base_url))
                .headers(auth_headers(&self.profile)?)
                .json(&json!({
                    "model": self.profile.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": self.profile.temperature.unwrap_or(0.2),
                    "top_p": self.profile.top_p.unwrap_or(1.0),
                    "max_tokens": self.profile.max_output_tokens.unwrap_or(4096)
                }))
                .send(),
        )
        .await
        .map_err(|_| "LLM request timed out after 90 seconds.".to_string())?
        .map_err(|error| error.to_string())?;
        let status = response.status();
        let body = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            return Err(format!("LLM request failed ({status}): {body}"));
        }
        let parsed: ChatCompletionResponse =
            serde_json::from_str(&body).map_err(|error| error.to_string())?;
        parsed
            .choices
            .into_iter()
            .find_map(|choice| choice.message.content)
            .ok_or_else(|| "LLM response did not contain text".to_string())
    }
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PaperContextJson {
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    terminology: Vec<TranslationTermJson>,
}

#[derive(Debug, Deserialize)]
struct TranslationTermJson {
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BatchTranslationJson {
    #[serde(default)]
    segments: Vec<BatchSegmentJson>,
}

#[derive(Debug, Deserialize)]
struct BatchSegmentJson {
    #[serde(default)]
    segment_uid: Option<String>,
    #[serde(default)]
    translated_text: Option<String>,
}

fn update_translation(
    root: PathBuf,
    entry_id: EntryId,
    update: impl FnOnce(&mut EntryTranslation),
) -> Result<EntryTranslationResponse, String> {
    let translation = update_translation_value(root, entry_id, update)?;
    Ok(EntryTranslationResponse {
        translation: Some(translation),
    })
}

fn update_translation_value(
    root: PathBuf,
    entry_id: EntryId,
    update: impl FnOnce(&mut EntryTranslation),
) -> Result<EntryTranslation, String> {
    let workspace = Workspace::open(root).map_err(|error| error.to_string())?;
    let mut translation = workspace
        .read_entry_translation(&entry_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "translation has not been started".to_string())?;
    update(&mut translation);
    recompute_progress(&mut translation);
    translation.updated_at = Utc::now();
    workspace
        .write_entry_translation(&entry_id, &translation)
        .map_err(|error| error.to_string())?;
    Ok(translation)
}

fn new_translation(
    entry_id: EntryId,
    source_language: String,
    target_language: String,
    model: Option<String>,
    total: usize,
) -> EntryTranslation {
    let now = Utc::now();
    EntryTranslation {
        schema_version: 1,
        entry_id,
        source_language,
        target_language,
        status: TranslationStatus::Running,
        progress: TranslationProgress {
            total,
            translated: 0,
            skipped: 0,
            failed: 0,
        },
        paper_context: None,
        segments: Vec::new(),
        model,
        error: None,
        created_at: now,
        updated_at: now,
    }
}

fn upsert_segments(
    translation: &mut EntryTranslation,
    segments: impl IntoIterator<Item = TranslatedSegment>,
) {
    for segment in segments {
        if let Some(existing) = translation
            .segments
            .iter_mut()
            .find(|item| item.segment_uid == segment.segment_uid)
        {
            *existing = segment;
        } else {
            translation.segments.push(segment);
        }
    }
}

fn segment_from_patch(patch: TranslatedSegmentPatch) -> TranslatedSegment {
    TranslatedSegment {
        segment_uid: patch.segment_uid,
        page_idx: patch.page_idx,
        segment_type: patch.segment_type,
        source_hash: patch.source_hash,
        source_text: patch.source_text,
        translated_text: patch.translated_text,
        status: patch.status,
        error: patch.error,
        updated_at: Utc::now(),
    }
}

fn skipped_segment(segment: &SourceSegment) -> TranslatedSegment {
    TranslatedSegment {
        segment_uid: segment.uid.clone(),
        page_idx: segment.page_idx,
        segment_type: segment.segment_type,
        source_hash: source_hash(&source_text(segment)),
        source_text: source_text(segment),
        translated_text: None,
        status: TranslatedSegmentStatus::Skipped,
        error: None,
        updated_at: Utc::now(),
    }
}

fn translated_segment(
    segment: &SourceSegment,
    translated_text: Option<&String>,
) -> TranslatedSegment {
    let text = translated_text.map(|value| value.trim().to_string());
    let has_text = text.as_ref().is_some_and(|value| !value.is_empty());
    TranslatedSegment {
        segment_uid: segment.uid.clone(),
        page_idx: segment.page_idx,
        segment_type: segment.segment_type,
        source_hash: source_hash(&source_text(segment)),
        source_text: source_text(segment),
        translated_text: has_text.then_some(text.unwrap_or_default()),
        status: if has_text {
            TranslatedSegmentStatus::Translated
        } else {
            TranslatedSegmentStatus::Failed
        },
        error: (!has_text).then(|| "LLM did not return this segment translation".to_string()),
        updated_at: Utc::now(),
    }
}

fn is_reusable_translated_segment(
    segment: &SourceSegment,
    existing: Option<&TranslatedSegment>,
) -> bool {
    existing.is_some_and(|segment_translation| {
        matches!(
            segment_translation.status,
            TranslatedSegmentStatus::Translated
        ) && segment_translation.source_hash == source_hash(&source_text(segment))
            && segment_translation
                .translated_text
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
    })
}

fn recompute_progress(translation: &mut EntryTranslation) {
    translation.progress.translated = translation
        .segments
        .iter()
        .filter(|segment| matches!(segment.status, TranslatedSegmentStatus::Translated))
        .count();
    translation.progress.skipped = translation
        .segments
        .iter()
        .filter(|segment| matches!(segment.status, TranslatedSegmentStatus::Skipped))
        .count();
    translation.progress.failed = translation
        .segments
        .iter()
        .filter(|segment| matches!(segment.status, TranslatedSegmentStatus::Failed))
        .count();
}

#[derive(Debug, Eq, PartialEq)]
struct ProtectedFormulaText {
    formulas: Vec<String>,
    text: String,
}

fn protect_formula_spans(text: &str, protect_entire: bool) -> ProtectedFormulaText {
    if protect_entire && !text.is_empty() {
        return ProtectedFormulaText {
            formulas: vec![text.to_string()],
            text: "⟪NEUINK_MATH_0⟫".to_string(),
        };
    }

    let mut formulas = Vec::new();
    let mut protected = String::with_capacity(text.len());
    let mut index = 0usize;
    while index < text.len() {
        let remaining = &text[index..];
        let delimiter = if remaining.starts_with("$$") {
            Some(("$$", "$$"))
        } else if remaining.starts_with("\\[") {
            Some(("\\[", "\\]"))
        } else if remaining.starts_with("\\(") {
            Some(("\\(", "\\)"))
        } else if remaining.starts_with('$') && !text[..index].ends_with('\\') {
            Some(("$", "$"))
        } else {
            None
        };

        if let Some((opening, closing)) = delimiter {
            let content_start = index + opening.len();
            if let Some(relative_end) = text[content_start..].find(closing) {
                let end = content_start + relative_end + closing.len();
                let token = format!("⟪NEUINK_MATH_{}⟫", formulas.len());
                formulas.push(text[index..end].to_string());
                protected.push_str(&token);
                index = end;
                continue;
            }
        }

        let character = remaining
            .chars()
            .next()
            .expect("index remains on a character boundary");
        protected.push(character);
        index += character.len_utf8();
    }

    ProtectedFormulaText {
        formulas,
        text: protected,
    }
}

fn restore_formula_spans(text: &str, formulas: &[String]) -> Result<String, String> {
    let mut restored = text.to_string();
    for (index, formula) in formulas.iter().enumerate() {
        let token = format!("⟪NEUINK_MATH_{index}⟫");
        if restored.matches(&token).count() != 1 {
            return Err(format!(
                "翻译模型改变了公式占位符 {token}，已停止全部任务。"
            ));
        }
        restored = restored.replacen(&token, formula, 1);
    }
    Ok(restored)
}

fn completed_translation_status(translation: &EntryTranslation) -> TranslationStatus {
    let completed = translation.progress.translated + translation.progress.skipped;
    if translation.progress.failed == 0 && completed >= translation.progress.total {
        TranslationStatus::Succeeded
    } else {
        TranslationStatus::Partial
    }
}

fn should_translate_segment(segment: &SourceSegment) -> bool {
    !source_text(segment).trim().is_empty()
}

fn segment_type_key(segment_type: SegmentType) -> &'static str {
    match segment_type {
        SegmentType::Paragraph => "paragraph",
        SegmentType::Heading => "heading",
        SegmentType::Table => "table",
        SegmentType::Math => "math",
        SegmentType::Figure => "figure",
        SegmentType::Code => "code",
        SegmentType::List => "list",
        SegmentType::PageHeader => "page_header",
        SegmentType::PageFooter => "page_footer",
        SegmentType::PageNumber => "page_number",
        SegmentType::AsideText => "aside_text",
        SegmentType::PageFootnote => "page_footnote",
    }
}

fn build_translation_batches(
    segments: Vec<SourceSegment>,
    char_budget: usize,
) -> Vec<Vec<SourceSegment>> {
    let mut batches = Vec::new();
    let mut current = Vec::new();
    let mut current_chars = 0;

    for segment in segments {
        let length = source_text(&segment).chars().count();
        if !current.is_empty()
            && (current.len() >= MAX_BATCH_SEGMENTS || current_chars + length > char_budget)
        {
            batches.push(current);
            current = Vec::new();
            current_chars = 0;
        }
        current.push(segment);
        current_chars += length;
    }

    if !current.is_empty() {
        batches.push(current);
    }
    batches
}

#[derive(Clone, Copy)]
struct TranslationBudgets {
    batch: usize,
    context: usize,
}

fn translation_budgets(max_context_length: Option<u32>) -> TranslationBudgets {
    let estimated_context_chars = (max_context_length.unwrap_or(8_192) as usize)
        .saturating_mul(3)
        .max(12_000);
    TranslationBudgets {
        batch: (estimated_context_chars / 4).clamp(2_000, MAX_BATCH_CHAR_BUDGET),
        context: ((estimated_context_chars * 35) / 100).clamp(4_000, MAX_PAPER_CONTEXT_BUDGET),
    }
}

#[derive(Debug, Eq, PartialEq)]
struct ListTranslationUnit {
    prefix: String,
    text: String,
}

#[derive(Debug, Deserialize)]
struct ListItemMetadata {
    text: String,
}

fn list_translation_units(segment: &SourceSegment) -> Vec<ListTranslationUnit> {
    let parsed = split_list_translation_units(&source_text(segment));
    let metadata_items = segment
        .mineru_metadata
        .get("list_item_regions")
        .and_then(|value| serde_json::from_str::<Vec<ListItemMetadata>>(value).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|item| !item.text.trim().is_empty())
        .collect::<Vec<_>>();

    // MinerU may expose visual list items even when the Markdown has lost its
    // markers.  Prefer that authoritative visual order whenever it disagrees
    // with the textual split, so every highlighted region still gets one call.
    if !metadata_items.is_empty() && metadata_items.len() != parsed.len() {
        return metadata_items
            .into_iter()
            .map(|item| ListTranslationUnit {
                prefix: "- ".to_string(),
                text: item.text,
            })
            .collect();
    }
    parsed
}

/// Splits nested Markdown-style lists into source-order items.  The prefix includes
/// indentation and the original marker so a translated item can be reassembled at
/// exactly the same logical position as its source item.
fn split_list_translation_units(text: &str) -> Vec<ListTranslationUnit> {
    let mut items = Vec::new();
    for line in text.lines() {
        if let Some((prefix, item_text)) = split_list_marker(line) {
            items.push(ListTranslationUnit {
                prefix: format!("{prefix} "),
                text: item_text.to_string(),
            });
        } else if let Some(item) = items.last_mut() {
            let continuation = line.trim();
            if !continuation.is_empty() {
                item.text.push('\n');
                item.text.push_str(continuation);
            }
        }
    }
    items
}

fn split_list_marker(line: &str) -> Option<(&str, &str)> {
    let trimmed_start = line.trim_start();
    let indent_len = line.len() - trimmed_start.len();
    let marker_len = if trimmed_start.starts_with("- ")
        || trimmed_start.starts_with("* ")
        || trimmed_start.starts_with("+ ")
    {
        1
    } else if let Some(closing_index) = trimmed_start
        .strip_prefix('[')
        .and_then(|value| value.find("] ").map(|index| index + 1))
    {
        closing_index + 1
    } else {
        let digits = trimmed_start
            .chars()
            .take_while(|value| value.is_ascii_digit())
            .count();
        if digits > 0
            && matches!(trimmed_start.as_bytes().get(digits), Some(b'.' | b')'))
            && trimmed_start.as_bytes().get(digits + 1) == Some(&b' ')
        {
            digits + 1
        } else {
            return None;
        }
    };
    let prefix_end = indent_len + marker_len;
    Some((&line[..prefix_end], line[prefix_end..].trim_start()))
}

fn source_text(segment: &SourceSegment) -> String {
    segment
        .markdown
        .as_deref()
        .unwrap_or(segment.text.as_str())
        .to_string()
}

fn source_hash(text: &str) -> String {
    let mut hash = 2166136261u32;
    for code_unit in text.encode_utf16() {
        hash ^= u32::from(code_unit);
        hash = hash.wrapping_mul(16777619);
    }
    format!("{hash:08x}")
}

fn trim_to_budget(text: &str, budget: usize) -> String {
    if text.chars().count() <= budget {
        return text.to_string();
    }
    format!(
        "{}\n\n[Truncated]",
        text.chars().take(budget).collect::<String>()
    )
}

fn normalize_terms(terms: Vec<TranslationTermJson>) -> Vec<TranslationTerm> {
    terms
        .into_iter()
        .filter_map(|term| {
            let source = term.source?.trim().to_string();
            let target = term.target?.trim().to_string();
            (!source.is_empty() && !target.is_empty()).then_some(TranslationTerm {
                source,
                target,
                note: term.note.and_then(|note| {
                    let note = note.trim().to_string();
                    (!note.is_empty()).then_some(note)
                }),
            })
        })
        .take(80)
        .collect()
}

fn parse_json_object<T: for<'de> Deserialize<'de>>(text: &str) -> Result<T, String> {
    let trimmed = text.trim();
    let candidate = if let Some(start) = trimmed.find("```") {
        let after_open = &trimmed[start + 3..];
        let after_lang = after_open
            .strip_prefix("json")
            .unwrap_or(after_open)
            .trim_start();
        after_lang
            .find("```")
            .map(|end| &after_lang[..end])
            .unwrap_or(after_lang)
    } else {
        trimmed
    };
    let start = candidate
        .find('{')
        .ok_or_else(|| "LLM did not return a JSON object".to_string())?;
    let end = candidate
        .rfind('}')
        .ok_or_else(|| "LLM did not return a JSON object".to_string())?;
    let object = &candidate[start..=end];
    serde_json::from_str(object).or_else(|original_error| {
        let repaired = repair_invalid_json_escapes(object);
        serde_json::from_str(&repaired).map_err(|repair_error| {
            format!("{original_error}; repair attempt failed: {repair_error}")
        })
    })
}

fn repair_invalid_json_escapes(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut in_string = false;
    let mut escaped = false;
    let chars = value.chars().collect::<Vec<_>>();
    let mut index = 0;
    while index < chars.len() {
        let current = chars[index];
        if !in_string {
            if current == '"' {
                in_string = true;
            }
            output.push(current);
            index += 1;
            continue;
        }
        if escaped {
            escaped = false;
            output.push(current);
            index += 1;
            continue;
        }
        if current == '"' {
            in_string = false;
            output.push(current);
            index += 1;
            continue;
        }
        if current == '\\' {
            let next = chars.get(index + 1).copied();
            if !matches!(
                next,
                Some('"' | '\\' | '/' | 'b' | 'f' | 'n' | 'r' | 't' | 'u')
            ) {
                output.push_str("\\\\");
                index += 1;
                continue;
            }
            escaped = true;
        }
        output.push(current);
        index += 1;
    }
    output
}

fn chat_completions_url(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    }
}

fn auth_headers(profile: &LlmProfile) -> Result<reqwest::header::HeaderMap, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(api_key) = profile.api_key.as_deref().filter(|value| !value.is_empty()) {
        let value = format!("Bearer {api_key}");
        headers.insert(
            reqwest::header::AUTHORIZATION,
            value
                .parse::<reqwest::header::HeaderValue>()
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(headers)
}

fn translation_payload(translation: &EntryTranslation) -> Value {
    json!({ "translation": translation })
}

#[cfg(test)]
mod tests {
    use super::{
        list_translation_units, parse_json_object, protect_formula_spans, restore_formula_spans,
        should_translate_segment, split_list_translation_units, translation_budgets,
    };
    use neuink_domain::{SegmentType, SourceSegment};
    use serde_json::Value;

    #[test]
    fn translation_budgets_follow_the_configured_context_window() {
        let small = translation_budgets(Some(8_192));
        let large = translation_budgets(Some(128_000));

        assert!(small.batch < large.batch);
        assert!(small.context < large.context);
        assert_eq!(large.batch, 7_500);
        assert_eq!(large.context, 28_000);
    }

    #[test]
    fn repairs_invalid_backslash_escapes_in_llm_json() {
        let parsed: Value =
            parse_json_object(r#"{"segments":[{"translated_text":"keep \\[x\\] and \\_"}]}"#)
                .expect("invalid LaTex escapes should be repaired");
        assert_eq!(
            parsed["segments"][0]["translated_text"],
            "keep \\[x\\] and \\_"
        );
    }

    #[test]
    fn protects_and_restores_inline_and_display_formulas_exactly() {
        let source = "Loss $L_i = x_i^2$ is defined by:\n$$\\sum_i x_i$$\nDone.";
        let protected = protect_formula_spans(source, false);

        assert_eq!(
            protected.text,
            "Loss ⟪NEUINK_MATH_0⟫ is defined by:\n⟪NEUINK_MATH_1⟫\nDone."
        );
        assert_eq!(
            restore_formula_spans(
                "损失 ⟪NEUINK_MATH_0⟫ 定义为：\n⟪NEUINK_MATH_1⟫\n完成。",
                &protected.formulas,
            )
            .expect("formula tokens should restore"),
            "损失 $L_i = x_i^2$ 定义为：\n$$\\sum_i x_i$$\n完成。"
        );
    }

    #[test]
    fn rejects_changed_or_duplicated_formula_tokens() {
        let formulas = vec!["$x_i$".to_string()];
        assert!(restore_formula_spans("没有公式占位符", &formulas).is_err());
        assert!(restore_formula_spans("⟪NEUINK_MATH_0⟫ 和 ⟪NEUINK_MATH_0⟫", &formulas,).is_err());
    }

    #[test]
    fn allows_every_non_empty_segment_type_for_translation() {
        let segment_types = [
            SegmentType::Paragraph,
            SegmentType::Heading,
            SegmentType::Table,
            SegmentType::Math,
            SegmentType::Figure,
            SegmentType::Code,
            SegmentType::List,
            SegmentType::PageHeader,
            SegmentType::PageFooter,
            SegmentType::PageNumber,
            SegmentType::AsideText,
            SegmentType::PageFootnote,
        ];

        for segment_type in segment_types {
            let segment = SourceSegment::new(segment_type, 0, None, "English source".to_string());
            assert!(should_translate_segment(&segment), "{segment_type:?}");
        }
    }

    #[test]
    fn splits_nested_list_items_in_source_order_and_preserves_markers() {
        let items = split_list_translation_units(
            "- First item\n  continuation\n  - Nested item\n2. Second item",
        );

        assert_eq!(
            items,
            vec![
                super::ListTranslationUnit {
                    prefix: "- ".to_string(),
                    text: "First item\ncontinuation".to_string(),
                },
                super::ListTranslationUnit {
                    prefix: "  - ".to_string(),
                    text: "Nested item".to_string(),
                },
                super::ListTranslationUnit {
                    prefix: "2. ".to_string(),
                    text: "Second item".to_string(),
                },
            ]
        );
    }

    #[test]
    fn uses_visual_list_items_when_markers_are_missing_from_markdown() {
        let mut segment =
            SourceSegment::new(SegmentType::List, 0, None, "first\nsecond".to_string());
        segment.mineru_metadata.insert(
            "list_item_regions".to_string(),
            r#"[{"bbox":[0,0,1,1],"text":"first"},{"bbox":[0,2,1,3],"text":"second"}]"#.to_string(),
        );

        assert_eq!(
            list_translation_units(&segment),
            vec![
                super::ListTranslationUnit {
                    prefix: "- ".to_string(),
                    text: "first".to_string()
                },
                super::ListTranslationUnit {
                    prefix: "- ".to_string(),
                    text: "second".to_string()
                },
            ]
        );
    }
}

fn emit_started<R: Runtime>(app: &AppHandle<R>, job_id: &str, message: &str) {
    if let Some(event) = job_manager().start(job_id, message) {
        emit_job_event(app, event);
    }
}

fn default_source_language() -> String {
    "en".to_string()
}

fn default_target_language() -> String {
    "zh-CN".to_string()
}
