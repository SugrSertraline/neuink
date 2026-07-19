mod embedding_provider_trait;
mod error;
mod fastembed_provider;
mod memory_index;
mod persistent_semantic_index;
mod query;
mod result;
mod rrf;
mod search_index_trait;
mod token;
mod vector_store_trait;

pub use embedding_provider_trait::{
    EmbeddingInput, EmbeddingProvider, EmbeddingProviderStatus, EmbeddingVector,
};
pub use error::{SearchError, SearchResult};
pub use fastembed_provider::{
    FastEmbedProvider, DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR, LOCAL_EMBEDDING_BATCH_SIZE,
};
pub use memory_index::MemorySearchIndex;
pub use persistent_semantic_index::{
    merge_hybrid_results, semantic_index_path, semantic_result_mode, PersistentSemanticSearchIndex,
};
pub use query::{SearchInclude, SearchMode, SearchQuery, SearchScope};
pub use result::{
    SearchDocument, SearchDocumentSource, SearchDocumentSourceKind, SearchEntryGroup, SearchHit,
    SearchResults, SearchTarget, SearchTextSection,
};
pub use rrf::{reciprocal_rank_fusion, DEFAULT_RRF_K};
pub use search_index_trait::SearchIndex;
pub use vector_store_trait::{VectorRecord, VectorSearchHit, VectorStore};
