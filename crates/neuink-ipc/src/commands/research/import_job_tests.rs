use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

use neuink_job::{JobEventKind, JobStatus};

use super::*;

fn paper(title: &str) -> Paper {
    Paper {
        id: title.into(),
        title: title.into(),
        authors: vec![],
        year: String::new(),
        abstract_text: String::new(),
        doi: String::new(),
        url: String::new(),
        pdf_url: None,
        provider: "test".into(),
        evidence_level: "abstract".into(),
    }
}

#[test]
fn no_job_is_created_until_the_import_has_been_authorized() {
    let manager = LocalJobManager::new();
    drop(ImportJob::new(manager.clone(), |_| {}));
    assert!(manager.list().is_empty());
    assert!(manager.events(None).is_empty());
}

#[test]
fn queued_download_and_completion_events_report_paper_counts() {
    let manager = LocalJobManager::new();
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let events = Arc::clone(&emitted);
    let mut job = ImportJob::new(manager.clone(), move |event| {
        events.lock().unwrap().push(event);
    });
    job.queue(Path::new("workspace"), 2);
    let queued = manager.list().remove(0);
    assert_eq!(queued.status, JobStatus::Queued);
    assert_eq!(queued.kind, JobKind::PdfImport);
    assert!(queued.id.starts_with("research-import:"));
    assert_eq!(queued.progress.current, 0);
    assert_eq!(queued.progress.total, 2);
    assert_eq!(
        queued.scope,
        Some(JobScope::Workspace {
            root: "workspace".into()
        })
    );
    assert!(queued.message.unwrap().contains("等待下载"));

    job.start_paper(&paper("First paper"));
    job.downloading();
    let downloading = manager.get(&queued.id).unwrap();
    assert_eq!(downloading.status, JobStatus::Processing);
    assert_eq!(downloading.progress.percent, 0);
    assert!(downloading
        .message
        .unwrap()
        .contains("正在下载：First paper"));
    job.complete_paper(&json!({"status": "imported"}));
    assert_eq!(manager.get(&queued.id).unwrap().progress.percent, 50);
    job.start_paper(&paper("Existing paper"));
    job.complete_paper(&json!({"status": "already_in_library"}));
    job.finish();
    drop(job);

    let completed = manager.get(&queued.id).unwrap();
    assert_eq!(completed.status, JobStatus::Succeeded);
    assert_eq!(completed.progress.current, 2);
    assert_eq!(completed.progress.percent, 100);
    let events = emitted.lock().unwrap();
    assert_eq!(*events, manager.events(Some(&queued.id)));
    assert_eq!(events.first().unwrap().kind, JobEventKind::Queued);
    let terminal = events.last().unwrap();
    assert_eq!(terminal.kind, JobEventKind::Succeeded);
    assert_eq!(terminal.payload["imported"], 1);
    assert_eq!(terminal.payload["already_in_library"], 1);
    assert_eq!(terminal.payload["failed"], 0);
}

#[test]
fn mixed_results_fail_the_batch_without_losing_success_counts() {
    let manager = LocalJobManager::new();
    let mut job = ImportJob::new(manager.clone(), |_| {});
    job.queue(Path::new("workspace"), 2);
    job.start_paper(&paper("Imported paper"));
    job.complete_paper(&json!({"status": "imported"}));
    job.start_paper(&paper("Unavailable paper"));
    job.complete_paper(&json!({"status": "failed", "error": "没有公开 PDF"}));
    job.finish();
    drop(job);

    let completed = manager.list().remove(0);
    assert_eq!(completed.status, JobStatus::Failed);
    assert_eq!(completed.progress.current, 2);
    let message = completed.message.unwrap();
    assert!(message.contains("已入库 1"));
    assert!(message.contains("失败 1"));
    assert!(completed
        .error
        .unwrap()
        .contains("Unavailable paper：没有公开 PDF"));
    assert_eq!(manager.events(None).last().unwrap().payload["imported"], 1);
}

#[test]
fn canceling_queued_or_partial_imports_preserves_counts_and_finishes_once() {
    for complete_first in [false, true] {
        let manager = LocalJobManager::new();
        let mut job = ImportJob::new(manager.clone(), |_| {});
        job.queue(Path::new("workspace"), 2);
        if complete_first {
            job.start_paper(&paper("Imported paper"));
            job.complete_paper(&json!({"status": "imported"}));
            job.start_paper(&paper("Pending paper"));
        }
        job.cancel("用户已停止下载");
        drop(job);
        let canceled = manager.list().remove(0);
        assert_eq!(canceled.status, JobStatus::Canceled);
        assert_eq!(canceled.progress.current, usize::from(complete_first));
        assert_eq!(canceled.progress.total, 2);
        let events = manager.events(None);
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == JobEventKind::Canceled)
                .count(),
            1
        );
    }
}

#[tokio::test]
async fn dropping_an_import_future_cancels_its_job_and_keeps_partial_results() {
    let manager = LocalJobManager::new();
    let task_manager = manager.clone();
    let (ready, started) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let mut job = ImportJob::new(task_manager, |_| {});
        job.queue(Path::new("workspace"), 3);
        job.start_paper(&paper("Imported paper"));
        job.complete_paper(&json!({"status": "imported"}));
        job.start_paper(&paper("Pending paper"));
        ready.send(()).unwrap();
        std::future::pending::<()>().await;
        job.finish();
    });
    started.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    let canceled = manager.list().remove(0);
    assert_eq!(canceled.status, JobStatus::Canceled);
    assert_eq!(canceled.progress.current, 1);
    assert_eq!(canceled.progress.total, 3);
    assert!(canceled.message.unwrap().contains("已入库 1"));
}

#[tokio::test]
async fn outer_timeout_fails_the_job_after_dropping_the_download_future() {
    let manager = LocalJobManager::new();
    let mut job = ImportJob::new(manager.clone(), |_| {});
    let outcome = tokio::time::timeout(Duration::from_millis(1), async {
        job.queue(Path::new("workspace"), 2);
        job.start_paper(&paper("Imported paper"));
        job.complete_paper(&json!({"status": "imported"}));
        job.start_paper(&paper("Slow paper"));
        job.downloading();
        std::future::pending::<()>().await;
    })
    .await;
    assert!(outcome.is_err());
    job.fail("论文下载超时");
    drop(job);
    let failed = manager.list().remove(0);
    assert_eq!(failed.status, JobStatus::Failed);
    assert_eq!(failed.progress.current, 1);
    assert_eq!(failed.progress.percent, 50);
    let message = failed.error.unwrap();
    assert!(message.contains("下载超时"));
    assert!(message.contains("已入库 1"));
    assert!(message.contains("Slow paper"));
}
