use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Paper {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: String,
    pub abstract_text: String,
    pub doi: String,
    pub url: String,
    pub pdf_url: Option<String>,
    pub provider: String,
    pub evidence_level: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RecommendedPaper {
    #[serde(flatten)]
    pub paper: Paper,
    pub published: String,
    pub updated: String,
    pub categories: Vec<String>,
    pub reasons: Vec<String>,
    pub matched_interests: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RecommendationBatch {
    pub date: String,
    pub generated_at: String,
    pub interest_key: String,
    pub interests: Vec<String>,
    pub papers: Vec<RecommendedPaper>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RecommendationFeedback {
    pub id: String,
    pub ignored: bool,
    pub saved: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Recommendations {
    pub version: u16,
    pub batches: Vec<RecommendationBatch>,
    pub feedback: Vec<RecommendationFeedback>,
    pub last_attempt_at: Option<String>,
    pub last_error: Option<String>,
    #[serde(default)]
    pub retry_after: Option<String>,
}
impl Default for Recommendations {
    fn default() -> Self {
        Self {
            version: 1,
            batches: vec![],
            feedback: vec![],
            last_attempt_at: None,
            last_error: None,
            retry_after: None,
        }
    }
}
