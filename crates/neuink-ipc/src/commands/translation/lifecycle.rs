use super::*;
use neuink_job::{JobProgress, JobStatus};

#[derive(Debug, Deserialize)]
pub struct TranslationTaskActionRequest {
    pub root: PathBuf,
    pub entry_id: EntryId,
    pub job_id: String,
}

pub(super) fn restore_paused_job(
    root: &std::path::Path,
    translation: &EntryTranslation,
) -> Result<Option<Job>, String> {
    if !matches!(translation.status, TranslationStatus::Paused) {
        return Ok(None);
    }
    let Some(task) = &translation.task else {
        return Ok(None);
    };
    let total = task.source_hashes.len();
    job_manager()
        .restore_paused(Job {
            id: task.job_id.clone(),
            kind: JobKind::Translation,
            status: JobStatus::Paused,
            scope: Some(JobScope::Entry {
                root: root.to_string_lossy().into_owned(),
                entry_id: translation.entry_id.to_string(),
            }),
            progress: JobProgress::new(
                total.saturating_sub(task.remaining_segment_uids.len()),
                total,
            ),
            message: Some("已暂停翻译，可继续当前任务".into()),
            error: None,
            created_at: task.created_at,
            updated_at: translation.updated_at,
        })
        .map(Some)
}

fn read_task(
    request: &TranslationTaskActionRequest,
) -> Result<(Workspace, EntryTranslation, TranslationTaskSnapshot), String> {
    let workspace = Workspace::open(&request.root).map_err(|error| error.to_string())?;
    let translation = workspace
        .read_entry_translation(&request.entry_id)
        .map_err(|error| error.to_string())?
        .ok_or("翻译任务不存在。")?;
    let task = translation
        .task
        .clone()
        .filter(|task| task.job_id == request.job_id)
        .ok_or("原翻译任务已结束或已被替换，请重新打开翻译任务。")?;
    Ok((workspace, translation, task))
}

pub(super) fn load_paused_task(
    request: &TranslationTaskActionRequest,
) -> Result<(Workspace, EntryTranslation, TranslationTaskSnapshot), String> {
    let (workspace, translation, snapshot) = read_task(request)?;
    if !matches!(translation.status, TranslationStatus::Paused)
        || get_translation_task_control(&request.job_id).is_some()
    {
        return Err("任务不在已暂停状态，请等待当前操作结束。".into());
    }
    validate_remaining(&workspace, &translation, &snapshot)?;
    Ok((workspace, translation, snapshot))
}

pub(super) fn pending_segments(
    task: &TranslationTask,
    segments: Vec<SourceSegment>,
    translation: &EntryTranslation,
) -> Vec<SourceSegment> {
    let remaining = translation
        .task
        .as_ref()
        .map(|task| task.remaining_segment_uids.iter().collect::<HashSet<_>>());
    segments
        .into_iter()
        .filter(|segment| {
            task.selected_segment_uids
                .as_ref()
                .is_none_or(|uids| uids.contains(&segment.uid))
                && remaining
                    .as_ref()
                    .is_none_or(|uids| uids.contains(&segment.uid))
        })
        .collect()
}

pub(super) fn validate_remaining(
    workspace: &Workspace,
    translation: &EntryTranslation,
    task: &TranslationTaskSnapshot,
) -> Result<(), String> {
    let segments = workspace
        .read_segments(&translation.entry_id)
        .map_err(|error| error.to_string())?;
    let hashes: HashMap<_, _> = segments
        .iter()
        .map(|segment| (&segment.uid, source_hash(&source_text(segment))))
        .collect();
    if task.remaining_segment_uids.iter().any(|uid| {
        task.source_hashes.get(uid).is_none() || hashes.get(uid) != task.source_hashes.get(uid)
    }) {
        return Err("待翻译的原文已改变，请取消此任务后重新选择内容翻译。".into());
    }
    Ok(())
}

#[tauri::command]
pub fn resume_entry_translation<R: Runtime>(
    app: AppHandle<R>,
    request: TranslationTaskActionRequest,
) -> Result<RunEntryTranslationResponse, String> {
    let _guard = TRANSLATION_START_LOCK
        .lock()
        .map_err(|error| error.to_string())?;
    let (workspace, mut translation, snapshot) = load_paused_task(&request)?;
    let profile = super::super::settings::read_settings(&app)?
        .llm_profiles
        .into_iter()
        .find(|profile| profile.id == snapshot.profile_id)
        .ok_or("此任务使用的模型配置已删除，请恢复配置，或取消任务后重新翻译。")?;
    if translation.model.as_deref() != Some(profile.model.as_str()) {
        return Err("此任务使用的模型已更改，请恢复配置，或取消任务后重新翻译。".into());
    }
    restore_paused_job(&request.root, &translation)?;
    translation.status = TranslationStatus::Running;
    translation.error = None;
    translation.updated_at = Utc::now();
    workspace
        .write_entry_translation(&request.entry_id, &translation)
        .map_err(|error| error.to_string())?;
    let Some(event) = job_manager().start(&request.job_id, "继续翻译") else {
        translation.status = TranslationStatus::Paused;
        workspace
            .write_entry_translation(&request.entry_id, &translation)
            .map_err(|error| error.to_string())?;
        return Err("无法恢复任务状态，请重试。".into());
    };
    let control = register_translation_task_control(&request.job_id);
    emit_job_event(&app, event.clone());
    let task = TranslationTask {
        control,
        entry_id: request.entry_id,
        root: request.root,
        profile,
        force: snapshot.force,
        job_total: snapshot.source_hashes.len(),
        selected_segment_uids: Some(snapshot.source_hashes.into_keys().collect()),
        strategy: RunTranslationStrategy::Resume,
    };
    tauri::async_runtime::spawn(run_translation_task(app, request.job_id, task));
    Ok(RunEntryTranslationResponse {
        job: event.job,
        translation,
    })
}

#[tauri::command]
pub fn cancel_translation_task<R: Runtime>(
    app: AppHandle<R>,
    request: TranslationTaskActionRequest,
) -> Result<RunEntryTranslationResponse, String> {
    let _guard = TRANSLATION_START_LOCK
        .lock()
        .map_err(|error| error.to_string())?;
    let (_, translation, _) = read_task(&request)?;
    if matches!(translation.status, TranslationStatus::Paused)
        && get_translation_task_control(&request.job_id).is_none()
    {
        restore_paused_job(&request.root, &translation)?;
        let translation = cancel_saved_task(&request)?;
        let event = job_manager()
            .cancel(
                &request.job_id,
                "已取消翻译任务，保留已有译文",
                translation_payload(&translation),
            )
            .ok_or("无法更新任务状态。")?;
        emit_job_event(&app, event.clone());
        return Ok(RunEntryTranslationResponse {
            job: event.job,
            translation,
        });
    }
    let job = stop_entry_translation(&request.job_id, TranslationStop::Cancel)?
        .ok_or("翻译任务不存在。")?;
    Ok(RunEntryTranslationResponse { job, translation })
}

pub(super) fn cancel_saved_task(
    request: &TranslationTaskActionRequest,
) -> Result<EntryTranslation, String> {
    let (_, translation, _) = read_task(request)?;
    if !matches!(translation.status, TranslationStatus::Paused) {
        return Err("任务尚未暂停。".into());
    }
    update_translation_value(
        request.root.clone(),
        request.entry_id.clone(),
        |translation| {
            translation.task = None;
            translation.status = TranslationStatus::Canceled;
            translation.error = None;
        },
    )
}
