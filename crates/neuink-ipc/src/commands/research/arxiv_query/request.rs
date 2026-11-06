use serde::{Deserialize, Serialize};

pub const MAX_QUERY_CHARS: usize = 1000;
pub const MAX_RAW_CHARS: usize = 4000;
pub const MAX_TERMS: usize = 20;
pub const MAX_CATEGORIES: usize = 20;
pub const MAX_IDS: usize = 100;
pub const MAX_CATEGORY_CHARS: usize = 64;
pub const MAX_ID_INPUT_CHARS: usize = 256;
pub const DEFAULT_RESULTS: u64 = 20;
pub const MAX_RESULTS: u64 = 100;
pub const MAX_WINDOW_END: u64 = 30_000;
pub const MAX_DAYS_BACK: u64 = 36_500;

#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Structured {
        query: Option<String>,
        keywords: Option<Vec<String>>,
        search_field: Option<SearchField>,
        categories: Option<Vec<String>>,
        sort_by: Option<SortBy>,
        sort_order: Option<SortOrder>,
        start: Option<u64>,
        page_size: Option<u64>,
        max_results: Option<u64>,
        days_back: Option<u64>,
    },
    Raw {
        raw_query: String,
        sort_by: Option<SortBy>,
        sort_order: Option<SortOrder>,
        start: Option<u64>,
        page_size: Option<u64>,
        max_results: Option<u64>,
    },
    Ids {
        ids: Vec<String>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchField {
    All,
    Title,
    Abstract,
    TitleAbstract,
    Author,
    Comment,
    JournalRef,
    ReportNumber,
}

impl SearchField {
    pub fn prefix(self) -> Option<&'static str> {
        Some(match self {
            Self::All => "all",
            Self::Title => "ti",
            Self::Abstract => "abs",
            Self::Author => "au",
            Self::Comment => "co",
            Self::JournalRef => "jr",
            Self::ReportNumber => "rn",
            Self::TitleAbstract => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub enum SortBy {
    #[serde(rename = "relevance")]
    Relevance,
    #[default]
    #[serde(rename = "submittedDate")]
    SubmittedDate,
    #[serde(rename = "lastUpdatedDate")]
    LastUpdatedDate,
}
impl SortBy {
    pub fn parameter(self) -> &'static str {
        match self {
            Self::Relevance => "relevance",
            Self::SubmittedDate => "submittedDate",
            Self::LastUpdatedDate => "lastUpdatedDate",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    Ascending,
    #[default]
    Descending,
}
impl SortOrder {
    pub fn parameter(self) -> &'static str {
        match self {
            Self::Ascending => "ascending",
            Self::Descending => "descending",
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct QueryError {
    pub code: &'static str,
    pub field: String,
    pub message: &'static str,
}
impl QueryError {
    pub fn new(code: &'static str, field: &str, message: &'static str) -> Self {
        Self {
            code,
            field: field.into(),
            message,
        }
    }
}

pub fn text(value: &str, max: usize, field: &str) -> Result<(), QueryError> {
    if value.trim().is_empty() {
        return Err(QueryError::new(
            "invalid_arguments",
            field,
            "检索条件不能为空",
        ));
    }
    if value.chars().count() > max {
        return Err(QueryError::new(
            "limit_exceeded",
            field,
            "检索条件超过字符上限",
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(QueryError::new(
            "invalid_arguments",
            field,
            "检索条件不能包含控制字符",
        ));
    }
    Ok(())
}

pub fn list_length(size: usize, max: usize, field: &str) -> Result<(), QueryError> {
    if size == 0 || size > max {
        Err(QueryError::new(
            "limit_exceeded",
            field,
            "列表必须非空且不超过数量上限",
        ))
    } else {
        Ok(())
    }
}

pub fn category(value: &str) -> bool {
    let stem = value.strip_suffix(".*").unwrap_or(value);
    !stem.is_empty()
        && stem.len() <= MAX_CATEGORY_CHARS
        && stem.split('.').all(|part| {
            !part.is_empty()
                && part.as_bytes()[0].is_ascii_alphabetic()
                && part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
}
