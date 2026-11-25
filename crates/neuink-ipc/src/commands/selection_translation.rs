//! Translation service configuration and vault credentials. Credentials stay in the OS vault; no provider fallback or retries.
use super::settings::{read_settings, write_settings};
use neuink_config::{
    SelectionTranslationProvider as Provider, SelectionTranslationSettings as Settings,
};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Runtime};

mod transport;
pub(crate) mod cancellation;
mod text;
pub(crate) mod registry;
use transport::translate;
#[cfg(test)]
use transport::{payload, extract};

// Keep pooled connections warm for repeated short selections.
static HTTP: OnceLock<Result<Client, String>> = OnceLock::new();
fn client() -> Result<&'static Client, String> {
    HTTP.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "无法初始化翻译连接".to_string())
    })
    .as_ref()
    .map_err(Clone::clone)
}

#[derive(Serialize)]
pub struct State {
    #[serde(flatten)]
    settings: Settings,
    has_key: bool,
}
#[derive(Deserialize)]
pub struct Save {
    #[serde(flatten)]
    settings: Settings,
    api_key: Option<String>,
}

fn credential(settings: &Settings) -> Result<keyring::Entry, String> {
    let identity = serde_json::to_string(&(settings.provider, settings.endpoint.trim()))
        .map_err(|_| "翻译服务配置无效")?;
    keyring::Entry::new(
        "com.neuink.workspace",
        &format!(
            "selection-translation-{}",
            blake3::hash(identity.as_bytes()).to_hex()
        ),
    )
    .map_err(|_| "系统凭据库不可用".into())
}
fn state(settings: Settings) -> State {
    let has_key = credential(&settings)
        .and_then(|entry| entry.get_password().map_err(|_| "未配置密钥".into()))
        .is_ok();
    State { settings, has_key }
}
pub(crate) fn validate(settings: &Settings) -> Result<(), String> {
    if settings.provider == Provider::ReadingModel {
        return Ok(());
    }
    let url = Url::parse(settings.endpoint.trim()).map_err(|_| "请输入完整的翻译请求地址")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || (url.scheme() == "http" && local))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "翻译地址需使用 HTTPS；本机服务可使用 HTTP，地址中不能包含账号、密码或片段".into(),
        );
    }
    if settings.endpoint.len() > 2048 || settings.model.len() > 256 || settings.region.len() > 128 {
        return Err("翻译服务配置过长".into());
    }
    if settings.provider == Provider::QwenMt && settings.model.trim().is_empty() {
        return Err("请填写翻译模型名称".into());
    }
    Ok(())
}
pub(crate) fn key(settings: &Settings, supplied: Option<&str>) -> Result<String, String> {
    if let Some(value) = supplied.filter(|value| !value.trim().is_empty()) {
        if value.len() > 4096 {
            return Err("翻译密钥过长".into());
        }
        return Ok(value.trim().to_string());
    }
    if let Ok(value) = credential(settings)?.get_password() {
        return Ok(value);
    }
    Err("请在设置 → 翻译 → 翻译服务中填写 API Key".into())
}

#[tauri::command]
pub fn get_selection_translation_settings<R: Runtime>(app: AppHandle<R>) -> Result<State, String> {
    Ok(state(read_settings(&app)?.selection_translation))
}
#[tauri::command]
pub fn save_selection_translation_settings<R: Runtime>(
    app: AppHandle<R>,
    request: Save,
) -> Result<State, String> {
    validate(&request.settings)?;
    if request.settings.provider != Provider::ReadingModel {
        let resolved = key(&request.settings, request.api_key.as_deref())?;
        if request
            .api_key
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            if !matches!(
                keyring::default::default_credential_builder().persistence(),
                keyring::credential::CredentialPersistence::UntilDelete
            ) {
                return Err("此构建未启用持久系统凭据库，无法保存翻译密钥".into());
            }
            credential(&request.settings)?
                .set_password(&resolved)
                .map_err(|_| "保存翻译密钥失败")?;
        }
    }
    let mut settings = read_settings(&app)?;
    registry::upsert(&mut settings, request.settings.clone());
    settings.selection_translation = request.settings;
    write_settings(&app, &settings)?;
    Ok(state(settings.selection_translation))
}
#[tauri::command]
pub async fn translate_selection_service<R: Runtime>(
    app: AppHandle<R>,
    text: String,
    provider: Option<Provider>,
    request_id: Option<String>,
) -> Result<Option<String>, String> {
    let control = request_id.map(cancellation::Request::register).transpose()?;
    let app_settings = read_settings(&app)?;
    let settings = match provider {
        Some(provider) => registry::configured(&app_settings, provider)?,
        None => app_settings.selection_translation,
    };
    if settings.provider == Provider::ReadingModel {
        return Ok(None);
    }
    let client = registry::ServiceClient::new(settings)?;
    if let Some(control) = control { control.run(client.translate(&text)).await.map(Some) }
    else { client.translate(&text).await.map(Some) }
}
#[tauri::command]
pub async fn test_selection_translation_service(request: Save) -> Result<String, String> {
    if request.settings.provider == Provider::ReadingModel {
        return Err("请在模型连接中测试阅读模型".into());
    }
    validate(&request.settings)?;
    let api_key = key(&request.settings, request.api_key.as_deref())?;
    translate(
        &request.settings,
        &api_key,
        "The experiment was successful.",
    )
    .await
}


#[cfg(test)]
#[path = "selection_translation_tests.rs"]
pub(crate) mod tests;
