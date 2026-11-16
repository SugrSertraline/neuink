//! Reranker over HTTP, for hosts that would rather call a hosted API than ship ONNX.
//!
//! Jina and Cohere both expose a rerank endpoint with the same request shape
//! (`model`, `query`, `documents`, optional `top_n`) and return `results[]` entries carrying
//! `index` and `relevance_score`, so one adapter covers both. The product keeps its own
//! ordering rules: scores are validated to be exactly one per document, finite, and matched
//! back by index.

use neuink_config::RemoteApiStyle;

use crate::reranking::{RerankError, RerankProvider, RerankResult, RerankScore};

/// Documented endpoints, offered as defaults in the settings screen.
pub const JINA_RERANK_ENDPOINT: &str = "https://api.jina.ai/v1/rerank";
pub const COHERE_RERANK_ENDPOINT: &str = "https://api.cohere.com/v2/rerank";
pub const JINA_RERANK_MODEL: &str = "jina-reranker-v2-base-multilingual";
pub const COHERE_RERANK_MODEL: &str = "rerank-v3.5";
/// Alibaba Model Studio (DashScope) native rerank endpoint and model.
pub const DASHSCOPE_RERANK_ENDPOINT: &str =
    "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank";
pub const DASHSCOPE_RERANK_MODEL: &str = "qwen3-rerank";

pub struct HttpReranker {
    client: reqwest::blocking::Client,
    endpoint: String,
    api_key: String,
    model: String,
    style: RemoteApiStyle,
}

impl HttpReranker {
    pub fn new(
        endpoint: String,
        api_key: String,
        model: String,
        style: RemoteApiStyle,
    ) -> RerankResult<Self> {
        if !endpoint.starts_with("https://") {
            return Err(RerankError::Invalid(format!(
                "rerank endpoint must use https: {endpoint}"
            )));
        }
        if api_key.trim().is_empty() {
            return Err(RerankError::Invalid("rerank API key is empty".to_string()));
        }
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|error| RerankError::Invalid(error.to_string()))?;
        Ok(Self {
            client,
            endpoint,
            api_key,
            model,
            style,
        })
    }

    /// Request body, kept public for tests so a shape change is reviewable.
    pub fn payload(&self, query: &str, documents: &[&str]) -> serde_json::Value {
        match self.style {
            RemoteApiStyle::Protocol => serde_json::json!({
                "model": self.model,
                "query": query,
                "documents": documents,
                "top_n": documents.len(),
            }),
            // Model Studio nests query/documents under `input` and options under `parameters`.
            RemoteApiStyle::DashScope => serde_json::json!({
                "model": self.model,
                "input": { "query": query, "documents": documents },
                "parameters": { "top_n": documents.len(), "return_documents": false },
            }),
        }
    }
}

/// Reads `results[]` into one score per document index.
///
/// Entries may arrive in any order and may be clipped by `top_n`; a document without a
/// score is a hard error, because silently treating it as "worst" changes the ranking.
pub fn parse_scores(body: &str, documents: usize) -> RerankResult<Vec<RerankScore>> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| RerankError::Invalid(format!("rerank response is not JSON: {error}")))?;
    // Model Studio nests the list under `output.results`; the protocol shape is top level.
    let results = value
        .get("results")
        .or_else(|| value.get("output").and_then(|output| output.get("results")))
        .and_then(|results| results.as_array())
        .ok_or_else(|| RerankError::Invalid("rerank response lacks results[]".to_string()))?;
    let mut scores: Vec<Option<f32>> = vec![None; documents];
    for entry in results {
        let index = entry
            .get("index")
            .and_then(|index| index.as_u64())
            .ok_or_else(|| RerankError::Invalid("rerank result lacks index".to_string()))?
            as usize;
        let score = entry
            .get("relevance_score")
            .or_else(|| entry.get("score"))
            .and_then(|score| score.as_f64())
            .ok_or_else(|| RerankError::Invalid("rerank result lacks a score".to_string()))?;
        if index >= documents {
            return Err(RerankError::Invalid(format!(
                "rerank result index {index} exceeds {documents} documents"
            )));
        }
        if !score.is_finite() {
            return Err(RerankError::Invalid("rerank score is not finite".to_string()));
        }
        scores[index] = Some(score as f32);
    }
    scores
        .into_iter()
        .enumerate()
        .map(|(index, score)| {
            score
                .map(|score| RerankScore {
                    index,
                    score,
                })
                .ok_or_else(|| {
                    RerankError::Invalid(format!(
                        "rerank response omitted a score for document {index}"
                    ))
                })
        })
        .collect()
}

impl RerankProvider for HttpReranker {
    fn score(&self, query: &str, documents: &[&str]) -> RerankResult<Vec<RerankScore>> {
        let response = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(&self.payload(query, documents))
            .send()
            .map_err(|error| RerankError::Provider(error.to_string()))?;
        let status = response.status();
        let body = response
            .text()
            .map_err(|error| RerankError::Provider(error.to_string()))?;
        if !status.is_success() {
            let trimmed: String = body.chars().take(200).collect();
            return Err(RerankError::Provider(format!(
                "rerank API answered {status}: {trimmed}"
            )));
        }
        parse_scores(&body, documents.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_jina_and_cohere_shaped_results() {
        let body = r#"{"results":[{"index":1,"relevance_score":0.9},{"index":0,"relevance_score":0.2}]}"#;
        let scores = parse_scores(body, 2).expect("scores");
        assert_eq!(scores[0].index, 0);
        assert!((scores[0].score - 0.2).abs() < 1e-6);
        assert_eq!(scores[1].index, 1);
        assert!((scores[1].score - 0.9).abs() < 1e-6);
    }

    #[test]
    fn accepts_a_plain_score_key() {
        let body = r#"{"results":[{"index":0,"score":0.5}]}"#;
        let scores = parse_scores(body, 1).expect("scores");
        assert!((scores[0].score - 0.5).abs() < 1e-6);
    }

    #[test]
    fn a_missing_document_score_is_an_error() {
        let body = r#"{"results":[{"index":0,"relevance_score":0.5}]}"#;
        assert!(parse_scores(body, 2).is_err());
    }

    #[test]
    fn an_out_of_range_index_is_an_error() {
        let body = r#"{"results":[{"index":3,"relevance_score":0.5}]}"#;
        assert!(parse_scores(body, 1).is_err());
    }

    #[test]
    fn payload_carries_model_query_and_documents() {
        let reranker = HttpReranker::new(
            JINA_RERANK_ENDPOINT.to_string(),
            "token".to_string(),
            JINA_RERANK_MODEL.to_string(),
            RemoteApiStyle::Protocol,
        )
        .expect("provider");
        let payload = reranker.payload("q", &["a", "b"]);
        assert_eq!(payload["model"], JINA_RERANK_MODEL);
        assert_eq!(payload["query"], "q");
        assert_eq!(payload["documents"].as_array().expect("array").len(), 2);
        assert_eq!(payload["top_n"], 2);
    }

    #[test]
    fn a_plain_http_endpoint_is_rejected() {
        assert!(HttpReranker::new(
            "http://api.example.com/rerank".to_string(),
            "token".to_string(),
            "model".to_string(),
            RemoteApiStyle::Protocol,
        )
        .is_err());
    }
}



#[cfg(test)]
mod dashscope_tests {
    use super::*;

    fn reranker() -> HttpReranker {
        HttpReranker::new(
            DASHSCOPE_RERANK_ENDPOINT.to_string(),
            "token".to_string(),
            DASHSCOPE_RERANK_MODEL.to_string(),
            RemoteApiStyle::DashScope,
        )
        .expect("provider")
    }

    #[test]
    fn the_payload_nests_query_and_documents_under_input() {
        let payload = reranker().payload("q", &["a", "b"]);
        assert_eq!(payload["model"], DASHSCOPE_RERANK_MODEL);
        assert_eq!(payload["input"]["query"], "q");
        assert_eq!(
            payload["input"]["documents"].as_array().expect("array").len(),
            2
        );
        assert_eq!(payload["parameters"]["top_n"], 2);
        assert!(payload.get("query").is_none());
    }

    #[test]
    fn scores_are_read_from_output_results() {
        let body = r#"{"output":{"results":[{"index":0,"relevance_score":0.8}]},
                       "usage":{"total_tokens":12},"request_id":"r"}"#;
        let scores = parse_scores(body, 1).expect("scores");
        assert!((scores[0].score - 0.8).abs() < 1e-6);
    }

    #[test]
    fn an_error_body_without_results_is_rejected() {
        let body = r#"{"code":"InvalidApiKey","message":"Invalid API-key provided."}"#;
        assert!(parse_scores(body, 1).is_err());
    }
}

