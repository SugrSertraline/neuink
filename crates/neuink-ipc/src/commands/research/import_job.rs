use std::path::Path;

use neuink_job::{Job, JobEvent, JobKind, JobScope, LocalJobManager};
use serde_json::{json, Value};

use super::Paper;

/// Kept outside the bounded import future so timeout/cancel can finalize its progress.
pub(super) struct ImportJob {
    manager: LocalJobManager,
    emit: Box<dyn Fn(JobEvent) + Send + Sync>,
    progress: Option<ImportProgress>,
}

struct ImportProgress {
    id: String,
    total: usize,
    imported: usize,
    existing: usize,
    failed: usize,
    paper: Option<String>,
    last_error: Option<String>,
}

impl ImportProgress {
    fn completed(&self) -> usize {
        self.imported + self.existing + self.failed
    }

    fn summary(&self) -> String {
        format!(
            "已处理 {}/{} 篇 · 已入库 {} · 已有 {} · 失败 {}",
            self.completed(),
            self.total,
            self.imported,
            self.existing,
            self.failed
        )
    }

    fn payload(&self) -> Value {
        json!({
            "imported": self.imported,
            "already_in_library": self.existing,
            "failed": self.failed,
            "current_paper": self.paper,
        })
    }
}

impl ImportJob {
    pub(super) fn new(
        manager: LocalJobManager,
        emit: impl Fn(JobEvent) + Send + Sync + 'static,
    ) -> Self {
        Self {
            manager,
            emit: Box::new(emit),
            progress: None,
        }
    }

    // Only call after consuming the user's frozen one-time approval.
    pub(super) fn queue(&mut self, root: &Path, total: usize) {
        let mut job = Job::queued(
            JobKind::PdfImport,
            Some(JobScope::Workspace {
                root: root.to_string_lossy().into_owned(),
            }),
            total,
        );
        job.id = format!("research-import:{}", job.id);
        job.message = Some(format!("等待下载 · 共 {total} 篇论文"));
        self.progress = Some(ImportProgress {
            id: job.id.clone(),
            total,
            imported: 0,
            existing: 0,
            failed: 0,
            paper: None,
            last_error: None,
        });
        (self.emit)(self.manager.enqueue(job));
    }

    pub(super) fn start_paper(&mut self, paper: &Paper) {
        let Some(progress) = self.progress.as_mut() else {
            return;
        };
        progress.paper = Some(paper.title.clone());
        if let Some(event) = self.manager.start(
            &progress.id,
            format!("正在检查：{} · {}", paper.title, progress.summary()),
        ) {
            (self.emit)(event);
        }
    }

    pub(super) fn downloading(&self) {
        let Some(progress) = self.progress.as_ref() else {
            return;
        };
        self.report(format!(
            "正在下载：{} · {}",
            progress.paper.as_deref().unwrap_or_default(),
            progress.summary()
        ));
    }

    pub(super) fn complete_paper(&mut self, result: &Value) {
        let Some(progress) = self.progress.as_mut() else {
            return;
        };
        let status = match result["status"].as_str() {
            Some("imported") => {
                progress.imported += 1;
                "已入库"
            }
            Some("already_in_library") => {
                progress.existing += 1;
                "已在资料库"
            }
            _ => {
                progress.failed += 1;
                progress.last_error = Some(format!(
                    "{}：{}",
                    progress.paper.as_deref().unwrap_or_default(),
                    result["error"].as_str().unwrap_or("论文入库失败")
                ));
                "下载入库失败"
            }
        };
        let message = format!(
            "{status}：{} · {}{}",
            progress.paper.as_deref().unwrap_or_default(),
            progress.summary(),
            result["error"]
                .as_str()
                .map(|error| format!(" · {error}"))
                .unwrap_or_default(),
        );
        self.report(message);
    }

    fn report(&self, message: String) {
        let Some(progress) = self.progress.as_ref() else {
            return;
        };
        if let Some(event) = self.manager.progress(
            &progress.id,
            progress.completed(),
            progress.total,
            message,
            progress.payload(),
        ) {
            (self.emit)(event);
        }
    }

    pub(super) fn finish(&mut self) {
        let Some(progress) = self.progress.take() else {
            return;
        };
        let event = if progress.failed > 0 {
            self.manager.fail(
                &progress.id,
                format!(
                    "论文下载入库有失败 · {} · {}",
                    progress.summary(),
                    progress.last_error.as_deref().unwrap_or_default()
                ),
                progress.payload(),
            )
        } else {
            self.manager.succeed(
                &progress.id,
                format!("论文下载入库完成 · {}", progress.summary()),
                progress.payload(),
            )
        };
        if let Some(event) = event {
            (self.emit)(event);
        }
    }

    pub(super) fn fail(&mut self, reason: &str) {
        self.interrupt(reason, false);
    }

    pub(super) fn cancel(&mut self, reason: &str) {
        self.interrupt(reason, true);
    }

    fn interrupt(&mut self, reason: &str, canceled: bool) {
        let Some(progress) = self.progress.take() else {
            return;
        };
        let message = format!(
            "{reason} · {}{}",
            progress.summary(),
            progress
                .paper
                .as_ref()
                .map(|title| format!(" · 当前论文：{title}"))
                .unwrap_or_default(),
        );
        let event = if canceled {
            self.manager
                .cancel(&progress.id, message, progress.payload())
        } else {
            self.manager.fail(&progress.id, message, progress.payload())
        };
        if let Some(event) = event {
            (self.emit)(event);
        }
    }
}

impl Drop for ImportJob {
    fn drop(&mut self) {
        // Dropping a caller/IPC future must not strand a queued or processing job.
        self.cancel("论文下载已中断；已入库的论文会保留");
    }
}

#[cfg(test)]
#[path = "import_job_tests.rs"]
mod tests;
