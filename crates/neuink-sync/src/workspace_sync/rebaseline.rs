//! Explicit snapshot reconciliation. Preview and confirmation both reread saved
//! local content and a stable server snapshot; no user file is changed here.
use super::{active, observe::observe, wire};
use crate::{
    replica::{RebaselinePreview, RemoteChange, Replica},
    SyncClient,
};
use neuink_sync_protocol::Binding;
use neuink_workspace::{sync_journal::WorkspaceSyncBinding, Workspace};
use reqwest::Method;
use serde::Deserialize;

#[derive(Deserialize)]
struct Page {
    objects: Vec<RemoteChange>,
    revision: u64,
    epoch: String,
    has_more: bool,
    after: String,
}
pub(super) async fn snapshot(
    client: &SyncClient,
    binding: &Binding,
    access: &str,
) -> Result<(String, u64, Vec<RemoteChange>), String> {
    let info = client.discovery().await?;
    let epoch = info["epoch"]
        .as_str()
        .ok_or("服务器恢复标识缺失")?
        .to_owned();
    crate::synchronize::validate_session(client, binding, &epoch, access).await?;
    let mut revision = None;
    let mut after = String::new();
    let mut objects = Vec::new();
    let mut bytes = 0usize;
    loop {
        let escaped = after
            .bytes()
            .map(|b| format!("%{b:02X}"))
            .collect::<String>();
        let path = format!(
            "/v1/libraries/{}/snapshot?epoch={}&revision={}&after={}",
            binding.library_id,
            epoch,
            revision
                .map(|r: u64| r.to_string())
                .unwrap_or_else(|| "-1".into()),
            escaped
        );
        let value = client
            .request(Method::GET, &path, Some(access), None)
            .await?;
        bytes += value.to_string().len();
        if bytes > 128 * 1024 * 1024 {
            return Err("完整快照超过本次核对容量，资料未修改".into());
        }
        let page: Page = serde_json::from_value(value).map_err(|_| "完整快照响应无效")?;
        if page.epoch != epoch || revision.is_some_and(|r| r != page.revision) {
            return Err("云端在核对期间发生变化，请重新读取".into());
        }
        revision = Some(page.revision);
        for change in &page.objects {
            if change.object_id <= after
                || change.revision > page.revision
                || change.deleted != change.content.is_none()
            {
                return Err("快照顺序或版本无效".into());
            }
            if let Some(value) = &change.content {
                let doc = wire::decode(value)?;
                if doc.entity_id != change.object_id || doc.kind != change.kind {
                    return Err("快照对象标识不一致".into());
                }
            }
            after = change.object_id.clone();
        }
        if page.after != after || (page.has_more && page.objects.is_empty()) {
            return Err("快照分页无效".into());
        }
        objects.extend(page.objects);
        if objects.len() > 100000 {
            return Err("完整快照对象数超过本次核对容量".into());
        }
        if !page.has_more {
            return Ok((epoch, page.revision, objects));
        }
    }
}
pub async fn reconcile(
    workspace: &Workspace,
    client: &SyncClient,
    binding: &WorkspaceSyncBinding,
    access: &str,
    token: Option<&str>,
) -> Result<RebaselinePreview, String> {
    let _active = active::acquire(workspace.layout().root())?;
    let identity = Binding {
        server_id: binding.server_id.clone(),
        account_id: binding.account_id.clone(),
        library_id: binding.library_id.clone(),
    };
    let (epoch, revision, objects) = snapshot(client, &identity, access).await?;
    let mut replica = Replica::open(
        &workspace.sync_replica_path(binding)?,
        &identity,
        &binding.epoch,
    )?;
    let scan = observe(workspace, &mut replica, binding, true)?;
    if !scan.failures.is_empty() {
        return Err("本地仍有未完成的同步内容，请先处理后重新核对".into());
    }
    let preview = replica.preview_rebaseline(&epoch, revision, &objects)?;
    if let Some(token) = token {
        replica.accept_rebaseline(&epoch, revision, &objects, token)?;
    }
    Ok(preview)
}
