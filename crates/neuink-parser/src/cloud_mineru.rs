use std::{
    collections::HashMap,
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE, Engine};
use hmac::{Hmac, Mac};
use neuink_domain::NeuinkDocument;
use reqwest::multipart;
use serde::Serialize;
use serde_json::{json, Value};
use sha1::Sha1;
use zip::ZipArchive;

use crate::{
    custom_endpoint::{ParseTask, ParseTaskState},
    mineru_middle::enrich_document_with_middle,
    normalizer::normalize_parser_response,
    ParserError,
};

type HmacSha1 = Hmac<Sha1>;

const DEFAULT_MINERU_BASE_URL: &str = "https://mineru.net/api/v4";
const DEFAULT_QINIU_KEY_PREFIX: &str = "neuink/mineru";
const DEFAULT_UPLOAD_TOKEN_TTL_SECONDS: u64 = 3600;
const APP_CONFIG_DIR_NAME: &str = "com.neuink.workspace";

#[derive(Clone, Debug)]
pub struct MineruQiniuParserProvider {
    client: reqwest::Client,
    config: MineruQiniuConfig,
}

#[derive(Clone, Debug)]
pub struct MineruQiniuTaskResult {
    pub document: NeuinkDocument,
    pub full_zip_url: String,
    pub zip_bytes: Vec<u8>,
}

#[derive(Clone, Debug)]
struct MineruQiniuConfig {
    mineru_token: String,
    mineru_base_url: String,
    mineru_model_version: String,
    mineru_is_ocr: Option<bool>,
    mineru_enable_formula: Option<bool>,
    mineru_enable_table: Option<bool>,
    mineru_language: Option<String>,
    mineru_extra_formats: Vec<String>,
    mineru_no_cache: Option<bool>,
    mineru_page_ranges: Option<String>,
    qiniu_access_key: String,
    qiniu_secret_key: String,
    qiniu_bucket: String,
    qiniu_upload_host: String,
    qiniu_public_base_url: String,
    qiniu_key_prefix: String,
    qiniu_upload_token_ttl_seconds: u64,
}

#[derive(Debug, Serialize)]
struct QiniuPutPolicy {
    scope: String,
    deadline: u64,
}

#[derive(Debug, Serialize)]
struct MineruCreateTaskRequest {
    url: String,
    model_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_ocr: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    enable_formula: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    enable_table: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_id: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    extra_formats: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_ranges: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    no_cache: Option<bool>,
}

impl MineruQiniuParserProvider {
    pub fn from_env() -> Result<Self, ParserError> {
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(900))
                .build()?,
            config: MineruQiniuConfig::from_env()?,
        })
    }

    pub async fn submit_pdf_task(
        &self,
        pdf_path: &Path,
        data_id: &str,
    ) -> Result<ParseTask, ParserError> {
        let sanitized_data_id = sanitize_data_id(data_id);
        let pdf_url = self
            .upload_pdf_to_qiniu(pdf_path, &sanitized_data_id)
            .await?;
        let payload = MineruCreateTaskRequest {
            url: pdf_url.clone(),
            model_version: self.config.mineru_model_version.clone(),
            is_ocr: self.config.mineru_is_ocr,
            enable_formula: self.config.mineru_enable_formula,
            enable_table: self.config.mineru_enable_table,
            language: self.config.mineru_language.clone(),
            data_id: Some(sanitized_data_id),
            extra_formats: self.config.mineru_extra_formats.clone(),
            page_ranges: self.config.mineru_page_ranges.clone(),
            no_cache: self.config.mineru_no_cache,
        };

        let value = self
            .client
            .post(self.extract_task_url())
            .bearer_auth(&self.config.mineru_token)
            .json(&payload)
            .send()
            .await?
            .json::<Value>()
            .await?;
        let data = mineru_api_data(&value)?;
        let task_id = data
            .get("task_id")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                ParserError::InvalidResponse("MinerU task response returned no task_id".to_string())
            })?
            .to_string();

        Ok(ParseTask {
            task_id,
            state: ParseTaskState::Queued,
            message: Some(format!("uploaded to Qiniu: {pdf_url}")),
        })
    }

    pub async fn fetch_task_status(&self, task_id: &str) -> Result<ParseTask, ParserError> {
        let value = self.fetch_task_status_value(task_id).await?;
        let data = mineru_api_data(&value)?;
        Ok(ParseTask {
            task_id: data
                .get("task_id")
                .and_then(Value::as_str)
                .unwrap_or(task_id)
                .to_string(),
            state: parse_mineru_task_state(data),
            message: mineru_task_message(data),
        })
    }

    pub async fn fetch_task_result(
        &self,
        task_id: &str,
    ) -> Result<MineruQiniuTaskResult, ParserError> {
        let value = self.fetch_task_status_value(task_id).await?;
        let data = mineru_api_data(&value)?;
        if parse_mineru_task_state(data) != ParseTaskState::Succeeded {
            return Err(ParserError::TaskFailed(
                mineru_task_message(data).unwrap_or_else(|| "MinerU task is not done".to_string()),
            ));
        }

        let full_zip_url = data
            .get("full_zip_url")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                ParserError::InvalidResponse(
                    "MinerU completed task returned no full_zip_url".to_string(),
                )
            })?
            .to_string();
        let zip_bytes = self
            .client
            .get(&full_zip_url)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?
            .to_vec();
        let document = normalize_mineru_zip(&zip_bytes)?;

        Ok(MineruQiniuTaskResult {
            document,
            full_zip_url,
            zip_bytes,
        })
    }

    async fn upload_pdf_to_qiniu(
        &self,
        pdf_path: &Path,
        data_id: &str,
    ) -> Result<String, ParserError> {
        let pdf_bytes = fs::read(pdf_path)?;
        let file_name = pdf_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("paper.pdf");
        let key = self.qiniu_object_key(data_id);
        let upload_token = self.qiniu_upload_token(&key)?;
        let pdf_part = multipart::Part::bytes(pdf_bytes)
            .file_name(file_name.to_string())
            .mime_str("application/pdf")?;
        let form = multipart::Form::new()
            .text("token", upload_token)
            .text("key", key.clone())
            .part("file", pdf_part);

        let response = self
            .client
            .post(&self.config.qiniu_upload_host)
            .multipart(form)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let url = response.url().to_string();
            let body = response.text().await.unwrap_or_default();
            return Err(ParserError::HttpStatus {
                status,
                url,
                body: status_body_suffix(&body),
            });
        }

        Ok(format!(
            "{}/{}",
            self.config.qiniu_public_base_url.trim_end_matches('/'),
            key
        ))
    }

    fn qiniu_upload_token(&self, key: &str) -> Result<String, ParserError> {
        let deadline = unix_timestamp_seconds() + self.config.qiniu_upload_token_ttl_seconds;
        let policy = QiniuPutPolicy {
            scope: format!("{}:{key}", self.config.qiniu_bucket),
            deadline,
        };
        let encoded_policy = URL_SAFE.encode(serde_json::to_vec(&policy)?);
        let mut mac =
            HmacSha1::new_from_slice(self.config.qiniu_secret_key.as_bytes()).map_err(|_| {
                ParserError::InvalidConfig("QINIU_SECRET_KEY is not a valid HMAC key".to_string())
            })?;
        mac.update(encoded_policy.as_bytes());
        let encoded_sign = URL_SAFE.encode(mac.finalize().into_bytes());
        Ok(format!(
            "{}:{encoded_sign}:{encoded_policy}",
            self.config.qiniu_access_key
        ))
    }

    fn qiniu_object_key(&self, data_id: &str) -> String {
        let timestamp = unix_timestamp_seconds();
        format!(
            "{}/{data_id}/{timestamp}.pdf",
            self.config.qiniu_key_prefix.trim_matches('/')
        )
    }

    async fn fetch_task_status_value(&self, task_id: &str) -> Result<Value, ParserError> {
        Ok(self
            .client
            .get(self.extract_task_status_url(task_id))
            .bearer_auth(&self.config.mineru_token)
            .send()
            .await?
            .json::<Value>()
            .await?)
    }

    fn extract_task_url(&self) -> String {
        format!(
            "{}/extract/task",
            self.config.mineru_base_url.trim_end_matches('/')
        )
    }

    fn extract_task_status_url(&self, task_id: &str) -> String {
        format!("{}/{}", self.extract_task_url(), task_id)
    }
}

impl MineruQiniuConfig {
    fn from_env() -> Result<Self, ParserError> {
        let env_file = EnvFile::load();
        Ok(Self {
            mineru_token: required_config("MINERU_API_TOKEN", &env_file)?,
            mineru_base_url: optional_config("MINERU_API_BASE_URL", &env_file)
                .unwrap_or_else(|| DEFAULT_MINERU_BASE_URL.to_string()),
            mineru_model_version: optional_config("MINERU_MODEL_VERSION", &env_file)
                .unwrap_or_else(|| "vlm".to_string()),
            mineru_is_ocr: optional_bool_config("MINERU_IS_OCR", &env_file)?,
            mineru_enable_formula: optional_bool_config("MINERU_ENABLE_FORMULA", &env_file)?,
            mineru_enable_table: optional_bool_config("MINERU_ENABLE_TABLE", &env_file)?,
            mineru_language: optional_config("MINERU_LANGUAGE", &env_file),
            mineru_extra_formats: optional_config("MINERU_EXTRA_FORMATS", &env_file)
                .map(|value| parse_csv(&value))
                .unwrap_or_default(),
            mineru_no_cache: optional_bool_config("MINERU_NO_CACHE", &env_file)?,
            mineru_page_ranges: optional_config("MINERU_PAGE_RANGES", &env_file),
            qiniu_access_key: required_config("QINIU_ACCESS_KEY", &env_file)?,
            qiniu_secret_key: required_config("QINIU_SECRET_KEY", &env_file)?,
            qiniu_bucket: required_config("QINIU_BUCKET", &env_file)?,
            qiniu_upload_host: required_config("QINIU_UPLOAD_HOST", &env_file)?,
            qiniu_public_base_url: required_config("QINIU_PUBLIC_BASE_URL", &env_file)?,
            qiniu_key_prefix: optional_config("QINIU_KEY_PREFIX", &env_file)
                .unwrap_or_else(|| DEFAULT_QINIU_KEY_PREFIX.to_string()),
            qiniu_upload_token_ttl_seconds: optional_config(
                "QINIU_UPLOAD_TOKEN_TTL_SECONDS",
                &env_file,
            )
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(DEFAULT_UPLOAD_TOKEN_TTL_SECONDS),
        })
    }
}

#[derive(Default)]
struct EnvFile {
    values: HashMap<String, String>,
}

impl EnvFile {
    fn load() -> Self {
        let Some(path) = find_env_file() else {
            return Self::default();
        };
        let Ok(content) = fs::read_to_string(path) else {
            return Self::default();
        };
        Self {
            values: parse_env_file(&content),
        }
    }
}

fn required_config(key: &str, env_file: &EnvFile) -> Result<String, ParserError> {
    optional_config(key, env_file).ok_or_else(|| {
        ParserError::InvalidConfig(format!(
            "{key} is required for the MinerU + Qiniu fallback parser"
        ))
    })
}

fn optional_config(key: &str, env_file: &EnvFile) -> Option<String> {
    std::env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            env_file
                .values
                .get(key)
                .cloned()
                .filter(|value| !value.trim().is_empty())
        })
}

fn optional_bool_config(key: &str, env_file: &EnvFile) -> Result<Option<bool>, ParserError> {
    optional_config(key, env_file)
        .map(|value| parse_bool_config(key, &value))
        .transpose()
}

fn parse_bool_config(key: &str, value: &str) -> Result<bool, ParserError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "y" | "on" => Ok(true),
        "0" | "false" | "no" | "n" | "off" => Ok(false),
        _ => Err(ParserError::InvalidConfig(format!(
            "{key} must be true or false"
        ))),
    }
}

fn find_env_file() -> Option<PathBuf> {
    for candidate in env_file_candidates() {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn env_file_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(mut current) = std::env::current_dir() {
        loop {
            candidates.push(current.join(".env"));
            if !current.pop() {
                break;
            }
        }
    }

    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.join(".env"));
        }
    }

    if let Some(appdata) = std::env::var_os("APPDATA") {
        let app_dir = PathBuf::from(appdata).join(APP_CONFIG_DIR_NAME);
        candidates.push(app_dir.join(".env"));
        candidates.push(app_dir.join("config").join(".env"));
        candidates.push(app_dir.join("dev-library").join(".env"));
    }

    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".neuink").join(".env"));
        candidates.push(home.join(".config").join(APP_CONFIG_DIR_NAME).join(".env"));
    }

    candidates
}

fn parse_env_file(content: &str) -> HashMap<String, String> {
    content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }
            let (key, value) = trimmed.split_once('=')?;
            Some((
                key.trim().to_string(),
                value
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string(),
            ))
        })
        .collect()
}

fn parse_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn mineru_api_data(value: &Value) -> Result<&Value, ParserError> {
    if value.get("code").and_then(Value::as_i64).unwrap_or(0) != 0 {
        return Err(ParserError::TaskFailed(
            value
                .get("msg")
                .and_then(Value::as_str)
                .unwrap_or("MinerU API returned a non-zero code")
                .to_string(),
        ));
    }
    value
        .get("data")
        .ok_or_else(|| ParserError::InvalidResponse("MinerU API response has no data".to_string()))
}

fn parse_mineru_task_state(data: &Value) -> ParseTaskState {
    match data
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "done" | "completed" | "complete" | "succeeded" | "success" => ParseTaskState::Succeeded,
        "failed" | "failure" | "error" => ParseTaskState::Failed,
        "canceled" | "cancelled" => ParseTaskState::Canceled,
        "pending" | "queued" => ParseTaskState::Queued,
        "running" | "converting" | "parsing" | "processing" => ParseTaskState::Parsing,
        _ => ParseTaskState::Unknown,
    }
}

fn mineru_task_message(data: &Value) -> Option<String> {
    if let Some(err_msg) = data
        .get("err_msg")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        return Some(err_msg.to_string());
    }
    if let Some(progress) = data.get("extract_progress") {
        let extracted = progress
            .get("extracted_pages")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let total = progress
            .get("total_pages")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        return Some(format!("running: {extracted}/{total} pages"));
    }
    data.get("full_zip_url")
        .and_then(Value::as_str)
        .map(|url| format!("full_zip_url: {url}"))
}

pub fn normalize_mineru_zip(zip_bytes: &[u8]) -> Result<NeuinkDocument, ParserError> {
    let mut archive = ZipArchive::new(Cursor::new(zip_bytes))?;
    let names = (0..archive.len())
        .filter_map(|index| {
            archive
                .by_index(index)
                .ok()
                .map(|file| file.name().to_string())
        })
        .collect::<Vec<_>>();

    for matcher in [is_content_list_v2_file, is_content_list_file] {
        for name in names.iter().filter(|name| matcher(name)) {
            let mut file = archive.by_name(name)?;
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            let value = serde_json::from_str::<Value>(&content)?;
            let wrapped = if is_content_list_v2_file(name) {
                json!({ "content_list_v2": value })
            } else {
                json!({ "content_list": value })
            };
            let mut document = normalize_parser_response(&wrapped)?;
            drop(file);
            enrich_from_middle_file(&mut archive, &names, &mut document)?;
            return Ok(document);
        }
    }

    Err(ParserError::MissingContentList)
}

fn enrich_from_middle_file(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    names: &[String],
    document: &mut NeuinkDocument,
) -> Result<(), ParserError> {
    let Some(name) = names.iter().find(|name| name.ends_with("_middle.json")) else {
        return Ok(());
    };
    let mut file = archive.by_name(name)?;
    let mut content = String::new();
    file.read_to_string(&mut content)?;
    let middle = serde_json::from_str::<Value>(&content)?;
    enrich_document_with_middle(document, &middle);
    Ok(())
}

fn is_content_list_v2_file(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.ends_with("_content_list_v2.json") || name.ends_with("content_list_v2.json")
}

fn is_content_list_file(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    !is_content_list_v2_file(&name)
        && (name.ends_with("_content_list.json") || name.ends_with("content_list.json"))
}

fn sanitize_data_id(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "neuink-entry".to_string()
    } else {
        trimmed.chars().take(128).collect()
    }
}

fn unix_timestamp_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(DEFAULT_UPLOAD_TOKEN_TTL_SECONDS)
}

fn status_body_suffix(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let excerpt = trimmed.chars().take(1200).collect::<String>();
    format!(": {excerpt}")
}

#[cfg(test)]
mod tests {
    use super::{parse_env_file, sanitize_data_id, MineruQiniuConfig, MineruQiniuParserProvider};

    #[test]
    fn parses_env_lines() {
        let env = parse_env_file(
            r#"
            # comment
            MINERU_API_TOKEN="abc"
            QINIU_BUCKET=test
            "#,
        );

        assert_eq!(env.get("MINERU_API_TOKEN").unwrap(), "abc");
        assert_eq!(env.get("QINIU_BUCKET").unwrap(), "test");
    }

    #[test]
    fn sanitizes_data_id() {
        assert_eq!(sanitize_data_id("entry/abc"), "entry-abc");
    }

    #[test]
    fn qiniu_upload_token_uses_padded_url_safe_base64() {
        let provider = MineruQiniuParserProvider {
            client: reqwest::Client::new(),
            config: MineruQiniuConfig {
                mineru_token: "mineru-token".to_string(),
                mineru_base_url: "https://mineru.net/api/v4".to_string(),
                mineru_model_version: "vlm".to_string(),
                mineru_is_ocr: None,
                mineru_enable_formula: None,
                mineru_enable_table: None,
                mineru_language: None,
                mineru_extra_formats: Vec::new(),
                mineru_no_cache: None,
                mineru_page_ranges: None,
                qiniu_access_key: "access-key".to_string(),
                qiniu_secret_key: "secret-key".to_string(),
                qiniu_bucket: "bucket".to_string(),
                qiniu_upload_host: "https://up-z2.qiniup.com".to_string(),
                qiniu_public_base_url: "https://cdn.example.test".to_string(),
                qiniu_key_prefix: "neuink".to_string(),
                qiniu_upload_token_ttl_seconds: 3600,
            },
        };

        let token = provider.qiniu_upload_token("neuink/test.pdf").unwrap();
        let parts = token.split(':').collect::<Vec<_>>();

        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "access-key");
        assert!(parts[1].ends_with('='));
        assert!(parts[2].ends_with('='));
    }
}
