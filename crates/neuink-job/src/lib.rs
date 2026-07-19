use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use chrono::{DateTime, Utc};
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Job {
    pub id: String,
    pub kind: JobKind,
    pub status: JobStatus,
    pub progress: JobProgress,
    pub scope: Option<JobScope>,
    pub message: Option<String>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Job {
    pub fn queued(kind: JobKind, scope: Option<JobScope>, total: usize) -> Self {
        let now = Utc::now();
        Self {
            id: format!("job_{}", nanoid!(12)),
            kind,
            status: JobStatus::Queued,
            progress: JobProgress {
                current: 0,
                total,
                percent: 0,
            },
            scope,
            message: None,
            error: None,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    PdfImport,
    Parser,
    IndexBuild,
    Translation,
    Vectorize,
    Llm,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Processing,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct JobProgress {
    pub current: usize,
    pub total: usize,
    pub percent: u8,
}

impl JobProgress {
    pub fn new(current: usize, total: usize) -> Self {
        let percent = if total == 0 {
            100
        } else {
            ((current.saturating_mul(100)) / total).min(100) as u8
        };
        Self {
            current,
            total,
            percent,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobScope {
    Entry { root: String, entry_id: String },
    Workspace { root: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct JobEvent {
    pub job: Job,
    pub kind: JobEventKind,
    #[serde(default)]
    pub payload: Value,
    pub emitted_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobEventKind {
    Queued,
    Started,
    Progress,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Clone, Debug, Default)]
pub struct LocalJobManager {
    inner: Arc<Mutex<JobState>>,
}

impl LocalJobManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create(&self, kind: JobKind, scope: Option<JobScope>, total: usize) -> JobEvent {
        let job = Job::queued(kind, scope, total);
        self.record(job, JobEventKind::Queued, Value::Null)
    }

    pub fn start(&self, job_id: &str, message: impl Into<String>) -> Option<JobEvent> {
        self.update(job_id, JobEventKind::Started, Value::Null, |job| {
            job.status = JobStatus::Processing;
            job.message = Some(message.into());
            job.error = None;
        })
    }

    pub fn progress(
        &self,
        job_id: &str,
        current: usize,
        total: usize,
        message: impl Into<String>,
        payload: Value,
    ) -> Option<JobEvent> {
        self.update(job_id, JobEventKind::Progress, payload, |job| {
            job.status = JobStatus::Processing;
            job.progress = JobProgress::new(current, total);
            job.message = Some(message.into());
        })
    }

    pub fn succeed(
        &self,
        job_id: &str,
        message: impl Into<String>,
        payload: Value,
    ) -> Option<JobEvent> {
        self.update(job_id, JobEventKind::Succeeded, payload, |job| {
            job.status = JobStatus::Succeeded;
            job.progress = JobProgress::new(job.progress.total, job.progress.total);
            job.message = Some(message.into());
            job.error = None;
        })
    }

    pub fn fail(&self, job_id: &str, error: impl Into<String>, payload: Value) -> Option<JobEvent> {
        self.update(job_id, JobEventKind::Failed, payload, |job| {
            let error = error.into();
            job.status = JobStatus::Failed;
            job.message = Some(error.clone());
            job.error = Some(error);
        })
    }

    pub fn cancel(
        &self,
        job_id: &str,
        message: impl Into<String>,
        payload: Value,
    ) -> Option<JobEvent> {
        self.update(job_id, JobEventKind::Canceled, payload, |job| {
            job.status = JobStatus::Canceled;
            job.message = Some(message.into());
            job.error = None;
        })
    }

    pub fn get(&self, job_id: &str) -> Option<Job> {
        self.inner.lock().ok()?.jobs.get(job_id).cloned()
    }

    pub fn list(&self) -> Vec<Job> {
        let Ok(inner) = self.inner.lock() else {
            return Vec::new();
        };
        let mut jobs = inner.jobs.values().cloned().collect::<Vec<_>>();
        jobs.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        jobs
    }

    pub fn events(&self, job_id: Option<&str>) -> Vec<JobEvent> {
        let Ok(inner) = self.inner.lock() else {
            return Vec::new();
        };
        inner
            .events
            .iter()
            .filter(|event| job_id.map_or(true, |id| event.job.id == id))
            .cloned()
            .collect()
    }

    fn update(
        &self,
        job_id: &str,
        kind: JobEventKind,
        payload: Value,
        update: impl FnOnce(&mut Job),
    ) -> Option<JobEvent> {
        let mut inner = self.inner.lock().ok()?;
        let job = inner.jobs.get_mut(job_id)?;
        update(job);
        job.updated_at = Utc::now();
        let event = JobEvent {
            job: job.clone(),
            kind,
            payload,
            emitted_at: Utc::now(),
        };
        inner.events.push(event.clone());
        trim_events(&mut inner.events);
        trim_jobs(&mut inner.jobs);
        Some(event)
    }

    fn record(&self, job: Job, kind: JobEventKind, payload: Value) -> JobEvent {
        let event = JobEvent {
            job: job.clone(),
            kind,
            payload,
            emitted_at: Utc::now(),
        };
        if let Ok(mut inner) = self.inner.lock() {
            inner.jobs.insert(job.id.clone(), job);
            inner.events.push(event.clone());
            trim_events(&mut inner.events);
            trim_jobs(&mut inner.jobs);
        }
        event
    }
}

#[derive(Clone, Debug, Default)]
struct JobState {
    jobs: HashMap<String, Job>,
    events: Vec<JobEvent>,
}

fn trim_events(events: &mut Vec<JobEvent>) {
    const MAX_EVENTS: usize = 500;
    if events.len() > MAX_EVENTS {
        events.drain(0..events.len() - MAX_EVENTS);
    }
}

fn trim_jobs(jobs: &mut HashMap<String, Job>) {
    const MAX_JOBS: usize = 256;
    while jobs.len() > MAX_JOBS {
        let Some(oldest_terminal_id) = jobs
            .values()
            .filter(|job| {
                matches!(
                    job.status,
                    JobStatus::Succeeded | JobStatus::Failed | JobStatus::Canceled
                )
            })
            .min_by_key(|job| job.updated_at)
            .map(|job| job.id.clone())
        else {
            return;
        };
        jobs.remove(&oldest_terminal_id);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::{JobKind, LocalJobManager};

    #[test]
    fn completed_job_history_is_bounded() {
        let manager = LocalJobManager::new();
        for _ in 0..300 {
            let event = manager.create(JobKind::IndexBuild, None, 1);
            manager.succeed(&event.job.id, "done", Value::Null);
        }

        assert_eq!(manager.list().len(), 256);
    }
}
