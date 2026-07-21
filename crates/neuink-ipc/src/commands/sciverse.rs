use std::{fs, net::IpAddr, path::PathBuf};

use keyring::{credential::CredentialPersistence, Entry};
use neuink_sciverse::{
    AgenticSearchRequest, AgenticSearchResponse, ContentRequest, ContentResponse, SciverseClient,
    DEFAULT_SCIVERSE_BASE_URL,
};
use reqwest::{redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

use super::settings::{read_settings, write_settings};

const CREDENTIAL_SERVICE: &str = "Neuink";
const CREDENTIAL_USER: &str = "sciverse-api-token";
const CREDENTIAL_REF: &str = "keyring:sciverse-api-token";
const ENV_API_TOKEN: &str = "SCIVERSE_API_TOKEN";
const MAX_IMPORT_PDF_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
pub struct SciverseSettingsState {
    pub enabled: bool,
    pub base_url: String,
    pub has_api_token: bool,
    pub token_source: Option<&'static str>,
}

#[derive(Debug, Deserialize)]
pub struct SaveSciverseSettingsRequest {
    pub enabled: bool,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_token: Option<String>,
    #[serde(default)]
    pub clear_api_token: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct SciverseConnectionStatus {
    pub ok: bool,
    pub base_url: String,
    pub field_count: usize,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SciverseJsonRequest {
    pub payload: Value,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PrepareSciversePaperImportRequest {
    pub doc_id: String,
    pub title: String,
    #[serde(default)]
    pub doi: Option<String>,
    #[serde(default)]
    pub access_oa_url: Option<String>,
    #[serde(default)]
    pub resource_file_name: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SciversePaperImportPreparation {
    pub title: String,
    pub doc_id: String,
    pub doi: Option<String>,
    pub authors: Vec<String>,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    pub publication_year: Option<u32>,
    pub venue: Option<String>,
    pub access_oa_url: Option<String>,
    pub access_license: Option<String>,
    pub pdf_path: Option<String>,
    pub degradation_reason: Option<String>,
    pub resource_attempts: Vec<String>,
}

#[tauri::command]
pub fn get_sciverse_settings<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SciverseSettingsState, String> {
    let settings = read_settings(&app)?;
    settings_state(&settings.sciverse)
}

#[tauri::command]
pub fn reveal_sciverse_api_token<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let settings = read_settings(&app)?;
    resolve_api_token(&settings.sciverse)
}

#[tauri::command]
pub fn save_sciverse_settings<R: Runtime>(
    app: AppHandle<R>,
    request: SaveSciverseSettingsRequest,
) -> Result<SciverseSettingsState, String> {
    let mut settings = read_settings(&app)?;
    let base_url = request
        .base_url
        .unwrap_or_else(|| settings.sciverse.base_url.clone())
        .trim()
        .trim_end_matches('/')
        .to_string();
    let base_url = if base_url.is_empty() {
        DEFAULT_SCIVERSE_BASE_URL.to_string()
    } else {
        base_url
    };
    SciverseClient::new(&base_url, "validation-token").map_err(|error| error.to_string())?;

    if request.clear_api_token {
        delete_credential()?;
        settings.sciverse.api_key_ref = None;
    } else if let Some(token) = request.api_token {
        let token = token.trim();
        if !token.is_empty() {
            persist_credential(token)?;
            settings.sciverse.api_key_ref = Some(CREDENTIAL_REF.to_string());
        }
    }

    if request.enabled && resolve_api_token(&settings.sciverse).is_err() {
        return Err(
            "Sciverse cannot be enabled until its API token is persistently configured."
                .to_string(),
        );
    }

    settings.sciverse.enabled = request.enabled;
    settings.sciverse.base_url = base_url;
    write_settings(&app, &settings)?;
    let state = settings_state(&settings.sciverse)?;
    if settings.sciverse.api_key_ref.as_deref() == Some(CREDENTIAL_REF) && !state.has_api_token {
        return Err("Sciverse credential was not readable after saving.".to_string());
    }
    Ok(state)
}

#[tauri::command]
pub async fn test_sciverse_connection<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SciverseConnectionStatus, String> {
    let settings = read_settings(&app)?;
    let client = configured_client(&settings.sciverse)?;
    let catalog = client
        .meta_catalog()
        .await
        .map_err(|error| error.to_string())?;
    let field_count = catalog
        .get("fields")
        .and_then(serde_json::Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();
    Ok(SciverseConnectionStatus {
        ok: true,
        base_url: settings.sciverse.base_url,
        field_count,
    })
}

#[tauri::command]
pub async fn sciverse_agentic_search<R: Runtime>(
    app: AppHandle<R>,
    request: AgenticSearchRequest,
) -> Result<AgenticSearchResponse, String> {
    let settings = read_settings(&app)?;
    ensure_enabled(settings.sciverse.enabled)?;
    configured_client(&settings.sciverse)?
        .agentic_search(&request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sciverse_read_content<R: Runtime>(
    app: AppHandle<R>,
    request: ContentRequest,
) -> Result<ContentResponse, String> {
    let settings = read_settings(&app)?;
    ensure_enabled(settings.sciverse.enabled)?;
    configured_client(&settings.sciverse)?
        .content(&request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sciverse_meta_catalog<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let settings = read_settings(&app)?;
    ensure_enabled(settings.sciverse.enabled)?;
    configured_client(&settings.sciverse)?
        .meta_catalog()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sciverse_meta_search<R: Runtime>(
    app: AppHandle<R>,
    request: SciverseJsonRequest,
) -> Result<Value, String> {
    let settings = read_settings(&app)?;
    ensure_enabled(settings.sciverse.enabled)?;
    configured_client(&settings.sciverse)?
        .meta_search(&request.payload)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sciverse_meta_paper_relations<R: Runtime>(
    app: AppHandle<R>,
    request: SciverseJsonRequest,
) -> Result<Value, String> {
    let settings = read_settings(&app)?;
    ensure_enabled(settings.sciverse.enabled)?;
    configured_client(&settings.sciverse)?
        .meta_paper_relations(&request.payload)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sciverse_paper_schema<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let settings = read_settings(&app)?;
    ensure_enabled(settings.sciverse.enabled)?;
    configured_client(&settings.sciverse)?
        .paper_schema()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sciverse_paper_schema_search<R: Runtime>(
    app: AppHandle<R>,
    request: SciverseJsonRequest,
) -> Result<Value, String> {
    let settings = read_settings(&app)?;
    ensure_enabled(settings.sciverse.enabled)?;
    configured_client(&settings.sciverse)?
        .paper_schema_search(&request.payload)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn prepare_sciverse_paper_import<R: Runtime>(
    app: AppHandle<R>,
    request: PrepareSciversePaperImportRequest,
) -> Result<SciversePaperImportPreparation, String> {
    let settings = read_settings(&app)?;
    ensure_enabled(settings.sciverse.enabled)?;
    let client = configured_client(&settings.sciverse)?;
    let mut preparation = SciversePaperImportPreparation {
        title: request.title.trim().to_string(),
        doc_id: request.doc_id.trim().to_string(),
        doi: clean_optional(request.doi),
        authors: Vec::new(),
        abstract_text: None,
        publication_year: None,
        venue: None,
        access_oa_url: clean_optional(request.access_oa_url),
        access_license: None,
        pdf_path: None,
        degradation_reason: None,
        resource_attempts: Vec::new(),
    };
    if preparation.doc_id.is_empty() || preparation.title.is_empty() {
        return Err("Sciverse paper import requires doc_id and title".to_string());
    }

    let metadata = resolve_paper_metadata(&client, &preparation.doc_id, &preparation.title)
        .await
        .ok();
    if let Some(metadata) = metadata.as_ref() {
        apply_paper_metadata(&mut preparation, &metadata);
    }

    let mut failures = Vec::new();
    let mut resource_candidates = Vec::new();
    push_unique(
        &mut resource_candidates,
        clean_optional(request.resource_file_name),
    );
    if let Some(metadata) = metadata.as_ref() {
        collect_pdf_resource_candidates(metadata, &mut resource_candidates);
    }
    for file_name in &resource_candidates {
        match client.resource(&preparation.doc_id, file_name).await {
            Ok(resource) if looks_like_pdf(resource.content_type.as_deref(), &resource.bytes) => {
                preparation.pdf_path = Some(save_import_pdf(&preparation.doc_id, &resource.bytes)?);
                break;
            }
            Ok(_) => failures.push(format!("资源 {file_name} 不是 PDF")),
            Err(error) => failures.push(format!("资源 {file_name}：{error}")),
        }
    }

    if preparation.pdf_path.is_none() {
        let mut open_access_urls = Vec::new();
        push_unique(&mut open_access_urls, preparation.access_oa_url.clone());
        if let Some(metadata) = metadata.as_ref() {
            collect_open_access_pdf_urls(metadata, &mut open_access_urls);
        }
        for url in &open_access_urls {
            match download_open_access_pdf(url).await {
                Ok(bytes) => {
                    preparation.pdf_path = Some(save_import_pdf(&preparation.doc_id, &bytes)?);
                    break;
                }
                Err(error) => failures.push(format!("开放获取链接 {url}：{error}")),
            }
        }
    }

    if preparation.pdf_path.is_none() {
        preparation.degradation_reason = Some(if failures.is_empty() {
            "Sciverse 未返回 PDF 资源路径或开放获取链接；此论文只能保存为元数据条目，需用户后续手动补充 PDF。".to_string()
        } else {
            format!(
                "已尝试 {} 个候选 PDF 来源但均不可下载；条目将仅保存元数据。最近失败：{}",
                failures.len(),
                failures.last().expect("failures is not empty")
            )
        });
    }
    preparation.resource_attempts = failures;
    Ok(preparation)
}

async fn resolve_paper_metadata(
    client: &SciverseClient,
    doc_id: &str,
    title: &str,
) -> Result<Value, String> {
    let response = client
        .meta_search(&json!({
            "query": title,
            "filters": [],
            "fields": [
                "title", "doc_id", "doi", "author", "abstract",
                "publication_published_year", "publication_venue_name_unified",
                "access_oa_url", "access_license", "locations", "file_name"
            ],
            "page": 1,
            "page_size": 10
        }))
        .await
        .map_err(|error| error.to_string())?;
    let results = response
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| "Sciverse meta-search returned no result list".to_string())?;
    results
        .iter()
        .find(|item| item.get("doc_id").and_then(Value::as_str) == Some(doc_id))
        .or_else(|| {
            results.iter().find(|item| {
                item.get("title")
                    .and_then(Value::as_str)
                    .is_some_and(|candidate| candidate.eq_ignore_ascii_case(title))
            })
        })
        .cloned()
        .ok_or_else(|| "Sciverse metadata did not contain the selected paper".to_string())
}

fn push_unique(candidates: &mut Vec<String>, value: Option<String>) {
    if let Some(value) = value {
        if !candidates.iter().any(|candidate| candidate == &value) {
            candidates.push(value);
        }
    }
}

fn collect_pdf_resource_candidates(value: &Value, candidates: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if let Some(text) = child.as_str() {
                    let normalized = text.trim();
                    if (key.contains("file") || key.contains("resource") || key.contains("path"))
                        && normalized.to_ascii_lowercase().ends_with(".pdf")
                        && is_safe_resource_path(normalized)
                    {
                        push_unique(candidates, Some(normalized.to_string()));
                    }
                }
                collect_pdf_resource_candidates(child, candidates);
            }
        }
        Value::Array(values) => {
            for child in values {
                collect_pdf_resource_candidates(child, candidates);
            }
        }
        _ => {}
    }
}

fn collect_open_access_pdf_urls(value: &Value, candidates: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if let Some(text) = child.as_str() {
                    let normalized = text.trim();
                    if (key.contains("oa") || key.contains("pdf") || key.contains("url"))
                        && normalized.starts_with("https://")
                        && (key.contains("pdf") || normalized.to_ascii_lowercase().contains("pdf"))
                    {
                        push_unique(candidates, Some(normalized.to_string()));
                    }
                }
                collect_open_access_pdf_urls(child, candidates);
            }
        }
        Value::Array(values) => {
            for child in values {
                collect_open_access_pdf_urls(child, candidates);
            }
        }
        _ => {}
    }
}

fn is_safe_resource_path(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.split('/').any(|segment| segment == "..")
        && !value.contains("://")
}

fn apply_paper_metadata(preparation: &mut SciversePaperImportPreparation, value: &Value) {
    if let Some(title) = value
        .get("title")
        .and_then(Value::as_str)
        .and_then(clean_text)
    {
        preparation.title = title;
    }
    preparation.doi = preparation.doi.take().or_else(|| {
        value
            .get("doi")
            .and_then(Value::as_str)
            .and_then(clean_text)
    });
    preparation.abstract_text = value
        .get("abstract")
        .and_then(Value::as_str)
        .and_then(clean_text);
    preparation.publication_year = value
        .get("publication_published_year")
        .and_then(Value::as_u64)
        .and_then(|year| u32::try_from(year).ok());
    preparation.venue = value
        .get("publication_venue_name_unified")
        .and_then(Value::as_str)
        .and_then(clean_text);
    preparation.access_oa_url = preparation.access_oa_url.take().or_else(|| {
        value
            .get("access_oa_url")
            .and_then(Value::as_str)
            .and_then(clean_text)
    });
    preparation.access_license = value
        .get("access_license")
        .and_then(Value::as_str)
        .and_then(clean_text);
    preparation.authors = value
        .get("author")
        .and_then(Value::as_array)
        .map(|authors| {
            authors
                .iter()
                .filter_map(|author| {
                    author.as_str().and_then(clean_text).or_else(|| {
                        author
                            .get("name")
                            .and_then(Value::as_str)
                            .and_then(clean_text)
                    })
                })
                .collect()
        })
        .unwrap_or_default();
}

async fn download_open_access_pdf(url: &str) -> Result<Vec<u8>, String> {
    let mut current = Url::parse(url).map_err(|_| "invalid open-access URL".to_string())?;
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .redirect(Policy::none())
        .build()
        .map_err(|error| error.to_string())?;

    for _ in 0..5 {
        validate_external_pdf_url(&current)?;
        let mut response = http
            .get(current.clone())
            .header(
                reqwest::header::USER_AGENT,
                "Neuink/0.1 Sciverse paper importer",
            )
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "open-access redirect omitted Location".to_string())?;
            current = current
                .join(location)
                .map_err(|_| "invalid open-access redirect URL".to_string())?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!(
                "open-access PDF returned HTTP {}",
                response.status()
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length as usize > MAX_IMPORT_PDF_BYTES)
        {
            return Err("open-access PDF exceeds the 64 MB import limit".to_string());
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(ToString::to_string);
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
            if bytes.len() + chunk.len() > MAX_IMPORT_PDF_BYTES {
                return Err("open-access PDF exceeds the 64 MB import limit".to_string());
            }
            bytes.extend_from_slice(&chunk);
        }
        if !looks_like_pdf(content_type.as_deref(), &bytes) {
            return Err("open-access URL did not return a PDF".to_string());
        }
        return Ok(bytes);
    }
    Err("open-access PDF redirected too many times".to_string())
}

fn validate_external_pdf_url(url: &Url) -> Result<(), String> {
    if url.scheme() != "https" {
        return Err("only HTTPS open-access PDF URLs are allowed".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "open-access URL has no host".to_string())?;
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.parse::<IpAddr>().is_ok_and(is_private_address)
    {
        return Err("open-access URL points to a local or private address".to_string());
    }
    Ok(())
}

fn is_private_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified()
                || address.is_multicast()
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unspecified()
                || address.is_multicast()
                || (address.segments()[0] & 0xfe00) == 0xfc00
                || (address.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

fn looks_like_pdf(content_type: Option<&str>, bytes: &[u8]) -> bool {
    content_type.is_some_and(|value| value.to_ascii_lowercase().contains("application/pdf"))
        || bytes.starts_with(b"%PDF-")
}

fn save_import_pdf(doc_id: &str, bytes: &[u8]) -> Result<String, String> {
    let safe_id = doc_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(48)
        .collect::<String>();
    let directory = std::env::temp_dir().join("neuink-sciverse-imports");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path: PathBuf = directory.join(format!(
        "{}.pdf",
        if safe_id.is_empty() {
            "paper"
        } else {
            &safe_id
        }
    ));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| clean_text(&value))
}

fn clean_text(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn settings_state(
    settings: &neuink_config::SciverseSettings,
) -> Result<SciverseSettingsState, String> {
    let token_source = if env_token().is_some() {
        Some("environment")
    } else if settings.api_key_ref.as_deref() == Some(CREDENTIAL_REF) && credential_exists()? {
        Some("credential_store")
    } else {
        None
    };
    let has_api_token = token_source.is_some();
    Ok(SciverseSettingsState {
        enabled: settings.enabled && has_api_token,
        base_url: settings.base_url.clone(),
        has_api_token,
        token_source,
    })
}

fn configured_client(settings: &neuink_config::SciverseSettings) -> Result<SciverseClient, String> {
    let token = resolve_api_token(settings)?;
    SciverseClient::new(&settings.base_url, token).map_err(|error| error.to_string())
}

fn resolve_api_token(settings: &neuink_config::SciverseSettings) -> Result<String, String> {
    if let Some(token) = env_token() {
        return Ok(token);
    }
    if settings.api_key_ref.as_deref() == Some(CREDENTIAL_REF) {
        return read_credential()?.ok_or_else(missing_token_error);
    }
    Err(missing_token_error())
}

fn env_token() -> Option<String> {
    std::env::var(ENV_API_TOKEN)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(credential_error)
}

fn persist_credential(token: &str) -> Result<(), String> {
    ensure_persistent_credential_store()?;
    credential_entry()?
        .set_password(token)
        .map_err(credential_error)?;

    match read_credential()? {
        Some(persisted) if persisted == token => Ok(()),
        Some(_) => Err("Sciverse credential verification returned different data.".to_string()),
        None => Err("Sciverse credential was not readable after saving.".to_string()),
    }
}

fn ensure_persistent_credential_store() -> Result<(), String> {
    match keyring::default::default_credential_builder().persistence() {
        CredentialPersistence::UntilDelete => Ok(()),
        _ => Err(
            "Sciverse requires a persistent system credential store, but this build is using a non-persistent credential backend."
                .to_string(),
        ),
    }
}

fn credential_exists() -> Result<bool, String> {
    Ok(read_credential()?.is_some())
}

fn read_credential() -> Result<Option<String>, String> {
    normalize_credential_result(credential_entry()?.get_password())
}

fn normalize_credential_result(
    result: Result<String, keyring::Error>,
) -> Result<Option<String>, String> {
    match result {
        Ok(value) => Ok((!value.trim().is_empty()).then_some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(credential_error(error)),
    }
}

fn delete_credential() -> Result<(), String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(credential_error(error)),
    }
}

fn credential_error(error: keyring::Error) -> String {
    format!("Sciverse credential store error: {error}")
}

fn missing_token_error() -> String {
    format!("Sciverse API token is not configured. Save one in Settings or set {ENV_API_TOKEN}.")
}

fn ensure_enabled(enabled: bool) -> Result<(), String> {
    if enabled {
        Ok(())
    } else {
        Err("Sciverse is disabled in Settings".to_string())
    }
}

pub(crate) fn assistant_tools_enabled<R: Runtime>(app: &AppHandle<R>) -> bool {
    read_settings(app)
        .ok()
        .filter(|settings| settings.sciverse.enabled)
        .and_then(|settings| resolve_api_token(&settings.sciverse).ok())
        .is_some()
}

#[cfg(test)]
mod tests {
    use reqwest::Url;

    use super::{
        ensure_persistent_credential_store, looks_like_pdf, normalize_credential_result,
        validate_external_pdf_url,
    };

    #[test]
    fn missing_credential_is_treated_as_unconfigured() {
        assert_eq!(
            normalize_credential_result(Err(keyring::Error::NoEntry)),
            Ok(None)
        );
    }

    #[test]
    fn platform_credential_store_persists_until_deleted() {
        assert_eq!(ensure_persistent_credential_store(), Ok(()));
    }

    #[test]
    fn import_pdf_validation_accepts_pdf_bytes_without_a_reliable_content_type() {
        assert!(looks_like_pdf(
            Some("application/octet-stream"),
            b"%PDF-1.7\n"
        ));
        assert!(!looks_like_pdf(Some("text/html"), b"<html>login</html>"));
    }

    #[test]
    fn open_access_download_rejects_local_and_insecure_urls() {
        assert!(
            validate_external_pdf_url(&Url::parse("https://127.0.0.1/paper.pdf").unwrap()).is_err()
        );
        assert!(
            validate_external_pdf_url(&Url::parse("http://example.com/paper.pdf").unwrap())
                .is_err()
        );
        assert!(
            validate_external_pdf_url(&Url::parse("https://example.com/paper.pdf").unwrap())
                .is_ok()
        );
    }
}
