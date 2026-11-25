use super::{authenticated, current_sync_root, read, scheduler, tasks, Account};
use neuink_sync::{replica::Replica, SyncClient};
use neuink_sync_protocol::Binding;
use neuink_workspace::Workspace;
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

/// Independent of the local debounce tick. Neither the credentials lock nor a
/// SQLite read transaction is held during the long poll.
pub(super) async fn run<R: Runtime>(
    app: &AppHandle<R>, account: &Account, client: &SyncClient, root: PathBuf,
    guard: tokio::sync::MutexGuard<'_, ()>,
) -> Result<Value, String> {
    let workspace = Workspace::open_existing(&root).map_err(|e| e.to_string())?;
    let Some(binding) = workspace.sync_binding().map_err(|e| e.to_string())? else {
        return Ok(json!({"delay_ms": 60000}));
    };
    if account.account_id.as_ref() != Some(&binding.account_id) || account.server_id != binding.server_id
        || workspace.sync_control().map_err(|e| e.to_string())?.paused {
        return Ok(json!({"delay_ms": 60000}));
    }
    let generation = scheduler::generation(&root)?;
    let identity = Binding { server_id: binding.server_id.clone(), account_id: binding.account_id.clone(), library_id: binding.library_id.clone() };
    let path = workspace.sync_replica_path(&binding)?;
    if !path.is_file() { return Ok(json!({"delay_ms": 3000})); }
    let (epoch, cursor) = {
        let replica = Replica::read_snapshot(&path, &identity, &binding.epoch)?;
        (replica.protocol_epoch()?, replica.cursor()?)
    };
    let session = authenticated(account, client).await?;
    drop(guard);
    let result = client.wait_for_revision(&identity, &epoch, cursor, &session.access_token).await;
    // The window can switch account/library or pause while the request waits.
    // A late hint must not schedule work in a different context.
    if current_sync_root(app, &root).is_err() { return Ok(json!({"delay_ms": 60000})); }
    let current = read(app)?;
    if current.account_id != account.account_id || current.server_id != account.server_id
        || current.endpoint != account.endpoint || workspace.sync_binding().map_err(|e| e.to_string())?.as_ref() != Some(&binding)
        || workspace.sync_control().map_err(|e| e.to_string())?.paused {
        return Ok(json!({"delay_ms": 60000}));
    }
    match result {
        Ok(hint) => {
            // An active receiver will either consume this revision or leave its
            // cursor behind; the next watch checks that durable cursor again.
            if hint.changed && !tasks::status(&root)?.running {
                scheduler::remote_changed(&root, generation)?;
            }
            Ok(json!({"delay_ms": if hint.long_poll { 1000 } else { 60000 }}))
        }
        Err(_) => {
            // A normal task reports the error through the existing task centre;
            // notification errors never silently turn into a successful sync.
            scheduler::remote_changed(&root, generation)?;
            Ok(json!({"delay_ms": 60000}))
        }
    }
}
