use neuink_domain::EntryId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SearchQuery {
    pub text: String,
    #[serde(default)]
    pub mode: SearchMode,
    #[serde(default)]
    pub scope: SearchScope,
    #[serde(default)]
    pub include: SearchInclude,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

impl SearchQuery {
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            mode: SearchMode::Keyword,
            scope: SearchScope::default(),
            include: SearchInclude::default(),
            limit: default_limit(),
        }
    }

    pub fn normalized_text(&self) -> String {
        self.text.trim().to_string()
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    #[default]
    Keyword,
    Semantic,
    Hybrid,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct SearchScope {
    #[serde(default)]
    pub entry_ids: Vec<EntryId>,
}

impl SearchScope {
    pub fn contains_entry(&self, entry_id: &EntryId) -> bool {
        self.entry_ids.is_empty() || self.entry_ids.iter().any(|id| id == entry_id)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SearchInclude {
    #[serde(default = "default_true")]
    pub entry_meta: bool,
    #[serde(default = "default_true")]
    pub notes: bool,
    #[serde(default = "default_true")]
    pub segments: bool,
}

impl Default for SearchInclude {
    fn default() -> Self {
        Self {
            entry_meta: true,
            notes: true,
            segments: true,
        }
    }
}

fn default_limit() -> usize {
    40
}

fn default_true() -> bool {
    true
}
