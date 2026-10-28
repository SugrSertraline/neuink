use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ResearchDocument {
    pub id: String,
    pub title: String,
    pub evidence_level: String,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ResearchTask {
    pub version: u32,
    pub id: String,
    pub query: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub status: String,
    pub stage: String,
    pub profile_id: String,
    pub model: String,
    pub retriever: String,
    pub depth: String,
    pub timeout_seconds: u64,
    pub documents: Vec<ResearchDocument>,
    pub source_urls: Vec<String>,
    pub report: String,
    pub error: Option<String>,
    pub engine_version: String,
    #[serde(default = "legacy_engine")]
    pub engine: String,
    pub cost_estimate: Option<f64>,
}

fn legacy_engine() -> String { "gpt-researcher".into() }
