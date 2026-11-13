//! Application coordinator; network code stages bytes, Workspace owns publication.
mod active;
pub mod entry_status;
pub mod cloud_contents;
mod children;
pub mod conflicts;
mod inbound;
mod lifecycle;
mod observe;
pub mod preview;
pub mod rebaseline;
mod transfer;
mod wire;
use crate::{
    replica::Replica,
    synchronize::{synchronize_selected, validate_cursor, validate_session},
    SyncClient,
};
use neuink_sync_protocol::{Binding, Mutation};
use neuink_workspace::{sync_journal::WorkspaceSyncBinding, Workspace};
use observe::observe;
use std::collections::BTreeMap;

#[derive(Debug, Default, serde::Serialize)]
pub struct WorkspaceSyncResult {
    pub uploads_blocked: bool,
    pub pending: usize,
    pub published: usize,
    pub received: usize,
    pub applied: usize,
    pub conflicts: usize,
    pub failures: Vec<(String, String)>,
}

/// Explicitly bound, one-shot bridge. Automatic scheduling/UI control is added
/// separately; this does not implicitly bind or scan another account's library.
pub async fn synchronize_workspace(
    workspace: &Workspace,
    client: &SyncClient,
    binding: &WorkspaceSyncBinding,
    access: &str,
) -> Result<WorkspaceSyncResult, String> {
    synchronize_workspace_with_retry(workspace, client, binding, access, true).await
}

pub async fn synchronize_workspace_with_retry(
    workspace: &Workspace,
    client: &SyncClient,
    binding: &WorkspaceSyncBinding,
    access: &str,
    explicit_retry: bool,
) -> Result<WorkspaceSyncResult, String> {
    let _active = active::acquire(workspace.layout().root())?;
    client.phase("observing");
    workspace.recover_pending_sync(binding)?;
    let identity = Binding {
        server_id: binding.server_id.clone(),
        account_id: binding.account_id.clone(),
        library_id: binding.library_id.clone(),
    };
    let mut replica = Replica::open(
        &workspace.sync_replica_path(binding)?,
        &identity,
        &binding.epoch,
    )?;
    validate_session(client, &identity, &replica.protocol_epoch()?, access).await?;
    validate_cursor(
        replica.cursor()?,
        client,
        &identity,
        &replica.protocol_epoch()?,
        access,
    )
    .await?;
    let mut result = WorkspaceSyncResult::default();
    let mut scan = observe::observe_with_progress(workspace, &mut replica, binding, true,
        |current, total| client.scan_progress(current, total))?;
    let available = if replica.has_upload_gate()? && !explicit_retry {
        client
            .request(reqwest::Method::GET, "/v1/storage", Some(access), None)
            .await
            .ok()
            .and_then(|v| v["available_bytes"].as_u64())
    } else {
        None
    };
    result.uploads_blocked = replica.uploads_blocked(available, explicit_retry)?;
    if result.uploads_blocked {
        let deletions = replica
            .pending()?
            .into_iter()
            .filter(|op| matches!(op.mutation, Mutation::Delete))
            .map(|op| op.object_id)
            .collect::<std::collections::BTreeSet<_>>();
        scan.ready.retain(|id| deletions.contains(id));
    }
    let mut uploads = BTreeMap::new();
    let mut owners: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for operation in replica.pending()? {
        if !scan.ready.contains(&operation.object_id) {
            continue;
        }
        let value = match operation.mutation {
            Mutation::Put { content } | Mutation::Restore { content } => content,
            Mutation::Delete => continue,
        };
        let document = wire::decode(&value)?;
        if document.entity_id != operation.object_id || document.kind != operation.kind {
            return Err("同步队列实体标识不一致".into());
        }
        for resource in document.resources {
            owners
                .entry(resource.hash.clone())
                .or_default()
                .push(operation.object_id.clone());
            if let Some(previous) = uploads.insert(resource.hash.clone(), resource.clone()) {
                if previous.size != resource.size {
                    return Err("同一附件的大小声明不一致".into());
                }
            }
        }
    }
    client.phase("uploading");
    for resource in uploads.values() {
        client.file_progress(true, &resource.hash, 0, resource.size);
    }
    let failures = std::sync::Mutex::new(Vec::new());
    transfer::run(uploads.into_values(), |resource| {
        let failures = &failures;
        async move {
            if client.quota_exceeded() {
                return Ok(());
            }
            let outcome = async {
                let path = workspace.sync_blob_path(binding, &resource.hash)?;
                if crate::attachments::fingerprint(&path).await?
                    != (resource.hash.clone(), resource.size)
                {
                    return Err("排队附件校验失败，未占用新的上传配额".into());
                }
                let ticket = client.begin_upload(access, &path).await?;
                if ticket.hash != resource.hash || ticket.size != resource.size {
                    return Err("排队附件已变化，未发布实体".into());
                }
                client.resume_upload(access, &path, &ticket).await
            }
            .await;
            if let Err(error) = outcome {
                failures
                    .lock()
                    .map_err(|_| "附件结果不可用")?
                    .push((resource.hash, error));
            }
            Ok(())
        }
    })
    .await?;
    for (hash, error) in failures.into_inner().map_err(|_| "附件结果不可用")? {
        for owner in owners.get(&hash).into_iter().flatten() {
            scan.ready.remove(owner);
            result.failures.push((owner.clone(), error.clone()));
        }
    }
    if client.quota_exceeded() {
        suspend_for_quota(&mut replica, client, access).await?;
        let deletions = replica
            .pending()?
            .into_iter()
            .filter(|op| matches!(op.mutation, Mutation::Delete))
            .map(|op| op.object_id)
            .collect::<std::collections::BTreeSet<_>>();
        scan.ready.retain(|id| deletions.contains(id));
        result.uploads_blocked = true;
    }
    client.phase("exchanging");
    let transferred = synchronize_selected(
        &mut replica,
        client,
        &identity,
        &binding.epoch,
        access,
        &scan.ready,
    )
    .await?;
    if client.quota_exceeded() && !result.uploads_blocked {
        suspend_for_quota(&mut replica, client, access).await?;
        result.uploads_blocked = true;
    }
    result.published = transferred.uploaded;
    result.received = transferred.downloaded;
    result.failures.extend(transferred.failures);
    client.phase("observing");
    let before_apply = observe::observe_with_progress(workspace, &mut replica, binding, false,
        |current, total| client.scan_progress(current, total))?;
    client.phase("applying");
    client.object_progress(result.published, result.received, 0);
    inbound::apply(
        workspace,
        client,
        binding,
        access,
        &mut replica,
        &mut result,
    )
    .await?;
    // Report the final scan: an incoming restore can satisfy a board's previously
    // missing entry dependency during this round. Persist concurrent saves too.
    // Without incoming writes the pre-apply observation is already current.
    // Local edits made afterwards are picked up on the next scheduled round.
    if result.applied > 0 {
        client.phase("checking");
        result.failures.extend(observe::observe_with_progress(workspace, &mut replica, binding, false,
            |current, total| client.scan_progress(current, total))?.failures);
    } else {
        result.failures.extend(before_apply.failures);
    }
    result.conflicts = replica.conflicts()?.len();
    result.failures.sort();
    result.failures.dedup();
    client.object_progress(result.published, result.received, result.applied);
    result.pending = replica.pending()?.len();
    client.phase("finished");
    Ok(result)
}

async fn suspend_for_quota(
    replica: &mut Replica,
    client: &SyncClient,
    access: &str,
) -> Result<(), String> {
    // Persist first: even a failed or cancelled capacity probe keeps the queue paused.
    replica.suspend_uploads(None)?;
    let available = client
        .request(reqwest::Method::GET, "/v1/storage", Some(access), None)
        .await
        .ok()
        .and_then(|v| v["available_bytes"].as_u64());
    replica.suspend_uploads(available)
}

#[cfg(test)]
mod lifecycle_tests;

#[cfg(test)]
mod group_tests;
#[cfg(test)]
mod test_support;
