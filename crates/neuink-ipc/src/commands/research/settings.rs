use super::super::settings::{read_settings, write_settings};
use neuink_config::ResearchSettings;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

#[derive(Serialize)]
pub struct State {
    pub papers_enabled: bool,
    pub web_enabled: bool,
    pub has_web_key: bool,
    pub use_tavily: bool,
}
#[derive(Deserialize)]
pub struct Save {
    pub papers_enabled: bool,
    pub web_enabled: bool,
    pub web_key: Option<String>,
    #[serde(default)]
    pub use_tavily: bool,
}
fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.neuink.workspace", "research-tavily")
        .map_err(|_| "系统凭据库不可用".into())
}
pub fn web_key() -> Result<String, String> {
    credential()?
        .get_password()
        .map_err(|_| "请在设置 → 工具与扩展中配置 Tavily API Key".into())
}
pub fn state<R: Runtime>(app: &AppHandle<R>) -> Result<State, String> {
    let s = read_settings(app)?.research;
    Ok(State {
        papers_enabled: s.papers_enabled,
        web_enabled: s.web_enabled,
        has_web_key: web_key().is_ok(),
        use_tavily: s.use_tavily,
    })
}
pub fn save<R: Runtime>(app: &AppHandle<R>, request: Save) -> Result<State, String> {
    if let Some(key) = request.web_key {
        if !matches!(
            keyring::default::default_credential_builder().persistence(),
            keyring::credential::CredentialPersistence::UntilDelete
        ) {
            return Err("此构建未使用持久系统凭据库，无法安全保存检索密钥".into());
        }
        let key = key.trim();
        if key.is_empty() || key.len() > 4096 {
            return Err("检索凭据为空或过长".into());
        }
        credential()?
            .set_password(key)
            .map_err(|_| "保存检索凭据失败".to_string())?;
        if web_key()? != key {
            return Err("检索凭据回读校验失败".into());
        }
    }
    if request.use_tavily {
        web_key()?;
    }
    let mut settings = read_settings(app)?;
    settings.research = ResearchSettings {
        papers_enabled: request.papers_enabled,
        web_enabled: request.web_enabled,
        use_tavily: request.use_tavily,
    };
    write_settings(app, &settings)?;
    state(app)
}
