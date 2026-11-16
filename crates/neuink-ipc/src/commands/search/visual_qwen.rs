//! Qwen3-VL-Embedding-2B behind a local HTTP service.
//!
//! The model is a 4 GB PyTorch/transformers checkpoint, so it cannot live inside this
//! process; it runs as a local service the user downloads and starts. This provider is
//! the second implementation of `VisualEmbeddingProvider`, interchangeable with the
//! bundled ONNX encoder: same trait, same index, different model identity.
//!
//! Protocol (one JSON object per request):
//! ```text
//! GET  {endpoint}/health  -> {"ready":true,"model":"…","dimensions":2048,"identity":"…"}
//! POST {endpoint}/embed   <- {"texts":["…"],"images":["<base64>"]}
//!                         -> {"vectors":[[float,…],…]}   # texts first, then images
//! ```
//! Any deviation is a fixed, path-free error; nothing here retries silently.

use std::sync::OnceLock;
use std::time::Duration;

use base64::Engine;
use neuink_search::{
    SearchError, SearchResult, VisualAssetInput, VisualEmbeddingProvider, VisualPageEmbedding,
    VisualPageVector, VisualProviderStatus,
};
use serde::Deserialize;

const PROVIDER_NAME: &str = "qwen-service";

#[derive(Clone, Debug, Deserialize)]
struct Health {
    #[serde(default)]
    ready: bool,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    dimensions: Option<usize>,
    #[serde(default)]
    identity: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EmbedResponse {
    vectors: Vec<Vec<f32>>,
}

#[derive(Debug, Deserialize)]
struct PageVectorResponse {
    page: u32,
    #[serde(default)]
    region: Option<u32>,
    vector: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct EmbedPagesResponse {
    vectors: Vec<PageVectorResponse>,
}

pub struct QwenVisualServiceProvider {
    endpoint: String,
    client: reqwest::blocking::Client,
    api_key: Option<String>,
    /// Only a local service can read a local PDF path.
    allow_pages: bool,
    health: OnceLock<Option<Health>>,
    status: VisualProviderStatus,
}

impl QwenVisualServiceProvider {
    /// A service the user runs locally: loopback, no credential, and no HTTP proxy.
    ///
    /// A configured `HTTP_PROXY` would otherwise turn a loopback request into a proxy
    /// error, so the local client opts out of proxying entirely.
    pub fn from_local(endpoint: impl Into<String>, timeout: Duration) -> Self {
        Self::build(endpoint.into(), timeout, None, true)
    }

    /// The same model behind a remote API: bearer token, proxy allowed.
    pub fn from_api(endpoint: impl Into<String>, api_key: String, timeout: Duration) -> Self {
        Self::build(endpoint.into(), timeout, Some(api_key), false)
    }

    fn build(
        endpoint: String,
        timeout: Duration,
        api_key: Option<String>,
        loopback_only: bool,
    ) -> Self {
        let endpoint = endpoint.trim_end_matches('/').to_string();
        let mut builder = reqwest::blocking::Client::builder().timeout(timeout);
        if loopback_only {
            builder = builder.no_proxy();
        }
        let client = match builder.build() {
            Ok(client) => client,
            Err(error) => {
                return Self {
                    endpoint,
                    client: reqwest::blocking::Client::new(),
                    api_key,
                    allow_pages: loopback_only,
                    health: OnceLock::from(None),
                    status: VisualProviderStatus::unavailable(
                        PROVIDER_NAME,
                        format!("视觉编码服务客户端创建失败：{error}"),
                    ),
                }
            }
        };
        let health = probe(&client, &endpoint, api_key.as_deref());
        let status = match &health {
            Some(health) if health.ready && health.dimensions.is_some() && health.identity.is_some() => {
                VisualProviderStatus {
                    available: true,
                    provider: PROVIDER_NAME.to_string(),
                    model_name: health.model.clone(),
                    dimensions: health.dimensions,
                    message: Some("Qwen 视觉编码服务已就绪。".to_string()),
                }
            }
            Some(_) => VisualProviderStatus::unavailable(
                PROVIDER_NAME,
                "视觉编码服务已响应，但未声明维度或内容身份。".to_string(),
            ),
            None => VisualProviderStatus::unavailable(
                PROVIDER_NAME,
                "视觉编码服务不可达。".to_string(),
            ),
        };
        Self {
            endpoint,
            client,
            api_key,
            allow_pages: loopback_only,
            health: OnceLock::from(health),
            status,
        }
    }

    fn health(&self) -> Option<&Health> {
        self.health.get().and_then(Option::as_ref)
    }

    fn require_available(&self) -> SearchResult<()> {
        if self.status.available {
            return Ok(());
        }
        Err(SearchError::EmbeddingUnavailable(
            self.status
                .message
                .clone()
                .unwrap_or_else(|| "视觉编码服务不可用。".to_string()),
        ))
    }

    fn embed_request(
        &self,
        texts: &[String],
        images: &[String],
    ) -> SearchResult<Vec<Vec<f32>>> {        self.require_available()?;
        let body = serde_json::json!({ "texts": texts, "images": images });
        let mut request = self.client.post(format!("{}/embed", self.endpoint)).json(&body);
        if let Some(key) = self.api_key.as_deref() {
            request = request.bearer_auth(key);
        }
        let response = request
            .send()
            .map_err(|error| SearchError::EmbeddingUnavailable(format!("视觉编码请求失败：{error}")))?;
        if !response.status().is_success() {
            return Err(SearchError::EmbeddingUnavailable(format!(
                "视觉编码服务返回状态 {}",
                response.status().as_u16()
            )));
        }
        let parsed = response
            .json::<EmbedResponse>()
            .map_err(|error| SearchError::EmbeddingUnavailable(format!("视觉编码响应无法解析：{error}")))?;
        let expected = texts.len() + images.len();
        if parsed.vectors.len() != expected {
            return Err(SearchError::EmbeddingUnavailable(format!(
                "视觉编码服务返回 {} 个向量，期望 {expected} 个",
                parsed.vectors.len()
            )));
        }
        if let Some(dimensions) = self.status.dimensions {
            if let Some(bad) = parsed
                .vectors
                .iter()
                .find(|vector| vector.len() != dimensions)
            {
                return Err(SearchError::VectorDimensionMismatch {
                    expected: dimensions,
                    actual: bad.len(),
                });
            }
        }
        if parsed
            .vectors
            .iter()
            .any(|vector| vector.iter().any(|value| !value.is_finite()))
        {
            return Err(SearchError::EmbeddingUnavailable(
                "视觉编码服务返回了非有限向量".to_string(),
            ));
        }
        Ok(parsed.vectors)
    }
}

impl VisualEmbeddingProvider for QwenVisualServiceProvider {
    fn status(&self) -> VisualProviderStatus {
        self.status.clone()
    }

    fn identity(&self) -> Option<String> {
        self.health().and_then(|health| health.identity.clone())
    }

    fn dimensions(&self) -> Option<usize> {
        self.status.dimensions
    }

    fn embed_assets(
        &self,
        assets: &[VisualAssetInput],
        on_progress: &dyn Fn(usize, usize),
    ) -> SearchResult<Vec<Vec<f32>>> {
        if assets.is_empty() {
            on_progress(0, 0);
            return Ok(Vec::new());
        }
        let mut vectors = Vec::with_capacity(assets.len());
        for batch in assets.chunks(4) {
            let images = batch
                .iter()
                .map(|asset| base64::engine::general_purpose::STANDARD.encode(&asset.bytes))
                .collect::<Vec<_>>();
            let mut embedded = self.embed_request(&[], &images)?;
            vectors.append(&mut embedded);
            on_progress(vectors.len(), assets.len());
        }
        Ok(vectors)
    }

    fn embed_query_text(&self, text: &str) -> SearchResult<Vec<f32>> {
        let mut vectors = self.embed_request(&[text.to_string()], &[])?;
        vectors.pop().ok_or_else(|| {
            SearchError::EmbeddingUnavailable("视觉编码服务未返回查询向量".to_string())
        })
    }

    fn page_source(&self) -> Option<&dyn VisualPageEmbedding> {
        self.allow_pages.then_some(self as &dyn VisualPageEmbedding)
    }
}

/// Pages per request. Four pages is twenty sources with crops: enough to amortise the
/// request, small enough to stay well inside the client timeout on CPU-only inference.
const PAGE_REQUEST_CHUNK: usize = 4;

impl VisualPageEmbedding for QwenVisualServiceProvider {
    fn embed_pdf_pages(
        &self,
        pdf_path: &std::path::Path,
        pages: &[u32],
        regions: bool,
    ) -> SearchResult<Vec<VisualPageVector>> {
        if !self.allow_pages {
            return Err(SearchError::EmbeddingUnavailable(
                "远程视觉编码 API 无法读取本地 PDF".to_string(),
            ));
        }
        self.require_available()?;
        if pages.is_empty() {
            return Err(SearchError::EmbeddingUnavailable(
                "视觉编码未收到任何页码".to_string(),
            ));
        }
        // The service renders and encodes every requested page, so one request covering a
        // whole paper can outlive the client timeout. Chunking keeps each request bounded.
        let mut vectors = Vec::with_capacity(pages.len() * if regions { 5 } else { 1 });
        for chunk in pages.chunks(PAGE_REQUEST_CHUNK) {
            vectors.extend(self.embed_pages_once(pdf_path, chunk, regions)?);
        }
        Ok(vectors)
    }
}

impl QwenVisualServiceProvider {
    /// One bounded request: asks the service for exactly these pages and validates that
    /// what came back matches the request, rather than trusting the response shape.
    fn embed_pages_once(
        &self,
        pdf_path: &std::path::Path,
        pages: &[u32],
        regions: bool,
    ) -> SearchResult<Vec<VisualPageVector>> {
        let body = serde_json::json!({
            "pdf_path": pdf_path.to_string_lossy(),
            "pages": pages,
            "regions": regions,
        });
        let mut request = self
            .client
            .post(format!("{}/embed_pages", self.endpoint))
            .json(&body);
        if let Some(key) = self.api_key.as_deref() {
            request = request.bearer_auth(key);
        }
        let response = request.send().map_err(|error| {
            SearchError::EmbeddingUnavailable(format!("视觉分页编码请求失败：{error}"))
        })?;
        if !response.status().is_success() {
            return Err(SearchError::EmbeddingUnavailable(format!(
                "视觉分页编码服务返回状态 {}",
                response.status().as_u16()
            )));
        }
        let parsed = response.json::<EmbedPagesResponse>().map_err(|error| {
            SearchError::EmbeddingUnavailable(format!("视觉分页编码响应无法解析：{error}"))
        })?;
        let expected = pages.len() * if regions { 5 } else { 1 };
        if parsed.vectors.len() != expected {
            return Err(SearchError::EmbeddingUnavailable(format!(
                "视觉分页编码返回 {} 个向量，期望 {expected} 个",
                parsed.vectors.len()
            )));
        }
        let dimensions = self.status.dimensions;
        let mut vectors = Vec::with_capacity(parsed.vectors.len());
        for item in parsed.vectors {
            if let Some(expected_dimensions) = dimensions {
                if item.vector.len() != expected_dimensions {
                    return Err(SearchError::VectorDimensionMismatch {
                        expected: expected_dimensions,
                        actual: item.vector.len(),
                    });
                }
            }
            if item.vector.iter().any(|value| !value.is_finite()) {
                return Err(SearchError::EmbeddingUnavailable(
                    "视觉分页编码返回了非有限向量".to_string(),
                ));
            }
            if !pages.contains(&item.page) {
                return Err(SearchError::EmbeddingUnavailable(
                    "视觉分页编码返回了未请求的页码".to_string(),
                ));
            }
            vectors.push(VisualPageVector {
                page_idx: item.page,
                region: item.region,
                vector: item.vector,
            });
        }
        Ok(vectors)
    }
}

fn probe(
    client: &reqwest::blocking::Client,
    endpoint: &str,
    api_key: Option<&str>,
) -> Option<Health> {
    let mut request = client.get(format!("{endpoint}/health"));
    if let Some(key) = api_key {
        request = request.bearer_auth(key);
    }
    let response = match request.send() {
        Ok(response) => response,
        Err(error) => {
            if cfg!(test) {
                eprintln!("visual probe send failed: {error}");
            }
            return None;
        }
    };
    let response = match response.error_for_status() {
        Ok(response) => response,
        Err(error) => {
            if cfg!(test) {
                eprintln!("visual probe status failed: {error}");
            }
            return None;
        }
    };
    match response.json::<Health>() {
        Ok(health) => Some(health),
        Err(error) => {
            if cfg!(test) {
                eprintln!("visual probe json failed: {error}");
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::thread;

    use super::*;

    fn spawn_server(
        health: &'static str,
        embed: &'static str,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = format!("http://{}", listener.local_addr().expect("addr"));
        let handle = thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut reader = BufReader::new(stream.try_clone().expect("clone"));
                let mut request_line = String::new();
                if reader.read_line(&mut request_line).is_err() {
                    break;
                }
                // Consume headers; the body is small and this fake reads only routing.
                loop {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => break,
                        Ok(_) if line == "\r\n" => break,
                        Ok(_) => {}
                        Err(_) => break,
                    }
                }
                let body = if request_line.contains("/health") {
                    health
                } else {
                    embed
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        (address, handle)
    }

    const HEALTH: &str = r#"{"ready":true,"model":"paired","dimensions":3,"identity":"identity-1"}"#;

    #[test]
    fn a_ready_service_reports_identity_dimensions_and_encodes_both_sides() {
        // One canned vector per request: this fake does not parse the body, so each test
        // case asks for exactly one input.
        let (endpoint, _handle) = spawn_server(HEALTH, r#"{"vectors":[[1,0,0]]}"#);
        let provider = QwenVisualServiceProvider::from_local(endpoint, Duration::from_secs(5));
        assert_eq!(provider.status().provider, "qwen-service");
        assert!(
            provider.status().available,
            "unexpected status: {:?}",
            provider.status().message
        );
        assert_eq!(provider.dimensions(), Some(3));
        assert_eq!(provider.identity().as_deref(), Some("identity-1"));

        let query = provider.embed_query_text("question").expect("query");
        assert_eq!(query, vec![1.0, 0.0, 0.0]);
        let assets = provider
            .embed_assets(
                &[VisualAssetInput {
                    id: "a".to_string(),
                    bytes: b"img".to_vec(),
                }],
                &|_, _| {},
            )
            .expect("assets");
        assert_eq!(assets.len(), 1);
    }

    #[test]
    fn a_service_without_identity_is_unavailable_and_refuses_to_encode() {
        let (endpoint, _handle) = spawn_server(r#"{"ready":true,"dimensions":3}"#, r#"{"vectors":[]}"#);
        let provider = QwenVisualServiceProvider::from_local(endpoint, Duration::from_secs(5));
        assert!(!provider.status().available);
        assert!(provider.identity().is_none());
        assert!(provider.embed_query_text("q").is_err());
    }

    #[test]
    fn an_unreachable_service_degrades_instead_of_failing_later() {
        let provider =
            QwenVisualServiceProvider::from_local("http://127.0.0.1:9", Duration::from_millis(200));
        assert!(!provider.status().available);
        assert_eq!(
            provider.status().message.as_deref(),
            Some("视觉编码服务不可达。")
        );
        assert!(matches!(
            provider.embed_query_text("q"),
            Err(SearchError::EmbeddingUnavailable(_))
        ));
    }

    #[test]
    fn a_vector_count_mismatch_is_rejected() {
        let (endpoint, _handle) = spawn_server(HEALTH, r#"{"vectors":[[1,0,0]]}"#);
        let provider = QwenVisualServiceProvider::from_local(endpoint, Duration::from_secs(5));
        let error = provider
            .embed_assets(
                &[
                    VisualAssetInput {
                        id: "a".to_string(),
                        bytes: b"a".to_vec(),
                    },
                    VisualAssetInput {
                        id: "b".to_string(),
                        bytes: b"b".to_vec(),
                    },
                ],
                &|_, _| {},
            )
            .expect_err("count mismatch");
        assert!(matches!(error, SearchError::EmbeddingUnavailable(_)));
    }
}
