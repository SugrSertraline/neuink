//! OpenAI-compatible embedding API behind `EmbeddingProvider`.
//!
//! Why a second implementation: the local ONNX path requires the user to have weights on
//! disk, and not every machine can hold a 500 MB encoder. The retrieval pipeline only needs
//! `EmbeddingProvider`, so the remote transport is a settings change, not a second code
//! path: same trait, same vector store, same identity rules, same degradation vocabulary.
//!
//! Protocol (one JSON object per request, OpenAI-compatible):
//! ```text
//! POST {endpoint}/embeddings
//!   <- {"model":"<model>","input":["text", ...]}
//!   -> {"data":[{"embedding":[float,...],"index":0}, ...]}
//! ```
//! Any deviation is a fixed, path-free error; nothing here retries silently.

use std::time::Duration;

use serde::Deserialize;

use crate::{
    EmbeddingInput, EmbeddingProvider, EmbeddingProviderStatus, EmbeddingVector, SearchError,
    SearchResult,
};

const PROVIDER_NAME: &str = "openai-compatible";
/// One request never carries more than this many inputs, so a 2 000-segment rebuild stays a
/// bounded sequence of requests instead of one oversized body.
const BATCH_SIZE: usize = 32;

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    #[serde(default)]
    data: Vec<EmbeddingDatum>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingDatum {
    #[serde(default)]
    embedding: Vec<f32>,
    #[serde(default)]
    index: Option<usize>,
}

pub struct RemoteEmbeddingProvider {
    endpoint: String,
    client: reqwest::blocking::Client,
    api_key: Option<String>,
    model: String,
    dimensions: usize,
    timeout_ms: u64,
}

impl RemoteEmbeddingProvider {
    /// Builds a provider for `{endpoint}/embeddings`. The URL may already name the endpoint.
    pub fn new(
        endpoint: impl Into<String>,
        api_key: Option<String>,
        model: impl Into<String>,
        dimensions: usize,
        timeout_ms: u64,
    ) -> SearchResult<Self> {
        let endpoint = normalize_endpoint(&endpoint.into());
        if endpoint.is_empty() {
            return Err(SearchError::EmbeddingUnavailable(
                "未配置嵌入 API 地址".to_string(),
            ));
        }
        let model: String = model.into();
        if model.trim().is_empty() {
            return Err(SearchError::EmbeddingUnavailable(
                "未配置嵌入 API 模型名称".to_string(),
            ));
        }
        if dimensions == 0 {
            return Err(SearchError::EmbeddingUnavailable(
                "嵌入 API 需要声明向量维度".to_string(),
            ));
        }
        let model = model.trim().to_string();
        let mut builder =
            reqwest::blocking::Client::builder().timeout(Duration::from_millis(timeout_ms.max(1)));
        // A loopback endpoint must not be routed through an HTTP proxy; a remote one may.
        if is_loopback_url(&endpoint) {
            builder = builder.no_proxy();
        }
        let client = builder.build().map_err(|error| {
            SearchError::EmbeddingUnavailable(format!("嵌入 API 客户端创建失败：{error}"))
        })?;
        Ok(Self {
            endpoint,
            client,
            api_key: api_key.filter(|key| !key.trim().is_empty()),
            model,
            dimensions,
            timeout_ms: timeout_ms.max(1),
        })
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    pub fn dimensions(&self) -> usize {
        self.dimensions
    }

    pub fn timeout_ms(&self) -> u64 {
        self.timeout_ms
    }

    fn embeddings_url(&self) -> String {
        if self.endpoint.ends_with("/embeddings") {
            self.endpoint.clone()
        } else {
            format!("{}/embeddings", self.endpoint)
        }
    }

    fn request_once(&self, texts: &[String]) -> SearchResult<Vec<Vec<f32>>> {
        let body = serde_json::json!({ "model": self.model, "input": texts });
        let mut request = self.client.post(self.embeddings_url()).json(&body);
        if let Some(key) = self.api_key.as_deref() {
            request = request.bearer_auth(key);
        }
        let response = request.send().map_err(|error| {
            SearchError::EmbeddingUnavailable(format!("嵌入 API 请求失败：{error}"))
        })?;
        if !response.status().is_success() {
            return Err(SearchError::EmbeddingUnavailable(format!(
                "嵌入 API 返回状态 {}",
                response.status().as_u16()
            )));
        }
        let parsed = response.json::<EmbeddingResponse>().map_err(|error| {
            SearchError::EmbeddingUnavailable(format!("嵌入 API 响应无法解析：{error}"))
        })?;
        let mut data = parsed.data;
        if data.len() != texts.len() {
            return Err(SearchError::EmbeddingUnavailable(format!(
                "嵌入 API 返回 {} 个向量，期望 {} 个",
                data.len(),
                texts.len()
            )));
        }
        // `index` is optional in practice; when present it restores the input order.
        if data.iter().enumerate().all(|(position, item)| {
            item.index.map(|index| index == position).unwrap_or(true)
        }) {
            // Already in order.
        } else {
            data.sort_by_key(|item| item.index);
        }
        for vector in &data {
            if vector.embedding.len() != self.dimensions {
                return Err(SearchError::VectorDimensionMismatch {
                    expected: self.dimensions,
                    actual: vector.embedding.len(),
                });
            }
            if vector.embedding.iter().any(|value| !value.is_finite()) {
                return Err(SearchError::EmbeddingUnavailable(
                    "嵌入 API 返回了非有限向量".to_string(),
                ));
            }
        }
        Ok(data.into_iter().map(|item| item.embedding).collect())
    }
}

impl EmbeddingProvider for RemoteEmbeddingProvider {
    fn status(&self) -> EmbeddingProviderStatus {
        EmbeddingProviderStatus {
            available: true,
            provider: PROVIDER_NAME.to_string(),
            model_name: Some(self.model.clone()),
            model_path: None,
            dimensions: Some(self.dimensions),
            message: Some(format!("远程嵌入 API：{}", self.endpoint)),
        }
    }

    fn prefixes(&self) -> crate::EmbeddingPrefixes {
        if self.model.to_ascii_lowercase().contains("e5") {
            crate::EmbeddingPrefixes::e5_default()
        } else {
            crate::EmbeddingPrefixes::none()
        }
    }

    /// For a remote model the immutable facts we can observe are its declared identity and
    /// output width. The endpoint stays out of the hash on purpose: two gateways serving the
    /// same model produce compatible vectors, and switching gateway should not re-embed the
    /// library.
    fn cache_identity(&self) -> Option<String> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"neuink-openai-compatible-embedding-v1");
        hasher.update(&(self.model.len() as u64).to_le_bytes());
        hasher.update(self.model.as_bytes());
        hasher.update(&(self.dimensions as u64).to_le_bytes());
        Some(hasher.finalize().to_hex().to_string())
    }

    fn embed(&self, inputs: &[EmbeddingInput]) -> SearchResult<Vec<EmbeddingVector>> {
        let mut vectors = Vec::with_capacity(inputs.len());
        for batch in inputs.chunks(BATCH_SIZE) {
            let texts = batch
                .iter()
                .map(|input| input.text.clone())
                .collect::<Vec<_>>();
            let embedded = self.request_once(&texts)?;
            vectors.extend(embedded.into_iter().map(EmbeddingVector::new));
        }
        Ok(vectors)
    }

    fn embed_with_progress(
        &self,
        inputs: &[EmbeddingInput],
        on_progress: &dyn Fn(usize, usize),
    ) -> SearchResult<Vec<EmbeddingVector>> {
        let total = inputs.len();
        let mut vectors = Vec::with_capacity(total);
        for batch in inputs.chunks(BATCH_SIZE) {
            let texts = batch
                .iter()
                .map(|input| input.text.clone())
                .collect::<Vec<_>>();
            let embedded = self.request_once(&texts)?;
            vectors.extend(embedded.into_iter().map(EmbeddingVector::new));
            on_progress(vectors.len(), total);
        }
        Ok(vectors)
    }
}

fn normalize_endpoint(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    trimmed.to_string()
}

fn is_loopback_url(url: &str) -> bool {
    let without_scheme = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url);
    let authority = without_scheme.split('/').next().unwrap_or(without_scheme);
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    let host = if let Some(rest) = host_port.strip_prefix('[') {
        rest.split(']').next().unwrap_or(rest)
    } else {
        host_port.split(':').next().unwrap_or(host_port)
    };
    matches!(
        host.to_ascii_lowercase().as_str(),
        "127.0.0.1" | "localhost" | "::1"
    )
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use super::*;

    /// Serves exactly one HTTP response and returns the request body it received.
    fn serve_once(
        status_line: &'static str,
        body: &'static str,
    ) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let endpoint = format!("http://{}/v1", listener.local_addr().expect("addr"));
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 4096];
            // Read headers plus the body declared by Content-Length.
            loop {
                let read = stream.read(&mut chunk).expect("read");
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
                let text = String::from_utf8_lossy(&buffer);
                if let Some(split) = text.find("\r\n\r\n") {
                    let headers = &text[..split];
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|value| value.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    if buffer.len() >= split + 4 + length {
                        break;
                    }
                }
            }
            let request_text = String::from_utf8_lossy(&buffer).to_string();
            let response = format!(
                "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).expect("write");
            request_text
        });
        (endpoint, handle)
    }

    #[test]
    fn embeds_texts_through_an_openai_compatible_endpoint() {
        let (endpoint, server) = serve_once(
            "200 OK",
            r#"{"data":[{"embedding":[0.1,0.2,0.3],"index":0},{"embedding":[0.4,0.5,0.6],"index":1}]}"#,
        );
        let provider = RemoteEmbeddingProvider::new(
            endpoint,
            Some("secret".to_string()),
            "some-model",
            3,
            5_000,
        )
        .expect("provider");
        let vectors = provider
            .embed(&[
                EmbeddingInput {
                    id: "a".to_string(),
                    text: "first".to_string(),
                },
                EmbeddingInput {
                    id: "b".to_string(),
                    text: "second".to_string(),
                },
            ])
            .expect("embed");
        let request = server.join().expect("join");
        assert_eq!(vectors.len(), 2);
        assert_eq!(vectors[0].dimensions(), 3);
        assert_eq!(vectors[1].values, vec![0.4, 0.5, 0.6]);
        assert!(request.contains("\"model\":\"some-model\""));
        assert!(request.contains("first"));
        assert_eq!(
            provider.status().model_name.as_deref(),
            Some("some-model")
        );
        assert_eq!(provider.status().dimensions, Some(3));
        assert!(provider.cache_identity().is_some());
    }

    #[test]
    fn an_endpoint_named_embeddings_is_used_as_is() {
        let (endpoint, server) = serve_once("200 OK", r#"{"data":[{"embedding":[1.0],"index":0}]}"#);
        let provider =
            RemoteEmbeddingProvider::new(format!("{endpoint}/embeddings/"), None, "m", 1, 5_000)
                .expect("provider");
        provider
            .embed(&[EmbeddingInput {
                id: "a".to_string(),
                text: "x".to_string(),
            }])
            .expect("embed");
        let request = server.join().expect("join");
        assert!(request.starts_with("POST /v1/embeddings "));
        assert!(!request.starts_with("POST /v1/embeddings//"));
    }

    #[test]
    fn a_dimension_mismatch_is_a_fixed_error() {
        let (endpoint, server) = serve_once("200 OK", r#"{"data":[{"embedding":[1.0,2.0],"index":0}]}"#);
        let provider =
            RemoteEmbeddingProvider::new(endpoint, None, "m", 3, 5_000).expect("provider");
        let error = provider
            .embed(&[EmbeddingInput {
                id: "a".to_string(),
                text: "x".to_string(),
            }])
            .expect_err("must reject");
        let _ = server.join();
        assert!(matches!(
            error,
            SearchError::VectorDimensionMismatch {
                expected: 3,
                actual: 2
            }
        ));
    }

    #[test]
    fn a_count_mismatch_and_an_error_status_are_rejected() {
        let (endpoint, server) = serve_once("200 OK", r#"{"data":[]}"#);
        let provider =
            RemoteEmbeddingProvider::new(endpoint, None, "m", 3, 5_000).expect("provider");
        let error = provider
            .embed(&[EmbeddingInput {
                id: "a".to_string(),
                text: "x".to_string(),
            }])
            .expect_err("must reject");
        let _ = server.join();
        assert!(matches!(error, SearchError::EmbeddingUnavailable(_)));

        let (endpoint, server) = serve_once("500 Internal Server Error", "{}");
        let provider =
            RemoteEmbeddingProvider::new(endpoint, None, "m", 3, 5_000).expect("provider");
        let error = provider
            .embed(&[EmbeddingInput {
                id: "a".to_string(),
                text: "x".to_string(),
            }])
            .expect_err("must reject");
        let _ = server.join();
        assert!(matches!(error, SearchError::EmbeddingUnavailable(_)));
    }

    #[test]
    fn an_empty_endpoint_or_model_is_rejected_at_construction() {
        assert!(RemoteEmbeddingProvider::new("", None, "m", 3, 1_000).is_err());
        assert!(RemoteEmbeddingProvider::new("http://127.0.0.1:1/v1", None, "  ", 3, 1_000).is_err());
        assert!(RemoteEmbeddingProvider::new("http://127.0.0.1:1/v1", None, "m", 0, 1_000).is_err());
    }
}
