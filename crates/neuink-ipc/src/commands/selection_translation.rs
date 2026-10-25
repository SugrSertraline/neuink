//! Short-text translation. Credentials stay in the OS vault; no provider fallback or retries.
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
fn validate(settings: &Settings) -> Result<(), String> {
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
fn key(settings: &Settings, supplied: Option<&str>) -> Result<String, String> {
    if let Some(value) = supplied.filter(|value| !value.trim().is_empty()) {
        if value.len() > 4096 {
            return Err("翻译密钥过长".into());
        }
        return Ok(value.trim().to_string());
    }
    if let Ok(value) = credential(settings)?.get_password() {
        return Ok(value);
    }
    Err("请在设置 → 翻译 → 选区翻译服务中填写 API Key".into())
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
    settings.selection_translation = request.settings;
    write_settings(&app, &settings)?;
    Ok(state(settings.selection_translation))
}
#[tauri::command]
pub async fn translate_selection_service<R: Runtime>(
    app: AppHandle<R>,
    text: String,
) -> Result<Option<String>, String> {
    let settings = read_settings(&app)?.selection_translation;
    if settings.provider == Provider::ReadingModel {
        return Ok(None);
    }
    let api_key = key(&settings, None)?;
    translate(&settings, &api_key, &text).await.map(Some)
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

fn payload(settings: &Settings, text: &str) -> Value {
    match settings.provider {
        Provider::Azure => json!([{ "Text": text }]),
        Provider::Deepl => json!({ "text": [text], "target_lang": "ZH-HANS" }),
        Provider::QwenMt => {
            json!({ "model": settings.model.trim(), "messages": [{"role":"user", "content":text}],
            "translation_options": {"source_lang":"auto", "target_lang":"Chinese"}, "stream":false })
        }
        Provider::ReadingModel => Value::Null,
    }
}
fn extract(provider: Provider, body: &Value) -> Result<String, String> {
    let text = match provider {
        Provider::Azure => body.pointer("/0/translations/0/text"),
        Provider::Deepl => body.pointer("/translations/0/text"),
        Provider::QwenMt => body.pointer("/choices/0/message/content"),
        Provider::ReadingModel => None,
    }
    .and_then(Value::as_str)
    .unwrap_or_default()
    .trim();
    if text.is_empty() {
        Err("翻译服务未返回译文，请检查服务类型与模型名称".into())
    } else {
        Ok(text.to_string())
    }
}
async fn translate(settings: &Settings, api_key: &str, text: &str) -> Result<String, String> {
    validate(settings)?;
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 12000 {
        return Err("请选择 1–12000 个字符进行快速翻译".into());
    }
    let mut url = Url::parse(settings.endpoint.trim()).map_err(|_| "翻译地址无效")?;
    if settings.provider == Provider::Azure {
        url.set_query(None);
        url.query_pairs_mut()
            .append_pair("api-version", "3.0")
            .append_pair("to", "zh-Hans");
    }
    let mut request = client()?.post(url).json(&payload(settings, text));
    request = match settings.provider {
        Provider::Azure => {
            let mut request = request.header("Ocp-Apim-Subscription-Key", api_key);
            if !settings.region.trim().is_empty() {
                request = request.header("Ocp-Apim-Subscription-Region", settings.region.trim());
            }
            request
        }
        Provider::Deepl => request.header("Authorization", format!("DeepL-Auth-Key {api_key}")),
        Provider::QwenMt => request.bearer_auth(api_key),
        Provider::ReadingModel => return Err("请使用整体翻译模型进行翻译".into()),
    };
    let mut response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "翻译服务响应超时（30 秒），请重试或更换服务"
        } else {
            "无法连接翻译服务，请检查地址和网络"
        }
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "翻译服务请求失败（HTTP {}），请检查密钥、额度和请求地址",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "读取翻译结果失败或超时")?
    {
        if bytes.len() + chunk.len() > 512 * 1024 {
            return Err("翻译响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = serde_json::from_slice(&bytes)
        .map_err(|_| "翻译服务返回格式不匹配，请检查服务类型和地址")?;
    extract(settings.provider, &body)
}

#[cfg(test)]
#[path = "selection_translation_tests.rs"]
mod tests;
