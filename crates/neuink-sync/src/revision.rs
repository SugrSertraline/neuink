//! Read-only remote hints. Only the normal receiver may advance a replica cursor.
use crate::SyncClient;
use neuink_sync_protocol::Binding;
use reqwest::Method;
use serde::Deserialize;

#[derive(Debug)]
pub struct RevisionHint {
    pub changed: bool,
    pub long_poll: bool,
}

#[derive(Deserialize)]
struct Revision {
    server_id: String,
    epoch: String,
    revision: u64,
}

impl SyncClient {
    pub async fn wait_for_revision(
        &self,
        binding: &Binding,
        epoch: &str,
        cursor: u64,
        access: &str,
    ) -> Result<RevisionHint, String> {
        let valid_id = |id: &str| id.len() == 64 && id.bytes().all(|c| c.is_ascii_hexdigit());
        if !valid_id(&binding.library_id) || !valid_id(epoch) {
            return Err("同步绑定标识无效".into());
        }
        let path = format!("/v1/libraries/{}/revision?epoch={epoch}&revision={cursor}&wait_ms=25000", binding.library_id);
        match self.request_detailed(Method::GET, &path, Some(access), None).await {
            Ok(value) => {
                let hint: Revision = serde_json::from_value(value).map_err(|_| "云端变化通知无效")?;
                if hint.server_id != binding.server_id || hint.epoch != epoch || hint.revision < cursor {
                    return Err("服务器身份或恢复代际发生变化，请重新核对云端内容".into());
                }
                Ok(RevisionHint { changed: hint.revision > cursor, long_poll: true })
            }
            Err(error) if error.status == Some(404) => {
                // Compatibility with older self-hosted servers. This response is
                // deliberately not passed to Replica::receive/advance_cursor.
                let info = self.discovery().await?;
                if info["server_id"].as_str() != Some(&binding.server_id) || info["epoch"].as_str() != Some(epoch) {
                    return Err("服务器身份或恢复代际发生变化，请重新核对云端内容".into());
                }
                let page = self.request(Method::GET,
                    &format!("/v1/libraries/{}/changes?epoch={epoch}&revision={cursor}", binding.library_id),
                    Some(access), None).await?;
                let changes = page["changes"].as_array().ok_or("云端增量通知无效")?;
                let revision = page["revision"].as_u64().ok_or("云端增量通知无效")?;
                if page["epoch"].as_str() != Some(epoch) || revision < cursor {
                    return Err("服务器恢复代际或版本发生变化".into());
                }
                Ok(RevisionHint { changed: !changes.is_empty() || revision > cursor, long_poll: false })
            }
            Err(error) => Err(error.message),
        }
    }
}

#[cfg(test)]
mod tests;
