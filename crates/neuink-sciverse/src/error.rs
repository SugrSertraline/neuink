use reqwest::StatusCode;

pub type SciverseResult<T> = Result<T, SciverseError>;

#[derive(Debug, thiserror::Error)]
pub enum SciverseError {
    #[error("Sciverse API token is required")]
    MissingApiToken,
    #[error("invalid Sciverse base URL: {0}")]
    InvalidBaseUrl(String),
    #[error("Sciverse request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("Sciverse returned an unexpected JSON response ({status}, {content_type}) at {path}: {message}")]
    Decode {
        status: StatusCode,
        content_type: String,
        path: String,
        message: String,
    },
    #[error("Sciverse API returned {status}: {message}")]
    Api {
        status: StatusCode,
        code: Option<String>,
        message: String,
        request_id: Option<String>,
    },
}

impl SciverseError {
    pub fn status(&self) -> Option<StatusCode> {
        match self {
            Self::Api { status, .. } | Self::Decode { status, .. } => Some(*status),
            _ => None,
        }
    }

    pub fn code(&self) -> Option<&str> {
        match self {
            Self::Api { code, .. } => code.as_deref(),
            _ => None,
        }
    }

    pub fn request_id(&self) -> Option<&str> {
        match self {
            Self::Api { request_id, .. } => request_id.as_deref(),
            _ => None,
        }
    }
}
