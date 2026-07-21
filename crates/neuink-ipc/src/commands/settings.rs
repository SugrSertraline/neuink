use std::{fs, path::PathBuf};

use chrono::Utc;
use neuink_config::{AppSettings, LlmProfile, LlmSettings};
use neuink_workspace::atomic_write_json;
use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Deserialize)]
pub struct SaveLlmSettingsRequest {
    #[serde(default)]
    pub profile_id: Option<String>,
    pub name: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub max_context_length: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub top_p: Option<f32>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteLlmProfileRequest {
    pub profile_id: String,
}

#[derive(Debug, Deserialize)]
pub struct SetTaskLlmProfileRequest {
    pub task: LlmProfileTask,
    pub profile_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmProfileTask {
    Assistant,
    Translation,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct LlmSettingsState {
    pub profiles: Vec<LlmProfile>,
    pub assistant_profile_id: Option<String>,
    pub assistant_profile: Option<LlmProfile>,
    pub translation_profile_id: Option<String>,
    pub translation_profile: Option<LlmProfile>,
}

#[tauri::command]
pub fn get_llm_settings<R: Runtime>(app: AppHandle<R>) -> Result<LlmSettingsState, String> {
    let mut settings = read_settings(&app)?;
    ensure_legacy_profile(&mut settings);
    let state = settings_state(&settings);
    write_settings(&app, &settings)?;
    Ok(state)
}

#[tauri::command]
pub fn save_llm_settings<R: Runtime>(
    app: AppHandle<R>,
    request: SaveLlmSettingsRequest,
) -> Result<LlmSettingsState, String> {
    let mut settings = read_settings(&app)?;
    ensure_legacy_profile(&mut settings);
    let profile = LlmProfile {
        id: request.profile_id.unwrap_or_else(new_profile_id),
        name: normalize_profile_name(request.name),
        base_url: request.base_url.trim().trim_end_matches('/').to_string(),
        model: request.model.trim().to_string(),
        api_key: request.api_key.and_then(|value| {
            let value = value.trim().to_string();
            (!value.is_empty()).then_some(value)
        }),
        max_context_length: request.max_context_length,
        temperature: request.temperature,
        top_p: request.top_p,
        max_output_tokens: request.max_output_tokens,
    };

    if profile.base_url.is_empty() {
        return Err("LLM base URL is required".to_string());
    }
    if profile.model.is_empty() {
        return Err("LLM model is required".to_string());
    }

    if let Some(existing) = settings
        .llm_profiles
        .iter_mut()
        .find(|item| item.id == profile.id)
    {
        *existing = profile.clone();
    } else {
        settings.llm_profiles.push(profile.clone());
    }
    settings
        .active_llm_profile_id
        .get_or_insert_with(|| profile.id.clone());
    if settings.assistant_llm_profile_id.is_none() {
        settings.assistant_llm_profile_id = Some(profile.id.clone());
    }
    if settings.translation_llm_profile_id.is_none() {
        settings.translation_llm_profile_id = Some(profile.id.clone());
    }
    settings.llm = Some(legacy_settings(&profile));
    write_settings(&app, &settings)?;
    Ok(settings_state(&settings))
}

#[tauri::command]
pub fn clear_llm_settings<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let mut settings = read_settings(&app)?;
    settings.llm = None;
    settings.llm_profiles.clear();
    settings.active_llm_profile_id = None;
    settings.assistant_llm_profile_id = None;
    settings.translation_llm_profile_id = None;
    write_settings(&app, &settings)
}

#[tauri::command]
pub fn delete_llm_profile<R: Runtime>(
    app: AppHandle<R>,
    request: DeleteLlmProfileRequest,
) -> Result<LlmSettingsState, String> {
    let mut settings = read_settings(&app)?;
    ensure_legacy_profile(&mut settings);
    settings
        .llm_profiles
        .retain(|profile| profile.id != request.profile_id);
    if settings.active_llm_profile_id.as_deref() == Some(request.profile_id.as_str()) {
        settings.active_llm_profile_id = settings
            .llm_profiles
            .first()
            .map(|profile| profile.id.clone());
    }
    let replacement_profile_id = settings
        .llm_profiles
        .first()
        .map(|profile| profile.id.clone());
    if settings.assistant_llm_profile_id.as_deref() == Some(request.profile_id.as_str()) {
        settings.assistant_llm_profile_id = replacement_profile_id.clone();
    }
    if settings.translation_llm_profile_id.as_deref() == Some(request.profile_id.as_str()) {
        settings.translation_llm_profile_id = replacement_profile_id;
    }
    settings.llm = legacy_active_profile(&settings).map(legacy_settings);
    write_settings(&app, &settings)?;
    Ok(settings_state(&settings))
}

#[tauri::command]
pub fn set_task_llm_profile<R: Runtime>(
    app: AppHandle<R>,
    request: SetTaskLlmProfileRequest,
) -> Result<LlmSettingsState, String> {
    let mut settings = read_settings(&app)?;
    ensure_legacy_profile(&mut settings);
    if let Some(profile_id) = request.profile_id.as_deref() {
        if !settings
            .llm_profiles
            .iter()
            .any(|profile| profile.id == profile_id)
        {
            return Err("LLM profile not found".to_string());
        }
    }

    match request.task {
        LlmProfileTask::Assistant => settings.assistant_llm_profile_id = request.profile_id,
        LlmProfileTask::Translation => settings.translation_llm_profile_id = request.profile_id,
    }

    write_settings(&app, &settings)?;
    Ok(settings_state(&settings))
}

pub(crate) fn read_settings<R: Runtime>(app: &AppHandle<R>) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

pub(crate) fn read_translation_profile<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<LlmProfile>, String> {
    let mut settings = read_settings(app)?;
    ensure_legacy_profile(&mut settings);
    let profile = task_profile(settings.translation_llm_profile_id.as_deref(), &settings).cloned();
    write_settings(app, &settings)?;
    Ok(profile)
}

pub(crate) fn read_assistant_profile<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<LlmProfile>, String> {
    let mut settings = read_settings(app)?;
    ensure_legacy_profile(&mut settings);
    let profile = task_profile(settings.assistant_llm_profile_id.as_deref(), &settings).cloned();
    write_settings(app, &settings)?;
    Ok(profile)
}

pub(crate) fn write_settings<R: Runtime>(
    app: &AppHandle<R>,
    settings: &AppSettings,
) -> Result<(), String> {
    let path = settings_path(app)?;
    atomic_write_json(path, settings).map_err(|error| error.to_string())
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
    Ok(config_dir.join("settings.json"))
}

fn ensure_legacy_profile(settings: &mut AppSettings) {
    if settings.llm_profiles.is_empty() {
        if let Some(llm) = settings.llm.clone() {
            let profile = LlmProfile {
                id: "default".to_string(),
                name: infer_profile_name(&llm),
                base_url: llm.base_url,
                model: llm.model,
                api_key: llm.api_key,
                max_context_length: llm.max_context_length,
                temperature: llm.temperature,
                top_p: llm.top_p,
                max_output_tokens: llm.max_output_tokens,
            };
            settings.active_llm_profile_id = Some(profile.id.clone());
            settings.llm_profiles.push(profile);
        }
    }

    // Older settings only had an active/default profile. Migrate that choice once
    // into explicit task assignments; runtime resolution below never falls back.
    let migration_profile_id = settings
        .active_llm_profile_id
        .as_ref()
        .filter(|id| {
            settings
                .llm_profiles
                .iter()
                .any(|profile| profile.id == **id)
        })
        .cloned()
        .or_else(|| {
            settings
                .llm_profiles
                .first()
                .map(|profile| profile.id.clone())
        });
    let has_profile = |profile_id: Option<&str>| {
        profile_id.is_some_and(|id| settings.llm_profiles.iter().any(|profile| profile.id == id))
    };
    if !has_profile(settings.assistant_llm_profile_id.as_deref()) {
        settings.assistant_llm_profile_id = migration_profile_id.clone();
    }
    if !has_profile(settings.translation_llm_profile_id.as_deref()) {
        settings.translation_llm_profile_id = migration_profile_id;
    }
}

fn settings_state(settings: &AppSettings) -> LlmSettingsState {
    LlmSettingsState {
        profiles: settings.llm_profiles.clone(),
        assistant_profile_id: settings.assistant_llm_profile_id.clone(),
        assistant_profile: task_profile(settings.assistant_llm_profile_id.as_deref(), settings)
            .cloned(),
        translation_profile_id: settings.translation_llm_profile_id.clone(),
        translation_profile: task_profile(settings.translation_llm_profile_id.as_deref(), settings)
            .cloned(),
    }
}

fn legacy_active_profile(settings: &AppSettings) -> Option<&LlmProfile> {
    settings
        .active_llm_profile_id
        .as_ref()
        .and_then(|id| {
            settings
                .llm_profiles
                .iter()
                .find(|profile| profile.id == *id)
        })
        .or_else(|| settings.llm_profiles.first())
}

fn task_profile<'a>(profile_id: Option<&str>, settings: &'a AppSettings) -> Option<&'a LlmProfile> {
    profile_id.and_then(|id| {
        settings
            .llm_profiles
            .iter()
            .find(|profile| profile.id == id)
    })
}

fn legacy_settings(profile: &LlmProfile) -> LlmSettings {
    LlmSettings {
        base_url: profile.base_url.clone(),
        model: profile.model.clone(),
        api_key: profile.api_key.clone(),
        api_key_ref: None,
        max_context_length: profile.max_context_length,
        temperature: profile.temperature,
        top_p: profile.top_p,
        max_output_tokens: profile.max_output_tokens,
    }
}

fn infer_profile_name(settings: &LlmSettings) -> String {
    if settings.base_url.contains("deepseek") {
        "DeepSeek".to_string()
    } else if settings.base_url.contains("localhost") || settings.base_url.contains("127.0.0.1") {
        "Ollama".to_string()
    } else {
        settings.model.clone()
    }
}

fn normalize_profile_name(name: String) -> String {
    let name = name.trim();
    if name.is_empty() {
        "Untitled model".to_string()
    } else {
        name.chars().take(40).collect()
    }
}

fn new_profile_id() -> String {
    format!(
        "llm_{}",
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    )
}

#[cfg(test)]
mod tests {
    use super::{ensure_legacy_profile, task_profile};
    use neuink_config::{AppSettings, LlmProfile};

    #[test]
    fn migrates_legacy_default_into_explicit_task_assignments() {
        let mut settings = AppSettings::default();
        settings.llm_profiles = vec![profile("first"), profile("second")];

        ensure_legacy_profile(&mut settings);

        assert_eq!(settings.assistant_llm_profile_id.as_deref(), Some("first"));
        assert_eq!(
            settings.translation_llm_profile_id.as_deref(),
            Some("first")
        );
    }

    #[test]
    fn task_resolution_does_not_fall_back_to_an_unassigned_profile() {
        let mut settings = AppSettings::default();
        settings.llm_profiles = vec![profile("first")];

        assert!(task_profile(None, &settings).is_none());
        assert!(task_profile(Some("missing"), &settings).is_none());
    }

    fn profile(id: &str) -> LlmProfile {
        LlmProfile {
            id: id.to_string(),
            name: id.to_string(),
            base_url: "http://localhost:11434/v1".to_string(),
            model: "test-model".to_string(),
            api_key: None,
            max_context_length: Some(8_192),
            temperature: Some(0.2),
            top_p: None,
            max_output_tokens: Some(1_024),
        }
    }
}
