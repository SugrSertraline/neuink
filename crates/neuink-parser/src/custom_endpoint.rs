use std::{
    io::{Cursor, Read},
    path::Path,
    time::Duration,
};

use neuink_domain::NeuinkDocument;
use reqwest::{header::CONTENT_TYPE, multipart, RequestBuilder, StatusCode};
use serde_json::{json, Value};
use tokio::time::sleep;
use zip::ZipArchive;

use crate::{
    mineru_middle::enrich_document_with_middle, normalizer::normalize_parser_response, ParserError,
};

const TRANSIENT_HTTP_RETRY_DELAY: Duration = Duration::from_secs(2);
const TRANSIENT_HTTP_RETRY_ATTEMPTS: usize = 4;
const TASK_POLL_INTERVAL: Duration = Duration::from_secs(1);
const TASK_POLL_ATTEMPTS: usize = 900;
const PRIMARY_FILE_FIELD: &str = "files";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParseTask {
    pub task_id: String,
    pub state: ParseTaskState,
    pub message: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ParseTaskState {
    Queued,
    Parsing,
    Succeeded,
    Failed,
    Canceled,
    Unknown,
}

#[derive(Clone, Debug)]
pub struct CustomParseResult {
    pub document: NeuinkDocument,
    pub raw_response: Option<Value>,
    pub zip_bytes: Option<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub struct CustomEndpointParserProvider {
    endpoints: ParseEndpoints,
    client: reqwest::Client,
    api_key: Option<String>,
}

#[derive(Clone, Debug)]
struct ParseEndpoints {
    file_parse: String,
    tasks: String,
    prefer_tasks: bool,
}

impl CustomEndpointParserProvider {
    pub fn new(endpoint: impl Into<String>) -> Result<Self, ParserError> {
        Self::with_api_key(endpoint, None::<String>)
    }

    pub fn with_api_key(
        endpoint: impl Into<String>,
        api_key: Option<impl Into<String>>,
    ) -> Result<Self, ParserError> {
        Ok(Self {
            endpoints: normalize_parse_endpoints(endpoint.into()),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(900))
                .build()?,
            api_key: api_key
                .map(Into::into)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        })
    }

    pub async fn parse_pdf(&self, pdf_path: &Path) -> Result<NeuinkDocument, ParserError> {
        let file_name = pdf_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("paper.pdf")
            .to_string();
        let pdf_bytes = std::fs::read(pdf_path)?;

        let document = if self.endpoints.prefer_tasks {
            self.parse_with_tasks(PRIMARY_FILE_FIELD, file_name.clone(), pdf_bytes.clone())
                .await?
                .document
        } else {
            let value = self
                .send_parse_request(PRIMARY_FILE_FIELD, file_name.clone(), pdf_bytes.clone())
                .await?;
            normalize_parser_response(&value)?
        };
        Ok(document)
    }

    pub async fn submit_pdf_task(&self, pdf_path: &Path) -> Result<ParseTask, ParserError> {
        let file_name = pdf_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("paper.pdf")
            .to_string();
        let pdf_bytes = std::fs::read(pdf_path)?;
        self.submit_task_request(PRIMARY_FILE_FIELD, file_name, pdf_bytes)
            .await
    }

    pub async fn fetch_task_status(&self, task_id: &str) -> Result<ParseTask, ParserError> {
        let value = self.task_status(task_id).await?;
        Ok(parse_task_from_value(task_id, &value))
    }

    pub async fn fetch_task_result(&self, task_id: &str) -> Result<NeuinkDocument, ParserError> {
        let result = self.fetch_task_result_with_raw(task_id).await?;
        Ok(result.document)
    }

    pub async fn fetch_task_result_with_raw(
        &self,
        task_id: &str,
    ) -> Result<CustomParseResult, ParserError> {
        let result_url = format!("{}/{}/result", self.endpoints.tasks, task_id);
        let response = self.authorized(self.client.get(&result_url)).send().await?;

        if response.status() == StatusCode::ACCEPTED {
            return Err(ParserError::TaskTimeout);
        }

        if response.status().is_success() {
            let result = parse_task_result_response(response).await?;
            return self.attach_download_artifacts(task_id, result).await;
        }

        if matches!(
            response.status(),
            StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED
        ) {
            let download_response = self
                .authorized(
                    self.client
                        .get(format!("{}/{}/download", self.endpoints.tasks, task_id)),
                )
                .send()
                .await?;
            if download_response.status() == StatusCode::ACCEPTED {
                return Err(ParserError::TaskTimeout);
            }
            return parse_task_result_response(download_response).await;
        }

        let raw_response = response_json_or_status_error(response).await?;
        let document = normalize_parser_response(&raw_response)?;
        Ok(CustomParseResult {
            document,
            raw_response: Some(raw_response),
            zip_bytes: None,
        })
    }

    async fn attach_download_artifacts(
        &self,
        task_id: &str,
        mut result: CustomParseResult,
    ) -> Result<CustomParseResult, ParserError> {
        if result.zip_bytes.is_some() {
            return Ok(result);
        }

        let response = self
            .authorized(
                self.client
                    .get(format!("{}/{}/download", self.endpoints.tasks, task_id)),
            )
            .send()
            .await?;
        if response.status().is_success() && response_is_zip(&response) {
            result.zip_bytes = Some(response.bytes().await?.to_vec());
        }
        Ok(result)
    }

    pub async fn fetch_task_failure_message(
        &self,
        task_id: &str,
    ) -> Result<Option<String>, ParserError> {
        let response = self
            .authorized(
                self.client
                    .get(format!("{}/{}/result", self.endpoints.tasks, task_id)),
            )
            .send()
            .await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let trimmed = body.trim();

        if trimmed.is_empty() {
            return Ok(Some(format!(
                "MinerU result endpoint returned HTTP {status} without an error body"
            )));
        }

        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            return Ok(task_message_optional_from_value(&value)
                .or_else(|| Some(compact_json_message(&value))));
        }

        Ok(Some(trim_message(trimmed)))
    }

    async fn send_parse_request(
        &self,
        file_field: &str,
        file_name: String,
        pdf_bytes: Vec<u8>,
    ) -> Result<Value, ParserError> {
        let response = self
            .post_multipart_request(
                &self.endpoints.file_parse,
                file_field,
                file_name.clone(),
                pdf_bytes.clone(),
                false,
            )
            .await?;
        if response.status().is_success() {
            if response_is_zip(&response) {
                return parse_task_result_response(response)
                    .await
                    .and_then(parser_value_from_custom_result);
            }
            return Ok(response.json::<Value>().await?);
        }

        if response.status() == StatusCode::CONFLICT {
            let body = response.text().await.unwrap_or_default();
            if let Some(task_id) = task_id_from_body(&body) {
                return parser_value_from_custom_result(self.wait_for_task_result(&task_id).await?);
            }
            return self
                .parse_with_tasks(file_field, file_name, pdf_bytes)
                .await
                .and_then(parser_value_from_custom_result);
        }

        if matches!(
            response.status(),
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY
        ) {
            let Some(fallback_file_field) = fallback_file_field(file_field) else {
                return response_json_or_status_error(response).await;
            };
            let fallback = self
                .post_multipart_request(
                    &self.endpoints.file_parse,
                    fallback_file_field,
                    file_name,
                    pdf_bytes,
                    false,
                )
                .await?;
            if fallback.status().is_success() && response_is_zip(&fallback) {
                return parse_task_result_response(fallback)
                    .await
                    .and_then(parser_value_from_custom_result);
            }
            return response_json_or_status_error(fallback).await;
        }

        response_json_or_status_error(response).await
    }

    async fn parse_with_tasks(
        &self,
        file_field: &str,
        file_name: String,
        pdf_bytes: Vec<u8>,
    ) -> Result<CustomParseResult, ParserError> {
        let response = self
            .post_multipart_request(
                &self.endpoints.tasks,
                file_field,
                file_name.clone(),
                pdf_bytes.clone(),
                false,
            )
            .await?;

        if matches!(
            response.status(),
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY
        ) {
            let Some(fallback_file_field) = fallback_file_field(file_field) else {
                return self.task_submission_result(response).await;
            };
            let fallback = self
                .post_multipart_request(
                    &self.endpoints.tasks,
                    fallback_file_field,
                    file_name,
                    pdf_bytes,
                    false,
                )
                .await?;
            return self.task_submission_result(fallback).await;
        }

        self.task_submission_result(response).await
    }

    async fn submit_task_request(
        &self,
        file_field: &str,
        file_name: String,
        pdf_bytes: Vec<u8>,
    ) -> Result<ParseTask, ParserError> {
        let submit_endpoint = if self.endpoints.prefer_tasks {
            &self.endpoints.tasks
        } else {
            &self.endpoints.file_parse
        };
        let response = self
            .post_multipart_request(
                submit_endpoint,
                file_field,
                file_name.clone(),
                pdf_bytes.clone(),
                true,
            )
            .await?;

        if matches!(
            response.status(),
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY
        ) {
            let Some(fallback_file_field) = fallback_file_field(file_field) else {
                return self.submitted_task_from_response(response).await;
            };
            let fallback = self
                .post_multipart_request(
                    submit_endpoint,
                    fallback_file_field,
                    file_name,
                    pdf_bytes,
                    true,
                )
                .await?;
            return self.submitted_task_from_response(fallback).await;
        }

        self.submitted_task_from_response(response).await
    }

    async fn submitted_task_from_response(
        &self,
        response: reqwest::Response,
    ) -> Result<ParseTask, ParserError> {
        if response.status() == StatusCode::CONFLICT {
            let status = response.status();
            let url = response.url().to_string();
            let body = response.text().await.unwrap_or_default();
            if let Some(task_id) = task_id_from_body(&body) {
                return Ok(ParseTask {
                    task_id,
                    state: ParseTaskState::Parsing,
                    message: message_from_body(&body),
                });
            }
            return Err(ParserError::HttpStatus {
                status,
                url,
                body: status_body_suffix(&body),
            });
        }

        let value = response_json_or_status_error(response).await?;
        let task_id = task_id_from_value(&value).ok_or_else(|| {
            ParserError::InvalidResponse("task submission returned no task_id".to_string())
        })?;
        Ok(parse_task_from_value(&task_id, &value))
    }

    async fn task_submission_result(
        &self,
        response: reqwest::Response,
    ) -> Result<CustomParseResult, ParserError> {
        if response.status() == StatusCode::CONFLICT {
            let status = response.status();
            let url = response.url().to_string();
            let body = response.text().await.unwrap_or_default();
            if let Some(task_id) = task_id_from_body(&body) {
                return self.wait_for_task_result(&task_id).await;
            }
            return Err(ParserError::HttpStatus {
                status,
                url,
                body: status_body_suffix(&body),
            });
        }

        let value = response_json_or_status_error(response).await?;
        if let Some(task_id) = task_id_from_value(&value) {
            return self.wait_for_task_result(&task_id).await;
        }
        let document = normalize_parser_response(&value)?;
        Ok(CustomParseResult {
            document,
            raw_response: Some(value),
            zip_bytes: None,
        })
    }

    async fn wait_for_task_result(&self, task_id: &str) -> Result<CustomParseResult, ParserError> {
        for _ in 0..TASK_POLL_ATTEMPTS {
            let status_value = self.task_status(task_id).await?;
            match task_state_from_value(&status_value).as_deref() {
                Some("completed" | "complete" | "succeeded" | "success" | "done" | "finished") => {
                    return self.task_result(task_id).await;
                }
                Some("failed" | "failure" | "error" | "cancelled" | "canceled") => {
                    return Err(ParserError::TaskFailed(task_message_from_value(
                        &status_value,
                    )));
                }
                Some(
                    "created" | "queued" | "pending" | "submitted" | "started" | "running"
                    | "processing" | "in-progress" | "uploading" | "working",
                ) => {
                    if let Some(result) = self.try_task_result(task_id).await? {
                        return Ok(result);
                    }
                    sleep(TASK_POLL_INTERVAL).await;
                }
                _ => {
                    if let Some(result) = inline_task_result(&status_value) {
                        let document = normalize_parser_response(result)?;
                        return Ok(CustomParseResult {
                            document,
                            raw_response: Some(result.clone()),
                            zip_bytes: None,
                        });
                    }
                    if let Some(result) = self.try_task_result(task_id).await? {
                        return Ok(result);
                    }
                    sleep(TASK_POLL_INTERVAL).await;
                }
            }
        }

        Err(ParserError::TaskTimeout)
    }

    async fn task_status(&self, task_id: &str) -> Result<Value, ParserError> {
        let response = self
            .authorized(
                self.client
                    .get(format!("{}/{}", self.endpoints.tasks, task_id)),
            )
            .send()
            .await?;
        response_json_or_status_error(response).await
    }

    async fn task_result(&self, task_id: &str) -> Result<CustomParseResult, ParserError> {
        let response = self
            .authorized(
                self.client
                    .get(format!("{}/{}/result", self.endpoints.tasks, task_id)),
            )
            .send()
            .await?;
        parse_task_result_response(response).await
    }

    async fn try_task_result(
        &self,
        task_id: &str,
    ) -> Result<Option<CustomParseResult>, ParserError> {
        let response = self
            .authorized(
                self.client
                    .get(format!("{}/{}/result", self.endpoints.tasks, task_id)),
            )
            .send()
            .await?;
        if response.status() == StatusCode::ACCEPTED {
            return Ok(None);
        }
        if response.status().is_success() && response_is_zip(&response) {
            return parse_task_result_response(response).await.map(Some);
        }
        if response.status().is_success() {
            return parse_task_result_response(response).await.map(Some);
        }
        if matches!(
            response.status(),
            StatusCode::ACCEPTED
                | StatusCode::NOT_FOUND
                | StatusCode::CONFLICT
                | StatusCode::TOO_EARLY
                | StatusCode::SERVICE_UNAVAILABLE
        ) {
            return Ok(None);
        }
        let raw_response = response_json_or_status_error(response).await?;
        let document = normalize_parser_response(&raw_response)?;
        Ok(Some(CustomParseResult {
            document,
            raw_response: Some(raw_response),
            zip_bytes: None,
        }))
    }

    async fn post_multipart_request(
        &self,
        endpoint: &str,
        file_field: &str,
        file_name: String,
        pdf_bytes: Vec<u8>,
        prefer_zip_response: bool,
    ) -> Result<reqwest::Response, ParserError> {
        for attempt in 0..TRANSIENT_HTTP_RETRY_ATTEMPTS {
            let pdf_part = multipart::Part::bytes(pdf_bytes.clone())
                .file_name(file_name.clone())
                .mime_str("application/pdf")?;
            let form = mineru_parse_form(file_field, pdf_part, prefer_zip_response);
            let response = self
                .authorized(self.client.post(endpoint).multipart(form))
                .send()
                .await?;

            if is_transient_gateway_status(response.status())
                && attempt + 1 < TRANSIENT_HTTP_RETRY_ATTEMPTS
            {
                sleep(TRANSIENT_HTTP_RETRY_DELAY * (attempt + 1) as u32).await;
                continue;
            }

            return Ok(response);
        }

        unreachable!("transient HTTP retry loop must return a response")
    }

    fn authorized(&self, request: RequestBuilder) -> RequestBuilder {
        match &self.api_key {
            Some(api_key) => request.header("X-API-Key", api_key),
            None => request,
        }
    }
}

async fn parse_task_result_response(
    response: reqwest::Response,
) -> Result<CustomParseResult, ParserError> {
    if response.status().is_success() && response_is_zip(&response) {
        let zip_bytes = response.bytes().await?.to_vec();
        let document = normalize_mineru_zip(&zip_bytes)?;
        return Ok(CustomParseResult {
            document,
            raw_response: None,
            zip_bytes: Some(zip_bytes),
        });
    }

    let raw_response = response_json_or_status_error(response).await?;
    let document = normalize_parser_response(&raw_response)?;
    Ok(CustomParseResult {
        document,
        raw_response: Some(raw_response),
        zip_bytes: None,
    })
}

fn parser_value_from_custom_result(result: CustomParseResult) -> Result<Value, ParserError> {
    result
        .raw_response
        .or_else(|| serde_json::to_value(result.document).ok())
        .ok_or_else(|| {
            ParserError::InvalidResponse("parser result could not be converted to JSON".to_string())
        })
}

fn mineru_parse_form(
    file_field: &str,
    pdf_part: multipart::Part,
    prefer_zip_response: bool,
) -> multipart::Form {
    multipart::Form::new()
        .part(file_field.to_string(), pdf_part)
        .text("lang_list", "ch")
        .text("backend", "hybrid-engine")
        .text("effort", "high")
        .text("parse_method", "auto")
        .text("formula_enable", "true")
        .text("table_enable", "true")
        .text("image_analysis", "true")
        .text("return_content_list", "true")
        .text("return_content_list_v2", "true")
        .text("return_md", "true")
        .text("return_middle_json", "true")
        .text("return_model_output", "true")
        .text("return_images", "true")
        .text(
            "response_format_zip",
            if prefer_zip_response { "true" } else { "false" },
        )
        .text(
            "return_original_file",
            if prefer_zip_response { "true" } else { "false" },
        )
        .text("client_side_output_generation", "false")
        .text("start_page_id", "0")
        .text("end_page_id", "99999")
}

fn response_is_zip(response: &reqwest::Response) -> bool {
    response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            let lower = value.to_ascii_lowercase();
            lower.contains("application/zip") || lower.contains("application/octet-stream")
        })
        .unwrap_or(false)
}

fn normalize_mineru_zip(zip_bytes: &[u8]) -> Result<NeuinkDocument, ParserError> {
    let mut archive = ZipArchive::new(Cursor::new(zip_bytes))?;
    let names = (0..archive.len())
        .filter_map(|index| {
            archive
                .by_index(index)
                .ok()
                .map(|file| file.name().to_string())
        })
        .collect::<Vec<_>>();

    for suffix in ["_content_list_v2.json", "_content_list.json"] {
        for name in names.iter().filter(|name| name.ends_with(suffix)) {
            let mut file = archive.by_name(name)?;
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            let value = serde_json::from_str::<Value>(&content)?;
            let wrapped = if name.ends_with("_content_list_v2.json") {
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

fn is_transient_gateway_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::BAD_GATEWAY | StatusCode::SERVICE_UNAVAILABLE | StatusCode::GATEWAY_TIMEOUT
    )
}

async fn response_json_or_status_error(response: reqwest::Response) -> Result<Value, ParserError> {
    if response.status().is_success() {
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        if !content_type
            .to_ascii_lowercase()
            .contains("application/json")
        {
            return Err(ParserError::NonJsonResponse {
                url: response.url().to_string(),
                content_type: if content_type.is_empty() {
                    "unknown".to_string()
                } else {
                    content_type
                },
            });
        }
        return Ok(response.json::<Value>().await?);
    }

    let status = response.status();
    let url = response.url().to_string();
    let body = response.text().await.unwrap_or_default();

    Err(ParserError::HttpStatus {
        status,
        url,
        body: status_body_suffix(&body),
    })
}

fn normalize_parse_endpoints(endpoint: String) -> ParseEndpoints {
    let trimmed = endpoint.trim().trim_end_matches('/').to_string();
    if let Some(base) = trimmed.strip_suffix("/docs") {
        return endpoints_from_base(base, true);
    }
    if let Some(base) = trimmed.strip_suffix("/file_parse") {
        return endpoints_from_base(base, true);
    }
    if let Some(base) = trimmed.strip_suffix("/tasks") {
        return endpoints_from_base(base, true);
    }
    endpoints_from_base(&trimmed, true)
}

fn endpoints_from_base(base: &str, prefer_tasks: bool) -> ParseEndpoints {
    ParseEndpoints {
        file_parse: format!("{base}/file_parse"),
        tasks: format!("{base}/tasks"),
        prefer_tasks,
    }
}

fn fallback_file_field(file_field: &str) -> Option<&'static str> {
    match file_field {
        "file" => Some("files"),
        "files" => Some("file"),
        _ => None,
    }
}

fn task_id_from_body(body: &str) -> Option<String> {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| task_id_from_value(&value))
}

fn message_from_body(body: &str) -> Option<String> {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| task_message_optional_from_value(&value))
}

fn parse_task_from_value(fallback_task_id: &str, value: &Value) -> ParseTask {
    ParseTask {
        task_id: task_id_from_value(value).unwrap_or_else(|| fallback_task_id.to_string()),
        state: parse_task_state_from_value(value),
        message: task_message_optional_from_value(value),
    }
}

fn task_id_from_value(value: &Value) -> Option<String> {
    find_string_key(value, &["task_id", "taskId", "task"]).or_else(|| {
        let object = value.as_object()?;
        object
            .get("id")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .or_else(|| object.get("data").and_then(task_id_from_value))
            .or_else(|| object.get("result").and_then(task_id_from_value))
    })
}

fn parse_task_state_from_value(value: &Value) -> ParseTaskState {
    match task_state_from_value(value).as_deref() {
        Some("completed" | "complete" | "succeeded" | "success" | "done" | "finished") => {
            ParseTaskState::Succeeded
        }
        Some("failed" | "failure" | "error") => ParseTaskState::Failed,
        Some("cancelled" | "canceled") => ParseTaskState::Canceled,
        Some("created" | "queued" | "pending" | "submitted") => ParseTaskState::Queued,
        Some(
            "started" | "running" | "processing" | "in-progress" | "uploading" | "working"
            | "parsing",
        ) => ParseTaskState::Parsing,
        _ => ParseTaskState::Unknown,
    }
}

fn task_state_from_value(value: &Value) -> Option<String> {
    find_string_key(value, &["status", "state"])
        .map(|state| state.trim().to_ascii_lowercase().replace('_', "-"))
}

fn task_message_from_value(value: &Value) -> String {
    task_message_optional_from_value(value).unwrap_or_else(|| value.to_string())
}

fn task_message_optional_from_value(value: &Value) -> Option<String> {
    find_message_value(
        value,
        &[
            "message",
            "error",
            "detail",
            "reason",
            "exception",
            "traceback",
        ],
    )
    .map(|message| trim_message(&message))
    .filter(|message| {
        let trimmed = message.trim();
        !trimmed.is_empty() && trimmed != "null"
    })
}

fn inline_task_result(value: &Value) -> Option<&Value> {
    let object = value.as_object()?;
    object
        .get("result")
        .or_else(|| object.get("data"))
        .or_else(|| object.get("results"))
        .filter(|nested| nested.is_object() || nested.is_array())
}

fn find_string_key(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    for key in keys {
        if let Some(text) = object.get(*key).and_then(Value::as_str) {
            if !text.trim().is_empty() {
                return Some(text.to_string());
            }
        }
    }
    for key in ["data", "result", "task"] {
        if let Some(nested) = object
            .get(key)
            .and_then(|nested| find_string_key(nested, keys))
        {
            return Some(nested);
        }
    }
    None
}

fn find_message_value(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    for key in keys {
        if let Some(message) = object.get(*key).and_then(message_value_to_string) {
            return Some(message);
        }
    }
    for key in ["data", "result", "task"] {
        if let Some(nested) = object
            .get(key)
            .and_then(|nested| find_message_value(nested, keys))
        {
            return Some(nested);
        }
    }
    None
}

fn message_value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let message = items
                .iter()
                .filter_map(|item| {
                    item.as_str()
                        .map(ToString::to_string)
                        .or_else(|| {
                            find_message_value(item, &["message", "error", "detail", "msg"])
                        })
                        .or_else(|| Some(compact_json_message(item)))
                })
                .collect::<Vec<_>>()
                .join("\n");
            Some(message)
        }
        Value::Object(_) => find_message_value(value, &["message", "error", "detail", "msg"])
            .or_else(|| Some(compact_json_message(value))),
        Value::Null => None,
        _ => Some(value.to_string()),
    }
}

fn compact_json_message(value: &Value) -> String {
    trim_message(&value.to_string())
}

fn trim_message(message: &str) -> String {
    let trimmed = message.trim();
    trimmed.chars().take(1200).collect()
}

fn status_body_suffix(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let excerpt = trim_message(trimmed);
    format!(": {excerpt}")
}
