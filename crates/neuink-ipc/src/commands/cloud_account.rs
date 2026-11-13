//! Account transport; long-lived credentials stay in the OS vault, never React.
mod credentials;
mod local_actions;
use credentials::{authenticated, read, save, store, vault};
mod execution;
mod scheduler;
mod tasks;
use neuink_sync::{Session, SyncClient};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::OnceLock;
use tauri::{AppHandle, Runtime};

#[derive(Default, Deserialize, Serialize)]
struct Account {
    endpoint: String,
    server_id: String,
    account_id: Option<String>,
    username: Option<String>,
}
#[derive(Deserialize, Serialize)]
struct SavedSession {
    session: Session,
    expires_at: u64,
    #[serde(default)]
    refresh_request_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Request {
    Status,
    SyncStatus,
    SyncEntryStatus { root: std::path::PathBuf },
    SyncCloudContents { root: std::path::PathBuf },
    RecoveryInspect,
    RecoveryRetry,
    RecoveryKeepCurrent { name: String, token: String },
    SyncRebaseline { root: std::path::PathBuf, token: Option<String> },
    SyncConflictNotes {
        root: std::path::PathBuf,
        id: String,
    },
    SyncMergeNote {
        root: std::path::PathBuf,
        id: String,
        token: String,
        markdown: String,
    },
    SyncDeletionGroup { root: std::path::PathBuf, id: String },
    SyncResolveDeletionGroup { root: std::path::PathBuf, id: String, token: String, keep_local: bool },
    SyncConflicts {
        root: std::path::PathBuf,
    },
    SyncConflict {
        root: std::path::PathBuf,
        id: String,
    },
    SyncResolve {
        root: std::path::PathBuf,
        id: String,
        token: String,
        keep_local: bool,
    },
    SyncAuto {
        root: std::path::PathBuf,
    },
    SyncPause {
        root: std::path::PathBuf,
        paused: bool,
    },
    SyncWake {
        root: std::path::PathBuf,
    },
    SyncPreview {
        root: std::path::PathBuf,
    },
    SyncCancel {
        root: std::path::PathBuf,
    },
    SyncCloudPreview { root: std::path::PathBuf, library_id: String },
    SyncBind {
        root: std::path::PathBuf,
        library_id: String,
        token: String,
    },
    SyncRun {
        root: std::path::PathBuf,
    },
    Preview,
    Profile,
    SaveProfile {
        profile: Value,
    },
    Storage,
    StorageCleanupPreview,
    StorageCleanup { token: String },
    Connect {
        endpoint: String,
    },
    Register {
        username: String,
        password: String,
        invite: String,
    },
    Login {
        username: String,
        password: String,
        device_name: String,
    },
    Logout,
    Devices,
    Revoke {
        id: String,
    },
    Libraries,
    DefaultLibrary,
    CreateLibrary {
        name: String,
    },
    Invite,
    AdminResetPassword {
        new_password: String,
    },
    Password {
        old_password: String,
        new_password: String,
    },
}
#[tauri::command]
pub async fn cloud_account<R: Runtime>(
    app: AppHandle<R>,
    request: Request,
) -> Result<Value, String> {
    if let Some(value) = local_actions::handle(&app, &request).await? {
        return Ok(value);
    }
    // Cancel before waiting for the credential lock: an in-flight refresh owns
    // that lock, and its cancellation must be able to release it while offline.
    if matches!(request, Request::Logout) {
        tasks::cancel_all()?;
    }
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    let _guard = LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let mut a = read(&app)?;
    if matches!(request, Request::Status) {
        return serde_json::to_value(a).map_err(|_| "无法读取账号状态".into());
    }
    if let Request::Connect { endpoint } = request {
        if a.account_id.is_some() {
            return Err("请先退出当前账号，再切换服务器".into());
        }
        let client = SyncClient::new(&endpoint)?;
        let info = client.discovery().await?;
        a.endpoint = neuink_sync::normalize_endpoint(&endpoint)?.to_string();
        a.server_id = info["server_id"].as_str().ok_or("服务器身份无效")?.into();
        save(&app, &a)?;
        return Ok(info);
    }
    if a.endpoint.is_empty() {
        return Err("请先填写并测试同步服务器地址".into());
    }
    let c = SyncClient::new(&a.endpoint)?;
    if let Request::Register {
        username,
        password,
        invite,
    } = request
    {
        let info = c.discovery().await?;
        if info["server_id"].as_str() != Some(&a.server_id) {
            return Err("服务器身份已变化，请重新测试连接".into());
        }
        return c
            .request(
                Method::POST,
                "/v1/auth/register",
                None,
                Some(&json!({"username":username,"password":password,"invite":invite})),
            )
            .await;
    }
    if let Request::Login {
        username,
        password,
        device_name,
    } = request
    {
        if a.account_id.is_some() {
            return Err("请先退出当前账号，防止混用资料".into());
        }
        let info = c.discovery().await?;
        if info["server_id"].as_str() != Some(&a.server_id) {
            return Err("服务器身份已变化，请重新测试连接".into());
        }
        let v = c
            .request(
                Method::POST,
                "/v1/auth/login",
                None,
                Some(&json!({"username":username,"password":password,"device_name":device_name})),
            )
            .await?;
        let session: Session = serde_json::from_value(v).map_err(|_| "服务器登录响应无效")?;
        a.account_id = Some(session.account_id.clone());
        a.username = Some(username);
        store(&a, session)?;
        scheduler::reset_all()?;
        save(&app, &a)?;
        return serde_json::to_value(a).map_err(|_| "无法返回账号状态".into());
    }
    if matches!(request, Request::Logout) {
        tasks::cancel_all()?;
        // Offline logout must not trap the user behind a network timeout.
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            if let Ok(session) = authenticated(&a, &c).await {
                let _ = c
                    .request(
                        Method::POST,
                        "/v1/auth/logout",
                        Some(&session.access_token),
                        None,
                    )
                    .await;
            }
        })
        .await;
        match vault(&a)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("无法清除本机登录态".into()),
        }
        a.account_id = None;
        a.username = None;
        save(&app, &a)?;
        return Ok(json!({"ok":true}));
    }
    if let Request::SyncRun { root } | Request::SyncAuto { root } = &request {
        let root = current_sync_root(&app, root)?;
        if matches!(request, Request::SyncRun { .. }) {
            scheduler::reset(&root)?;
        }
        return execution::run(
            &app,
            &a,
            &c,
            root,
            matches!(request, Request::SyncAuto { .. }),
            _guard,
        )
        .await;
    }
    let session = authenticated(&a, &c).await?;
    if let Request::SyncCloudContents { root } = &request {
        let root = current_sync_root(&app, root)?;
        let workspace = neuink_workspace::Workspace::open_existing(&root).map_err(|e| e.to_string())?;
        let binding = workspace.sync_binding().map_err(|e| e.to_string())?.ok_or("请先绑定资料库")?;
        if binding.server_id != a.server_id || binding.account_id != session.account_id {
            return Err("当前账号与资料库绑定不一致".into());
        }
        // Browsing must not hold the account lock while sync is transferring.
        drop(_guard);
        let contents = neuink_sync::workspace_sync::cloud_contents::inspect(&c, &binding, &session.access_token).await?;
        current_sync_root(&app, &root)?;
        let current_account = read(&app)?;
        if current_account.account_id != a.account_id || current_account.server_id != a.server_id {
            return Err("账号已切换，请重新读取云端内容".into());
        }
        return serde_json::to_value(contents).map_err(|_| "无法返回云端内容".into());
    }
    if let Request::SyncConflictNotes { root, id } = &request {
        let root = current_sync_root(&app, root)?;
        let workspace =
            neuink_workspace::Workspace::open_existing(&root).map_err(|e| e.to_string())?;
        let binding = workspace
            .sync_binding()
            .map_err(|e| e.to_string())?
            .ok_or("请先确认同步绑定")?;
        if binding.server_id != a.server_id || binding.account_id != session.account_id {
            return Err("当前账号与资料库绑定不一致".into());
        }
        let comparison = neuink_sync::workspace_sync::conflicts::download_notes(
            &workspace,
            &binding,
            id,
            &c,
            &session.access_token,
        )
        .await?;
        return serde_json::to_value(comparison).map_err(|_| "无法返回正文比较".into());
    }
    if let Request::SyncCloudPreview { root, library_id } = &request {
        let root=current_sync_root(&app,root)?;
        let workspace=neuink_workspace::Workspace::open_existing(&root).map_err(|e|e.to_string())?;
        let preview=neuink_sync::workspace_sync::preview::inspect(&workspace,&c,library_id,&session.access_token).await?;
        return serde_json::to_value(preview).map_err(|_|"无法返回云端空间预览".into());
    }
    if let Request::SyncBind { root, library_id, token } = &request {
        let root = current_sync_root(&app, root)?;
        let libraries = c
            .request(
                Method::GET,
                "/v1/libraries",
                Some(&session.access_token),
                None,
            )
            .await?;
        if !libraries
            .as_array()
            .is_some_and(|values| values.iter().any(|v| v["id"].as_str() == Some(library_id)))
        {
            return Err("云端资料库不可用，请重新读取列表".into());
        }
        let info = c.discovery().await?;
        if info["server_id"].as_str() != Some(a.server_id.as_str()) {
            return Err("服务器身份发生变化，请重新核对".into());
        }
        let binding = neuink_workspace::sync_journal::WorkspaceSyncBinding {
            server_id: a.server_id.clone(),
            account_id: session.account_id.clone(),
            library_id: library_id.clone(),
            epoch: info["epoch"].as_str().ok_or("服务器恢复代际无效")?.into(),
        };
        current_sync_root(&app, &root)?;
        let workspace =
            neuink_workspace::Workspace::open_existing(&root).map_err(|e| e.to_string())?;
        let preview=neuink_sync::workspace_sync::preview::inspect(&workspace,&c,library_id,&session.access_token).await?;
        if preview.token!=*token {return Err("同步范围或云端空间已变化，请重新预览后确认".into());}
        workspace.bind_sync(&binding).map_err(|e| e.to_string())?;
        return serde_json::to_value(binding).map_err(|_| "无法返回同步绑定".into());
    }
    if let Request::SyncRebaseline { root, token } = &request {
        let root=current_sync_root(&app,root)?;
        let workspace=neuink_workspace::Workspace::open_existing(&root).map_err(|e|e.to_string())?;
        let binding=workspace.sync_binding().map_err(|e|e.to_string())?.ok_or("请先绑定资料库")?;
        if binding.server_id!=a.server_id || binding.account_id!=session.account_id {return Err("当前账号与资料库绑定不一致".into());}
        let preview=neuink_sync::workspace_sync::rebaseline::reconcile(&workspace,&c,&binding,&session.access_token,token.as_deref()).await?;
        if token.is_some() {scheduler::reset(&root)?;}
        return serde_json::to_value(preview).map_err(|_|"无法返回核对结果".into());
    }
    let token = Some(session.access_token.as_str());
    match request {
        Request::Profile => c.request(Method::GET, "/v1/profile", token, None).await,
        Request::SaveProfile { profile } => {
            c.request(Method::PATCH, "/v1/profile", token, Some(&profile))
                .await
        }
        Request::StorageCleanupPreview => c.request(Method::GET, "/v1/storage/cleanup", token, None).await,
        Request::StorageCleanup { token: preview_token } => c.request(Method::POST, "/v1/storage/cleanup", token, Some(&json!({"token":preview_token}))).await,
        Request::Storage => c.request(Method::GET, "/v1/storage", token, None).await,
        Request::Devices => c.request(Method::GET, "/v1/devices", token, None).await,
        Request::DefaultLibrary => c.request(Method::POST, "/v1/libraries/default", token, Some(&json!({}))).await,
        Request::Libraries => c.request(Method::GET, "/v1/libraries", token, None).await,
        Request::CreateLibrary { name } => {
            c.request(
                Method::POST,
                "/v1/libraries",
                token,
                Some(&json!({"name":name})),
            )
            .await
        }
        Request::Invite => {
            c.request(Method::POST, "/v1/admin/invites", token, Some(&json!({})))
                .await
        }
        Request::Revoke { id } => {
            if id.len() != 64 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
                return Err("设备标识无效".into());
            }
            c.request(Method::DELETE, &format!("/v1/devices/{id}"), token, None)
                .await
        }
        Request::AdminResetPassword { new_password } => {
            if new_password.len() < 12 || new_password.len() > 1024 {
                return Err("新密码需至少 12 个字符".into());
            }
            let id = &session.account_id;
            if id.len() != 64 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
                return Err("账号标识无效".into());
            }
            // The server checks admin authority. A search command never grants it.
            let proof = c.request(Method::POST, &format!("/v1/admin/reset/{id}"), token, Some(&json!({}))).await?;
            let reset_token = proof["reset_token"].as_str().ok_or("无法验证重置授权")?;
            c.request(Method::POST, "/v1/auth/reset", None,
                Some(&json!({"token":reset_token,"password":new_password}))).await
        }
        Request::Password {
            old_password,
            new_password,
        } => {
            c.request(
                Method::POST,
                "/v1/auth/password",
                token,
                Some(&json!({"old_password":old_password,"new_password":new_password})),
            )
            .await
        }
        _ => Err("不支持的账号操作".into()),
    }
}

fn current_sync_root<R: Runtime>(
    app: &AppHandle<R>,
    requested: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    let current = super::workspace::current_workspace_root(app)?
        .canonicalize()
        .map_err(|_| "无法定位当前资料库")?;
    let requested = requested
        .canonicalize()
        .map_err(|_| "无法定位待同步资料库")?;
    if current != requested {
        return Err("当前资料库已切换，请重新核对同步范围".into());
    }
    Ok(current)
}
