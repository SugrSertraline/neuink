use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ArxivPaper {
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
    #[serde(flatten)]
    pub arxiv: ArxivMetadata,
}

// Optional on the wire so older records and non-arXiv providers keep their shape.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct ArxivMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub categories: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journal_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rank: Option<u64>,
}

impl From<super::Paper> for ArxivPaper {
    fn from(p: super::Paper) -> Self {
        Self {
            id: p.id,
            title: p.title,
            authors: p.authors,
            year: p.year,
            abstract_text: p.abstract_text,
            doi: p.doi,
            url: p.url,
            pdf_url: p.pdf_url,
            provider: p.provider,
            evidence_level: p.evidence_level,
            arxiv: Default::default(),
        }
    }
}
impl From<ArxivPaper> for super::Paper {
    fn from(p: ArxivPaper) -> Self {
        Self {
            id: p.id,
            title: p.title,
            authors: p.authors,
            year: p.year,
            abstract_text: p.abstract_text,
            doi: p.doi,
            url: p.url,
            pdf_url: p.pdf_url,
            provider: p.provider,
            evidence_level: p.evidence_level,
        }
    }
}
