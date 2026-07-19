use thiserror::Error;

pub type SearchResult<T> = Result<T, SearchError>;

#[derive(Debug, Error)]
pub enum SearchError {
    #[error("search query is empty")]
    EmptyQuery,
    #[error("semantic search is not available in the keyword MVP")]
    SemanticUnavailable,
    #[error("embedding provider is unavailable: {0}")]
    EmbeddingUnavailable(String),
    #[error("vector store is unavailable: {0}")]
    VectorStoreUnavailable(String),
    #[error("vector index io failed: {0}")]
    VectorIndexIo(String),
    #[error("vector dimensions do not match: expected {expected}, actual {actual}")]
    VectorDimensionMismatch { expected: usize, actual: usize },
    #[error("search index lock is poisoned")]
    LockPoisoned,
}
