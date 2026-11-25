use super::{Account, SavedSession};
use neuink_sync::{Session, SyncClient};
use reqwest::Method;
use serde_json::json;
use tauri::{AppHandle, Runtime};

fn path<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    Ok(crate::storage::settings_path(app)?.with_file_name("sync-account.json"))
}
pub(super) fn read<R: Runtime>(app: &AppHandle<R>) -> Result<Account, String> {
    match std::fs::read(path(app)?) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "账号配置损坏，未修改本地资料".into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Account::default()),
        Err(_) => Err("无法读取账号配置".into()),
    }
}
pub(super) fn save<R: Runtime>(app: &AppHandle<R>, a: &Account) -> Result<(), String> {
    neuink_workspace::atomic_write_json(path(app)?, a).map_err(|_| "无法保存账号配置".into())
}
pub(super) fn vault(a: &Account) -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        "com.neuink.sync",
        &blake3::hash(format!("{}:{}", a.endpoint, a.server_id).as_bytes()).to_hex(),
    )
    .map_err(|_| "系统凭据库不可用".into())
}
fn clock() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|x| x.as_secs())
        .unwrap_or(0)
}
pub(super) fn store(a: &Account, session: Session) -> Result<(), String> {
    let expires_at = clock() + session.expires_in;
    vault(a)?
        .set_password(
            &serde_json::to_string(&SavedSession {
                session,
                expires_at,
                refresh_request_id: None,
            })
            .map_err(|_| "无法保存登录态")?,
        )
        .map_err(|_| "无法安全保存登录态，请检查系统凭据库".into())
}
pub(super) async fn authenticated(a: &Account, c: &SyncClient) -> Result<Session, String> {
    let info = c.discovery().await?;
    if info["server_id"].as_str() != Some(a.server_id.as_str()) {
        return Err("服务器身份已变化，已停止发送登录凭据".into());
    }
    let value = vault(a)?
        .get_password()
        .map_err(|_| "请先登录同步账号".to_string())?;
    let mut saved: SavedSession =
        serde_json::from_str(&value).map_err(|_| "登录态无效，请重新登录".to_string())?;
    if a.account_id.as_deref() != Some(saved.session.account_id.as_str()) {
        return Err("账号与本机登录态不一致，请重新登录".into());
    }
    if saved.expires_at <= clock() + 30 {
        if saved.refresh_request_id.is_none() {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "系统时间无效")?
                .as_nanos();
            saved.refresh_request_id = Some(
                blake3::hash(format!("{}:{nonce}", saved.session.refresh_token).as_bytes())
                    .to_hex()
                    .to_string(),
            );
            // Persist before networking: after a lost response the retry must use
            // exactly the same request ID and old refresh token.
            vault(a)?
                .set_password(&serde_json::to_string(&saved).map_err(|_| "无法保存登录重试状态")?)
                .map_err(|_| "无法安全保存登录重试状态")?;
        }
        let v = c
            .request(
                Method::POST,
                "/v1/auth/refresh",
                None,
                Some(&json!({"refresh_token":saved.session.refresh_token,"request_id":saved.refresh_request_id})),
            )
            .await?;
        saved.session = serde_json::from_value(v).map_err(|_| "刷新登录态失败".to_string())?;
        if a.account_id.as_deref() != Some(saved.session.account_id.as_str()) {
            return Err("服务器返回了不匹配的账号".into());
        }
        store(a, saved.session.clone())?;
    }
    Ok(saved.session)
}
