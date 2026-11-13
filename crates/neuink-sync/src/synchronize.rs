mod batches;
use crate::{
    replica::{RemoteChange, Replica},
    SyncClient,
};
use neuink_sync_protocol::Binding;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Default, Debug, Serialize)]
pub struct SyncResult {
    pub uploaded: usize,
    pub downloaded: usize,
    pub conflicts: usize,
    pub failures: Vec<(String, String)>,
}
#[derive(Deserialize)]
struct Page {
    changes: Vec<RemoteChange>,
    revision: u64,
    epoch: String,
    has_more: bool,
}

/// Synchronize the journal. Workspace projection is a separate, revision-checked step.
pub async fn synchronize(
    replica: &mut Replica,
    client: &SyncClient,
    binding: &Binding,
    epoch: &str,
    access: &str,
) -> Result<SyncResult, String> {
    replica.check_binding(binding, epoch)?;
    let protocol_epoch = replica.protocol_epoch()?;
    validate_session(client, binding, &protocol_epoch, access).await?;
    validate_cursor(replica.cursor()?, client, binding, &protocol_epoch, access).await?;
    synchronize_validated(replica, client, binding, &protocol_epoch, access, None).await
}

pub(crate) async fn synchronize_selected(
    replica: &mut Replica,
    client: &SyncClient,
    binding: &Binding,
    epoch: &str,
    access: &str,
    allowed: &std::collections::BTreeSet<String>,
) -> Result<SyncResult, String> {
    replica.check_binding(binding, epoch)?;
    let protocol_epoch = replica.protocol_epoch()?;
    validate_session(client, binding, &protocol_epoch, access).await?;
    validate_cursor(replica.cursor()?, client, binding, &protocol_epoch, access).await?;
    synchronize_validated(
        replica,
        client,
        binding,
        &protocol_epoch,
        access,
        Some(allowed),
    )
    .await
}

/// Check retention before any upload. Do not advance the cursor until changes
/// have actually been received into the durable replica.
pub(crate) async fn validate_cursor(
    cursor: u64,
    client: &SyncClient,
    binding: &Binding,
    epoch: &str,
    access: &str,
) -> Result<(), String> {
    let path = format!(
        "/v1/libraries/{}/changes?epoch={epoch}&revision={}",
        binding.library_id, cursor
    );
    let page: Page = serde_json::from_value(
        client
            .request(Method::GET, &path, Some(access), None)
            .await?,
    )
    .map_err(|_| "增量响应无效")?;
    if page.epoch != epoch {
        return Err("服务器恢复代际发生变化".into());
    }
    Ok(())
}

pub(crate) async fn validate_session(
    client: &SyncClient,
    binding: &Binding,
    epoch: &str,
    access: &str,
) -> Result<(), String> {
    let info = client.discovery().await?;
    if info["server_id"].as_str() != Some(&binding.server_id)
        || info["epoch"].as_str() != Some(epoch)
    {
        return Err("服务器身份或恢复代际发生变化，已暂停同步".into());
    }
    let me = client
        .request(Method::GET, "/v1/me", Some(access), None)
        .await?;
    if me["account_id"].as_str() != Some(&binding.account_id) {
        return Err("当前登录账号与同步队列不一致".into());
    }
    if binding.library_id.len() != 64 || !binding.library_id.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("资料库标识无效".into());
    }
    Ok(())
}

async fn synchronize_validated(
    replica: &mut Replica,
    client: &SyncClient,
    binding: &Binding,
    epoch: &str,
    access: &str,
    allowed: Option<&std::collections::BTreeSet<String>>,
) -> Result<SyncResult, String> {
    let mut result = SyncResult::default();
    for batch in batches::prepare(replica, allowed)? {
        let suffix = if batch.grouped { "/delete-group" } else { "" };
        let body = if batch.grouped {
            json!({"epoch":epoch,"operations":batch.operations})
        } else {
            json!({"epoch":epoch,"operation":batch.operations[0]})
        };
        let response = client
            .request_detailed(
                Method::POST,
                &format!("/v1/libraries/{}/operations{suffix}", binding.library_id),
                Some(access),
                Some(&body),
            )
            .await;
        match response {
            Ok(value) => {
                let revisions = if batch.grouped {
                    let rows = value["revisions"].as_array().ok_or("整组删除响应无效")?;
                    if rows.len() != batch.operations.len() {
                        return Err("整组删除响应数量不一致".into());
                    }
                    let mut revisions = Vec::new();
                    for (row, op) in rows.iter().zip(&batch.operations) {
                        if row["operation_id"].as_str() != Some(&op.operation_id) {
                            return Err("整组删除响应标识不一致".into());
                        }
                        revisions.push(row["revision"].as_u64().ok_or("服务器版本响应无效")?);
                    }
                    revisions
                } else {
                    vec![value["revision"].as_u64().ok_or("服务器版本响应无效")?]
                };
                for (op, revision) in batch.operations.iter().zip(revisions) {
                    replica.acknowledge(&op.operation_id, revision)?;
                    result.uploaded += 1;
                }
            }
            Err(e) if e.is_revision_conflict() => {}
            Err(e) => {
                if e.status == Some(507) {
                    replica.suspend_uploads(None)?;
                }
                for op in batch.operations {
                    result.failures.push((op.object_id, e.message.clone()));
                }
                if e.status.is_none() || matches!(e.status, Some(401 | 403 | 429 | 500..=507)) {
                    break;
                }
            }
        }
    }
    loop {
        let before = replica.cursor()?;
        let path = format!(
            "/v1/libraries/{}/changes?epoch={}&revision={before}",
            binding.library_id, epoch
        );
        let page: Page = serde_json::from_value(
            client
                .request(Method::GET, &path, Some(access), None)
                .await?,
        )
        .map_err(|_| "增量响应无效")?;
        if page.epoch != epoch {
            return Err("服务器恢复代际发生变化".into());
        }
        let mut previous = before;
        for change in &page.changes {
            if change.revision <= previous {
                return Err("远端变更顺序无效".into());
            }
            previous = change.revision;
        }
        if page.revision != previous || (page.has_more && page.changes.is_empty()) {
            return Err("远端增量游标无效".into());
        }
        for change in page.changes {
            replica.receive(&change)?;
            result.downloaded += 1;
        }
        if !page.has_more {
            break;
        }
    }
    result.conflicts = replica.conflicts()?.len();
    Ok(result)
}

#[cfg(test)]
mod tests;
