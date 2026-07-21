use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SciverseBinaryResource {
    pub bytes: Vec<u8>,
    pub content_type: Option<String>,
    pub content_disposition: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AgenticSearchFilter {
    #[serde(flatten)]
    pub values: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AgenticSearchRequest {
    pub query: String,
    #[serde(default = "default_top_k")]
    pub top_k: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_queries: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<AgenticSearchFilter>,
}

impl AgenticSearchRequest {
    pub fn new(query: impl Into<String>) -> Self {
        Self {
            query: query.into(),
            top_k: default_top_k(),
            sub_queries: None,
            filters: None,
        }
    }
}

fn default_top_k() -> u32 {
    10
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AgenticSearchResponse {
    #[serde(default)]
    pub hits: Vec<AgenticSearchHit>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AgenticSearchHit {
    #[serde(default)]
    pub chunk_id: Option<String>,
    #[serde(default)]
    pub chunk: String,
    #[serde(default)]
    pub doc_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    #[serde(default)]
    pub score: Option<f64>,
    #[serde(default)]
    pub source_type: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_nonnegative_u64")]
    pub offset: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_nonnegative_u32")]
    pub page_no: Option<u32>,
    #[serde(default)]
    pub lang: Option<String>,
    #[serde(default)]
    pub metadata_type: Option<String>,
    #[serde(default)]
    pub author: Vec<String>,
    #[serde(default)]
    pub publication_venue_name_unified: Option<String>,
    #[serde(default)]
    pub publication_venue_type: Option<String>,
    #[serde(default)]
    pub publication_published_date: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_nonnegative_u32")]
    pub publication_published_year: Option<u32>,
    #[serde(default, deserialize_with = "deserialize_optional_nonnegative_u64")]
    pub citation_count: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_nonnegative_u64")]
    pub influential_citation_count: Option<u64>,
    #[serde(default)]
    pub primary_topic: Option<String>,
    #[serde(default)]
    pub primary_topic_domain: Option<String>,
    #[serde(default)]
    pub doi: Option<String>,
    #[serde(default)]
    pub access_is_oa: Option<bool>,
    #[serde(default)]
    pub access_oa_url: Option<String>,
    #[serde(default)]
    pub access_license: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ContentRequest {
    pub doc_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct ContentResponse {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub chars_returned: u64,
    #[serde(default)]
    pub next_offset: u64,
    #[serde(default)]
    pub more: bool,
}

fn deserialize_optional_nonnegative_u64<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(value.and_then(nonnegative_u64))
}

fn deserialize_optional_nonnegative_u32<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    deserialize_optional_nonnegative_u64(deserializer)
        .map(|value| value.and_then(|number| u32::try_from(number).ok()))
}

fn nonnegative_u64(value: Value) -> Option<u64> {
    match value {
        Value::Number(number) => number.as_u64(),
        Value::String(text) => text.trim().parse::<u64>().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::AgenticSearchResponse;

    #[test]
    fn unknown_negative_metadata_counts_do_not_reject_search_results() {
        let response: AgenticSearchResponse = serde_json::from_value(serde_json::json!({
            "hits": [{
                "doc_id": "doc-1",
                "chunk": "Evidence",
                "influential_citation_count": -1,
                "citation_count": "128",
                "offset": -1,
                "page_no": -1,
                "publication_published_year": "2021"
            }]
        }))
        .expect("response");

        let hit = &response.hits[0];
        assert_eq!(hit.influential_citation_count, None);
        assert_eq!(hit.citation_count, Some(128));
        assert_eq!(hit.offset, None);
        assert_eq!(hit.page_no, None);
        assert_eq!(hit.publication_published_year, Some(2021));
    }
}
