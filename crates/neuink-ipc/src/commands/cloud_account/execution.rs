use super::{authenticated, scheduler, tasks, Account};
use neuink_sync::SyncClient;
use neuink_workspace::Workspace;
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Runtime};

pub(super) async fn run<R: Runtime>(
    app: &AppHandle<R>,
    account: &Account,
    client: &SyncClient,
    root: PathBuf,
    automatic: bool,
    guard: tokio::sync::MutexGuard<'_, ()>,
) -> Result<Value, String> {
    let workspace = Workspace::open_existing(&root).map_err(|e| e.to_string())?;
    if workspace.sync_control().map_err(|e| e.to_string())?.paused {
        return if automatic {
            Ok(Value::Null)
        } else {
            Err("同步已暂停，请先继续".into())
        };
    }
    let binding = workspace
        .sync_binding()
        .map_err(|e| e.to_string())?
        .ok_or("请先确认同步绑定")?;
    if binding.server_id != account.server_id
        || Some(&binding.account_id) != account.account_id.as_ref()
    {
        return Err("当前账号与此资料库绑定不一致".into());
    }
    let generation = scheduler::generation(&root)?;
    let mut running = tasks::begin(root.clone())?;
    let _ = app.emit(
        "cloud-sync-task",
        json!({"root":root, "automatic":automatic, "task":tasks::status(&root)?}),
    );
    let task_id = tasks::status(&root)?.id;
    let progress_app = app.clone();
    let progress_root = root.clone();
    let client = client.clone().with_progress(move |progress| {
        if let Some(task) = tasks::progress(&progress_root, task_id, progress) {
            let _ = progress_app.emit(
                "cloud-sync-task",
                json!({"root":progress_root,"automatic":automatic,"task":task}),
            );
        }
    });
    let (result, cancelled) = tokio::select! {
        biased;
        _ = running.cancellation.changed() => (Err("已取消本次同步".into()), true),
        result = async {
            let session = authenticated(account, &client).await?;
            drop(guard);
            neuink_sync::workspace_sync::synchronize_workspace_with_retry(&workspace, &client, &binding, &session.access_token, !automatic).await
        } => (result, false),
    };
    if cancelled {
        scheduler::cancelled(&root, generation)?;
    } else {
        scheduler::complete(
            &root,
            generation,
            result.is_err()
                || result.as_ref().is_ok_and(|outcome| {
                    !outcome.failures.is_empty() && client.retryable_failure()
                }),
            client.retryable_failure(),
        )?;
    }
    if !cancelled
        && result.as_ref().is_ok_and(|outcome| {
            outcome.pending > 0
                && outcome.published > 0
                && !outcome.uploads_blocked
                && outcome.failures.is_empty()
                && outcome.conflicts == 0
        })
    {
        scheduler::reset(&root)?;
    }
    let outcome = running.finish(result, cancelled)?;
    let _ = app.emit(
        "cloud-sync-task",
        json!({"root":root, "automatic":automatic, "task":outcome}),
    );
    let _ = app.emit("cloud-library-changed", json!({"root":root}));
    serde_json::to_value(outcome).map_err(|_| "无法返回同步状态".into())
}
