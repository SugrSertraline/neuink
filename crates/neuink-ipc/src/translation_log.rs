//! Bounded local diagnostic metadata. Never persist prompts, responses, paths,
//! headers, raw exceptions or credentials, even if a provider echoes them.
use chrono::Utc;
use neuink_config::LlmProfile;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager, Runtime};

const FILE: &str = "translation-errors.jsonl";
const MAX_BYTES: u64 = 2 * 1024 * 1024;
const BACKUPS: usize = 3;
static DIRECTORY: OnceLock<PathBuf> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Request,
    Stream,
    NonStreaming,
    BatchValidation,
    ContextValidation,
    ParagraphValidation,
    Selection,
    ConnectionTest,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Details {
    pub elapsed_ms: u64,
    pub attempt: Option<u32>,
    pub input_chars: Option<usize>,
    pub output_chars: Option<usize>,
    pub expected_segments: Option<usize>,
    pub accepted_segments: Option<usize>,
    pub http_status: Option<u16>,
    pub response_bytes: Option<usize>,
    pub json_line: Option<usize>,
    pub json_column: Option<usize>,
    pub provider_error: Option<ProviderError>,
    pub rejected_parameter: Option<Parameter>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderError {
    InvalidApiKey,
    ModelNotFound,
    UnsupportedParameter,
    InvalidRequestError,
    RateLimitExceeded,
    InsufficientQuota,
    ContextLengthExceeded,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Parameter {
    Model,
    Temperature,
    TopP,
    MaxTokens,
    MaxCompletionTokens,
    Messages,
    Stream,
    ResponseFormat,
}

/// Pick known error fields only; a provider message can contain the whole paper.
pub(crate) fn response_details(body: &str) -> Details {
    let mut details = Details {
        response_bytes: Some(body.len()),
        ..Details::default()
    };
    match serde_json::from_str::<Value>(body) {
        Ok(value) => {
            details.provider_error = value
                .pointer("/error/code")
                .or_else(|| value.pointer("/error/type"))
                .cloned()
                .and_then(|v| serde_json::from_value(v).ok());
            details.rejected_parameter = value
                .pointer("/error/param")
                .cloned()
                .and_then(|v| serde_json::from_value(v).ok());
        }
        Err(error) => {
            details.json_line = Some(error.line());
            details.json_column = Some(error.column());
        }
    }
    details
}

pub fn initialize<R: Runtime>(app: &AppHandle<R>) {
    let path = crate::storage::portable(app)
        .map(|p| p.data().join("logs"))
        .or_else(|| app.path().app_log_dir().ok());
    if let Some(path) = path {
        let _ = DIRECTORY.set(path);
    }
}

/// Unknown errors remain unknown, never raw provider output.
pub fn code(error: &str) -> &'static str {
    for (needle, code) in [
        ("LLM_TRANSLATION_OUTPUT_LIMIT", "output_limit"),
        ("LLM_TRANSLATION_REASONING_ONLY", "reasoning_only"),
        ("LLM_TRANSLATION_CONTENT_FILTERED", "content_filtered"),
        ("LLM_TRANSLATION_PROVIDER_ERROR", "provider_error"),
        ("LLM_TRANSLATION_INVALID_FORMAT", "invalid_json_or_schema"),
        ("TEST_INCOMPLETE_TRANSLATION", "incomplete_translation"),
        ("TEST_CONFIGURATION", "invalid_configuration"),
        ("TEST_RESPONSE_FORMAT", "invalid_json_or_schema"),
        ("TEST_CANCELLED", "cancelled"),
    ] {
        if error.contains(needle) {
            return code;
        }
    }
    let lower = error.to_lowercase();
    if lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("stalled")
        || lower.contains("idle")
        || error.contains("超时")
    {
        "timeout"
    } else if lower.contains("429") || lower.contains("rate limit") || error.contains("限流") {
        "rate_limited"
    } else if lower.contains("llm request failed") || lower.starts_with("http_") {
        "http_error"
    } else if lower.contains("network")
        || lower.contains("request")
        || lower.contains("fetch")
        || lower.contains("connect")
    {
        "network"
    } else if lower.contains("empty")
        || lower.contains("without content")
        || lower.contains("did not contain")
        || error.contains("空")
        || error.contains("没有返回可用译文")
    {
        "empty_response"
    } else if lower.contains("json") || lower.contains("schema") {
        "invalid_json_or_schema"
    } else if error.contains("TEST_INCOMPLETE") || error.contains("逐句") || error.contains("公式")
    {
        "incomplete_translation"
    } else {
        "unknown"
    }
}

fn safe_identifier(value: &str, key: Option<&str>) -> String {
    let mut value = value.to_string();
    if let Some(key) = key.map(str::trim).filter(|key| !key.is_empty()) {
        value = value.replace(key, "[redacted]");
    }
    if value.len() > 160
        || !value
            .chars()
            .all(|c| c.is_alphanumeric() || "-_.:/[]".contains(c))
        || value.starts_with('/')
        || value.contains(":/")
    {
        return "[omitted]".into();
    }
    value
}

fn record(profile: &LlmProfile, stage: Stage, error: &str, details: Details) -> Value {
    let host = reqwest::Url::parse(&profile.base_url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_default();
    json!({"schema_version":1, "timestamp":Utc::now().to_rfc3339(), "app_version":env!("CARGO_PKG_VERSION"),
        "event_id":neuink_domain::EntryId::new().to_string(), "stage":stage, "error_code":code(error),
        "model":safe_identifier(&profile.model, profile.api_key.as_deref()),
        "service_host":safe_identifier(&host, profile.api_key.as_deref()), "protocol":profile.api_protocol,
        "configured_parameters":{"max_output_tokens":profile.max_output_tokens, "max_context_length":profile.max_context_length,
            "temperature":profile.temperature, "top_p":profile.top_p}, "details":details})
}

fn append(directory: &Path, value: &Value, limit: u64) -> std::io::Result<()> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    fs::create_dir_all(directory)?;
    let path = directory.join(FILE);
    let mut line = serde_json::to_vec(value)?;
    line.push(b'\n');
    if fs::metadata(&path).map(|m| m.len()).unwrap_or(0) + line.len() as u64 > limit {
        let oldest = directory.join(format!("{FILE}.{BACKUPS}"));
        if oldest.exists() {
            fs::remove_file(oldest)?;
        }
        for index in (1..BACKUPS).rev() {
            let from = directory.join(format!("{FILE}.{index}"));
            if from.exists() {
                fs::rename(from, directory.join(format!("{FILE}.{}", index + 1)))?;
            }
        }
        if path.exists() {
            fs::rename(&path, directory.join(format!("{FILE}.1")))?;
        }
    }
    let mut options = fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)?.write_all(&line)
}

pub fn failure(
    profile: &LlmProfile,
    stage: Stage,
    error: &str,
    mut details: Details,
) -> Result<(), String> {
    let directory = DIRECTORY.get().ok_or("翻译日志尚未初始化。")?;
    if details.http_status.is_none() {
        details.http_status = error
            .strip_prefix("HTTP_")
            .or_else(|| error.split("LLM request failed (").nth(1))
            .and_then(|s| s.get(..3))
            .and_then(|s| s.parse().ok());
    }
    append(
        directory,
        &record(profile, stage, error, details),
        MAX_BYTES,
    )
    .map_err(|_| "无法写入翻译日志，请检查数据目录权限及磁盘空间。".into())
}

pub(crate) fn best_effort(profile: &LlmProfile, stage: Stage, error: &str, details: Details) {
    if failure(profile, stage, error, details).is_err() && DIRECTORY.get().is_some() {
        eprintln!("NeuInk: translation diagnostic log unavailable");
    }
}

#[tauri::command]
pub fn log_translation_failure(
    profile: LlmProfile,
    stage: Stage,
    error_code: String,
    details: Details,
) -> Result<(), String> {
    failure(&profile, stage, &error_code, details)
}

#[tauri::command]
pub fn translation_log_directory() -> Result<PathBuf, String> {
    let path = DIRECTORY.get().ok_or("翻译日志尚未初始化。")?;
    fs::create_dir_all(path).map_err(|_| "无法创建翻译日志目录。")?;
    Ok(path.clone())
}

#[cfg(test)]
mod tests;
