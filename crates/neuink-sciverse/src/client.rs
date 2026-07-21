use std::{net::IpAddr, time::Duration};

use reqwest::{RequestBuilder, Response, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::{
    AgenticSearchRequest, AgenticSearchResponse, ContentRequest, ContentResponse,
    SciverseBinaryResource, SciverseError, SciverseResult,
};

pub const DEFAULT_SCIVERSE_BASE_URL: &str = "https://api.sciverse.space";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_ATTEMPTS: usize = 3;
const MAX_RESOURCE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct SciverseClient {
    base_url: Url,
    api_token: String,
    http: reqwest::Client,
}

impl SciverseClient {
    pub fn new(base_url: impl AsRef<str>, api_token: impl Into<String>) -> SciverseResult<Self> {
        let base_url_text = base_url.as_ref().trim().trim_end_matches('/');
        let base_url = Url::parse(&format!("{base_url_text}/"))
            .map_err(|_| SciverseError::InvalidBaseUrl(base_url_text.to_string()))?;
        if !matches!(base_url.scheme(), "http" | "https") {
            return Err(SciverseError::InvalidBaseUrl(base_url_text.to_string()));
        }
        let api_token = api_token.into().trim().to_string();
        if api_token.is_empty() {
            return Err(SciverseError::MissingApiToken);
        }
        let mut http_builder = reqwest::Client::builder().timeout(REQUEST_TIMEOUT);
        if is_loopback_url(&base_url) {
            http_builder = http_builder.no_proxy();
        }
        let http = http_builder.build()?;
        Ok(Self {
            base_url,
            api_token,
            http,
        })
    }

    pub async fn agentic_search(
        &self,
        request: &AgenticSearchRequest,
    ) -> SciverseResult<AgenticSearchResponse> {
        let query = request.query.trim();
        if query.is_empty() {
            return Err(SciverseError::Api {
                status: StatusCode::BAD_REQUEST,
                code: Some("INVALID_REQUEST".to_string()),
                message: "query is required".to_string(),
                request_id: None,
            });
        }
        if request.top_k == 0 || request.top_k > 100 {
            return Err(SciverseError::Api {
                status: StatusCode::BAD_REQUEST,
                code: Some("INVALID_REQUEST".to_string()),
                message: "top_k must be between 1 and 100".to_string(),
                request_id: None,
            });
        }

        self.send_json(|| {
            self.authorized(self.http.post(self.endpoint("agentic-search")))
                .json(request)
        })
        .await
    }

    pub async fn content(&self, request: &ContentRequest) -> SciverseResult<ContentResponse> {
        if request.doc_id.trim().is_empty() {
            return Err(SciverseError::Api {
                status: StatusCode::BAD_REQUEST,
                code: Some("INVALID_REQUEST".to_string()),
                message: "doc_id is required".to_string(),
                request_id: None,
            });
        }

        self.send_json(|| {
            let mut params = vec![("doc_id", request.doc_id.clone())];
            if let Some(offset) = request.offset {
                params.push(("offset", offset.to_string()));
            }
            if let Some(limit) = request.limit {
                params.push(("limit", limit.to_string()));
            }
            self.authorized(self.http.get(self.endpoint("content")))
                .query(&params)
        })
        .await
    }

    pub async fn meta_catalog(&self) -> SciverseResult<Value> {
        self.send_json(|| self.authorized(self.http.get(self.endpoint("meta-catalog"))))
            .await
    }

    pub async fn meta_search(&self, request: &Value) -> SciverseResult<Value> {
        self.send_json(|| {
            self.authorized(self.http.post(self.endpoint("meta-search")))
                .json(request)
        })
        .await
    }

    pub async fn meta_paper_relations(&self, request: &Value) -> SciverseResult<Value> {
        self.send_json(|| {
            self.authorized(self.http.post(self.endpoint("meta-paper-relations")))
                .json(request)
        })
        .await
    }

    pub async fn paper_schema(&self) -> SciverseResult<Value> {
        self.send_json(|| self.authorized(self.http.get(self.endpoint("paper-schema"))))
            .await
    }

    pub async fn paper_schema_search(&self, request: &Value) -> SciverseResult<Value> {
        self.send_json(|| {
            self.authorized(self.http.post(self.endpoint("paper-schema/search")))
                .json(request)
        })
        .await
    }

    pub async fn resource(
        &self,
        doc_id: &str,
        file_name: &str,
    ) -> SciverseResult<SciverseBinaryResource> {
        let doc_id = doc_id.trim();
        let file_name = file_name.trim();
        if doc_id.is_empty()
            || file_name.is_empty()
            || file_name.starts_with('/')
            || file_name.contains('\\')
            || file_name.split('/').any(|segment| segment == "..")
        {
            return Err(SciverseError::Api {
                status: StatusCode::BAD_REQUEST,
                code: Some("INVALID_REQUEST".to_string()),
                message: "resource requires doc_id and a safe relative file_name".to_string(),
                request_id: None,
            });
        }

        let mut response = self
            .send_response(|| {
                self.authorized(self.http.get(self.endpoint("resource")))
                    .query(&[("doc_id", doc_id), ("file_name", file_name)])
            })
            .await?;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(ToString::to_string);
        let content_disposition = response
            .headers()
            .get(reqwest::header::CONTENT_DISPOSITION)
            .and_then(|value| value.to_str().ok())
            .map(ToString::to_string);
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESOURCE_BYTES)
        {
            return Err(SciverseError::Api {
                status: StatusCode::PAYLOAD_TOO_LARGE,
                code: Some("RESOURCE_TOO_LARGE".to_string()),
                message: "Sciverse resource exceeds the 64 MB import limit".to_string(),
                request_id: None,
            });
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > MAX_RESOURCE_BYTES as usize {
                return Err(SciverseError::Api {
                    status: StatusCode::PAYLOAD_TOO_LARGE,
                    code: Some("RESOURCE_TOO_LARGE".to_string()),
                    message: "Sciverse resource exceeds the 64 MB import limit".to_string(),
                    request_id: None,
                });
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(SciverseBinaryResource {
            bytes,
            content_disposition,
            content_type,
        })
    }

    fn endpoint(&self, path: &str) -> Url {
        self.base_url
            .join(path.trim_start_matches('/'))
            .expect("validated base URL must accept relative endpoints")
    }

    fn authorized(&self, request: RequestBuilder) -> RequestBuilder {
        request.bearer_auth(&self.api_token)
    }

    async fn send_json<T, F>(&self, build: F) -> SciverseResult<T>
    where
        T: DeserializeOwned,
        F: Fn() -> RequestBuilder,
    {
        for attempt in 0..MAX_ATTEMPTS {
            let response = build().send().await?;
            if response.status().is_success() {
                return decode_success_response(response).await;
            }
            if retryable(response.status()) && attempt + 1 < MAX_ATTEMPTS {
                tokio::time::sleep(Duration::from_millis(200 * (1 << attempt))).await;
                continue;
            }
            return Err(api_error(response).await);
        }
        unreachable!("request loop always returns")
    }

    async fn send_response<F>(&self, build: F) -> SciverseResult<Response>
    where
        F: Fn() -> RequestBuilder,
    {
        for attempt in 0..MAX_ATTEMPTS {
            let response = build().send().await?;
            if response.status().is_success() {
                return Ok(response);
            }
            if retryable(response.status()) && attempt + 1 < MAX_ATTEMPTS {
                tokio::time::sleep(Duration::from_millis(200 * (1 << attempt))).await;
                continue;
            }
            return Err(api_error(response).await);
        }
        unreachable!("request loop always returns")
    }
}

fn is_loopback_url(url: &Url) -> bool {
    url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<IpAddr>()
                .is_ok_and(|address| address.is_loopback())
    })
}

async fn decode_success_response<T: DeserializeOwned>(response: Response) -> SciverseResult<T> {
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("unknown content type")
        .to_string();
    let body = response.bytes().await?;
    let mut deserializer = serde_json::Deserializer::from_slice(&body);
    serde_path_to_error::deserialize(&mut deserializer).map_err(|error| SciverseError::Decode {
        status,
        content_type,
        path: error.path().to_string(),
        message: error.inner().to_string(),
    })
}

fn retryable(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::INTERNAL_SERVER_ERROR
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    )
}

async fn api_error(response: Response) -> SciverseError {
    let status = response.status();
    let request_id = response
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.text().await.unwrap_or_default();
    let parsed = serde_json::from_str::<Value>(&body).ok();
    let code = parsed
        .as_ref()
        .and_then(|value| value.get("code").or_else(|| value.get("error_code")))
        .and_then(Value::as_str)
        .map(str::to_string);
    let message = parsed
        .as_ref()
        .and_then(|value| value.get("message").or_else(|| value.get("detail")))
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if body.trim().is_empty() {
                status
                    .canonical_reason()
                    .unwrap_or("request failed")
                    .to_string()
            } else {
                body.chars().take(500).collect()
            }
        });
    SciverseError::Api {
        status,
        code,
        message,
        request_id,
    }
}

#[cfg(test)]
mod tests {
    use wiremock::matchers::{body_json, header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    #[test]
    fn preserves_base_url_path_prefix() {
        let client = SciverseClient::new("https://example.com/api/v1", "test-token").unwrap();
        assert_eq!(
            client.endpoint("agentic-search").as_str(),
            "https://example.com/api/v1/agentic-search"
        );
    }

    #[tokio::test]
    async fn searches_with_bearer_auth_and_typed_results() {
        let server = MockServer::start().await;
        let request = AgenticSearchRequest::new("graphene battery stability");
        Mock::given(method("POST"))
            .and(path("/agentic-search"))
            .and(header("authorization", "Bearer test-token"))
            .and(body_json(&request))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "hits": [{
                    "chunk_id": "chunk-1",
                    "chunk": "Evidence text",
                    "doc_id": "doc-1",
                    "title": "Paper title",
                    "page_no": 4,
                    "score": 0.91,
                    "influential_citation_count": -1
                }]
            })))
            .mount(&server)
            .await;

        let client = SciverseClient::new(server.uri(), "test-token").unwrap();
        let response = client.agentic_search(&request).await.unwrap();

        assert_eq!(response.hits.len(), 1);
        assert_eq!(response.hits[0].doc_id, "doc-1");
        assert_eq!(response.hits[0].page_no, Some(4));
        assert_eq!(response.hits[0].influential_citation_count, None);
    }

    #[tokio::test]
    async fn reads_content_with_unicode_offsets() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/content"))
            .and(header("authorization", "Bearer test-token"))
            .and(query_param("doc_id", "doc-1"))
            .and(query_param("offset", "700"))
            .and(query_param("limit", "900"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "text": "next section",
                "chars_returned": 12,
                "next_offset": 712,
                "more": true
            })))
            .mount(&server)
            .await;

        let client = SciverseClient::new(server.uri(), "test-token").unwrap();
        let response = client
            .content(&ContentRequest {
                doc_id: "doc-1".to_string(),
                offset: Some(700),
                limit: Some(900),
            })
            .await
            .unwrap();

        assert_eq!(response.next_offset, 712);
        assert!(response.more);
    }

    #[tokio::test]
    async fn downloads_an_authorized_binary_resource() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/resource"))
            .and(header("authorization", "Bearer test-token"))
            .and(query_param("doc_id", "doc-1"))
            .and(query_param("file_name", "papers/doc-1.pdf"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "application/pdf")
                    .set_body_bytes(b"%PDF-1.7 test"),
            )
            .mount(&server)
            .await;

        let client = SciverseClient::new(server.uri(), "test-token").unwrap();
        let resource = client.resource("doc-1", "papers/doc-1.pdf").await.unwrap();

        assert_eq!(resource.content_type.as_deref(), Some("application/pdf"));
        assert_eq!(resource.bytes, b"%PDF-1.7 test");
    }

    #[tokio::test]
    async fn rejects_parent_directory_resource_paths_before_requesting() {
        let client = SciverseClient::new("https://example.com", "test-token").unwrap();
        let error = client.resource("doc-1", "../secret.pdf").await.unwrap_err();

        assert_eq!(error.status(), Some(StatusCode::BAD_REQUEST));
        assert_eq!(error.code(), Some("INVALID_REQUEST"));
    }

    #[tokio::test]
    async fn surfaces_api_errors_without_exposing_the_token() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/meta-catalog"))
            .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({
                "code": "UNAUTHORIZED",
                "message": "invalid credential"
            })))
            .mount(&server)
            .await;

        let client = SciverseClient::new(server.uri(), "secret-token").unwrap();
        let error = client.meta_catalog().await.unwrap_err();

        assert_eq!(error.status(), Some(StatusCode::UNAUTHORIZED));
        assert_eq!(error.code(), Some("UNAUTHORIZED"));
        assert!(!error.to_string().contains("secret-token"));
    }
}
