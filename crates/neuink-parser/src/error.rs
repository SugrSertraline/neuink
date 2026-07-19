use reqwest::StatusCode;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ParserError {
    #[error("parser endpoint returned no recognizable content list")]
    MissingContentList,
    #[error("parser returned no segments")]
    EmptyDocument,
    #[error("invalid parser response: {0}")]
    InvalidResponse(String),
    #[error("parser endpoint returned non-JSON response for {url}: content-type {content_type}")]
    NonJsonResponse { url: String, content_type: String },
    #[error("parser configuration is invalid: {0}")]
    InvalidConfig(String),
    #[error("parser endpoint returned HTTP {status} for {url}{body}")]
    HttpStatus {
        status: StatusCode,
        url: String,
        body: String,
    },
    #[error("parser task failed: {0}")]
    TaskFailed(String),
    #[error("parser task did not finish in time")]
    TaskTimeout,
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
}
