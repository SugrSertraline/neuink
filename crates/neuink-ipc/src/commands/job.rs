use std::sync::OnceLock;

use neuink_job::{Job, JobEvent, LocalJobManager};
use serde::Deserialize;
use tauri::Emitter;

static JOB_MANAGER: OnceLock<LocalJobManager> = OnceLock::new();

pub(crate) fn job_manager() -> &'static LocalJobManager {
    JOB_MANAGER.get_or_init(LocalJobManager::new)
}

pub(crate) fn emit_job_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: JobEvent) {
    let _ = app.emit("neuink://job-event", event);
}

#[derive(Debug, Deserialize)]
pub struct GetJobRequest {
    pub job_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ListJobEventsRequest {
    #[serde(default)]
    pub job_id: Option<String>,
}

#[tauri::command]
pub fn get_job(request: GetJobRequest) -> Result<Option<Job>, String> {
    Ok(job_manager().get(&request.job_id))
}

#[tauri::command]
pub fn list_jobs() -> Result<Vec<Job>, String> {
    Ok(job_manager().list())
}

#[tauri::command]
pub fn list_job_events(request: ListJobEventsRequest) -> Result<Vec<JobEvent>, String> {
    Ok(job_manager().events(request.job_id.as_deref()))
}
