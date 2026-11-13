use neuink_sync::workspace_sync::WorkspaceSyncResult;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tokio::sync::watch;

#[derive(Clone, Default, Serialize)]
pub(super) struct Status {
    pub id: u64,
    pub progress: neuink_sync::progress::Progress,
    pub running: bool,
    pub cancelled: bool,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

struct Task {
    status: Status,
    cancel: watch::Sender<bool>,
}

fn tasks() -> &'static Mutex<BTreeMap<PathBuf, Task>> {
    static TASKS: OnceLock<Mutex<BTreeMap<PathBuf, Task>>> = OnceLock::new();
    TASKS.get_or_init(Default::default)
}

pub(super) fn status(root: &Path) -> Result<Status, String> {
    let tasks = tasks().lock().map_err(|_| "无法读取同步任务")?;
    Ok(tasks
        .get(root)
        .map(|task| task.status.clone())
        .unwrap_or_default())
}

pub(super) fn progress(
    root: &Path,
    id: u64,
    progress: neuink_sync::progress::Progress,
) -> Option<Status> {
    let mut tasks = tasks().lock().ok()?;
    let task = tasks.get_mut(root)?;
    if task.status.id != id || !task.status.running {
        return None;
    }
    task.status.progress = progress;
    Some(task.status.clone())
}

pub(super) fn cancel(root: &Path) -> Result<(), String> {
    let tasks = tasks().lock().map_err(|_| "无法读取同步任务")?;
    if let Some(task) = tasks.get(root) {
        task.cancel.send_replace(true);
    }
    Ok(())
}

pub(super) fn cancel_all() -> Result<(), String> {
    let tasks = tasks().lock().map_err(|_| "无法读取同步任务")?;
    for task in tasks.values() {
        task.cancel.send_replace(true);
    }
    Ok(())
}

pub(super) struct Running {
    root: PathBuf,
    finished: bool,
    pub cancellation: watch::Receiver<bool>,
}

pub(super) fn begin(root: PathBuf) -> Result<Running, String> {
    let mut tasks = tasks().lock().map_err(|_| "无法启动同步任务")?;
    if tasks.get(&root).is_some_and(|task| task.status.running) {
        return Err("此资料库已有同步任务正在运行".into());
    }
    static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (cancel, cancellation) = watch::channel(false);
    tasks.insert(
        root.clone(),
        Task {
            status: Status {
                id,
                running: true,
                ..Status::default()
            },
            cancel,
        },
    );
    Ok(Running {
        root,
        cancellation,
        finished: false,
    })
}

impl Running {
    pub fn finish(
        &mut self,
        result: Result<WorkspaceSyncResult, String>,
        cancelled: bool,
    ) -> Result<Status, String> {
        let mut tasks = tasks().lock().map_err(|_| "无法记录同步结果")?;
        let task = tasks.get_mut(&self.root).ok_or("同步任务记录缺失")?;
        self.finished = true;
        task.status.running = false;
        task.status.cancelled = cancelled;
        match result {
            Ok(result) => {
                task.status.result =
                    Some(serde_json::to_value(result).map_err(|_| "无法记录同步结果")?)
            }
            Err(error) if !cancelled => task.status.error = Some(error),
            Err(_) => {}
        }
        Ok(task.status.clone())
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        if let Ok(mut tasks) = tasks().lock() {
            if let Some(task) = tasks.get_mut(&self.root) {
                if task.status.running {
                    task.status.running = false;
                    task.status.error = Some("同步任务已中断，已保存内容和队列可重试".into());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_and_retry_keep_task_ownership_separate() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let mut first = begin(root.clone()).unwrap();
        assert!(begin(root.clone()).is_err());
        cancel(&root).unwrap();
        assert!(*first.cancellation.borrow());
        first.finish(Err("cancelled".into()), true).unwrap();
        let second = begin(root.clone()).unwrap();
        drop(first);
        assert!(status(&root).unwrap().running);
        assert!(!*second.cancellation.borrow());
        drop(second);
        assert!(!status(&root).unwrap().running);
        assert!(status(&root).unwrap().error.is_some());
    }
}
