use keyring::{credential::CredentialPersistence, Entry};
use neuink_sciverse::{
    AgenticSearchRequest, AgenticSearchResponse, ContentRequest, ContentResponse, SciverseClient,
    DEFAULT_SCIVERSE_BASE_URL,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Runtime};

use super::settings::{read_settings, write_settings};

const CREDENTIAL_SERVICE: &str = "Neuink";
const CREDENTIAL_USER: &str = "sciverse-api-token";
const CREDENTIAL_REF: &str = "keyring:sciverse-api-token";
const ENV_API_TOKEN: &str = "SCIVERSE_API_TOKEN";
pub(crate) mod paper_import;
pub(crate) mod note_images;
pub(super) mod pdf_download;
pub use paper_import::prepare_sciverse_paper_import;
pub(crate) mod saved_entry;
pub use saved_entry::fetch_entry_pdf;

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
    pub pdf_source_url: Option<String>,
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
#[path = "sciverse/live_tests.rs"]
mod live_tests;
#[cfg(test)]
#[path = "sciverse/note_images_live_tests.rs"]
mod note_images_live_tests;

#[cfg(test)]
mod tests {
    use super::{ensure_persistent_credential_store, normalize_credential_result};

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
}
