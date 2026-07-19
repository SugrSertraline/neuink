use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PdfAsset {
    pub file_name: String,
    pub content_hash: String,
    pub imported_at: DateTime<Utc>,
    pub parse: PdfParseState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PdfParseState {
    pub status: PdfParseStatus,
    pub updated_at: DateTime<Utc>,
    pub message: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub endpoint: Option<String>,
}

impl PdfParseState {
    pub fn not_started() -> Self {
        Self {
            status: PdfParseStatus::NotStarted,
            updated_at: Utc::now(),
            message: None,
            task_id: None,
            endpoint: None,
        }
    }

    pub fn can_transition(from: PdfParseStatus, to: PdfParseStatus) -> bool {
        use PdfParseStatus::*;

        matches!(
            (from, to),
            (NotStarted, Queued)
                | (NotStarted, Canceled)
                | (Queued, Uploading)
                | (Queued, Canceled)
                | (Uploading, Uploaded)
                | (Uploading, Failed)
                | (Uploading, Canceled)
                | (Uploaded, Parsing)
                | (Uploaded, Failed)
                | (Uploaded, Canceled)
                | (Parsing, Succeeded)
                | (Parsing, Failed)
                | (Parsing, Canceled)
                | (Failed, Queued)
        )
    }
}

impl Default for PdfParseState {
    fn default() -> Self {
        Self::not_started()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PdfParseStatus {
    NotStarted,
    Queued,
    Uploading,
    Uploaded,
    Parsing,
    Succeeded,
    Failed,
    Canceled,
}

#[cfg(test)]
mod tests {
    use super::{PdfParseState, PdfParseStatus};

    #[test]
    fn succeeded_does_not_transition_back() {
        assert!(!PdfParseState::can_transition(
            PdfParseStatus::Succeeded,
            PdfParseStatus::Parsing
        ));
    }

    #[test]
    fn parsing_can_succeed() {
        assert!(PdfParseState::can_transition(
            PdfParseStatus::Parsing,
            PdfParseStatus::Succeeded
        ));
    }
}
