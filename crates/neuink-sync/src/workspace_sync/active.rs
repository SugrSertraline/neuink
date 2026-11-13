use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

/// Canonical paths make alternate spellings of the same workspace share one task.
pub(super) fn acquire(root: &Path) -> Result<OwnedMutexGuard<()>, String> {
    static TASKS: OnceLock<Mutex<HashMap<PathBuf, Weak<AsyncMutex<()>>>>> = OnceLock::new();
    let root = root.canonicalize().map_err(|_| "无法定位同步资料库")?;
    let task = {
        let mut tasks = TASKS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "同步任务状态不可用")?;
        tasks.retain(|_, task| task.strong_count() > 0);
        let task = tasks
            .get(&root)
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| Arc::new(AsyncMutex::new(())));
        tasks.insert(root, Arc::downgrade(&task));
        task
    };
    task.try_lock_owned()
        .map_err(|_| "此资料库已有同步任务正在运行".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn independent_workspaces_can_run_and_same_workspace_cannot_overlap() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let running = acquire(first.path()).unwrap();
        assert!(acquire(&first.path().join(".")).is_err());
        let other = acquire(second.path()).unwrap();
        drop(running);
        assert!(acquire(first.path()).is_ok());
        drop(other);
    }
}
